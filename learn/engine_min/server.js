/**
 * 对 engine.io 的最小化抽取
 *
 * @author wujohns
 * @date 17/12/4
 */
'use strict';

const _ = require('lodash');
const url = require('url');
const querystring = require('querystring');
const base64id = require('base64id');
const cookieMod = require('cookie');
const EventEmitter = require('events').EventEmitter;
const debug = require('debug')('engine');

const Transport = require('./transport');
const Socket = require('./socket');

/**
 * 检查是否包含非法字符（这里为 v8 内部的实现逻辑）
 */
const checkInvalidHeaderChar = (val) => {
    const value = _.toString(val);
    const validHdrChars = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, // 0 - 15
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16 - 31
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 32 - 47
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 48 - 63
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 64 - 79
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 80 - 95
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 96 - 111
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, // 112 - 127
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 128 ...
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1  // ... 255
    ];
    const valid = _.every(value, (ele) => validHdrChars[ele.charCodeAt(0)]);
    return !valid;
};

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

    /**
     * 构造函数
     * @param {Object} options - server 配置
     */
    constructor (options) {
        super();
        this.clients = {};
        this.clientsCount = 0;

        const opts = _.pick(options, [
            'wsEngine',
            'transports',
            'allowRequest',
            'maxHttpBufferSize', 'perMessageDeflate',
            'pingInterval', 'pingTimeout'
        ]);

        // 包含默认值的设定
        _.defaultsDeep(this, opts, {
            wsEngine: process.env.EIO_WS_ENGINE || 'uws',
            pingTimeout: 60000,
            pingInterval: 25000,
            transports: ['websocket'],
            maxHttpBufferSize: 10E7,
            perMessageDeflate: { threshold: 1024 },
        });

        this.init();
    }

    // TODO 临时添加，之后移除
    upgrades () {return [];}

    /**
     * 初始化 ws 模块
     */
    init () {
        if (!_.includes(this.transports, 'websocket')) {
            return;
        }

        if (this.ws) {
            this.ws.close();
        }

        if (this.wsEngine !== 'ws' && this.wsEngine !== 'uws') {
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
     * 将服务绑定在已有的 http.Server 上
     * 给 server 增加了 /engine.io 路径上的 request 与 upgrade 处理方法
     * @param {http.Server} server - http 服务
     * @param {Object}      options - 配置
     * @param {String}      options.path - 配置的路径
     */
    attach (server, options) {
        // 初始化 options 中的配置
        let path = _.get(options, 'path', '/engine.io');
        path = _.replace(path, /\/$/, '');
        path = `${ path }/`;

        // 缓存并清理 server 的 listeners
        const listeners = server.listeners('request').slice(0);
        server.removeAllListeners('request');
        server.on('close', () => this.close());
        server.on('listening', () => this.init());

        const check = (req) => {
            return path === req.url.substr(0, path.length);
        };

        // 对 websocket 的处理
        server.on('upgrade', (req, socket, head) => {
            if (check(req)) {
                // upgrade 
                this.handleUpgrade(req, socket, head);
            } else {
                // 超时销毁 socket
                setTimeout(() => {
                    if (socket.writable && socket.bytesWritten <= 0) {
                        return socket.end();
                    }
                }, 1000);
            }
        });
    }

    /**
     * http 协议升级处理
     * @param {http.IncomingMessage} request - http 请求
     * @param {http.Socket} socket - 升级时创建的 socket 连接
     * @param {Buffer} upgradeHead - 升级时的 head
     */
    handleUpgrade (req, socket, upgradeHead) {
        this.prepare(req);
        this.verify(req, true, (err, success) => {
            if (!success && socket.writable) {
                // upgrade 验证不通过时的处理
                const message = _.get(Server.errorMessages, 'code', err || '');
                const length = Buffer.byteLength(message);
                socket.write(
                    'HTTP/1.1 400 Bad Request\r\n' +
                    'Connection: close\r\n' +
                    'Content-type: text/html\r\n' +
                    `Content-Length: ${ length }\r\n` +
                    '\r\n' +
                    message
                );
                socket.destory();
            }

            // 对 upgradeHead 进行深复制，防止之后被误改
            const head = new Buffer(upgradeHead.length);
            upgradeHead.copy(head);
            upgradeHead = null;

            // 将 upgrade 操作托管给 ws 模块，并获取连接操作对象
            this.ws.handleUpgrade(req, socket, head, (conn) => {
                req.websocket = conn;
                this.handshake(req._query.transport, req);
            });
        });
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
     * 验证相应的请求（验证 request 请求与 upgrade 请求）
     * @param {http.IncomingMessage} request - http 请求
     * @param {Boolean} upgrade - 是否进行 upgrade 操作
     * @param {Function} callback - 回调
     */
    verify (req, upgrade, callback) {
        // 判断 headers.origin 是否含有非法字符
        const isOriginInvalid = checkInvalidHeaderChar(req.headers.origin);
        if (isOriginInvalid) {
            req.headers.origin = null;
            return callback(Server.errors.BAD_REQUEST, false);
        }

        // 由于只使用 websocket 方式，所以这里这里 verify 的请求必定是 upgrade 请求
        if (req.method !== 'GET') {
            // upgrade 请求必须为 GET 方式
            return callback(Server.errors.BAD_HANDSHAKE_METHOD, false);
        }
        if (!this.allowRequest) {
            // 自定义的 allowRequest 逻辑
            return callback(null, true);
        }
        return this.allowRequest(req, callback);
    }

    /**
     * handshake，engine.io 通过 ws 通道进行的自定义握手用于标注客户端连接方便区分（通过id标注）
     * @param {String} transportName - 通讯协议名称
     * @param {http.IncomingMessage} req - http 请求
     */
    handshake (transportName, req) {
        const id = base64id.generateId();   // TODO 之后替换为 uuid 生成相应的 sid
        debug('handshaking client "%s"', id);

        const transport = new Transport(req);
        transport.perMessageDeflate = this.perMessageDeflate;

        if (_.get(req, '_query.b64')) {
            transport.supportsBinary = false;
        } else {
            transport.supportsBinary = true;
        }

        // 将后续的连接处理交给了 socket 对象
        const socket = new Socket(id, this, transport, req);

        // TODO cookie 设定的部分需要搞清楚原因，大概率会被移除
        if (this.cookie) {
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

        // 对 socket 的管理
        transport.onRequest(req);
        this.clients[id] = socket;
        this.clientsCount++;

        socket.once('close', () => {
            _.unset(this.clients, id);
            this.clientsCount--;
        });
        this.emit('connection', socket);
    }
}

module.exports = Server;