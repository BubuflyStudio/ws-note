/**
 * 纯 websocket 的 transport
 *
 * @author wujohns
 * @date 17/12/4
 */
'use strict';

const _ = require('lodash');
const EventEmitter = require('events').EventEmitter;
const parser = require('engine.io-parser');
const debug = require('debug')('engine:ws_trans');

class WebsocketTrans extends EventEmitter {
    /**
     * 构造函数
     * @param {http.IncomingMessage} req - http 请求
     * @constructor
     */
    constructor (req) {
        super();
        this.readyState = 'open';
        this.discarded = false;

        this.socket = req.websocket;
        this.socket.once('close', () => this.onClose());
        this.socket.on('message', (data) => this.onData(data));
        this.socket.on('error', (msg, desc) => this.onError(msg, desc));
        this.socket.on('headers', (headers) => {
            this.emit('headers', headers);
        });

        this.writable = null;
        this.perMessageDeflate = null;  // websocket 数据报的压缩配置
    }

    get name () { return 'websocket'; }
    get handlesUpgrades () { return true; }
    get supportsFraming () { return true; }

    /**
     * ws 服务被关闭时的处理（emit close）
     */
    onClose () {
        this.readyState = 'closed';
        this.emit('close');
    }

    /**
     * ws 接收到消息时的处理（emit packet）
     * @param {String} msg - 接受到的数据
     */
    onData (data) {
        debug('received "%s"', data);
        this.emit('packet', parser.decodePacket(data));
    }

    /**
     * ws 报错时处理
     * @param {String} msg - 错误信息
     * @param {Object} meta - 错误附属信息
     */
    onError (msg, meta) {
        if (this.listeners('error').length) {
            // 如果有对该 transport 对象的 error 事件的监听处理函数，则 emit 相应的 error
            const err = new Error(msg);
            err.type = 'TransportError';
            err.meta = meta;
            this.emit('error', err);
        } else {
            debug('ignored transport error %s (%s)', msg, meta);
        }
    }

    /**
     * 作用未知
     */
    onRequest (req) {
        debug('setting request');
        this.req = req;
    }

    /**
     * ws 发送信息
     * @param {[Packet]} packets - 尚未编码的信息
     */
    send (packets) {
        _.forEach(packets, (packet) => {
            // 对 packet 进行编码工作
            parser.encodePacket(packet, this.supportsBinary, (data) => {
                debug('writing "%s"', data);

                let compress = _.get(packet.options, 'compress');
                if (this.perMessageDeflate) {
                    const length = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
                    if (length < this.perMessageDeflate.threshold) {
                        // 数据长度小于阈值则不进行压缩
                        compress = false;
                    }
                }
                this.writable = false;
                this.socket.send(data, { compress: compress }, (err) => {
                    if (err) {
                        return this.onError('write error', err.stack);
                    }
                    this.writable = true;
                    this.emit('drain');     // 发送完成后的消息抛出
                });
            });
        });
    }

    /**
     * 标记 transport 状态为 “丢弃”
     */
    discard () {
        this.discarded = true;
    }

    /**
     * 关闭 ws
     * @param {Function} callback - 回调
     */
    doClose (callback) {
        debug('closing');
        callback = callback ? callback : () => {};
        this.socket.close();
        return callback();
    }

    /**
     * 关闭
     * @param {Function} callback - 回调
     */
    close (callback) {
        callback = callback || (() => {});
        if (
            this.readyState === 'closed' ||
            this.readyState === 'closing'
        ) {
            // 如果处于已关闭或关闭中的状态则不作处理
            return;
        }

        this.readyState = 'closing';
        this.doClose(callback);
    }
}

module.exports = WebsocketTrans;