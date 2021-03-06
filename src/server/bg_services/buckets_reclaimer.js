/* Copyright (C) 2016 NooBaa */
'use strict';

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const P = require('../../util/promise');
const auth_server = require('../common_services/auth_server');
const _ = require('lodash');

class BucketsReclaimer {

    constructor({ name, client }) {
        this.name = name;
        this.client = client;
    }

    async run_batch() {
        if (!this._can_run()) return;

        const support_account = _.find(system_store.data.accounts, account => account.is_support);
        const deleting_buckets = this._get_deleting_buckets();
        if (!deleting_buckets || !deleting_buckets.length) {
            dbg.log0('no buckets in "deleting" state. nothing to do');
            return config.BUCKET_RECLAIMER_EMPTY_DELAY;
        }

        let has_errors = false;
        dbg.log0('bucket_reclaimer: starting batch work on buckets: ', deleting_buckets.map(b => b.name).join(', '));
        await P.all(deleting_buckets.map(async bucket => {
            try {
                dbg.log0(`emptying bucket ${bucket.name}. deleting next ${config.BUCKET_RECLAIMER_BATCH_SIZE} objects`);
                const { is_empty } = await this.client.object.delete_multiple_objects_by_prefix({
                    bucket: bucket.name,
                    prefix: "",
                    limit: config.BUCKET_RECLAIMER_BATCH_SIZE
                }, {
                    auth_token: auth_server.make_auth_token({
                        system_id: system_store.data.systems[0]._id,
                        account_id: support_account._id,
                        role: 'admin'
                    })
                });
                if (is_empty) {
                    dbg.log0(`bucket ${bucket.name} is empty. calling delete_bucket`);
                    await this.client.bucket.delete_bucket({ name: bucket.name, internal_call: true }, {
                        auth_token: auth_server.make_auth_token({
                            system_id: system_store.data.systems[0]._id,
                            account_id: support_account._id,
                            role: 'admin'
                        })
                    });
                } else {
                    dbg.log0(`bucket ${bucket.name} is not empty yet`);
                }
            } catch (err) {
                dbg.error(`got error when trying to empty and delete bucket ${bucket.name} :`, err);
                has_errors = true;
            }
        }));

        if (has_errors) {
            return config.BUCKET_RECLAIMER_ERROR_DELAY;
        }
        return config.BUCKET_RECLAIMER_BATCH_DELAY;

    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('BucketsReclaimer: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        const support_account = _.find(system_store.data.accounts, account => account.is_support);
        if (!support_account) return false;

        return true;
    }

    _get_deleting_buckets() {
        // return buckets that has the deleting flag set
        return system_store.data.buckets.filter(bucket => Boolean(bucket.deleting));
    }

}


exports.BucketsReclaimer = BucketsReclaimer;
