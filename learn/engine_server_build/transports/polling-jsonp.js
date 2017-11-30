/**
 * jsonp 通讯处理
 *
 * @author wujohns
 * @date 17/11/30
 */
'use strict';

const querystring = require('querystring');
const Polling = require('./polling');

class PollingJsonp extends Polling {
    constructor (req) {
        super(req);

        const varName = (req._query.j || '').replace(/[^0-9]/g, '');
        this.head = `___eio[${ varName }](`;
        this.foot = ');';
    }

    onData (data) {
        const rSlashes = /(\\)?\\n/g;
        const rDoubleSlashes = /\\\\n/g;
        data = querystring.parse(data).d;
        if ('string' === typeof data) {
            data = data.replace(rSlashes, (match, slashes) => {
                return slashes ? match : '\n';
            });
        }
        super.onData(data.replace(rDoubleSlashes, '\\n'));
    }

    doWrite (data, options, callback) {
        const js = JSON.stringify(data)
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029');
        data = `${ this.head }${ js }${ this.foot }`;
        super.doWrite(data, options, callback);
    }
}

module.exports = PollingJsonp;