// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var RPC = require('../rpc/rpc');
var RpcSchema = require('../rpc/rpc_schema');

describe('RPC', function() {

    // init the test api
    var test_api = {
        name: 'test_api',
        definitions: {
            params_schema: {
                type: 'object',
                required: ['param1', 'param2', 'param3', 'param4'],
                properties: {
                    param1: {
                        type: 'string',
                    },
                    param2: {
                        type: 'number',
                    },
                    param3: {
                        type: 'boolean',
                    },
                    param4: {
                        type: 'integer',
                        format: 'idate',
                    },
                    param5: {
                        type: 'array',
                    },
                }
            },
            reply_schema: {
                type: 'object',
                required: ['rest'],
                properties: {
                    rest: {
                        type: 'array',
                    }
                }
            },
        },
        methods: {
            get: {
                method: 'GET',
                params: {
                    $ref: '/test_api/definitions/params_schema'
                },
                reply: {
                    $ref: '/test_api/definitions/reply_schema'
                },
                doc: 'get doc',
                auth: false,
            },
            post: {
                method: 'POST',
                params: {
                    $ref: '/test_api/definitions/params_schema'
                },
                reply: {
                    $ref: '/test_api/definitions/reply_schema'
                },
                doc: 'post doc',
                auth: false,
            },
            put: {
                method: 'PUT',
                params: {
                    $ref: '/test_api/definitions/params_schema'
                },
                reply: {
                    $ref: '/test_api/definitions/reply_schema'
                },
                doc: 'put doc',
                auth: false,
            },
            delete: {
                method: 'DELETE',
                params: {
                    $ref: '/test_api/definitions/params_schema'
                },
                reply: {
                    $ref: '/test_api/definitions/reply_schema'
                },
                doc: 'del doc',
                auth: false,
            },
        }
    };

    // test data
    var PARAMS = {
        param1: '1',
        param2: 2,
        param3: true,
        param4: Date.now(),
        param5: [1, 2, 3],
    };
    var REPLY = {
        rest: ['IS', {
            fucking: 'aWeSoMe'
        }]
    };
    var ERROR_DATA = 'testing error';
    var ERROR_NAME = 'FORBIDDEN';
    var ERROR_CODE = 403;
    var schema = new RpcSchema();
    schema.register_api(test_api);

    describe('schema.register_api', function() {

        it('should detect api with bad method', function() {
            assert.throws(function() {
                var bad_schema = new RpcSchema();
                bad_schema.register_api({
                    methods: {
                        a: {
                            method: 'POSTER',
                        },
                    }
                });
            });
        });

    });

    describe('register_service', function() {

        it('should work on empty server with allow_missing_methods', function() {
            var rpc = new RPC();
            rpc.register_service(test_api, {},  {
                allow_missing_methods: true
            });
        });

        it('should detect missing api func', function() {
            // check that missing functions are detected
            var rpc = new RPC();
            assert.throws(function() {
                rpc.register_service(test_api, {});
            }, Error);
        });

        it('should throw on duplicate service', function() {
            var rpc = new RPC();
            rpc.register_service(test_api, {}, {
                peer: 17,
                allow_missing_methods: true
            });
            assert.throws(function() {
                rpc.register_service(test_api, {}, {
                    peer: 17,
                    allow_missing_methods: true
                });
            }, Error);
        });

        it('should work on mock server', function() {
            var rpc = new RPC();
            var server = {
                get: function() {},
                put: function() {},
                post: function() {},
                delete: function() {},
                use: function() {},
            };
            rpc.register_service(test_api, server);
        });

    });


    describe('test_api round trip', function() {

        // create a test for every api function
        _.each(test_api.methods, function(method_api, method_name) {

            var rpc = new RPC();

            describe(method_name, function() {

                var reply_error = false;
                var client;

                before(function() {
                    // init a server for the currently tested func.
                    // we use a dedicated server per func so that all the other funcs
                    // of the server return error in order to detect calling confusions.
                    var methods = {};
                    methods[method_name] = function(req) {
                        // console.log('TEST SERVER REQUEST');
                        _.each(PARAMS, function(param, name) {
                            assert.deepEqual(param, req.rpc_params[name]);
                        });
                        if (reply_error) {
                            throw req.rpc_error(ERROR_NAME, ERROR_DATA);
                        } else {
                            return Q.resolve(REPLY);
                        }
                    };
                    rpc.register_service(test_api, methods, {
                        allow_missing_methods: true
                    });
                    client = rpc.create_client(test_api);
                });

                it('should call and get reply', function(done) {
                    reply_error = false;
                    client[method_name](PARAMS).then(function(res) {
                        assert.deepEqual(res, REPLY);
                    }, function(err) {
                        console.log('UNEXPECTED ERROR', err, err.stack);
                        throw 'UNEXPECTED ERROR';
                    }).nodeify(done);
                });

                it('should call and get error', function(done) {
                    reply_error = true;
                    client[method_name](PARAMS).then(function(res) {
                        console.log('UNEXPECTED REPLY', res);
                        throw 'UNEXPECTED REPLY';
                    }, function(err) {
                        assert.deepEqual(err.code, ERROR_CODE);
                        assert.deepEqual(err.name, ERROR_NAME);
                        assert.deepEqual(err.data, ERROR_DATA);
                    }).nodeify(done);
                });

            });
        });
    });

});
