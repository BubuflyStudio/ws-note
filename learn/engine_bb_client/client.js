/**
 * 简化版 engine.io 客户端
 *
 * @author wujohns
 * @date 17/12/15
 */
'use strict';

const parser = require('engine.io-parser');
const EventEmitter = require('component-emitter');
const debug = require('debug')('engine.io-client');

const Transport = require('./transport');

class Client extends EventEmitter {
    /**
     * 初始化
     * @param {String} uri - 目标地址
     * @param {Object} options - 连接配置
     */
    constructor (uri, options) {
        super();

        this.uri = uri;

        // 握手配置
        this.id = null;
        this.pingInterval = null;
        this.pingTimeout = null;

        // 心跳配置
        this.pingIntervalTimer = null;
        this.pingTimeoutTimer = null;

        // 写入配置
        this.prevBufferLen = 0;

        this.open();
    }

    /**
     * 初始化 transport 并启动
     */
    open () {
        this.readyState = 'opening';
        const transport = this.createTransport();
        transport.open();
        this.setTransport(transport);
    }

    /**
     * 创建 transport
     */
    createTransport () {
        debug('create transport');
        const transport = new Transport({
            uri: uri
        });
    }

    /**
     * 对 transport 的设定
     *
     * @param {Object} transport - transport
     */
    setTransport (transport) {
        debug('setting transport');
        
        if (this.transport) {
            debug('clearing existing transport');
            this.transport.removeAllListeners();
        }

        this.transport = transport;
        transport.on('packet', (packet) => this.onPacket(packet));
        transport.on('drain', () => this.onDrain());
        transport.on('error', (err) => this.onError(err));
        transport.on('close', () => this.onClose());
    }

    /**
     * packet 的处理
     *
     * @param {Object} packet - packet
     */
    onPacket (packet) {
        if (
            this.readyState === 'opening' ||
            this.readyState === 'open' ||
            this.readyState === 'closing'
        ) {
            debug('socket receive: type "%s", data "%s"', packet.type, packet.data);
            this.emit('packet', packet);
            this.emit('heartbeat');     // socket is live - any packet counts

            switch (packet.type) {
                case 'open':
                    // 初次连接后的握手处理
                    this.onHandshake(JSON.parse(packet.data));
                    break;

                case 'pong':
                    // 心跳包处理
                    this.setPing();
                    this.emit('pong');
                    break;

                case 'error':
                    const err = new Error('server error');
                    err.code = packet.data;
                    this.onError(err);
                    break;

                case 'message':
                    this.emit('data', packet.data);
                    this.emit('message', packet.data);
                    break;
            }
        } else {
            debug('packet received with socket readyState "%s"', this.readyState);
        }
    }

    /**
     * 握手处理
     *
     * @param {Object} data - 握手信息
     */
    onHandshake (data) {
        this.emit('handshake', data);
        this.id = data.sid;
        this.pingInterval = data.pingInterval;
        this.pingTimeout = data.pingTimeout;
        this.onOpen();

        if (this.readyState === 'closed') {
            return;
        }
        this.setPing();

        // TODO 可以考虑移除
        this.removeListener('heartbeat', this.onHeartbeat);
        this.on('heartbeat', this.onHeartbeat);
    }

    /**
     * 收到心跳包的处理
     */
    onHeartbeat (timeout) {
        clearTimeout(this.pingTimeoutTimer);
        this.pingTimeoutTimer = setTimeout(() => {
            if (this.readyState === 'closed') {
                return;
            }
            this.onClose('ping timeout');
        }, timeout || (this.pingInterval + this.pingTimeout));
    }

    /**
     * 设置 ping
     */
    setPing () {
        clearTimeout(this.pingIntervalTimer);
        this.pingIntervalTimer = setTimeout(() => {
            debug('writing ping packet - expecting pong within %sms', this.pingTimeout);
            this.ping();
            this.onHeartbeat(this.pingTimeout);
        }, this.pingInterval);
    }

    /**
     * 发送心跳包
     */
    ping () {
        this.sendPacket('ping', () => {
            this.emit('ping');
        });
    }

    /**
     * drain 事件的处理（写入完成时的处理）
     */
    onDrain () {
        this.writeBuffer.splice(0, this.prevBufferLen);
        this.prevBufferLen = 0;

        if (this.writeBuffer.length === 0) {
            this.emit('drain');
        } else {
            this.flush();
        }
    }

    /**
     * 错误处理相关
     * @param {Error} err - 错误对象
     */
    onError (err) {
        debug('socket error %j', err);
        this.emit('error', err);
        this.onClose('transport error', err);
    }

    /**
     * 关闭方法
     * @param {String} reason - 关闭原因
     * @param {Object} meta - 额外信息
     */
    onClose (reason, meta) {
        if (
            this.readyState === 'opening' ||
            this.readyState === 'open' ||
            this.readyState === 'closing'
        ) {
            debug('socket close with reason: "%s"', reason);

            // 清理 timers
            clearTimeout(this.pingIntervalTimer);
            clearTimeout(this.pingTimeoutTimer);

            this.transport.removeListener('close');
            this.transport.close();
            this.transport.removeAllListeners();

            this.readyState = 'closed';
            this.id = null;

            this.emit('close', reason, meta);
            this.writeBuffer = [];
            this.prevBufferLen = 0;
        }
    }

    /**
     * flush write buffers
     */
    flush () {
        if (
            this.readyState !== 'closed' &&
            this.transport.writable &&
            !this.upgrading &&
            this.writeBuffer.length
        ) {
            debug('flushing %d packets in socket', this.writeBuffer.length);
            this.transport.send(this.writeBuffer);
            this.prevBufferLen = this.writeBuffer.length;
            this.emit('flush');
        }
    }

    /** 
     * 发送消息
     * @param {String} message - 发送的内容
     * @param {Object} options - 发送配置
     * @param {Function} callback - 回调
     */
    write (message, options, callback) {
        this.sendPacket('message', message, options, callback);
        return this;
    }
    send (message, options, callback) {
        this.sendPacket('message', message, options, callback);
        return this;
    }

    /**
     * 发送 packet
     * @param {String} type - packet 类型
     * @param {String} data - 发送的内容
     * @param {Object} options - 发送配置
     * @param {Function} callback - 回调
     */
    sendPacket (type, data, options, callback) {
        if (
            this.readyState === 'closing' ||
            this.readyState === 'closed'
        ) {
            return;
        }

        if (typeof data === 'function') {
            callback = data;
            data = null;
        }
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        options = options || {};
        options.compress = !!options.compress;

        const packet = {
            type: type,
            data: data,
            options: options
        };
        this.emit('packetCreate', packet);
        this.writeBuffer.push(packet);
        if (callback) {
            this.once('flush', callback);
        }
        this.flush();
    }

    /**
     * 关闭连接
     */
    close () {
        const close = () => {
            this.onClose('forced close');
            debug('socket closing - telling transport to close');
            this.transport.close();
        };

        if (
            this.readyState === 'opening' ||
            this.readyState === 'open'
        ) {
            this.readyState = 'closing';
            if (this.writeBuffer.length) {
                this.once('drain', () => close());
            } else {
                close();
            }
        }
    }
}

module.exports = Client;