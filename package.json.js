/**
 * module bundler with simple configure
 */
'use strict';

const packageConfig = {
    // 基础说明配置
    name: 'ws-learn',
    version: '0.0.1',
    author: 'wujohns',
    description: 'learn ws',
    license: 'MIT',

    /**
     * scripts
     */
    scripts: {
        // test: './node_modules/mocha/bin/mocha ./test/build.test.js'
    },

    engine: {
        node: '>=4.0.0'
    },

    dependencies: {
        // 基础工具
        'lodash': '^4.17.4',
        'async': '^2.4.1',

        // 扩展依赖
        'engine.io-parser': '^2.1.1',
        'base64id': '^1.0.0',
        'debug': '^3.1.0',
        'ws': '^3.3.3',
        'uws': '^9.14.0',

        // 客户端部分依赖
        'component-emitter': '^1.2.1'
    },

    devDependencies: {
        'gulp': '^3.9.1',
        'webpack': '^3.10.0'
    }
};

const fs = require('fs');
const path = require('path');
const targetFile = path.join(__dirname, './package.json');
fs.writeFileSync(targetFile, JSON.stringify(packageConfig, null, 2), {
    encoding: 'utf8',
    flags: 'w',
    mode: 0o666
});