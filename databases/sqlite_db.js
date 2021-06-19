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

let sqlite3;
try {
  sqlite3 = require('sqlite3');
} catch (err) {
  throw new Error(
      'sqlite3 not found. It was removed from ueberdb\'s dependencies because it requires ' +
      'compilation which fails on several systems. If you still want to use sqlite, run ' +
      '"npm install sqlite3" in your etherpad-lite ./src directory.');
}

const AbstractDatabase = require('../lib/AbstractDatabase');
const util = require('util');

const escape = (val) => `'${val.replace(/'/g, "''")}'`;

exports.Database = class extends AbstractDatabase {
  constructor(settings) {
    super();
    this.db = null;

    if (!settings || !settings.filename) {
      settings = {filename: ':memory:'};
    }

    this.settings = settings;

    // set settings for the dbWrapper
    if (settings.filename === ':memory:') {
      this.settings.cache = 0;
      this.settings.writeInterval = 0;
      this.settings.json = true;
    } else {
      this.settings.cache = 1000;
      this.settings.writeInterval = 100;
      this.settings.json = true;
    }
  }

  async _query(sql, params = []) {
    // It is unclear how util.promisify() deals with variadic functions, so it is not used here.
    return await new Promise((resolve, reject) => {
      // According to sqlite3's documentation, .run() method (and maybe .all() and .get(); the
      // documentation is unclear) might call the callback multiple times. That's OK -- ECMAScript
      // guarantees that it is safe to call a Promise executor's resolve and reject functions
      // multiple times. The subsequent calls are ignored, except Node.js's 'process' object emits a
      // 'multipleResolves' event to aid in debugging.
      this.db.all(sql, params, (err, rows) => {
        if (err != null) return reject(err);
        resolve(rows);
      });
    });
  }

  // Temporary callbackified version of _query. This will be removed once all database objects are
  // asyncified.
  _queryCb(sql, params, callback) {
    // It is unclear how util.callbackify() handles optional parameters, so it is not used here.
    const p = this._query(sql, params);
    if (callback) p.then((rows) => callback(null, rows), (err) => callback(err || new Error(err)));
  }

  init(callback) {
    util.callbackify(async () => {
      this.db = await new Promise((resolve, reject) => {
        new sqlite3.Database(this.settings.filename, function (err) {
          if (err != null) return reject(err);
          // The use of `this` relies on an undocumented feature of sqlite3:
          // https://github.com/mapbox/node-sqlite3/issues/1408
          resolve(this);
        });
      });
      await this._query('CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT)');
    })(callback);
  }

  get(key, callback) {
    this._queryCb(
        'SELECT value FROM store WHERE key = ?', [key],
        (err, rows) => callback(err, err == null && rows && rows.length ? rows[0].value : null));
  }

  findKeys(key, notKey, callback) {
    let query = 'SELECT key FROM store WHERE key LIKE ?';
    const params = [];
    // desired keys are %key:%, e.g. pad:%
    key = key.replace(/\*/g, '%');
    params.push(key);

    if (notKey != null) {
      // not desired keys are notKey:%, e.g. %:%:%
      notKey = notKey.replace(/\*/g, '%');
      query += ' AND key NOT LIKE ?';
      params.push(notKey);
    }

    this._queryCb(query, params, (err, results) => {
      const value = [];

      if (!err && Object.keys(results).length > 0) {
        results.forEach((val) => {
          value.push(val.key);
        });
      }

      callback(err, value);
    });
  }

  set(key, value, callback) {
    this._queryCb('REPLACE INTO store VALUES (?,?)', [key, value], callback);
  }

  remove(key, callback) {
    this._queryCb('DELETE FROM store WHERE key = ?', [key], callback);
  }

  doBulk(bulk, callback) {
    let sql = 'BEGIN TRANSACTION;\n';
    for (const i in bulk) {
      if (bulk[i].type === 'set') {
        sql += `REPLACE INTO store VALUES (${escape(bulk[i].key)}, ${escape(bulk[i].value)});\n`;
      } else if (bulk[i].type === 'remove') {
        sql += `DELETE FROM store WHERE key = ${escape(bulk[i].key)};\n`;
      }
    }
    sql += 'END TRANSACTION;';

    this.db.exec(sql, (err) => {
      if (err) {
        console.error('ERROR WITH SQL: ');
        console.error(sql);
      }

      callback(err);
    });
  }

  close(callback) {
    this.db.close(callback);
  }
};
