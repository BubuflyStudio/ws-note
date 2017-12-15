/**
 * 简化版 engine.io 客户端
 *
 * @author wujohns
 * @date 17/12/15
 */
'use strict';

const parser = require('engine.io-parser');
const parseuri = require('parseuri');
const parseqs = require('parseqs');
const debug = require('debug')('engine.io-client');
const EventEmitter = require('events').EventEmitter;

class Client extends EventEmitter {
    /**
     * 初始化
     * @param {String} uri - 目标地址
     * @param {Object} options - 连接配置
     */
    constructor (uri, options) {
        super();

    }
}

module.exports = Client;