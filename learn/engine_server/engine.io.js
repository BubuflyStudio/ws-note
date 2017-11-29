/**
 * engine.io 的入口
 *
 * @author wujohns
 * @date 17/11/29
 */
'use strict';

const http = require('http');
const parser  = require('engine.io-parser');

const Server = require('./server');
const Transport = require('./transport');
const transports = require('./transports');

/**
 * 将 ws 服务 attach 到指定的 httpServer
 * @param {http.Server} server - httpServer 对象
 * @param {Object} options - 相关配置
 * @return {Object} engine.io 对象
 */
const attach = (server, options) => {
    const engine = new Server(options);
    engine.attach(server, options);
    return engine;
};

/**
 * 创建 httpServer 并将 ws 服务 attach 到该 httpServer
 * @param {Number} port - httpServer 监听的端口
 * @param {Object} options - ws 服务的相关配置
 * @param {Function} callback - 启动 httpServer 后的回调
 * @return {Object} engine.io 对象
 */
const listen = (port, options, callback) => {
    if ('function' === typeof options) {
        callback = options;
        options = {};
    }

    const server = http.createServer((req, res) => {
        res.writeHead(501);
        res.end('Not Implemented');
    });

    const engine = attach(server, options);
    engine.httpServer = server;

    server.listen(port, callback);
    return engine;
}

const engine = function () {
    if (arguments.length && arguments[0] instanceof http.Server) {
        return attach(server, options);
    }
    return new Server(arguments[0]);
};

engine.protocol = 1;
engine.parser = parser;

engine.Server = Server;
engine.Transport = Transport;
engine.transports = transports;

engine.attach = attach;
engine.listen = listen;

module.exports = engine;