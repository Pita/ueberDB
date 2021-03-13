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

const async = require('async');

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
  // Limit the query size to avoid timeouts or other failures.
  this.settings.bulkLimit = 100;
  this.settings.json = true;
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
  const db = this.db;

  const sqlCreate = `${'CREATE TABLE IF NOT EXISTS `store` ( ' +
                  '`key` VARCHAR( 100 ) NOT NULL COLLATE utf8mb4_bin, ' +
                  '`value` LONGTEXT COLLATE utf8mb4_bin NOT NULL , ' +
                  'PRIMARY KEY ( `key` ) ' +
                  ') ENGINE='}${this.settings.engine} CHARSET=utf8mb4 COLLATE=utf8mb4_bin;`;

  const sqlAlter = 'ALTER TABLE store MODIFY `key` VARCHAR(100) COLLATE utf8mb4_bin;';

  db.query({
    sql: sqlCreate,
    timeout: 60000,
  }, [], (err) => {
    // call the main callback
    callback(err);

    // Checks for Database charset et al
    const dbCharSet =
        'SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME ' +
        `FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${db.database}'`;
    db.query({
      sql: dbCharSet,
      timeout: 60000,
    }, (err, result) => {
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
    });

    const tableCharSet =
        'SELECT CCSA.character_set_name AS character_set_name ' +
        'FROM information_schema.`TABLES` ' +
        'T,information_schema.`COLLATION_CHARACTER_SET_APPLICABILITY` CCSA ' +
        'WHERE CCSA.collation_name = T.table_collation ' +
        `AND T.table_schema = '${db.database}' ` +
        "AND T.table_name = 'store'";
    db.query({
      sql: tableCharSet,
      timeout: 60000,
    }, (err, result, tf) => {
      if (!result[0]) {
        console.warn('Data has no character_set_name value -- ' +
                     'This may lead to crashes when certain characters are pasted in pads');
      }
      if (result[0] && (result[0].character_set_name !== db.charset)) {
        console.error(`table is not configured with charset ${db.charset} -- ` +
                      'This may lead to crashes when certain characters are pasted in pads');
        console.log(result[0], db.charset);
      }
    });

    // check migration level, alter if not migrated
    this.get('MYSQL_MIGRATION_LEVEL', (err, level) => {
      if (err) {
        throw err;
      }

      if (level !== '1') {
        db.query({
          sql: sqlAlter,
          timeout: 60000,
        }, [], (err) => {
          if (err) {
            throw err;
          }

          this.set('MYSQL_MIGRATION_LEVEL', '1', (err) => {
            if (err) {
              throw err;
            }
          });
        });
      }
    });
  });

  this.schedulePing();
};

exports.Database.prototype.get = function (key, callback) {
  this.db.query({
    sql: 'SELECT `value` FROM `store` WHERE `key` = ? AND BINARY `key` = ?',
    timeout: 60000,
  }, [key, key],
  (err, results) => {
    let value = null;

    if (!err && results.length === 1) {
      value = results[0].value;
    }

    callback(err, value);
  });

  this.schedulePing();
};

exports.Database.prototype.findKeys = function (key, notKey, callback) {
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
  this.db.query(
      {
        sql: query,
        timeout: 60000,
      }, params, (err, results) => {
        const value = [];

        if (!err && results.length > 0) {
          results.forEach((val) => {
            value.push(val.key);
          });
        }

        callback(err, value);
      });

  this.schedulePing();
};

exports.Database.prototype.set = function (key, value, callback) {
  if (key.length > 100) {
    callback('Your Key can only be 100 chars');
  } else {
    this.db.query({
      sql: 'REPLACE INTO `store` VALUES (?,?)',
      timeout: 60000,
    }, [key, value], (err, info) => {
      callback(err);
    });
  }

  this.schedulePing();
};

exports.Database.prototype.remove = function (key, callback) {
  this.db.query({
    sql: 'DELETE FROM `store` WHERE `key` = ? AND BINARY `key` = ?',
    timeout: 60000,
  }, [key, key], callback);
  this.schedulePing();
};

exports.Database.prototype.doBulk = function (bulk, callback) {
  let replaceSQL = 'REPLACE INTO `store` VALUES ';

  // keysToDelete is a string of the form "(k1, k2, ..., kn)" painstakingly built by hand.
  let keysToDelete = '(';

  let firstReplace = true;
  let firstRemove = true;

  for (const i in bulk) {
    if (bulk[i].type === 'set') {
      if (!firstReplace) replaceSQL += ',';
      firstReplace = false;

      replaceSQL += `(${this.db.escape(bulk[i].key)}, ${this.db.escape(bulk[i].value)})`;
    } else if (bulk[i].type === 'remove') {
      if (!firstRemove) keysToDelete += ',';
      firstRemove = false;

      keysToDelete += this.db.escape(bulk[i].key);
    }
  }

  keysToDelete += ')';

  replaceSQL += ';';

  const removeSQL =
      `DELETE FROM \`store\` WHERE \`key\` IN ${keysToDelete} ` +
      `AND BINARY \`key\` IN ${keysToDelete};`;

  async.parallel([
    (callback) => {
      if (!firstReplace) {
        this.db.query({
          sql: replaceSQL,
          timeout: 60000,
        },
        callback);
      } else {
        callback();
      }
    },
    (callback) => {
      if (!firstRemove) {
        this.db.query({
          sql: removeSQL,
          timeout: 60000,
        },
        callback);
      } else {
        callback();
      }
    },
  ], callback);

  this.schedulePing();
};

exports.Database.prototype.close = function (callback) {
  this.clearPing();
  this.db.end(callback);
};
