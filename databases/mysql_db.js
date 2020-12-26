'use strict';
/**
 * 2011 Peter 'Pita' Martischka
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

const util = require('util');

exports.Database = function (settings) {
  // temp hack needs a proper fix..
  if (settings && !settings.charset) settings.charset = 'utf8mb4';

  this.db = require('mysql').createConnection(settings);

  this.settings = settings;

  if (this.settings.host != null) this.db.host = this.settings.host;

  if (this.settings.port != null) this.db.port = this.settings.port;

  if (this.settings.user != null) this.db.user = this.settings.user;

  if (this.settings.password != null) this.db.password = this.settings.password;

  if (this.settings.database != null) this.db.database = this.settings.database;

  if (this.settings.charset != null) this.db.charset = this.settings.charset;

  this.settings.engine = 'InnoDB';
  // settings.cache was changed from 1000 to 500.  Testing higer values found that certain queries
  // were becomming quite large in length causing MySQL Lock to fire which is not terrible
  // but not ideal if you have a lot of new pads.
  // Essentially we learned that a lower cache value is better due to concatanated SQL query
  // length where lots of pads are active.
  // I actually "think" better values would be cache @ 200 and writeInterval @ 100 but that
  // would be an overly agressive change for now so 500, 100 seems fine until I can test further
  this.settings.cache = 500;
  this.settings.writeInterval = 100;
  this.settings.json = true;
};

exports.Database.prototype._query = async function (...args) {
  return await new Promise((resolve, reject) => {
    this.db.query(...args, (err, ...args) => {
      if (err != null) return reject(err);
      resolve(args);
    });
  });
};

exports.Database.prototype.clearPing = function () {
  if (this.interval) {
    clearInterval(this.interval);
  }
};

exports.Database.prototype.schedulePing = function () {
  this.clearPing();

  this.interval = setInterval(() => {
    this.db.query({
      sql: 'SELECT 1',
      timeout: 60000,
    });
  }, 10000);
};

exports.Database.prototype.init = function (callback) {
  return util.callbackify(this._init.bind(this))(callback);
};

exports.Database.prototype._init = async function () {
  const db = this.db;

  const sqlCreate = `${'CREATE TABLE IF NOT EXISTS `store` ( ' +
                  '`key` VARCHAR( 100 ) NOT NULL COLLATE utf8mb4_bin, ' +
                  '`value` LONGTEXT COLLATE utf8mb4_bin NOT NULL , ' +
                  'PRIMARY KEY ( `key` ) ' +
                  ') ENGINE='}${this.settings.engine} CHARSET=utf8mb4 COLLATE=utf8mb4_bin;`;

  const sqlAlter = 'ALTER TABLE store MODIFY `key` VARCHAR(100) COLLATE utf8mb4_bin;';

  await this._query({
    sql: sqlCreate,
    timeout: 60000,
  }, []);

  // Checks for Database charset et al
  const dbCharSet =
      'SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME ' +
      `FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${db.database}'`;
  let [result] = await this._query({
    sql: dbCharSet,
    timeout: 60000,
  });

  result = JSON.parse(JSON.stringify(result));
  if (result[0].DEFAULT_CHARACTER_SET_NAME !== db.charset) {
    console.error(`Database is not configured with charset ${db.charset} -- ` +
                  'This may lead to crashes when certain characters are pasted in pads');
    console.log(result[0], db.charset);
  }

  if (result[0].DEFAULT_COLLATION_NAME.indexOf(db.charset) === -1) {
    console.error(
        `Database is not configured with collation name that includes ${db.charset} -- ` +
          'This may lead to crashes when certain characters are pasted in pads');
    console.log(result[0], db.charset, result[0].DEFAULT_COLLATION_NAME);
  }

  const tableCharSet =
      'SELECT CCSA.character_set_name AS character_set_name ' +
      'FROM information_schema.`TABLES` ' +
      'T,information_schema.`COLLATION_CHARACTER_SET_APPLICABILITY` CCSA ' +
      'WHERE CCSA.collation_name = T.table_collation ' +
      `AND T.table_schema = '${db.database}' ` +
      "AND T.table_name = 'store'";
  [result] = await this._query({
    sql: tableCharSet,
    timeout: 60000,
  });
  if (!result[0]) {
    console.warn('Data has no character_set_name value -- ' +
                 'This may lead to crashes when certain characters are pasted in pads');
  }
  if (result[0] && (result[0].character_set_name !== db.charset)) {
    console.error(`table is not configured with charset ${db.charset} -- ` +
                  'This may lead to crashes when certain characters are pasted in pads');
    console.log(result[0], db.charset);
  }

  // check migration level, alter if not migrated
  const level = await this._get('MYSQL_MIGRATION_LEVEL');

  if (level !== '1') {
    await this._query({
      sql: sqlAlter,
      timeout: 60000,
    }, []);
    await this._set('MYSQL_MIGRATION_LEVEL', '1');
  }

  this.schedulePing();
};

exports.Database.prototype.get = function (key, callback) {
  return util.callbackify(this._get.bind(this))(key, callback);
};

exports.Database.prototype._get = async function (key) {
  const [results] = await this._query({
    sql: 'SELECT `value` FROM `store` WHERE `key` = ? AND BINARY `key` = ?',
    timeout: 60000,
  }, [key, key]);
  this.schedulePing();
  return results.length === 1 ? results[0].value : null;
};

exports.Database.prototype.findKeys = function (key, notKey, callback) {
  return util.callbackify(this._findKeys.bind(this))(key, notKey, callback);
};

exports.Database.prototype._findKeys = async function (key, notKey) {
  let query = 'SELECT `key` FROM `store` WHERE `key` LIKE ?';
  const params = [];

  // desired keys are key, e.g. pad:%
  key = key.replace(/\*/g, '%');
  params.push(key);

  if (notKey != null) {
    // not desired keys are notKey, e.g. %:%:%
    notKey = notKey.replace(/\*/g, '%');
    query += ' AND `key` NOT LIKE ?';
    params.push(notKey);
  }
  const [results] = await this._query({
    sql: query,
    timeout: 60000,
  }, params);
  this.schedulePing();
  return results.map((val) => val.key);
};

