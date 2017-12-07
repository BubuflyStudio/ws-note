/**
 * socket 逻辑处理相关
 *
 * @author wujohns
 * @date 17/12/1
 */
'use strict';

const _ = require('lodash');
const EventEmitter = require('events').EventEmitter;
const debug = require('debug')('engine:socket');

class Socket extends EventEmitter {
    /**
     * 初始化
     * @param {String} id - socket 编号
     * @param {Object} server - 自定义 server 对象（TODO engine.io 真乱）
     * @param {Object} transport - 使用的传输对象
     * @param {Object} req - requset 请求
     */
    constructor (id, server, transport, req) {
        super();
        this.id = id;
        this.server = server;
        this.upgrading = false;
        this.upgraded = false;
        this.readyState = 'opening';
        this.writeBuffer = [];
        this.packetsFn = [];
        this.sentCallbackFn = [];
        this.cleanupFn = [];
        this.request = req;

        // 缓存 IP（TODO 着重处理这块）
        if (req.websocket && req.websocket._socket) {
            this.remoteAddress = req.websocket._socket.remoteAddress;
        } else {
            this.remoteAddress = req.connection.remoteAddress;
        }

        this.checkIntervalTimer = null;
        this.upgradeTimeoutTimer = null;
        this.pingTimeoutTimer = null;

        this.setTransport(transport);
        this.onOpen();
    }

    /**
     * 
     */
    onOpen () {
        this.readyState = 'open';
        this.transport.sid = this.id;
        this.sendPacket('open', JSON.stringify({
            sid: this.id,
            upgrades: this.getAvailableUpgrades(),
            pingInterval: this.server.pingInterval,
            pingTimeout: this.server.pingTimeout
        }));

        if (this.server.initialPacket) {
            this.sendPacket('message', this.server.initialPacket);
        }

        this.emit('open');
        this.setPingTimeout();
    }

    /**
     * @param {Object} packet - packet
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
     * @param {Error} err - 错误对象
     */
    onError (err) {
        debug('transport error');
        this.onClose('transport error', err);
    }

    /**
     * 设定或重置 ping 的 timer
     */
    setPingTimeout () {
        clearTimeout(this.pingTimeoutTimer);
        this.pingTimeoutTimer = setTimeout(
            () => this.onClose('ping timeout'),
            this.server.pingInterval + this.server.pingTimeout
        );
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
        this.transport.once('error', onError);
        this.transport.on('packet', onPacket);
        this.transport.once('close', onClose);
        this.transport.on('drain', flush);

        // 管理 packet 事件与消息回调
        this.setupSendCallback();

        this.cleanupFn.push(() => {
            transport.removeListener('error', onError);
            transport.removeListener('packet', onPacket);
            transport.removeListener('close', onClose);
            transport.removeListener('drain', flush);
        });
    }

    /**
     * 将 socket 升级到指定的 transport
     * @param {Transport} transport
     */
    maybeUpgrade (transport) {
        debug(
            'might upgrade socket transport from "%s" to "%s"',
            this.transport.name, transport.name
        );
        this.upgrading = true;
        this.upgradeTimeoutTimer = setTimeout(() => {
            debug('client did not complete upgrade - closing transport');
            cleanup();
            if (transport.readyState === 'open') {
                transport.close();
            }
        }, this.server.upgradeTimeout);

        const cleanup = () => {
            this.upgrading = false;
            clearInterval(this.checkIntervalTimer);
            clearTimeout(this.upgradeTimeoutTimer);
            this.checkIntervalTimer = null;
            this.upgradeTimeoutTimer = null;

            transport.removeListener('packet', onPacket);
            transport.removeListener('error', onError);
            transport.removeListener('close', onTransportClose);
            this.removeListener('close', onClose);
        }

        const onPacket = (packet) => {
            if (
                packet.type === 'ping' &&
                packet.data === 'probe'
            ) {
                transport.send([{ type: 'pong', data: 'probe' }]);
                this.emit('upgrading', transport);
                
                clearInterval(this.checkIntervalTimer);
                this.checkIntervalTimer = setInterval(() => {
                    if (this.transport.name === 'polling' && this.transport.writable) {
                        debug('writing a noop packet to polling for fast upgrade');
                        this.transport.send([{ type: 'noop' }]);
                    }
                }, 100);
            } else if (
                packet.type === 'upgrade' &&
                this.readyState !== 'closed'
            ) {
                debug('got upgrade packet - upgrading');
                cleanup();
                this.transport.discard();
                this.upgraded = true;
                this.clearTransport();
                this.setTransport(transport);
                this.emit('upgrade', transport);
                this.setPingTimeout();
                this.flush();
                if (this.readyState === 'closing') {
                    transport.close(() => {
                        this.onClose('forced close');
                    });
                }
            } else {
                cleanup();
                transport.close();
            }
        };

        const onError = (err) => {
            debug('client did not complete upgrade - %s', err);
            cleanup();
            transport.close();
            transport = null;
        };

        const onTransportClose = () => onError('transport closed');
        const onClose = () => onError('socket closed');

        transport.on('packet', onPacket);
        transport.once('close', onTransportClose);
        transport.once('error', onError);
        this.once('close', onClose);
    }

