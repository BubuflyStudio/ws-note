/**
 * 对 engine.io 的最小化抽取
 *
 * @author wujohns
 * @date 17/12/4
 */
'use strict';

const _ = require('lodash');

class Server extends EventEmitter {
    /**
     * 构造函数
     * @param {Object} options - server 配置
     */
    constructor (options) {
        super();
        this.clients = {};
        this.clientsCount = 0;

        const opts = _.pick(options, []);

        // 包含默认值的设定
        _.defaultsDeep(this, opts, {});

        // TODO 先完成 attach 部分，以及把 polling 的 get 部分做抽取
    }
}