/**
 * ws ping pong
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

            // 握手成功后发送一条 Ping
            conn.write(utils.encodeDataFrame({
                fin: 1, opCode: 9, payloadData: 'pp测试'
            }));
        } else {
            // 输出接收到的消息
            console.log(utils.decodeDataFrame(data));
        }
    });
});
netServer.listen(8000);