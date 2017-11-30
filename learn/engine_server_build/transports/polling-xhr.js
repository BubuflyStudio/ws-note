/**
 * xhr 通讯处理
 *
 * @author wujohns
 * @date 17/11/30
 */
'use strict';

const Polling = require('./polling');

class PollingXhr extends Polling {
    constructor (req) {
        super(req);
    }

    onRequest (req) {
        if (req.method === 'OPTIONS') {
            const res = req.res;
            const headers = this.headers(req);
            headers['Access-Control-Allow-Headers'] = 'Content-Type';
            res.writeHead(200, headers);
            res.end();
        } else {
            super.onRequest(req);
        }
    }

    headers (req, headers) {
        headers = headers || {};

        if (req.headers.origin) {
            headers['Access-Control-Allow-Credentials'] = 'true';
            headers['Access-Control-Allow-Origin'] = req.headers.origin;
        } else {
            headers['Access-Control-Allow-Origin'] = '*';
        }

        return super.headers(req, headers);
    }
}

module.exports = PollingXhr;