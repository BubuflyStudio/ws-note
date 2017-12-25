/**
 * 替代 engine.io 原有的 socket 层
 *
 * @author wujohns
 * @date 17/12/7
 */
'use strict';

const _ = require('lodash');
const async = require('async');
const parser = require('engine.io-parser');
const EventEmitter = require('events').EventEmitter;
const debug = require('debug')('engine:socket');

class Socket extends EventEmitter {
    /**
     * 初始化
     * @param {Object} config - 初始化配置
     * @param {String} id - socket 编号
     * @param {Number} pingTimeout - 心跳包超时时间（ms）
     * @param {Number} pingInterval - 心跳包轮询时间（ms）
     * @param {Boolean} supportsBinary - 是否支持二进制数据
     * @param {Object} perMessageDeflate - ws 消息压缩配置
     * @param {wsModule} socket - ws 模块处理 upgrade 请求后生成的 socket 对象
     */
    constructor (config) {
        super();
        this.id = config.id;
        this.pingTimeout = config.pingTimeout;
        this.pingInterval = config.pingInterval;
        this.supportsBinary = config.supportsBinary;
        this.perMessageDeflate = config.perMessageDeflate;
        this.socket = config.socket;

        this.pingTimeoutTimer = null;
        this.readyState = 'opening';
        this.writable = true;       // 该 writable 并不是严格的锁
        this.writeBuffers = [];
        this.cleanupFn = [];

        this.writable = true;
        this.setSocket();   // socket 相关事件的初始化
        this.onOpen();      // socket 初始化
    }

    /**
     * 该 socket 对象的初始化
     */
    onOpen () {
        this.sendPacket('open', JSON.stringify({    // 发送服务端的配置信息
            sid: this.id,
            upgrades: [],
            pingInterval: this.pingInterval,
            pingTimeout: this.pingTimeout
        }));
        this.setPingTimeout();      // 设定心跳包过期时间

        // 设定状态为 open，并抛出 open 事件
        this.readyState = 'open';
        this.emit('open');
    }

    /**
     * socket 事件设定
     */
    setSocket () {
        const onClose = () => this.onClose('transport close');
        const onError = (msg, meta) => {
            if (this.socket.listeners('error').length) {
                // 如果有对该 transport 对象的 error 事件的监听处理函数，则进行处理
                const err = new Error(msg);
                err.type = 'SocketError';
                err.meta = meta;
                this.onError(err);
            } else {
                debug('ignored socket error %s (%s)', msg, meta);
            }
        };
        const onData = (data) => this.onData(data);

        // 添加对 socket 事件的相关处理
        this.socket.once('close', onClose);
        this.socket.on('error', onError);
        this.socket.on('message', onData);

        // 添加清理函数
        this.cleanupFn.push(() => {
            this.socket.removeListener('close', onClose);
            this.socket.removeListener('error', onError);
            this.socket.removeListener('message', onData);
        });
    }

    /**
     * 设定心跳包超时计时
     */
    setPingTimeout () {
        clearTimeout(this.pingTimeoutTimer);
        this.pingTimeoutTimer = setTimeout(
            () => this.onClose('ping timeout'),
            this.pingInterval + this.pingTimeout
        );
    }

    /**
     * socket 关闭处理
     * @param {String} reason - 关闭原因
     * @param {String} desc - 关闭描述
     */
    onClose (reason, desc) {
        if (this.readyState !== 'closed') {
            this.readyState = 'closed';

            // 清理心跳包超时计时
            clearTimeout(this.pingTimeoutTimer);

            // 重置缓存的消息和消息回调处理
            process.nextTick(() => this.writeBuffers = []);  // 异步置为空方便调试
            this.packetsFn = [];
            this.sentCallbackFn = [];

            // 执行预先设定的 cleanup
            _.forEach(this.cleanupFn, (cleanup) => cleanup());
            this.cleanupFn = [];

            // 关闭 socket 并抛出 close 事件
            this.socket.on('error', () => debug('error triggered when closing socket'));
            this.socket.close();
            this.emit('close', reason, desc);
        }
    }

    /**
     * 对 transport 错误的处理
     * @param {Error} err - 错误对象
     */
    onError (err) {
        debug('socket error');
        this.onClose('socket error', err);
    }

    /**
     * 收到消息时的处理
     * @param {Object} data - 收到的消息
     */
    onData (data) {
        debug('received "%s"', data);
        
        if (this.readyState === 'open') {
            debug('packet');
            
            const packet = parser.decodePacket(data);
            this.emit('packet', packet);
            this.setPingTimeout();

            switch (packet.type) {
                case 'ping':
                    debug('got ping');
                    this.sendPacket('pong');
                    this.emit('heartbeat');
                    break;
                case 'error':
                    this.onClose('parse error');
                    break;
                case 'message':
                    this.emit('data', packet.data);
                    this.emit('message', packet.data);
                    break;
                default:
                    break;
            }
        } else {
            debug('packet received with closed socket');
        }
    }