exports.Database.prototype.set = function (key, value, callback) {
  return util.callbackify(this._set.bind(this))(key, value, callback);
};

exports.Database.prototype._set = async function (key, value) {
  if (key.length > 100) throw new Error('Your Key can only be 100 chars');
  await this._query({
    sql: 'REPLACE INTO `store` VALUES (?,?)',
    timeout: 60000,
  }, [key, value]);
  this.schedulePing();
};

exports.Database.prototype.remove = function (key, callback) {
  return util.callbackify(this._remove.bind(this))(key, callback);
};

exports.Database.prototype._remove = async function (key) {
  await this._query({
    sql: 'DELETE FROM `store` WHERE `key` = ? AND BINARY `key` = ?',
    timeout: 60000,
  }, [key, key]);
  this.schedulePing();
};

exports.Database.prototype.doBulk = function (bulk, callback) {
  return util.callbackify(this._doBulk.bind(this))(bulk, callback);
};

exports.Database.prototype._doBulk = async function (bulk) {
  let replaceSQL = 'REPLACE INTO `store` VALUES ';

  // keysToDelete is a string of the form "(k1, k2, ..., kn)" painstakingly built by hand.
  let keysToDelete = '(';

  let firstReplace = true;
  let firstRemove = true;

  for (const op of bulk) {
    if (op.type === 'set') {
      if (!firstReplace) replaceSQL += ',';
      firstReplace = false;

      replaceSQL += `(${this.db.escape(op.key)}, ${this.db.escape(op.value)})`;
    } else if (op.type === 'remove') {
      if (!firstRemove) keysToDelete += ',';
      firstRemove = false;

      keysToDelete += this.db.escape(op.key);
    }
  }

  keysToDelete += ')';

  replaceSQL += ';';

  const removeSQL =
      `DELETE FROM \`store\` WHERE \`key\` IN ${keysToDelete} ` +
      `AND BINARY \`key\` IN ${keysToDelete};`;

  await Promise.all([
    firstReplace ? null : this._query({sql: replaceSQL, timeout: 60000}),
    firstRemove ? null : this._query({sql: removeSQL, timeout: 60000}),
  ]);

  this.schedulePing();
};

exports.Database.prototype.close = function (callback) {
  this.clearPing();
  this.db.end(callback);
};
