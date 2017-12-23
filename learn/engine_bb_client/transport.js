/**
 * transport 部分 (先不考虑兼容 nodejs 场景)
 *
 * @author wujohns
 * @date 17/12/15
 */
'use strict';

const parser = require('engine.io-parser');
const EventEmitter = require('component-emitter');
const debug = require('debug')('engine.io-client:transport');

const WsModule = window.WebSocket || window.MozWebSocket;

class Transport extends EventEmitter {
    /**
     * 初始化
     *
     * @param {Object} options
     */
    constructor (options) {
        super();
        this.uri = options.uri;

        this.readyState = '';
        this.writable = false;
        this.supportsBinary = true;     // 该属性需要综合处理
    }

    /**
     * 启动
     */
    open () {
        if (
            this.readyState === 'open' ||
            this.readyState === 'opening' ||
            !WebSocket
        ) {
            // 如果处于 open 或 opening 状态则不执行 open 操作
            return this;
        }

        // 尝试初始化 ws 对象
        try {
            this.ws = new WsModule(uri);
        } catch (err) {
            return this.emit('error', err);
        }

        if (!this.ws.binaryType) {
            this.supportsBinary = false;
        }

        // ws 对象事件处理
        this.ws.onopen = () => {
            this.readyState = 'open';
            this.writable = true;
            this.emit('open');
        };

        this.ws.onclose = () => {
            this.readyState = 'closed';
            this.emit('close');
        };

        this.ws.onmessage = (event) => {
            const packet = paser.decodePacket(event.data);
            this.emit('packet', packet);
        };

        this.ws.onerror = (wsError) => {
            const err = new Error('webSocket error');
            err.type = 'TransportError';
            err.meta = wsError;
            this.emit('error', err);
            return this;
        }
    }

    /**
     * 关闭 socket
     */
    close () {
        if (
            this.readyState === 'opening' ||
            this.readyState == 'open'
        ) {
            this.ws && this.ws.close();
            this.readyState = 'closed';
            this.emit('close');
        }
        return this;
    }

    /**
     * 写入数据
     *
     * @param {Array} packets - 写入的 packets
     */
    write (packets) {
        this.writable = false;

        // 写入任务创建
        const sendTasks = [];
        const length = packets.length;
        for (let i = 0; i < length; i++) {
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

        // 写入任务完成处理
        Promise.all(sendTasks).then(() => {
            this.writable = true;
            this.emit('drain');
        });
    }

    /**
     * 发送消息
     *
     * @param {Array} packets - 发送的 packets
     */
    send (packets) {
        if (this.readyState === 'open') {
            this.write(packets);
        } else {
            throw new Error('Transport not open');
        }
    }
}

module.exports = Transport;