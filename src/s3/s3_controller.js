'use strict';

let _ = require('lodash');
// let P = require('../util/promise');
let mime = require('mime');
let api = require('../api');
let dbg = require('../util/debug_module')(__filename);
let ObjectIO = require('../api/object_io');
let s3_errors = require('./s3_errors');

dbg.set_level(5);

const STORAGE_CLASS_STANDARD = 'Standard';
const DEFAULT_S3_USER = Object.freeze({
    ID: '123',
    DisplayName: 'NooBaa'
});

class S3Controller {

    constructor(params) {
        this.rpc_client_by_access_key = {};
        this.rpc = api.new_rpc(params.address);
        let signal_client = this.rpc.new_client();
        let n2n_agent = this.rpc.register_n2n_transport(signal_client.node.n2n_signal);
        n2n_agent.set_any_rpc_address();
    }

    prepare_request(req) {
        req.rpc_client = this.rpc_client_by_access_key[req.access_key];
        if (!req.rpc_client) {
            req.rpc_client =
                this.rpc_client_by_access_key[req.access_key] =
                this.rpc.new_client();
            req.rpc_client.object_io = new ObjectIO(req.rpc_client);
            return req.rpc_client.create_access_key_auth({
                access_key: req.access_key,
                string_to_sign: req.string_to_sign,
                signature: req.signature,
            }).return();
        }
    }


    ///////////////////////////////
    // OPERATIONS ON THE SERVICE //
    ///////////////////////////////


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTServiceGET.html
     */
    list_buckets(req) {
        return req.rpc_client.bucket.list_buckets()
            .then(reply => {
                let date = to_s3_date(new Date());
                return {
                    ListAllMyBucketsResult: {
                        Owner: DEFAULT_S3_USER,
                        Buckets: if_not_empty(_.map(reply.buckets, bucket => ({
                            Bucket: {
                                Name: bucket.name,
                                CreationDate: date
                            }
                        })))
                    }
                };
            });
    }


