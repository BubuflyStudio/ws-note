/**
 * engine.io 使用案例
 *
 * @author wujohns
 * @date 17/11/28
 */
'use strict';

// const engine = require('engine.io');
const engine = require('../../learn/engine_server_build/engine.io.js');

/**
 * 直接启用 listen
 */
const server = engine.listen(80);
server.on('connection', (socket) => {
    socket.send('测试');
});

/**
 * 将 socket 服务 attach 到 httpServer 上
 */
// const http = require('http').createServer().listen(80);
// const server = engine.attach(http);
// server.on('connection', (socket) => {
//     socket.send('测试');
// });

/**
 * 手动处理
 */
// const httpServer = require('http').createServer().listen(80);
// const server = new engine.Server();
// server.on('connection', (socket) => {
//     socket.send('测试');
// });
// httpServer.on('upgrade', (req, socket, head) => {
//     server.handleUpgrade(req, socket, head);
// });
// httpServer.on('request', (req, res) => {
//     server.handleRequest(req, res);
// });