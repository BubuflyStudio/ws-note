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
     * @param {Object} req - request 请求
     */
    constructor (id, server, transport, req) {
        super();
        this.id = id;
        this.server = server;
        this.readyState = 'opening';
        this.writeBuffer = [];
        this.packetsFn = [];

        this.setTransport(transport);
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

        this.transport = transport;
        this.transport.once('error', onError);  // transport 出错时触发
        this.transport.on('packet', onPacket);  // 当 transport 收到信息时同时出发 socket 的消息处理方法
        this.transport.once('close', onClose);  // 当 transport 关闭时，同时出发 socket 的关闭
        this.transport.on('drain', flush);  // 当 transport 发送完消息时，检查 buf 中是否有残留继续发送

        // cleanup 回调中添加对上述监听函数的处理
        this.cleanupFn.push(() => {
            transport.removeListener('error', onError);
            transport.removeListener('packet', onPacket);
            transport.removeListener('close', onClose);
            transport.removeListener('drain', flush);
        });

        // 消息发送后的回调的统一处理
        // TODO 有争议的地方
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
            callback || this.packetsFn.push(callback);
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
            this.server.emit('flush', this, this.writeBuffer);

            // 提取当前 writeBuffer 中积压的数据并清空 writeBuffer
            const wbuf = this.writeBuffer;
            this.writeBuffer = [];

        }
    }

    // TOOD 后续。。。

    /**
     *
     */
    onOpen () {}

    /**
     * 收到消息时的处理
     * @param {Object} packet - packet
     */
    onPacket (packet) {}


}