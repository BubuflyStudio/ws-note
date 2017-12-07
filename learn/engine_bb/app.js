/**
 * engine.io 最小化抽取的测试部分
 *
 * @author wujohns
 * @date 17/12/5
 */
'use strict';

const http = require('http');
const Engine = require('./server');

const httpServer = http.createServer().listen(80);
const engine = new Engine();
engine.attach(httpServer, {});
engine.on('connection', (socket) => {
    for (let i = 0; i < 10; i++) {
        socket.send(`测试${ i }`, {}, () => {
            console.log(`------------ after send ${ i }--------------`);
        });
    }
    // socket.on('message', () => {
    //     console.log('close-------------');
    //     socket.close();
    // });
});