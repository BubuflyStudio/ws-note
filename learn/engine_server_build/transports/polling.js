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
const compressionMethods = {
    gzip: zlib.createGzip,
    deflate: zlib.createDeflate
};

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

    /**
     * 将数据写入到 response
     * @param {String} data - 数据
     * @param {Object} options - 配置
     */
    write (data, options) {
        debug('writing "%s"', data);
        this.doWrite(data, options, () => {
            this.req.cleanup();
        });
    }

    /**
     * @param {String} data - 数据
     * @param {Object} options - 配置
     * @param {Function} callback - 回调
     */
    doWrite (data, options, callback) {
        const isString = typeof data === 'string';
        const contentType = isString
            ? 'text/plain; charset=UTF-8'
            : 'application/octet-stream';
        const length = isString ? Buffer.byteLength(data) : data.length;
        const encoding = accepts(this.req).encoding(['gzip', 'deflate']);
        const headers = {
            'Content-Type': contentType,
            'Content-Length': length
        };

        const response = (data) => {
            this.res.writeHead(200, this.headers(this.req, headers));
            this.res.end(data);
            return callback();
        };

        if (
            !this.httpCompression || !options.compress ||   // 设置中不需要压缩
            length < this.httpCompression.threshold ||      // 长度小于 threshold
            !encoding   // req 中没有压缩需要
        ) {
            // 直接返回 data
            return response(data);
        }

        this.compress(data, encoding, (err, data) => {
            // 对数据进行压缩后返回
            if (err) {
                res.writeHead(500);
                res.end();
                return callback();
            }
            headers['Content-Encoding'] = encoding;
            response(data);
        });
    }


    /**
     * 压缩数据
     * @param {String} data - 数据
     * @param {String} encoding - 压缩方式
     * @param {Function} callback - 回调
     */
    compress (data, encoding, callback) {
        debug('compress');

        const buffers = [];
        const nread = 0;

        const comStream = compressionMethods[encoding](this.httpCompression);
        comStream.on('error', callback);
        comStream.on('data', (chunk) => {
            buffers.push[chunk];
            nread += chunk.length;
        });
        comStream.on('end', () => callback(null, Buffer.concat(buffers, nread)));
        comStream.end(data);
    }

    /**
     * 关闭传输通道
     * @param {Function} callback - 回调
     */
    doClose (callback) {
        debug('closing');

        if (this.dataReq) {
            debug('aborting ongoing data request');
            this.dataReq.destory();
        }

        let closeTimeoutTimer;
        const onClose = () => {
            clearTimeout(closeTimeoutTimer);
            this.onClose();
            return callback();
        };

        if (this.writable) {
            debug('transport writable - closing right away');
            this.send([{ type: 'close' }]);
            onClose();
        } else if (this.discarded) {
            debug('transport discarded - closing right away');
            onClose();
        } else {
            // TODO 与 shouldClose 相关的逻辑有很多可以改进的地方
            debug('transport not writable - buffering orderly close');
            this.shouldClose = onClose;
            closeTimeoutTimer = setTimeout(onClose, this.closeTimeout);
        }
    }

    /**
     * 获取 headers
     * @param {http.IncomingMessage} req - http 请求
     * @param {Object} headers - 自定义 header
     */
    headers (req, headers) {
        headers = headers || {};

        // 防止IE的XSS报错：https://github.com/LearnBoost/socket.io/pull/1333
        const ua = req.headers['user-agent'];
        if (ua && (~ua.indexOf(';MSIE') || ~ua.indexOf('Trident/'))) {
            headers['X-XSS-Protection'] = '0';
        }

        this.emit('headers', headers);
        return headers;
    }
}

module.exports = Polling;