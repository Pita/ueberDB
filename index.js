'use strict';
/* eslint new-cap: ["error", {"newIsCapExceptions": ["channels"]}] */

/**
 * 2011 Peter 'Pita' Martischka
 * 2020 John McLear
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const cacheAndBufferLayer = require('./lib/CacheAndBufferLayer');
const channels = require('channels');
const util = require('util');

const defaultLogger = {
  debug: () => {},
  info: () => {},
  error: () => {},
  warn: () => {},
};

/**
 The Constructor
*/
exports.Database = function (type, dbSettings, wrapperSettings, logger) {
  if (!type) {
    type = 'sqlite';
    dbSettings = null;
    wrapperSettings = null;
  }

  // saves all settings and require the db module
  this.type = type;
  this.dbModule = require(`./databases/${type}_db`);
  this.dbSettings = dbSettings;
  this.wrapperSettings = wrapperSettings;
  this.logger = logger || defaultLogger;
  this.channels = new channels.channels(doOperation);
};

exports.Database.prototype.init = function (callback) {
  const db = new this.dbModule.Database(this.dbSettings);
  this.db = new cacheAndBufferLayer.Database(db, this.wrapperSettings, this.logger);
  if (callback) {
    this.db.init(callback);
  } else {
    return util.promisify(this.db.init.bind(this.db))();
  }
};

/**
 Wrapper functions
*/

exports.Database.prototype.doShutdown = function (callback) {
  this.db.doShutdown(callback);
};

exports.Database.prototype.get = function (key, callback) {
  this.channels.emit(key, {db: this.db, type: 'get', key, callback});
};

exports.Database.prototype.findKeys = function (key, notKey, callback) {
  this.channels.emit(key, {db: this.db, type: 'findKeys', key, notKey, callback});
};

exports.Database.prototype.remove = function (key, bufferCallback, writeCallback) {
  this.channels.emit(key, {db: this.db, type: 'remove', key, bufferCallback, writeCallback});
};

exports.Database.prototype.set = function (key, value, bufferCallback, writeCallback) {
  this.channels.emit(key,
      {db: this.db, type: 'set', key, value: clone(value), bufferCallback, writeCallback});
};

exports.Database.prototype.getSub = function (key, sub, callback) {
  this.channels.emit(key, {db: this.db, type: 'getsub', key, sub, callback});
};

exports.Database.prototype.setSub = function (key, sub, value, bufferCallback, writeCallback) {
  this.channels.emit(key,
      {db: this.db, type: 'setsub', key, sub, value: clone(value), bufferCallback, writeCallback});
};

const doOperation = (operation, callback) => {
  if (operation.type === 'get') {
    operation.db.get(operation.key, (err, value) => {
      // clone the value
      value = clone(value);

      // call the caller callback
      operation.callback(err, value);

      // call the queue callback
      callback();
    });
  } else if (operation.type === 'remove') {
    operation.db.remove(operation.key, (err) => {
      // call the queue callback
      callback();

      // call the caller callback
      if (operation.bufferCallback) operation.bufferCallback(err);
    }, operation.writeCallback);
  } else if (operation.type === 'findKeys') {
    operation.db.findKeys(operation.key, operation.notKey, (err, value) => {
      // clone the value
      value = clone(value);

      // call the caller callback
      operation.callback(err, value);

      // call the queue callback
      callback();
    });
  } else if (operation.type === 'set') {
    operation.db.set(operation.key, operation.value, (err) => {
      // call the queue callback
      callback();

      // call the caller callback
      if (operation.bufferCallback) operation.bufferCallback(err);
    }, operation.writeCallback);
  } else if (operation.type === 'getsub') {
    operation.db.getSub(operation.key, operation.sub, (err, value) => {
      // clone the value
      value = clone(value);

      // call the caller callback
      operation.callback(err, value);

      // call the queue callback
      callback();
    });
  } else if (operation.type === 'setsub') {
    operation.db.setSub(operation.key, operation.sub, operation.value, (err) => {
      // call the queue callback
      callback();

      // call the caller callback
      if (operation.bufferCallback) operation.bufferCallback(err);
    }, operation.writeCallback);
  }
};

exports.Database.prototype.close = function (callback) {
  this.db.close(callback);
};

const clone = (obj) => {
  // Handle the 3 simple types, and null or undefined
  if (null == obj || 'object' !== typeof obj) return obj;

  // Handle Date
  if (obj instanceof Date) {
    const copy = new Date();
    copy.setTime(obj.getTime());
    return copy;
  }

  // Handle Array
  if (obj instanceof Array) {
    const copy = [];
    for (let i = 0, len = obj.length; i < len; ++i) {
      copy[i] = clone(obj[i]);
    }
    return copy;
  }

  // Handle Object
  if (obj instanceof Object) {
    const copy = {};
    for (const attr in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, attr)) copy[attr] = clone(obj[attr]);
    }
    return copy;
  }

  throw new Error("Unable to copy obj! Its type isn't supported.");
};

/**
 * Deprecated synonym of Database.
 */
exports.database = exports.Database;
