/**
 * 针对 engine.io 或 socket.io 中对应客户端的编译
 *
 * @author wujohns
 * @date 17/11/28
 */
'use strict';

const path = require('path');
const gulp = require('gulp');
const webpack = require('webpack');

// TODO 由于 chrome 对 es6 语法支持比较好，这里不引入编译耗时的 babel
gulp.task('build', (callback) => {
    webpack({
        entry: path.join(__dirname, './scripts/engine_io_mini/index.js'),
        output: {
            path: path.join(__dirname, './scripts/engine_io_mini'),
            filename: 'dist.js'
        },
        devtool: 'inline-source-map'
    }, (err) => {
        return callback(err);
    });
});