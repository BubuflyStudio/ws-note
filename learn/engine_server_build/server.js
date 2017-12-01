/**
 * engine.io 核心部分构建
 *
 * @author wujohns
 * @date 17/12/1
 */
'use strict';

const _ = require('lodash');
const querystring = require('querystring');
const url = require('url');
const base64id = require('base64id');
const EventEmitter = require('events').EventEmitter;
const debug = require('debug')('engine');
const cookieMod = require('cookie');

const transports = require('./transports');
const Socket = require('./socket');

const sendErrorMessage = (req, res, code) => {};
const checkInvalidHeaderChar = (val) => {};
const abortConnetion = (socket, err) => {};

class Server extends EventEmitter {
    static get errors () {
        return {
            UNKNOWN_TRANSPORT: 0,
            UNKNOWN_SID: 1,
            BAD_HANDSHAKE_METHOD: 2,
            BAD_REQUEST: 3,
            FORBIDDEN: 4
        };
    }

    static get errorMessages () {
        return {
            0: 'Transport unknown',
            1: 'Session ID unknown',
            2: 'Bad handshake method',
            3: 'Bad request',
            4: 'Forbidden'
        };
    }

    constructor (options) {
        super();
        this.clients = {};
        this.clientsCount = 0;

        const opts = _.pick(options, [
            'wsEngine',
            'pingTimeout', 'pingInterval', 'upgradeTimeout',
            'maxHttpBufferSize', 'transports',
            'allowUpgrades', 'allowRequest',
            'cookie', 'cookiePath', 'cookieHttpOnly',
            'perMessageDeflate', 'httpCompression',
            'initialPacket'
        ]);

        // 包含默认值的设定
        _.defaultsDeep(this, opts, {
            wsEngine: process.env.EIO_WS_ENGINE || 'uws',
            
            pingTimeout: 60000,
            pingInterval: 25000,
            upgradeTimeout: 10000,
            
            maxHttpBufferSize: 10E7,
            transports: _.keys(transports),

            allowUpgrades: true,
            allowRequest: null,

            cookie: 'io',
            cookiePath: '/',
            cookieHttpOnly: true,

            perMessageDeflate: { threshold: 1024 },
            httpCompression: { threshold: 1024 },
            initialPacket: null
        });

        this.init();
    }

    /**
     * 初始化 websocket 服务
     */
    init () {
        if (!_.includes(this.transports, 'websocket')) {
            return;
        }

        if (this.ws) {
            // 如果 ws 服务已启动，则关闭已启动的服务
            this.ws.close();
        }

        if (this.wsEngine !== 'ws' || this.wsEngine !== 'uws') {
            this.wsEngine = 'ws';
        }
        const wsModule = require(this.wsEngine);
        this.ws = new wsModule.Server({
            noServer: true,
            clientTracking: false,
            perMessageDeflate: this.perMessageDeflate,
            maxPayload: this.maxHttpBufferSize
        });
    }

    /**
     * 获取指定协议可以 upgrade 的 transport 列表
     * @params {String} transport - transport 名称（polling|websocket）
     * @return {Array} 
     */
    upgrades (transport) {
        if (!this.allowUpgrades) {
            return [];
        }
        return transports[transport].upgradesTo || [];
    }

    /**
     * 请求预处理（获取 GET 参数）
     * @param {http.IncomingMessage} request - http 请求
     */
    prepare (req) {
        if (!req._query) {
            req._query = _.includes(req.url, '?') ? querystring.parse(url.parse(req.url).query) : {};
        }
    }

    /**
     * 验证相应的请求
     * @param {http.IncomingMessage} request - http 请求
     */
    verify (req, upgrade, callback) {
        const transport = req._query.transport;
        if (!_.includes(this.transports, transport)) {
            // 如果使用的 transport 不在支持的 transport 之内
            debug('unknown transport "%s"', transport);
            return callback(Server.errors.UNKNOWN_TRANSPORT, false);
        }

        const isOriginInvalid = checkInvalidHeaderChar(req.headers.origin);
        if (isOriginInvalid) {
            // 对 header 中的 origin 做检查（TODO 这个函数比较诡异，需要详细研究）
            req.headers.origin = null;
            return callback(Server.errors.BAD_REQUEST, false);
        }

        const sid = req._query.sid;
        if (sid) {
            const client = this.clients[sid];
            if (!client) {
                return callback(Server.errors.UNKNOWN_SID, false);
            }
            if (!upgrade && client.transport.name !== transport) {
                debug('bad request: unexpected transport without upgrade');
                return callback(Server.errors.BAD_REQUEST, false);
            }
        } else {
            if (req.method !== 'GET') {
                // 没有 sid 时，则只在 GET 请求中尝试握手
                return callback(Server.errors.BAD_HANDSHAKE_METHOD, false);
            }
            if (!this.allowRequest) {
                // 没有用户自定义校验时则直接判定为通过校验
                return callback(null, true);
            }
            return this.allowRequest(req, callback);
        }
    }

