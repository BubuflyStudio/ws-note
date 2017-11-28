/**
 * nodejs 中位操作汇总
 *
 * @author wujohns
 * @date 17/11/24
 */
'use strict';

const strBuf = new Buffer('ab');
console.log(strBuf);    // 输出：<Buffer 61 62>

const buf = new Buffer([0x61, 0x62]);
console.log(buf.toString());    // 输出：ab

// 输出：1，将 1000 0001 向右偏移了7位，变为了 0000 0001，十进制下即为1
const aa = 0x81;
console.log(aa >> 7);

// 输出：，将 1000 0001 向左偏移了1位，变为了 1 0000 0010，十进制下即为258
const bb = 0x81;
console.log(bb << 1);

const cc = 0x8181;
console.log(cc & 0x00ff);