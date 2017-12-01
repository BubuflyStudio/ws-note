/**
 * 对 req 处理的结构定义
 *
 * @author wujohns
 * @date 17/11/29
 */
'use strict';

const EventEmitter = require('events').EventEmitter;
const parser = require('engine.io-parser');
const debug = require('debug')('engine:transport');

class Transport extends EventEmitter {
    /**
     * 构造函数
     * @param {http.IncomingMessage} req - http 请求
     * @constructor
     */
    constructor (req) {
        super();
        this.readyState = 'open';
        this.discarded = false;
        // this.req = req;
    }

    /**
     * 标记为 “丢弃” 状态
     */
    discard () {
        this.discarded = true;
    }

    /**
     * 设定 req
     * @param {http.IncomingMessage} req - http 请求
     */
    onRequest (req) {
        debug('setting request');
        this.req = req;
    }

    /**
     * 关闭
     * @param {Function} callback - 回调
     */
    close (callback) {
        callback = callback || (() => {});
        if (this.readyState === 'closed' || this.readyState === 'closing') {
            // 如果处于已关闭或关闭中状态则不作处理
            return;
        }

        this.readyState = 'closing';
        this.doClose(callback);
    }

    /**
     * 错误事件的处理
     * @param {String} msg - 错误信息
     * @param {Object} desc - 错误描述（附属信息，其实参数名为 meta 会更合适些）
     */
    onError (msg, desc) {
        if (this.listeners('error').length) {
            // 如果有对该 transport 对象的 error 事件的监听处理函数，则 emit 相应的 error
            const err = new Error(msg);
            err.type = 'TransportError';
            err.description = desc;
            this.emit('error', err);
        } else {
            debug('ignored transport error %s (%s)', msg, desc);
        }
    }

    /**
     * TODO 作用待确定
     * @param {Object} packet
     */
    onPacket (packet) {
        this.emit('packet', packet);
    }

    /**
     * TODO 作用待确定
     * @param {String} data
     */
    onData (data) {
        this.onPacket(parser.decodePacket(data));
    }

    /**
     * TODO 作用待确定
     */
    onClose () {
        this.readyState = 'closed';
        this.emit('close');
    }
}

module.exports = Transport;