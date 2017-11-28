/**
 * engine.io 使用案例
 *
 * @author wujohns
 * @date 17/11/28
 */
'use strict';

// const engine = require('engine.io');
const engine = require('../../learn/engine_server/engine.io.js');

const server = engine.listen(80);
server.on('connection', (socket) => {
    socket.send('测试');
});