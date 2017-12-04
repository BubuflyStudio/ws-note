/**
 * 用于对 engine.io 所依赖的 ws 做处理
 */
'use strict';

const http = require('http');
const ws = require('ws');

const wsServer = new ws.Server({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: { threshold: 1024 },
    masPayload: 10E7
});

const server = http.createServer();
server.on('upgrade', (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head, (ws) => {
        wsServer.emit('connection', ws);
    });
});

wsServer.on('connection', (ws) => {
    ws.send('foo');
});
server.listen(80);