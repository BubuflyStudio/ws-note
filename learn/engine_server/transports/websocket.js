/**
 * websocket 处理相关
 *
 * @author wujohns
 * @date 17/11/29
 */
'use strict';

const _ = require('lodash');

const Transport = require('../transport');
const parser = require('engine.io-parser');
const debug = require('debug')('engine:ws');

class Websocket extends Transport {
    /**
     * 初始化函数
     * @param {http.IncomingMessage} req - http 请求
     * @constructor
     */
    constructor (req) {
        super(req);
        
        this.socket = req.websocket;
        this.socket.once('close', this.onClose.bind(this));
        this.socket.on('message', this.onData.bind(this));
        this.socket.on('error', this.onError.bind(this));
        this.socket.on('headers', (headers) => {
            this.emit('headers', headers);
        });

        this.writable = true;
        this.perMessageDeflate = null;
    }

    // TODO 考虑之后的结构变更
    get name () { return 'websocket'; }
    get handlesUpgrades () { return true; }
    get supportsFraming () { return true; }

    onData (data) {
        debug('received "%s"', data);
        super.onData(data);
    }

    send (packets) {
        _.forEach(packets, (packet) => {
            // 对 packet 进行编码操作
            parser.encodePacket(packet, this.supportsBinary, (data) => {
                debug('writing "%s"', data);

                const options = _.pick(packet.options, ['compress']);
                if (this.perMessageDeflate) {
                    const length = 'string' === typeof data ? Buffer.byteLength(data) : data.length;
                    if (length < this.perMessageDeflate.threshold) {
                        options.compress = false;
                    }
                }
                this.writable = false;
                this.socket.send(data, options, (err) => {
                    if (err) {
                        return this.onError('write error', err.stack);
                    }
                    this.writable = true;
                    this.emit('drain');
                });
            });
        });
    }

    /**
     * 关闭 transport
     * @param {Function} callback - 回调
     */
    doClose (callback) {
        debug('closing');
        this.socket.close();
        callback && callback();
    }
}

module.exports = Websocket;