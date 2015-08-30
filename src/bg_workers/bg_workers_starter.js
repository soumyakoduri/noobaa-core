'use strict';
require('../util/panic');

var dotenv = require('dotenv');
var _ = require('lodash');
var Q = require('q');
var mongoose = require('mongoose');
var http = require('http');
var promise_utils = require('../util/promise_utils');
var cloud_sync = require('./cloud_sync.js');
var dbg = require('noobaa-util/debug_module')(__filename);
var mongoose_logger = require('noobaa-util/mongoose_logger');

//Global Configuration and Initialization
console.log('loading .env file ( no foreman ;)');
dotenv.load();


//TODO:: move all this to db index (function and direct call)
var debug_mode = (process.env.DEBUG_MODE === 'true');
var mongoose_connected = false;
var mongoose_timeout = null;

// connect to the database
if (debug_mode) {
    mongoose.set('debug', mongoose_logger(dbg.log0.bind(dbg)));
}

mongoose.connection.once('open', function() {
    // call ensureIndexes explicitly for each model
    mongoose_connected = true;
    return Q.all(_.map(mongoose.modelNames(), function(model_name) {
        return Q.npost(mongoose.model(model_name), 'ensureIndexes');
    }));
});

mongoose.connection.on('error', function(err) {
    mongoose_connected = false;
    console.error('mongoose connection error:', err);
    if (!mongoose_timeout) {
        mongoose_timeout = setTimeout(mongoose_conenct, 5000);
    }

});

function mongoose_conenct() {
    clearTimeout(mongoose_timeout);
    mongoose_timeout = null;
    if (!mongoose_connected) {
        mongoose.connect(
            process.env.MONGOHQ_URL ||
            process.env.MONGOLAB_URI ||
            'mongodb://localhost/nbcore');
    }
}

mongoose_conenct();

var server_rpc;
var http_server;

function register_rpc() {
    server_rpc = require('./bg_workers_rpc');

    http_server = http.createServer();
    Q.fcall(function() {
            return Q.ninvoke(http_server, 'listen', 5002);
        })
        .then(function() {
            server_rpc.register_ws_transport(http_server);
        });
}

register_rpc();

function register_bg_worker(name, run_batch_function) {
    if (!name || !_.isFunction(run_batch_function)) {
        console.error('Name and run function must be supplied for registering bg worker', name);
        throw new Error('Name and run function must be supplied for registering bg worker ' + name);
    }

    dbg.log0('Registering', name, 'bg worker');
    promise_utils.run_background_worker({
        name: name,
        run_batch: run_batch_function
    });
}

register_bg_worker('cloud_sync_refresher', cloud_sync.background_worker);