    ///////////////////////////
    // OPERATIONS ON BUCKETS //
    ///////////////////////////


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketHEAD.html
     */
    head_bucket(req) {
        return req.rpc_client.bucket.read_bucket({
                name: req.params.bucket
            })
            .then(bucket_info => {
                // only called to check for existance
                // no headers or reply needed
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGET.html
     * (aka list objects)
     */
    get_bucket(req) {
        // TODO GGG MUST implement Marker & MaxKeys & IsTruncated
        let params = {
            bucket: req.params.bucket,
        };
        if ('prefix' in req.query) {
            params.prefix = req.query.prefix;
        }
        if ('delimiter' in req.query) {
            params.delimiter = req.query.delimiter;
        }
        return req.rpc_client.object.list_objects(params)
            .then(reply => {
                return {
                    ListBucketResult: [{
                            Name: req.params.bucket,
                            Prefix: req.query.prefix,
                            Delimiter: req.query.delimiter,
                            MaxKeys: req.query['max-keys'],
                            Marker: req.query.marker,
                            IsTruncated: false,
                            'Encoding-Type': req.query['encoding-type'],
                        },
                        if_not_empty(_.map(reply.objects, obj => ({
                            Contents: {
                                Key: obj.key,
                                LastModified: to_s3_date(obj.info.create_time),
                                ETag: obj.info.etag,
                                Size: obj.info.size,
                                StorageClass: STORAGE_CLASS_STANDARD,
                                Owner: DEFAULT_S3_USER
                            }
                        }))),
                        if_not_empty(_.map(reply.common_prefixes, prefix => ({
                            CommonPrefixes: {
                                Prefix: prefix || ''
                            }
                        })))
                    ]
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETVersion.html
     * (aka list object versions)
     */
    get_bucket_versions(req) {
        // TODO GGG MUST implement KeyMarker & VersionIdMarker & MaxKeys & IsTruncated
        let params = {
            bucket: req.params.bucket,
        };
        if ('prefix' in req.query) {
            params.prefix = req.query.prefix;
        }
        if ('delimiter' in req.query) {
            params.delimiter = req.query.delimiter;
        }
        return req.rpc_client.object.list_objects(params)
            .then(reply => {
                return {
                    ListVersionsResult: [{
                            Name: req.params.bucket,
                            Prefix: req.query.prefix,
                            Delimiter: req.query.delimiter,
                            MaxKeys: req.query['max-keys'],
                            KeyMarker: req.query['key-marker'],
                            VersionIdMarker: req.query['version-id-marker'],
                            IsTruncated: false,
                            // NextKeyMarker: ...
                            // NextVersionIdMarker: ...
                            'Encoding-Type': req.query['encoding-type'],
                        },
                        if_not_empty(_.map(reply.objects, obj => ({
                            Version: {
                                Key: obj.key,
                                VersionId: '',
                                IsLatest: true,
                                LastModified: to_s3_date(obj.info.create_time),
                                ETag: obj.info.etag,
                                Size: obj.info.size,
                                StorageClass: STORAGE_CLASS_STANDARD,
                                Owner: DEFAULT_S3_USER
                            }
                        }))),
                        if_not_empty(_.map(reply.common_prefixes, prefix => ({
                            CommonPrefixes: {
                                Prefix: prefix || ''
                            }
                        })))
                    ]
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadListMPUpload.html
     */
    // get_bucket_uploads(req) { TODO GGG }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUT.html
     * (aka create bucket)
     */
    put_bucket(req) {
        return req.rpc_client.bucket.create_bucket({
            name: req.params.bucket
        }).return();
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETE.html
     */
    delete_bucket(req, res) {
        return req.rpc_client.bucket.delete_bucket({
            name: req.params.bucket
        }).return();
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/multiobjectdeleteapi.html
     * (aka delete objects)
     */
    // post_bucket_delete(req) { TODO GGG }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETacl.html
     * (aka get bucket permissions)
     */
    get_bucket_acl(req) {
        return req.rpc_client.bucket.read_bucket({
                name: req.params.bucket
            })
            .then(bucket_info => {
                return {
                    AccessControlPolicy: {
                        Owner: DEFAULT_S3_USER
                    }
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTacl.html
     * (aka set bucket permissions)
     */
    put_bucket_acl(req) {
        // TODO GGG ignoring put_bucket_acl for now
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETlocation.html
     */
    get_bucket_location(req) {
        return req.rpc_client.bucket.read_bucket({
                name: req.params.bucket
            })
            .then(bucket_info => {
                return {
                    LocationConstraint: ''
                };
            });
    }


    ///////////////////////////
    // OPERATIONS ON OBJECTS //
    ///////////////////////////


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectHEAD.html
     * (aka read object meta-data)
     */
    head_object(req, res) {
        return req.rpc_client.object.read_object_md(this._object_path(req))
            .then(object_md => {
                req.object_md = object_md;
                res.setHeader('ETag', '"' + object_md.etag + '"');
                res.setHeader('Last-Modified', to_s3_date(object_md.create_time));
                res.setHeader('Content-Type', object_md.content_type);
                res.setHeader('Content-Length', object_md.size);
                res.setHeader('Accept-Ranges', 'bytes');
                set_response_xattr(res, object_md.xattr);
                if (this._ifs_check(req, res, object_md) === false) {
                    return false;
                }
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGET.html
     * (aka read object)
     */
    get_object(req, res) {
        return this.head_object(req, res)
            .then(should_handle => {
                // check if already handled by head_object
                if (should_handle === false) {
                    return false;
                }
                let object_md = req.object_md;
                let code = req.rpc_client.object_io.serve_http_stream(
                    req, res, this._object_path(req), object_md);
                switch (code) {
                    case 400:
                        throw s3_errors.InvalidArgument;
                    case 416:
                        throw s3_errors.InvalidRange;
                    case 200:
                        res.status(200);
                        return false; // let the caller know we are handling the response
                    case 206:
                        res.status(206);
                        return false; // let the caller know we are handling the response
                    default:
                        throw s3_errors.InternalError;
                }
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUT.html
     * (aka upload object, or copy object)
     */
    put_object(req, res) {

        // TODO GGG IMPLEMENT COPY OBJECT
        let copy_source = req.headers['x-amz-copy-source'];
        if (copy_source) {
            // return req.rpc_client.object.copy_object({});
            throw s3_errors.NotImplemented;
        }

        let params = {
            bucket: req.params.bucket,
            key: req.params.key,
            size: req.content_length,
            content_type: req.headers['content-type'] || mime.lookup(req.params.key),
            xattr: get_request_xattr(req),
            source_stream: req,
            calculate_md5: true
        };
        this._ifs_for_create(req, params);
        return req.rpc_client.object_io.upload_stream(params)
            .then(md5_digest => {
                let etag = md5_digest.toString('hex');
                res.setHeader('ETag', '"' + etag + '"');
                if (req.content_md5) {
                    if (Buffer.compare(md5_digest, req.content_md5)) {
                        // TODO GGG how to handle? delete the object?
                        dbg.error('S3Controller.put_object: BadDigest',
                            'content-md5', req.content_md5.toString('hex'),
                            'etag', etag);
                        throw s3_errors.BadDigest;
                    }
                }
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPOST.html
     * (aka upload using HTTP multipart/form-data encoding)
     */
    // post_object(req) { TODO GGG }

    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectDELETE.html
     */
    delete_object(req) {
        return req.rpc_client.object.delete_object({
            bucket: req.params.bucket,
            key: req.params.key
        });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGETacl.html
     * (aka get object acl)
     */
    get_object_acl(req) {
        return req.rpc_client.object.read_object_md(this._object_path(req))
            .then(object_md => {
                return {
                    AccessControlPolicy: {
                        Owner: DEFAULT_S3_USER
                    }
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUTacl.html
     * (aka set object acl)
     */
    put_object_acl(req) {
        // TODO GGG ignoring put_object_acl for now
    }


    //////////////////////
    // MULTIPART UPLOAD //
    //////////////////////


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadInitiate.html
     * (aka start multipart upload)
     */
    post_object_uploads(req) {
        let params = {
            bucket: req.params.bucket,
            key: req.params.key,
            size: req.content_length,
            content_type: req.headers['content-type'] || mime.lookup(req.params.key),
            xattr: get_request_xattr(req),
        };
        this._ifs_for_create(req, params);
        return req.rpc_client.object.create_object_upload(params)
            .then(reply => {
                return {
                    InitiateMultipartUploadResult: {
                        Bucket: req.params.bucket,
                        Key: req.params.key,
                        UploadId: reply.upload_id
                    }
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadComplete.html
     * (aka complete multipart upload)
     */
    post_object_uploadId(req) {
        return req.rpc_client.object.complete_object_upload({
                bucket: req.params.bucket,
                key: req.params.key,
                upload_id: req.query.uploadId,
                fix_parts_size: true,
                etag: '',
            })
            .then(reply => {
                return {
                    CompleteMultipartUploadResult: {
                        Bucket: req.params.bucket,
                        Key: req.params.key,
                        ETag: reply.etag,
                        Location: req.url,
                    }
                };
            });

    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadAbort.html
     * (aka abort multipart upload)
     */
    delete_object_uploadId(req) {
        return req.rpc_client.object.abort_object_upload({
            bucket: req.params.bucket,
            key: req.params.key,
            upload_id: req.query.uploadId,
        }).return();
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadListParts.html
     * (aka list multipart upload parts)
     */
    get_object_uploadId(req) {
        let part_number_marker = parseInt(req.query['part-number-marker'], 10) || 1;
        let max_parts = parseInt(req.query['max-parts'], 10) || 1000;
        return req.rpc_client.object.list_multipart_parts({
                bucket: req.params.bucket,
                key: req.params.key,
                upload_id: req.query.uploadId,
                part_number_marker: part_number_marker,
                max_parts: max_parts,
            })
            .then(reply => {
                return {
                    ListPartsResult: [{
                            Bucket: req.params.bucket,
                            Key: req.params.key,
                            UploadId: reply.uploadId,
                            Initiator: DEFAULT_S3_USER,
                            Owner: DEFAULT_S3_USER,
                            StorageClass: STORAGE_CLASS_STANDARD,
                            PartNumberMarker: part_number_marker,
                            MaxParts: max_parts,
                            NextPartNumberMarker: reply.next_part_number_marker,
                            IsTruncated: reply.is_truncated,
                        },
                        if_not_empty(_.map(reply.upload_parts, part => ({
                            Part: {
                                PartNumber: part.part_number,
                                Size: part.size,
                                ETag: part.etag,
                                LastModified: to_s3_date(part.last_modified),
                            }
                        })))
                    ]
                };
            });
    }


    /**
     * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadUploadPart.html
     * (aka upload part)
     */
    put_object_uploadId(req, res) {
        let upload_part_number = parseInt(req.query.partNumber, 10);

        // TODO GGG IMPLEMENT COPY PART
        let copy_source = req.headers['x-amz-copy-source'];
        if (copy_source) {
            // return req.rpc_client.object.copy_part({});
            throw s3_errors.NotImplemented;
        }

        return req.rpc_client.object_io.upload_stream_parts({
                bucket: req.params.bucket,
                key: req.params.key,
                upload_id: req.query.uploadId,
                upload_part_number: upload_part_number,
                size: req.content_length,
                source_stream: req,
                calculate_md5: true
            })
            .then(md5_digest => {
                let etag = md5_digest.toString('hex');
                res.setHeader('ETag', '"' + etag + '"');
                if (req.content_md5) {
                    if (Buffer.compare(md5_digest, req.content_md5)) {
                        // TODO GGG how to handle? delete the object?
                        dbg.error('S3Controller.put_object_uploadId: BadDigest',
                            'content-md5', req.content_md5.toString('hex'),
                            'etag', etag);
                        throw s3_errors.BadDigest;
                    }
                }
                return req.rpc_client.object.complete_part_upload({
                    bucket: req.params.bucket,
                    key: req.params.key,
                    upload_id: req.query.uploadId,
                    upload_part_number: upload_part_number,
                    etag: etag
                });
            });
    }


    /////////////
    // PRIVATE //
    /////////////


    _object_path(req) {
        // Support _$folder$ used by s3 clients (supported by AWS). Replace with current prefix /
        let key = req.params.key.replace(/_\$folder\$/, '/');
        return {
            bucket: req.params.bucket,
            key: key
        };
    }


    _ifs_check(req, res, object_md) {
        if ('if-modified-since' in req.headers && (
                object_md.create_time <=
                (new Date(req.headers['if-modified-since'])).getTime()
            )) {
            res.status(304).end();
            return false;
        }
        if ('if-unmodified-since' in req.headers && (
                object_md.create_time >=
                (new Date(req.headers['if-unmodified-since'])).getTime()
            )) {
            res.status(412).end();
            return false;
        }
        if ('if-match' in req.headers &&
            req.headers['if-match'] !== object_md.etag) {
            res.status(412).end();
            return false;
        }
        if ('if-none-match' in req.headers &&
            req.headers['if-none-match'] === object_md.etag) {
            res.status(304).end();
            return false;
        }
        return true;
    }

    _ifs_for_create(req, params) {
        if ('if-modified-since' in req.headers) {
            params.id_modified_since = (new Date(req.headers['if-modified-since'])).getTime();
        }
        if ('if-unmodified-since' in req.headers) {
            params.id_unmodified_since = (new Date(req.headers['if-unmodified-since'])).getTime();
        }
        if ('if-match' in req.headers) {
            params.if_match_etag = req.headers['if-match'];
        }
        if ('if-none-match' in req.headers) {
            params.if_none_match_etag = req.headers['if-none-match'];
        }
    }

}


function to_s3_date(input) {
    let date = input ? new Date(input) : new Date();
    date.setMilliseconds(0);
    return date.toISOString();
}

function if_not_empty(obj) {
    return _.isEmpty(obj) ? undefined : obj;
}

function get_request_xattr(req) {
    let xattr = {};
    _.each(req.headers, (val, hdr) => {
        if (!hdr.startsWith('x-amz-meta-')) return;
        let key = hdr.slice('x-amz-meta-'.length);
        if (!key) return;
        xattr[key] = val;
    });
    return xattr;
}

function set_response_xattr(res, xattr) {
    _.each(xattr, (val, key) => {
        res.setHeader('x-amz-meta-' + key, val);
    });
}

module.exports = S3Controller;
