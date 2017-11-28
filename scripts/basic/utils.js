/**
 * websocket 基础研究中的工具类方法
 *
 * @author wujohns
 * @date 17/11/24
 */
'use strict';

const crypto = require('crypto');

class Utils {
    /**
     * websocket 连接握手数据报生成
     * @param {Buffer} data - 握手时接受的数据
     * @return {String} frame - 握手时返回给前端的数据报
     * @static
     */
    static handshakeFrame (data) {
        const WS = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
        let key = data
            .toString()                             // 将 buffer 转化为 string
            .match(/Sec-WebSocket-Key: (.+)/)[1];   // 获取数据报中 Sec-WebSocket-Key 字段的值

        key = crypto
            .createHash('sha1')
            .update(`${ key }${ WS }`)  // 将 key 与 WS 拼接后做 sha1 运算
            .digest('base64');          // 将结果转换为 Base64 格式

        const frame =
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${ key }\r\n` +
            '\r\n';

        return frame;
    }

    /**
     * websocket 数据报解析
     * @param {Buffer} data - websocket 传输的原始数据报
     * @returns {Object} 解析后的数据
     * @static
     */
    static decodeDataFrame (data) {
        let i = 0;  // 数据帧游标
    
        // 解析前两个字节数据
        const frame = {
            fin: data[i] >> 7,
            opCode: data[i++] & 15,
            mask: data[i] >> 7,
            payloadLength: data[i++] & 0x7F
        };

        // 处理特殊长度 126 和 127
        if (frame.payloadLength === 126) {
            frame.payloadLength = (data[i++] << 8) + data[i++];
        }
        if (frame.payloadLength === 127) {
            i += 4;     // 固定的四个空位
            frame.payloadLength =
                (data[i++] << 24) + (data[i++] << 16) +
                (data[i++] << 8) + data[i++];
        }

        // 判断是否使用掩码
        let str = [];
        if (frame.mask) {
            frame.maskingKey = [data[i++], data[i++], data[i++], data[i++]];
            for (let j = 0; j < frame.payloadLength; j++) {
                str.push(data[i+j]^frame.maskingKey[j%4]);
            }
        } else {
            str = data.slice(i, i + frame.payloadLength);
        }
        str = new Buffer(str);
        if (frame.opCode === 1 || frame.opCode === 10) {
            str = str.toString();
        }
        frame.payloadData = str;
        return frame;
    }

    /**
     * websocket 数据报生成
     * @param {Object} config - 数据报配置
     * @param {Number} config.fin - fin 码
     * @param {Number} config.opCode - 操作码
     * @param {String} config.payloadData - 需要发送的信息
     * @return {Buffer} 用于发送的数据报
     */
    static encodeDataFrame (config) {
        const start = [];
        const dataBuf = new Buffer(config.payloadData);
        const length = dataBuf.length;

        // 生成数据报的第一个字节（fin 与 opCode）
        start.push((config.fin << 7) + config.opCode);

        // 依据需要发送的信息长度判断需要发送的数据报
        if (length < 126) {
            start.push(length);
        } else if (length < 0x10000) {
            start.push(126);
            start.push((length & 0xff00) >> 8);
            start.push(length & 0xff);
        } else {
            start.push(127);
            start.push(0, 0, 0, 0);     // 一般前4字节留空
            start.push((length & 0xff000000) >> 24);
            start.push((length & 0xff0000) >> 16);
            start.push((length & 0xff00) >> 8);
            start.push(length & 0xff);
        }

        // Buffer 合并
        return Buffer.concat([new Buffer(start), dataBuf]);
    }
}

module.exports = Utils;