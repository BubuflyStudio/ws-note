/**
 * 测试用编译入口
 */
'use strict';

const Client = require('./client');
const EventEmitter = require('component-emitter');

window.EventEmitter = EventEmitter;
window.eio = Client;