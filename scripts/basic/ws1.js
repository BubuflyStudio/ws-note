/**
 * ws 握手建立连接
 *
 * @author wujohns
 * @date 17/11/24
 */
'use strict';

const net = require('net');
const utils = require('./utils');

const netServer = net.createServer((conn) => {
    let hasHandshake;
    conn.on('data', (data) => {
        if (!hasHandshake) {
            // 如果没有握手则先进行握手
            conn.write(utils.handshakeFrame(data));
            hasHandshake = true;
        } else {
            // do nothing
        }
    });
});
netServer.listen(8000);