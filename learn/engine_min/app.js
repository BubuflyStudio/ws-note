/**
 * engine.io 最小化抽取的测试部分
 *
 * @author wujohns
 * @date 17/12/5
 */
'use strict';

const http = require('http');
const Engine = require('./server_min');

const httpServer = http.createServer().listen(80);
const engine = new Engine();
engine.attach(httpServer, {});
engine.on('connection', (socket) => {
    socket.send('测试');
});