    /**
     * 发送消息方法
     * @param {String} data - 发送的数据
     * @param {Object} options - 发送时的配置
     * @param {Function} callback - 回调
     * @return {Socket} 返回对象本身方便链式操作方式
     */
    send (data, options, callback) {
        this.sendPacket('message', data, options, callback);
        return this;
    }

    /**
     * 发送消息方法
     * @param {String} data - 发送的数据
     * @param {Object} options - 发送时的配置
     * @param {Function} callback - 回调
     * @return {Socket} 返回对象本身方便链式操作方式
     */
    write (data, options, callback) {
        this.sendPacket('message', data, options, callback);
        return this;
    }

    /**
     * 发送数据报的统一方法
     * @param {String} type - 数据报的类型
     * @param {String} data - 发送的数据
     * @param {Object} options - 发送配置
     * @param {Function} callback - 回调
     */
    sendPacket (type, data, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        options = options || {};
        options.compress = !!options.compress;

        if (
            this.readyState !== 'closing' &&
            this.readyState !== 'closed'
        ) {
            debug('sending packet "%s" (%s)', type, data);
            const packet = {
                type: type,
                options: options
            };
            data && (packet.data = data);

            this.emit('packetCreate', packet);
            const writeBuffer= {
                packet: packet
            };
            callback && (writeBuffer.callback = callback);
            this.writeBuffers.push(writeBuffer);
            this.flush();
        }
    }

    /**
     * 向客户端发送 writeBuffer 中积累的数据
     */
    flush () {
        const canFlush = (
            this.readyState !== 'closed' &&     // socket 为非关闭状态
            this.writable &&                    // transport 处于可写状态（没有被占用）
            this.writeBuffers.length            // writeBuffer 中有积压的数据
        );

        if (!canFlush) {
            // 如果不满足发送积累的数据的条件则不进行 flush 操作
            return;
        }

        debug('flushing buffer');
        const packets = _.map(this.writeBuffers, (writeBuffer) => writeBuffer.packet);
        this.emit('flush', packets);

        // 提取当前 writeBuffer 中积压的数据并清空 writeBuffer
        const writeBuffers = this.writeBuffers;
        this.writeBuffers = [];

        // 发送积累的 packets
        this.writable = false;
        async.map(
            writeBuffers,
            (writeBuffer, callback) => this.sendPacketInTime(writeBuffer, callback),
            (err) => {
                return err && this.onError('write error', err.stack);
            }
        );
        this.emit('drain');     // 不等待 socket 完全完成
    }

    /**
     * 即时发送 packet
     * @param {Object} writeBuffer - 发送时的配置
     * @param {Object} writeBuffer.packet - engine.io-parser 格式的数据
     * @param {Object} writeBuffer.callback - 本次发送后的回调（由用户自定义）
     * @param {Function} callback - 该此数据发送后的回调
     */
    sendPacketInTime (writeBuffer, callback) {
        const packet = writeBuffer.packet;
        async.auto({
            // 编码数据
            parser: (callback) => {
                parser.encodePacket(packet, this.supportsBinary, (data) => {
                    return callback(null, data);
                });
            },
            // 使用 ws 通道发送数据
            send: ['parser', (results, callback) => {
                const data = results.parser;
                debug('writing "%s"', data);

                let compress = _.get(packet.options, 'compress');
                if (this.perMessageDeflate) {
                    const length = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
                    if (length < this.perMessageDeflate.threshold) {
                        // 数据长度小于阈值则不进行压缩
                        compress = false;
                    }
                }

                this.socket.send(data, { compress: compress }, callback);
            }]
        }, (err) => {
            if (err) {
                return callback(err);
            }

            // 执行消息发送后回调，并尝试发送下一批消息
            writeBuffer.callback && writeBuffer.callback();
            this.writable = true;
            this.flush();
            return callback();
        });
    }

    /**
     * 关闭 socket
     */
    close () {
        if (this.readyState !== 'open') {
            return;
        }
        this.readyState = 'closing';

        const reason = 'force close';
        if (!_.isEmpty(this.writeBuffers)) {
            // 如果缓存中还有未发送的消息，则等待消息发送完成后再关闭 transport
            this.once('drain', () => this.onClose(reason));
            return;
        }
        this.onClose(reason);
    }
}

module.exports = Socket;