    /**
     * 清理绑定在当前 transport 上的 listener 和 timer
     */
    clearTransport () {
        const toCleanUp = this.cleanupFn.length;
        for (let i = 0; i < toCleanUp; i++) {
            let cleanup = this.cleanupFn.shift();
            cleanup();
        }
        
        this.transport.on('error', () => debug('error triggered by discard transport'));
        this.transport.close();
        clearTimeout(this.pingTimeoutTimer);
    }

    /**
     * @param {String} reason - 关闭原因
     * @param {String} description - 关闭描述
     */
    onClose (reason, description) {
        if (this.readyState !== 'closed') {
            this.readyState = 'closed';
            
            clearTimeout(this.pingTimeoutTimer);
            clearTimeout(this.upgradeTimeoutTimer);
            clearInterval(this.checkIntervalTimer);
            this.checkIntervalTimer = null;

            process.nextTick(() => this.writeBuffer = []);  // 方便调试
            
            this.packetsFn = [];
            this.sentCallbackFn = [];
            this.clearTransport();
            this.emit('close', reason, description);
        }
    }

    /**
     * 管理回调
     */
    setupSendCallback () {
        const onDrain = () => {
            if (this.sentCallbackFn.length > 0) {
                const seqFn = this.sentCallbackFn.splice(0, 1)[0];
                if ('function' === typeof seqFn) {
                    debug('executing send callback');
                    seqFn(this.transport);
                } else if (Array.isArray(seqFn)) {
                    debug('executing batch send callback');
                    _.forEach(seqFn, (seqFnEle) => {
                        if ('function' === seqFnEle) {
                            seqFnEle(this.transport);
                        }
                    });
                }
            }
        };
        this.transport.on('drain', onDrain);
        this.cleanupFn.push(() => this.transport.removeListener('drain', onDrain));
    }

    /**
     * @param {String} message
     * @param {Object} options
     * @param {Function} callback
     * @return {Socket} for chaining
     */
    send (data, options, callback) {
        this.sendPacket('message', data, options, callback);
        return this;
    }

    /**
     * @param {String} message
     * @param {Object} options
     * @param {Function} callback
     * @return {Socket} for chaining
     */
    write (data, options, callback) {
        this.sendPacket('message', data, options, callback);
        return this;
    }

    /**
     * @param {String} packet type
     * @param {String} data
     * @param {Object} options
     * @param {Function} callback
     */
    sendPacket (type, data, options, callback) {
        if ('function' === typeof options) {
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
     * 将整合好的数据通过已经建立的 transport 进行发送
     */
    flush () {
        if (
            this.readyState !== 'closed' &&
            this.transport.writable &&
            this.writeBuffer.length
        ) {
            debug('flushing buffer to transport');
            this.emit('flush', this.writeBuffer);
            this.server.emit('flush', this, this.writeBuffer);

            const wbuf = this.writeBuffer;
            this.writeBuffer = [];
            if (!this.transport.supportsFraming) {
                this.sentCallbackFn.push(this.packetsFn);
            } else {
                this.sentCallbackFn.push(...this.packetsFn);
            }
            this.packetsFn = [];
            this.transport.send(wbuf);
            this.emit('drain');
            this.server.emit('drain', this);
        }
    }

    /**
     *
     */
    getAvailableUpgrades () {
        const availableUpgrades = [];
        const allUpgrades = this.server.upgrades(this.transport.name);
        _.forEach(allUpgrades, (upg) => {
            if (_.includes(this.server.transports, upg)) {
                availableUpgrades.push(upg);
            }
        });
        return availableUpgrades;
    }

    /**
     * @param {Boolean} discard
     */
    close (discard) {
        if (this.readyState !== 'open') {
            return;
        }

        this.readyState = 'closing';
        if (this.writeBuffer.length) {
            this.once('drain', () => this.closeTransport(discard));
            return;
        }
        this.closeTransport(discard);
    }

    /**
     * @param {Boolean} discard
     */
    closeTransport (discard) {
        if (discard) {
            this.transport.discard();
        }
        this.transport.close(() => this.onClose('forced close'));
    }
}

module.exports = Socket;