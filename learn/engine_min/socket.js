/**
 * socket 方法封装
 *
 * @author wujohns
 * @date 17/12/5
 */
'use strict';

const _ = require('lodash');
const EventEmitter = require('events').EventEmitter;
const debug = require('debug')('engine:socket');

class Socket extends EventEmitter {
    /**
     * 初始化
     * @param {String} id - socket 编号
     * @param {Object} server - 自定义 server 对象
     * @param {Object} transport - 使用的传输对象
     */
    constructor (id, server, transport) {
        super();
        this.id = id;
        this.server = server;
        this.readyState = 'opening';
        this.writeBuffer = [];
        this.packetsFn = [];
        this.sentCallbackFn = [];
        this.cleanupFn = [];

        this.pingTimeout = server.pingTimeout;
        this.pingInterval = server.pingInterval;

        this.setTransport(transport);   // transport 的初始化
        this.onOpen();                  // socket 对象的初始化
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
     * 设定 transport
     * @param {Transport} transport
     */
    setTransport (transport) {
        const onError = this.onError.bind(this);
        const onPacket = this.onPacket.bind(this);
        const onClose = this.onClose.bind(this, 'transport close');
        const flush = this.flush.bind(this);
        const onDrain = () => {
            if (!_.isEmpty(this.sentCallbackFn)) {
                // 执行 sentCallbackFn 中的第一个函数（TODO 因一系列巧合让这种方式没有出错，但仍有隐患）
                const callbackFn = this.sentCallbackFn.splice(0, 1)[0];
                debug('executing send callback');
                callbackFn(this.transport);
            }
        };

        this.transport = transport;
        this.transport.once('error', onError);  // transport 出错时触发
        this.transport.on('packet', onPacket);  // 当 transport 收到信息时同时出发 socket 的消息处理方法
        this.transport.once('close', onClose);  // 当 transport 关闭时，同时出发 socket 的关闭
        this.transport.on('drain', flush);      // 当 transport 发送完消息时，检查 buf 中是否有残留继续发送
        this.transport.on('drain', onDrain);    // 当 transport 发送消息完成时，执行预先设置的回调

        // cleanup 回调中添加对上述监听函数的处理
        this.cleanupFn.push(() => {
            transport.removeListener('error', onError);
            transport.removeListener('packet', onPacket);
            transport.removeListener('close', onClose);
            transport.removeListener('drain', flush);
            transport.removeListener('drain', onDrain);
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
     * 收到消息时的处理
     * @param {Object} packet - 收到的消息（已经过 transport 解码与处理）
     */
    onPacket (packet) {
        if (this.readyState === 'open') {
            debug('packet');
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
     * 对 transport 错误的处理
     * @param {Error} err - 错误对象
     */
    onError (err) {
        debug('transport error');
        this.onClose('transport error', err);
    }

    /**
     * socket 关闭处理
     * @param {String} reason - 关闭原因
     * @param {String} description - 关闭描述
     */
    onClose (reason, description) {
        if (this.readyState !== 'closed') {
            this.readyState = 'closed';

            // 清理心跳包超时计时
            clearTimeout(this.pingTimeoutTimer);

            // 重置缓存的消息以及消息回调处理
            process.nextTick(() => this.writeBuffer = []);  // 异步置为空方便调试
            this.packetsFn = [];
            this.sentCallbackFn = [];
            
            // 执行预先设定的 cleanup
            _.forEach(this.cleanupFn, (cleanup) => cleanup());
            this.cleanupFn = [];

            // 关闭 transport 并抛出 close 事件
            this.transport.on('error', () => debug('error triggered by discard transport'));
            this.transport.close();
            this.emit('close', reason, description);
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
            this.writeBuffer.push(packet);
            callback && this.packetsFn.push(callback);
            this.flush();
        }
    }

    /**
     * 向客户端发送 writeBuffer 中积累的数据
     */
    flush () {
        if (
            this.readyState !== 'closed' &&     // socket 为非关闭状态
            this.transport.writable &&          // transport 处于可写状态（没有被占用）
            this.writeBuffer.length             // writeBuffer 中有积压的数据
        ) {
            debug('flushing buffer to transport');
            this.emit('flush', this.writeBuffer);

            // 提取当前 writeBuffer 中积压的数据并清空 writeBuffer
            const wbuf = this.writeBuffer;
            this.writeBuffer = [];

            // 将积累下来的每条消息对应的发送完成回调收集到 sentCallbackFn 中
            this.sentCallbackFn.push(...this.packetsFn);
            this.packetsFn = [];

            // 使用 transport 发送消息并抛出 drain（发送完成）事件
            this.transport.send(wbuf);
            this.emit('drain');
        }
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
        if (!_.isEmpty(this.writeBuffer)) {
            // 如果缓存中还有未发送的消息，则等待消息发送完成后再关闭 transport
            this.once('drain', () => this.onClose(reason));
            return;
        }
        this.onClose(reason);
    }
}

module.exports = Socket;