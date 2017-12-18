/**
 * 简化版 engine.io 客户端
 *
 * @author wujohns
 * @date 17/12/15
 */
'use strict';

const parser = require('engine.io-parser');
const parseuri = require('parseuri');
const parseqs = require('parseqs');
const debug = require('debug')('engine.io-client');
const EventEmitter = require('events').EventEmitter;

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

        //心跳配置
        this.pingIntervalTimer = null;
        this.pingTimeoutTimer = null;

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
        this.emit();
    }
}

module.exports = Client;