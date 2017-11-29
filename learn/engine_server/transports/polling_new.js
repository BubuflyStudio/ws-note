/**
 * 非 websocket 部分的通讯
 *
 * @author wujohns
 * @date 17/11/29
 */
'use strict';

const _ = require('lodash');
const parser = require('engine.io-parser');
const zlib = require('zlib');
const accepts = require('accepts');
const debug = require('debug')('engine:polling');

const Transport = require('../transport');

class Polling extends Transport {
    constructor (req) {
        super(req);
        this.closeTimeout = 30 * 1000;  // 30s 过期时间
        this.maxHttpBufferSize = null;
        this.httpCompression = null;
    }

    get name () { return 'polling'; }

    /**
     * 覆盖基类的 onRequest 方法
     * @param {http.IncomingMessage} req - http 请求
     */
    onRequest (req) {
        const res = req.res;
        if (req.method === 'GET') {
            this.onPollRequest(req, res);
        } else if (req.method === 'POST') {
            this.onDataRequest(req, res);
        } else {
            res.writeHead(500);
            res.end();
        }
    }

    /**
     * 对 get 请求的处理
     */
    onPollRequest (req, res) {
        if (this.req) {
            // req 被重复设置，this.req 与 this.res 需要被同时修改
            this.onError('overlap from client');
            res.writeHead(500);
            res.end();
            return;
        }

        debug('setting request');
        this.req = req;
        this.res = res;

        const onClose = () => this.onError('poll connection closed prematurely');
        req.cleanup = () => {
            req.removeListener('close', onClose);
            this.req = null;
            this.res = null;
        };
        req.on('close', onClose);

        this.writable = true;
        this.emit('drain');

        if (this.writable && this.shouldClose) {
            debug('triggering empty send to append close packet');
            this.send([{ type: 'noop' }]);
        }
    }

    /**
     * 对 post 请求的处理
     */
    onDataRequest (req, res) {
        if (this.dataReq) {
            // dataReq 被重复设置，this.dataReq 与 this.dataRes 需要被同时修改
            this.onError('data request overlap from client');
            res.writeHead(500);
            res.end();
            return;
        }

        const isBinary = req.headers['content-type'] === 'application/octet-stream';
        this.dataReq = req;
        this.dataRes = res;

        let chunks = isBinary ? new Buffer(0) : '';
        const cleanup = () => {
            req.removeListener('data', onData);
            req.removeListener('end', onEnd);
            req.removeListener('close', onClose);
            this.dataReq = null;
            this.dataRes = null;
            chunks = null;
        };

        const onClose = () => {
            cleanup();
            this.onError('data request connection closed prematurely');
        };

        const onData = (data) => {
            let contentLength;
            if (isBinary) {
                chunks = Buffer.concat([chunks, data]);
                contentLength = chunks.length;
            } else {
                chunks += data;
                contentLength = Buffer.byteLength(chunks);
            }

            if (contentLength > this.maxHttpBufferSize) {
                chunks = isBinary ? new Buffer(0) : '';
                req.connection.destory();
            }
        };

        const onEnd = () => {
            this.onData(chunks);
            // 将 ContentType 置为 text/html 已避免出现下载弹框
            const headers = {
                'Content-Type': 'text/html',
                'Content-Length': 2
            };
            res.writeHead(200, this.headers(req, headers));
            res.end('ok');
            cleanup();
        };

        !isBinary && req.setEncoding('utf8');
        req.on('close', onClose);
        req.on('data', onData);
        req.on('end', onEnd);
    }

    /**
     * 加工发送过来的传入的数据
     */
    onData (data) {
        debug('received "%s', data);
        parser.decodePayload(data, (packet) => {
            if (packet.type === 'close') {
                debug('got xhr close packet');
                this.onClose();
                return false;
            }
            this.onPacket(packet);
        });
    }

    /**
     * 复写 onClose 方法
     */
    onClose () {
        if (this.writable) {
            this.send([{ type: 'noop' }]);
        }
        super.onClose();
    }

    /**
     * 发送相应的数据报
     * @param {Array} packets - 数据
     */
    send (packets) {
        this.writable = false;
        if (this.shouldClose) {
            debug('appending close packet to payload');
            packets.push({ type: 'close' });
            this.shouldClose();
            this.shouldClose = null;
        }

        parser.encodePayload(packets, this.supportsBinary, (data) => {
            const compress = _.some(packets, (packet) => {
                return packet.options && packet.options.compress;
            });
            this.write(data, { compress: compress });
        });
    }
}

module.exports = Polling;