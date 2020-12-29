'use strict';
/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const cassandra = require('cassandra-driver');
const util = require('util');

/**
 * Cassandra DB constructor.
 *
 * @param {Object} settings The required settings object to initiate the Cassandra database
 * @param {String[]} settings.clientOptions See
 *     http://www.datastax.com/drivers/nodejs/2.0/global.html#ClientOptions for a full set of
 *     options that can be used
 * @param {String} settings.columnFamily The column family that should be used to store data. The
 *     column family will be created if it doesn't exist
 * @param {Function} [settings.logger] Function that will be used to pass on log events emitted by
 *     the Cassandra driver. See https://github.com/datastax/nodejs-driver#logging for more
 *     information
 */
exports.database = function (settings) {
  if (!settings.clientOptions) {
    throw new Error('The Cassandra client options should be defined');
  }
  if (!settings.columnFamily) {
    throw new Error('The Cassandra column family should be defined');
  }

  this.settings = {};
  this.settings.clientOptions = settings.clientOptions;
  this.settings.columnFamily = settings.columnFamily;
  this.settings.logger = settings.logger;
};

/**
 * Initializes the Cassandra client, connects to Cassandra and creates the CF if it didn't exist
 * already
 *
 * @param  {Function}   callback        Standard callback method.
 * @param  {Error}      callback.err    An error object (if any.)
 */
exports.database.prototype.init = function (callback) {
  // Create a client
  this.client = new cassandra.Client(this.settings.clientOptions);

  // Pass on log messages if a logger has been configured
  if (this.settings.logger) {
    this.client.on('log', this.settings.logger);
  }

  // Check whether our column family already exists and create it if necessary
  this.client.execute(
      'SELECT columnfamily_name FROM system.schema_columnfamilies WHERE keyspace_name = ?',
      [this.settings.clientOptions.keyspace],
      (err, result) => {
        if (err) {
          return callback(err);
        }

        let isDefined = false;
        const length = result.rows.length;
        for (let i = 0; i < length; i++) {
          if (result.rows[i].columnfamily_name === this.settings.columnFamily) {
            isDefined = true;
            break;
          }
        }

        if (isDefined) {
          return callback(null);
        } else {
          const cql = util.format(
              'CREATE COLUMNFAMILY "%s" (key text PRIMARY KEY, data text)',
              this.settings.columnFamily);
          this.client.execute(cql, callback);
        }
      });
};


/**
 * Gets a value from Cassandra
 *
 * @param  {String}     key               The key for which the value should be retrieved
 * @param  {Function}   callback          Standard callback method
 * @param  {Error}      callback.err      An error object, if any
 * @param  {String}     callback.value    The value for the given key (if any)
 */
exports.database.prototype.get = function (key, callback) {
  const cql = util.format('SELECT data FROM "%s" WHERE key = ?', this.settings.columnFamily);
  this.client.execute(cql, [key], (err, result) => {
    if (err) {
      return callback(err);
    }

    if (!result.rows || result.rows.length === 0) {
      return callback(null, null);
    }

    return callback(null, result.rows[0].data);
  });
};

/**
 * Cassandra has no native `findKeys` method. This function implements a naive filter by retrieving
 * *all* the keys and filtering those. This should obviously be used with the utmost care and is
 * probably not something you want to run in production.
 *
 * @param  {String}     key               The filter for keys that should match
 * @param  {String}     [notKey]          The filter for keys that shouldn't match
 * @param  {Function}   callback          Standard callback method
 * @param  {Error}      callback.err      An error object, if any
 * @param  {String[]}   callback.keys     An array of keys that match the specified filters
 */
exports.database.prototype.findKeys = function (key, notKey, callback) {
  let cql = null;
  if (!notKey) {
    // Get all the keys
    cql = util.format('SELECT key FROM "%s"', this.settings.columnFamily);
    this.client.execute(cql, (err, result) => {
      if (err) {
        return callback(err);
      }

      // Construct a regular expression based on the given key
      const regex = new RegExp(`^${key.replace(/\*/g, '.*')}$`);

      const keys = [];
      result.rows.forEach((row) => {
        if (regex.test(row.key)) {
          keys.push(row.key);
        }
      });

      return callback(null, keys);
    });
  } else if (notKey === '*:*:*') {
    // restrict key to format 'text:*'
    const matches = /^([^:]+):\*$/.exec(key);
    if (matches) {
      // Get the 'text' bit out of the key and get all those keys from a special column.
      // We can retrieve them from this column as we're duplicating them on .set/.remove
      cql = util.format('SELECT * from "%s" WHERE key = ?', this.settings.columnFamily);
      this.client.execute(cql, [`ueberdb:keys:${matches[1]}`], (err, result) => {
        if (err) {
          return callback(err);
        }

        if (!result.rows || result.rows.length === 0) {
          return callback(null, []);
        }

        const keys = result.rows.map((row) => row.data);
        return callback(null, keys);
      });
    } else {
      const msg = 'Cassandra db only supports key patterns like pad:* when notKey is set to *:*:*';
      return callback(new Error(msg), null);
    }
  } else {
    return callback(new Error('Cassandra db currently only supports *:*:* as notKey'), null);
  }
};

/**
 * Sets a value for a key
 *
 * @param  {String}     key             The key to set
 * @param  {String}     value           The value associated to this key
 * @param  {Function}   callback        Standard callback method
 * @param  {Error}      callback.err    An error object, if any
 */
exports.database.prototype.set = function (key, value, callback) {
  this.doBulk([{type: 'set', key, value}], callback);
};

/**
 * Removes a key and it's value from the column family
 *
 * @param  {String}     key             The key to remove
 * @param  {Function}   callback        Standard callback method
 * @param  {Error}      callback.err    An error object, if any
 */
exports.database.prototype.remove = function (key, callback) {
  this.doBulk([{type: 'remove', key}], callback);
};

/**
 * Performs multiple operations in one action
 *
 * @param  {Object[]}   bulk            The set of operations that should be performed
 * @param  {Function}   callback        Standard callback method
 * @param  {Error}      callback.err    An error object, if any
 */
exports.database.prototype.doBulk = function (bulk, callback) {
  const queries = [];
  bulk.forEach((operation) => {
    // We support finding keys of the form `test:*`. If anything matches, we will try and save this
    const matches = /^([^:]+):([^:]+)$/.exec(operation.key);
    if (operation.type === 'set') {
      queries.push({
        query: util.format('UPDATE "%s" SET data = ? WHERE key = ?', this.settings.columnFamily),
        params: [operation.value, operation.key],
      });

      if (matches) {
        queries.push({
          query: util.format('UPDATE "%s" SET data = ? WHERE key = ?', this.settings.columnFamily),
          params: ['1', `ueberdb:keys:${matches[1]}`],
        });
      }
    } else if (operation.type === 'remove') {
      queries.push({
        query: util.format('DELETE FROM "%s" WHERE key=?', this.settings.columnFamily),
        params: [operation.key],
      });

      if (matches) {
        queries.push({
          query: util.format('DELETE FROM "%s" WHERE key = ?', this.settings.columnFamily),
          params: [`ueberdb:keys:${matches[1]}`],
        });
      }
    }
  });
  this.client.batch(queries, {prepare: true}, callback);
};

/**
 * Closes the Cassandra connection
 *
 * @param  {Function}   callback        Standard callback method
 * @param  {Error}      callback.err    Error object in case something goes wrong
 */
exports.database.prototype.close = function (callback) {
  this.pool.shutdown(callback);
};
