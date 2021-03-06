# js 下的位操作
在使用 js 做 ws 数据帧的处理中有位操作，这里对 js 中的位操作相关做一次汇总，供以后参考。
为了方便调试，这里采用 nodejs 运行相应的 js 脚本。

脚本直接参考 [scripts/plus1.js](/scripts/plus1.js)

## 进制数
js 中可以直接使用 16 进制：
```js
var a = 0xff; // 255，对应的二进制：1111 1111
var b = 0x81; // 129，对应的二进制：1000 0001
```

### *Buffer*
在 nodejs 中一般数据报会以 `Buffer` 的形式传递，而数据在 `Buffer` 的存储格式可以理解为一
个包含16进制数的数组。例如：
```js
const strBuf = new Buffer('ab');
console.log(strBuf);    // 输出：<Buffer 61 62>

const buf = new Buffer([0x61, 0x62]);
console.log(buf.toString());    // 输出：ab
```

## 常用操作
需要注意的是位操作的参考是以相应数据的二进制数据作为参考的。

### 偏移
`>>` 向右偏移（有符号）：
```js
// 将 1000 0001 向右偏移了7位，变为了 0000 0001，十进制下即为1
const aa = 0x81;
console.log(aa >> 7);   // 输出 1
```

`<<` 向左偏移
```js
// 将 1000 0001 向左偏移了1位，变为了 1 0000 0010，十进制下即为258
const bb = 0x81;
console.log(bb << 1);   // 输出258
```

### 计算
`&` 按位与：
```js
// 将    1000 0001 1000 0001
// 和    0000 0000 1111 1111  做与运算，
// 得到  0000 0000 1000 0001，即129
const cc = 0x8181;
console.log(cc & 0x00ff);   // 输出 129
```

`|` 按位或，即按位进行或运算  
`^` 按位异或，即按位进行异或运算  
`~` 按位非，即按位取反  

## 参考
[MDN 按位操作符](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Operators/Bitwise_Operators)