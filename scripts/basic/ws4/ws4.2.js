/**
 * ws 服务端发起的断开连接
 *
 * @author wujohns
 * @date 17/11/28
 */
'use strict';

const net = require('net');
const utils = require('../utils');

const netServer = net.createServer((conn) => {
    let hasHandshake;
    conn.on('data', (data) => {
        if (!hasHandshake) {
            // 如果没有握手则先进行握手
            conn.write(utils.handshakeFrame(data));
            hasHandshake = true;
        } else {
            const frame = utils.decodeDataFrame(data);
            if (frame.opCode === 8) {
                // 收到断开连接的数据报后执行 conn.end()
                console.log(frame);
                conn.end();
            }
        }
    });
});
netServer.listen(8000);