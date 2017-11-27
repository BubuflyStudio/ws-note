/**
 * ws 分片发送信息
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
            // 输出接收到的消息
            console.log(utils.decodeDataFrame(data));

            // 向客户端写入消息（分片操作）
            conn.write(utils.encodeDataFrame({
                fin: 0, opCode: 1, payloadData: '片1'
            }));
            conn.write(utils.encodeDataFrame({
                fin: 0, opCode: 0, payloadData: '-片2-'
            }));
            conn.write(utils.encodeDataFrame({
                fin: 1, opCode: 0, payloadData: '片3'
            }));
        }
    });
});
netServer.listen(8000);