    /**
     * 关闭所有 client
     */
    close () {
        debug('closing all open clients');
        _.forEach(this.clients, (client) => {
            client.close(true);
        });
        if (this.ws) {
            debug('closing websocket server');
            this.ws.close();
        }
        return this;    // 返回 this 方便链式调用
    }

    /**
     * 处理 engine.io 中的 http 请求
     * @param {http.IncomingMessage} req - http 请求
     * @param {http.ServerResponse} res - http 响应
     */
    handleRequest (req, res) {
        debug('handling "%s" http request "%s"', req.method, req.url);
        this.prepare(req);
        req.res = res;

        this.verify(req, false, (err, success) => {
            if (!success) {
                sendErrorMessage(req, res, err);
                return;
            }

            if (req._query.sid) {
                debug('setting new request for existing client');
                this.clients[req._query.sid].transport.onRequest(req);
            } else {
                this.handshake(req._query.transport, req);
            }
        });
    }

    /**
     * 握手处理
     * @param {String} transportName - 通讯协议名称
     * @param {http.IncomingMessage} req - http 请求
     */
    handshake (transportName, req) {
        const id = base64id.generateId();   // TODO 之后替换为 uuid 生成相应的 sid
        debug('handshaking client "%s"', id);

        try {
            const transport = new transports[transportName](req);
            if (transportName === 'polling') {
                // 如果使用 polling 方式
                transport.maxHttpBufferSize = this.maxHttpBufferSize;
                transport.httpCompression = this.httpCompression;
            } else if (transportName === 'websocket') {
                // 如果使用 websocket 方式
                transport.perMessageDeflate = this.perMessageDeflate;
            }

            // TODO 以下判定有待研究
            if (_.get(req, '_query.b64')) {
                transport.supportsBinary = false;
            } else {
                transport.supportsBinary = true;
            }
        } catch (err) {
            sendErrorMessage(req, req.res, Server.errors.BAD_REQUEST);
            return;
        }
        const socket = new Socket(id, this, transport, req);

        if (this.cookie) {
            // cookie 的设定（TODO 研究后可以考虑移除）
            transport.on('headers', (headers) => {
                const httpOnly = this.cookiePath ? this.cookieHttpOnly : false;
                headers['Set-Cookie'] = cookieMod.serialize(
                    this.cookie, id,
                    {
                        path: this.cookiePath,
                        httpOnly: httpOnly
                    }
                );
            });
        }
        transport.onRequest(req);

        this.clients[id] = socket;
        this.clientsCount++;

        socket.once('close', () => {
            _.unset(this.clients, id);
            this.clientsCount--;
        });
        this.emit('connection', socket);
    }

    /**
     * http 协议升级处理
     */
    handleUpgrade (req, socket, upgradeHead) {
        this.prepare(req);
        this.verify(req, true, (err, success) => {
            if (!success) {
                // 验证不通过则删除连接
                abortConnetion(socket, err);
                return;
            }

            const head = new Buffer(upgradeHead.length);
            upgradeHead.copy(head);
            upgradeHead = null;

            this.ws.handleUpgrade(req, socket, head, (conn) => {
                this.onWebSocket(req, conn);
            });
        });
    }

    /**
     * websocket 通讯处理
     */
    onWebSocket (req, socket) {
        const onUpgradeError = () => debug('websocket error before upgrade');
        socket.on('error', onUpgradeError);

        if (req._query.transport !== 'websocket') {
            debug('transport doesnt handle upgrade requests');
            socket.close();
            return;
        }

        const id = req._query.sid;
        req.websocket = socket;     // TODO 考虑移除

        if (id) {
            const client = this.clients[i];
            if (!client) {
                debug('upgrade attempt for closed client');
                socket.close();
            } else if (client.upgrading) {
                debug('transport has already been trying to upgrade');
                socket.close();
            } else if (client.upgraded) {
                debug('transport had already been upgraded');
                socket.close();
            } else {
                debug('upgrading existing transport');
                socket.removeListener('error', onUpgradeError);

                const transport = new transports[req._query.transport](req);
                if (_.get(req, '_query.b64')) {
                    transport.supportsBinary = false;
                } else {
                    transport.supportsBinary = true;
                }
                transport.perMessageDeflate = this.perMessageDeflate;
                client.maybeUpgrade(transport);
            }
        } else {
            socket.removeListener('error', onUpgradeError);
            this.handshake(req._query.transport, req);
        }
    }

    /**
     * 将 upgrade 请求绑定到 http 的 server 上
     * @param {http.Server} server - http 服务
     * @param {Object} options - 配置
     */
    attach (server, options) {
        // TODO 下周制作
    }
}

module.exports = Server;