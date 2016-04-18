'use strict';
var assert = require('assertive');
var Bluebird = require('bluebird');

// This is important because PhantomJS has a non-writeable
// error.stack property and the resulting warnings make the tests fail...
Bluebird.config({ warnings: false });

var fetch = require('../').fetch;

var options = require('./mock-service');

describe('fetch: https', function () {
  it('can load from valid https remote', function () {
    // This is a remote call which isn't great but it means we get a valid
    // https certificate without having to pull any tricks.
    this.timeout(2000);
    return fetch('https://api.reddit.com/r/javascript/about.json')
      .then(function (res) {
        assert.equal(200, res.statusCode);
      });
  });

  it('fails with self-signed https', function () {
    return assert.rejects(fetch(options.baseUrlTls))
      .then(function (error) {
        // In browsers we don't get any nice, reliable errors (yet?)
        if (typeof document === 'undefined') {
          if (error.code) {
            // more recent node versions (e.g. 4+)
            assert.equal('SELF_SIGNED_CERT_IN_CHAIN', error.code);
          } else {
            // old node versions (e.g. 0.10)
            assert.equal('SELF_SIGNED_CERT_IN_CHAIN', error.message);
          }
        }
      });
  });

  it('supports rejectUnauthorized=false', function () {
    if (typeof document !== 'undefined') {
      // Browsers don't allow to side-step https
      return this.skip();
    }
    return fetch(options.baseUrlTls, {
      rejectUnauthorized: false,
    })
      .then(function (res) {
        assert.equal(200, res.statusCode);
      });
  });

  it('can load from self-signed https remote', function () {
    if (typeof document !== 'undefined') {
      // Browsers don't allow to side-step https
      return this.skip();
    }
    var fs = require('fs');
    return fetch(options.baseUrlTls, {
      ca: fs.readFileSync('test/certs/client/my-root-ca.crt.pem'),
    })
      .then(function (res) {
        assert.equal(200, res.statusCode);
      });
  });
});
