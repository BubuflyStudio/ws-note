/**
 * 握手尝试
 *
 * @author wujohns
 * @date 17/11/23
 */
'use strict';

const net = require('net');
const crypto = require('crypto');
const WS = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const netServer = net.createServer((conn) => {
    let key;
    conn.on('data', (data) => {
        if (!key) {
            // 如果 key 未生成 key 进行握手
            key = data
                .toString()                             // 将 buffer 转化为 string
                .match(/Sec-WebSocket-Key: (.+)/)[1];   // 获取数据报中 Sec-WebSocket-Key 字段的值
            
            key = crypto
                .createHash('sha1')
                .update(`${ key }${ WS }`)  // 将 key 与 WS 拼接后做 sha1 运算
                .digest('base64');          // 将结果转换为 Base64 格式

            // 返回给各户端的数据报
            conn.write('HTTP/1.1 101 Switching Protocols\r\n');
            conn.write('Upgrade: websocket\r\n');
            conn.write('Connection: Upgrade\r\n');
            conn.write(`Sec-WebSocket-Accept: ${ key }\r\n`);
            conn.write('\r\n');
        } else {
            // 如果 key 已经生成，则对传递的数据做处理
        }
    });
});
netServer.listen(8000);