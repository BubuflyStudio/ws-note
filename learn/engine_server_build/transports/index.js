/**
 * transports 入口
 *
 * @author wujohns
 * @date 17/11/29
 */
'use strict';

const XHR = require('./polling-xhr');
const JSONP = require('./polling-jsonp');
const websocket = require('./websocket');

/**
 * 依据 req 中的信息获取相应的 transports 对象
 * 该函数在被 new 后返回的为 JSONP 对象或 XHR 对象
 * TODO 之后在 server 处做调整，移除这种 ugly 的做法
 */
const polling = function (req) {
    if ('string' === typeof req._query.j) {
        // jsonp 方式
        return new JSONP(req);
    } else {
        // post 方式
        return new XHR(req);
    }
};
polling.upgradesTo = ['websocket'];

module.exports = {
    polling: polling,
    websocket: websocket
};