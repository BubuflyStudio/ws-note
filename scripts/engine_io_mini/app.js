/**
 * engine.io 最小化抽取的测试部分
 *
 * @author wujohns
 * @date 17/12/5
 */
'use strict';

const http = require('http');
const Engine = require('./libs/server');

const httpServer = http.createServer().listen(80);
const engine = new Engine();
engine.attach(httpServer, {});
engine.on('connection', (socket) => {
    socket.on('message', (msg) => {
        console.log('--------------------------');
        console.log(msg);
    });
});