/**
 * engine.io_bb client
 *
 * @author wujohns
 * @data 17/12/23
 */
'use strict';

const parseuri = require('parseuri');
const parseqs = require('parseqs');
const parser = require('engine.io-parser');
const EventEmitter = require('component-emitter');
const debug = require('debug')('engine.io-client');

const WsModule = window.WebSocket || window.MozWebSocket;

class Client extends EventEmitter {
    /**
     * 初始化
     * @param {String} uri - 目标地址
     */
    constructor (uri) {
        super();

        this.uri = uri;

        // 状态
        this.supportsBinary = true;
        this.readyState = '';
        this.writable = false;
        this.ws = null;
        this.writeBuffer = [];

        // 握手配置
        this.id = null;
        this.pingInterval = null;
        this.pingTimeout = null;

        // 心跳 timer
        this.pingIntervalTimer = null;
        this.pingTimeoutTimer = null;

        this.open();
    }

    /**
     * 启动 websocket 客户端
     */
    open () {
        this.readyState = 'opening';
        
        // 尝试初始化 ws 对象
        try {
            this.ws = new WsModule(this.uri);
        } catch (err) {
            return this.emit('error', err);
        }

        const query = parseuri(this.uri).query;
        const b64 = parseqs.decode(query).b64;
        if (!this.ws.binaryType || b64) {
            this.supportsBinary = false;
        }

        // ws 对象事件处理
        this.ws.onopen = () => this.writable = true;
        this.ws.onmessage = (event) => {
            const packet = parser.decodePacket(event.data);
            this.onPacket(packet);
        };
        this.ws.onclose = () => this.onClose('normal close');
        this.ws.onerror = (wsError) => {
            const err = new Error('websocket error');
            err.meta = wsError;
            this.onError(err);
        };
    }

    /**
     * packet 的处理
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
            this.id && this.resetTimeout();     // 在握手后，每次收到消息都重置一次超时

            switch (packet.type) {
                case 'open':
                    // 初次连接后的握手处理
                    this.onHandshake(JSON.parse(packet.data));
                    break;
                case 'pong':
                    // 收到心跳包响应
                    this.setPing();     // 设置下一次 ping 的发送
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
            debug('packet received with client readyState "%s"', this.readyState);
        }
    }

    /**
     * 握手处理
     * @param {Object} data - 握手处理
     */
    onHandshake (data) {
        this.emit('handshake', data);
        this.id = data.sid;
        this.pingInterval = data.pingInterval;
        this.pingTimeout = data.pingTimeout;

        debug('client open');
        this.readyState = 'open';
        this.emit('open');
        this.flush();
        this.setPing();
    }

    /**
     * 设置 ping
     */
    setPing () {
        clearTimeout(this.pingIntervalTimer);
        this.pingIntervalTimer = setTimeout(() => {
            debug('writing ping packet - expecting pong packet within %sms', this.pingTimeout);
            this.sendPacket('ping', () => this.emit('ping'));
            this.resetTimeout(this.pingTimeout);
        }, this.pingInterval);
    }

    /**
     * 设置 pingTimeout
     */
    resetTimeout (timeout) {
        clearTimeout(this.pingTimeoutTimer);
        this.pingTimeoutTimer = setTimeout(() => {
            if (this.readyState === 'closed') {
                return;
            }
            this.onClose('ping timeout');
        }, timeout || (this.pingInterval + this.pingTimeout));
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
            data = undefined;
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
        this.writeBuffer.push(packet);
        callback && this.once('flush', callback);
        this.flush();
    }

    /**
     * 发送 writeBuffer 中的数据
     */
    flush () {
        if (
            this.readyState !== 'closed' &&
            this.writable && this.writeBuffer.length
        ) {
            debug('flushing %d packets in socket', this.writeBuffer.length);
            this.prevBufferLen = this.writeBuffer.length;
            this.wsSend(this.writeBuffer);
            this.emit('flush');
        }
    }

    /**
     * websocket 发送消息的封装
     * @param {Array} packets - 发送的 packets
     */
    wsSend (packets) {
        this.writable = false;

        // 发送任务创建
        const sendTasks = [];
        const length = packets.length;
        for (let i = 0; i < length; i++) {
            const packet = packets[i];
            const task = new Promise((resolve, reject) => {
                parser.encodePacket(packet, this.supportsBinary, (data) => {
                    try {
                        this.ws.send(data);
                    } catch (e) {
                        debug('websocket closed before onclose event');
                    }
                    return resolve();
                });
            });
            sendTasks.push(task);
        }
        Promise.all(sendTasks).then(() => {
            this.writable = true;
            this.writeBuffer.splice(0, this.prevBufferLen);
            this.prevBufferLen = 0;

            if (this.writeBuffer.length === 0) {
                this.emit('drain');
            } else {
                this.flush();
            }
        });
    }

    /**
     * 对外暴露的 send 方法
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

            this.ws && this.ws.close();
            
            this.readyState = 'closed';
            this.id = null;
            this.writeBuffer = [];
            this.prevBufferLen = 0;

            this.emit('close', reason, meta);
        }
    }

    /**
     * 错误处理相关
     * @param {Error} err - 错误对象
     */
    onError (err) {
        debug('socket error %j', err);
        this.emit('error', err);
        this.onClose('websocket error', err);
    }

    /**
     * 关闭连接（手动关闭）
     */
    close () {
        const close = () => {
            this.onClose('forced close');
        };

        if (
            this.readyState === 'opening' ||
            this.readyState === 'open'
        ) {
            this.readyState = 'closing';
            if (this.writeBuffer.length) {
                // 如果还有未 flush 的信息，则在 flush 后发送
                this.once('drain', () => close());
            } else {
                close();
            }
        }
    }
}

module.exports = Client;