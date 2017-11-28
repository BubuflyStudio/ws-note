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

            // 构建断开连接数据报中的数据
            let buf = new Buffer('\0\0连接断开，LOL');   // 头两个字节留空，后续是断开原因
            buf.writeUInt16BE(1000, 0);                  // 在头两个字节中写入状态码 1000

            // 发送断开连接数据报
            conn.write(utils.encodeDataFrame({
                fin: 1, opCode: 8, payloadData: buf
            }));

            // 执行断开操作
            conn.end();
        } else {
            // do nothing
        }
    });
});
netServer.listen(8000);