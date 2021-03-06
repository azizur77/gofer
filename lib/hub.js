
/*
Copyright (c) 2014, Groupon, Inc.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

Neither the name of GROUPON nor the names of its contributors may be
used to endorse or promote products derived from this software without
specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
var DefaultPromise, EventEmitter, HRDuration, Hub, checkTimeout, debug, extend, formatUri, generateHeaders, generateUUID, http, https, isJsonResponse, map, mapValues, promiseHelpers, ref, ref1, ref2, removeInvalidHeaderChars, request, safeParseJSON, util, uuid;

EventEmitter = require('events').EventEmitter;

http = require('http');

https = require('https');

util = require('util');

request = require('request');

HRDuration = require('hrduration');

uuid = require('node-uuid');

ref = require('lodash'), extend = ref.extend, map = ref.map, mapValues = ref.mapValues;

debug = require('debug')('gofer:hub');

DefaultPromise = (ref1 = global.Promise) != null ? ref1 : require('bluebird');

ref2 = require('./json'), safeParseJSON = ref2.safeParseJSON, isJsonResponse = ref2.isJsonResponse;

promiseHelpers = require('./promise');

checkTimeout = function(timeout) {
  if (typeof timeout !== 'number') {
    throw new Error(util.format('Invalid timeout: %j, not a number', timeout));
  }
  return timeout;
};

removeInvalidHeaderChars = function(header) {
  return ("" + header).replace(/(?:\x7F|[^\x09\x20-\xFF])+/g, '');
};

module.exports = Hub = function() {
  var hub, logPendingRequests, setupCompletionTimeout, setupTimeouts;
  hub = new EventEmitter;
  hub.Promise = DefaultPromise;
  hub.fetch = function(options, done) {
    var baseLog, completionTimeoutInterval, connectTimeoutInterval, fetchId, getSeconds, handleResult, hubHeaders, ref3, ref4, req, responseData, sendResult;
    getSeconds = HRDuration().getSeconds;
    fetchId = generateUUID();
    options.timeout = checkTimeout((ref3 = options.timeout) != null ? ref3 : Hub.requestTimeout);
    connectTimeoutInterval = checkTimeout((ref4 = options.connectTimeout) != null ? ref4 : Hub.connectTimeout);
    if (options.headers == null) {
      options.headers = {};
    }
    options.method = options.method != null ? options.method.toUpperCase() : 'GET';
    hubHeaders = generateHeaders(options.requestId, fetchId);
    extend(options.headers, hubHeaders);
    options.headers = mapValues(options.headers, removeInvalidHeaderChars);
    logPendingRequests(http.globalAgent);
    logPendingRequests(https.globalAgent);
    responseData = {
      requestId: options.requestId,
      fetchId: fetchId
    };
    baseLog = extend({
      uri: options.uri,
      method: options.method
    }, options.logData, responseData);
    Object.defineProperty(responseData, 'requestOptions', {
      value: options
    });
    Object.defineProperty(baseLog, 'requestOptions', {
      value: options
    });
    debug('-> %s', options.method, options.uri);
    hub.emit('start', baseLog);
    handleResult = function(error, response, body) {
      var apiError, logLine, maxStatusCode, minStatusCode, parseError, parseJSON, ref5, ref6, ref7, successfulRequest, uri;
      parseJSON = (ref5 = options.parseJSON) != null ? ref5 : isJsonResponse(response, body);
      if (parseJSON) {
        ref6 = safeParseJSON(body, response), parseError = ref6.parseError, body = ref6.body;
      }
      if (error == null) {
        error = parseError;
      }
      responseData.fetchDuration = getSeconds();
      options.uri = this.uri;
      uri = formatUri(options.uri);
      logLine = extend({
        statusCode: response != null ? response.statusCode : void 0,
        uri: uri,
        method: options.method,
        connectDuration: responseData.connectDuration,
        fetchDuration: responseData.fetchDuration,
        requestId: options.requestId,
        fetchId: fetchId
      }, options.logData);
      if (error != null) {
        logLine.code = error.code;
        logLine.message = error.message;
        logLine.syscall = error.syscall;
        logLine.statusCode = error.code;
        debug('<- %s', error.code, uri);
        hub.emit('fetchError', logLine);
        if (error.responseData == null) {
          error.responseData = responseData;
        }
        process.nextTick(function() {
          return sendResult(error, body);
        });
        return;
      }
      apiError = null;
      minStatusCode = options.minStatusCode || 200;
      maxStatusCode = options.maxStatusCode || 299;
      successfulRequest = (minStatusCode <= (ref7 = response.statusCode) && ref7 <= maxStatusCode);
      if (successfulRequest) {
        debug('<- %s', response.statusCode, uri);
        hub.emit('success', logLine);
      } else {
        apiError = new Error("API Request returned a response outside the status code range (code: " + response.statusCode + ", range: [" + minStatusCode + ", " + maxStatusCode + "])");
        apiError.type = 'api_response_error';
        apiError.httpHeaders = response.headers;
        apiError.body = body;
        apiError.statusCode = response.statusCode;
        apiError.minStatusCode = logLine.minStatusCode = minStatusCode;
        apiError.maxStatusCode = logLine.maxStatusCode = maxStatusCode;
        if (apiError.responseData == null) {
          apiError.responseData = responseData;
        }
        debug('<- %s', response.statusCode, uri);
        hub.emit('failure', logLine);
      }
      return sendResult(apiError, body, response, responseData);
    };
    sendResult = function(error, data, response, responseData) {
      return req.emit('goferResult', error, data, response, responseData);
    };
    req = request(options, handleResult);
    completionTimeoutInterval = options.completionTimeout;
    setupTimeouts(connectTimeoutInterval, completionTimeoutInterval, req, responseData, getSeconds);
    if (typeof done === 'function') {
      req.on('goferResult', done);
    }
    req.Promise = hub.Promise;
    return Object.defineProperties(req, promiseHelpers);
  };
  logPendingRequests = function(arg) {
    var host, maxSockets, queue, queueReport, requests;
    requests = arg.requests, maxSockets = arg.maxSockets;
    if (!(Object.keys(requests).length > 0)) {
      return;
    }
    queueReport = (function() {
      var results;
      results = [];
      for (host in requests) {
        queue = requests[host];
        results.push(host + ": " + queue.length);
      }
      return results;
    })();
    return hub.emit('socketQueueing', {
      maxSockets: maxSockets,
      queueReport: queueReport
    });
  };
  setupTimeouts = function(connectTimeoutInterval, completionTimeoutInterval, request, responseData, getSeconds) {
    return request.on('request', function(req) {
      return req.on('socket', function(socket) {
        var connectTimeout, connectingSocket, connectionSuccessful, connectionTimedOut, ref3;
        connectTimeout = void 0;
        connectionTimedOut = function() {
          var err;
          req.abort();
          responseData.connectDuration = getSeconds();
          err = new Error('ECONNECTTIMEDOUT');
          err.code = 'ECONNECTTIMEDOUT';
          err.message = ("Connecting to " + responseData.requestOptions.method + " ") + (responseData.requestOptions.uri + " timed out after " + connectTimeoutInterval + "ms");
          err.responseData = responseData;
          return req.emit('error', err);
        };
        connectionSuccessful = function() {
          responseData.connectDuration = getSeconds();
          hub.emit('connect', responseData);
          clearTimeout(connectTimeout);
          connectTimeout = null;
          return setupCompletionTimeout(completionTimeoutInterval, req, responseData, getSeconds);
        };
        connectingSocket = (ref3 = socket.socket) != null ? ref3 : socket;
        connectingSocket.on('connect', connectionSuccessful);
        return connectTimeout = setTimeout(connectionTimedOut, connectTimeoutInterval);
      });
    });
  };
  setupCompletionTimeout = function(completionTimeoutInterval, req, responseData, getSeconds) {
    var completionSuccessful, completionTimedOut, completionTimeout;
    if (!completionTimeoutInterval) {
      return;
    }
    completionTimeout = void 0;
    completionTimedOut = function() {
      var err;
      req.abort();
      responseData.completionDuration = getSeconds() - responseData.connectDuration;
      err = new Error('ETIMEDOUT');
      err.code = 'ETIMEDOUT';
      err.message = "Response timed out after " + completionTimeoutInterval + "ms";
      err.responseData = responseData;
      return req.emit('error', err);
    };
    completionSuccessful = function() {
      responseData.completionDuration = getSeconds() - responseData.connectDuration;
      clearTimeout(completionTimeout);
      return completionTimeout = null;
    };
    req.on('complete', completionSuccessful);
    return completionTimeout = setTimeout(completionTimedOut, completionTimeoutInterval);
  };
  return hub;
};

generateUUID = function() {
  return uuid.v1().replace(/-/g, '');
};

generateHeaders = function(requestId, fetchId) {
  var headers;
  headers = {
    'Connection': 'close',
    'X-Fetch-ID': fetchId
  };
  if (requestId != null) {
    headers['X-Request-ID'] = requestId;
  }
  return headers;
};

formatUri = function(uri) {
  if (typeof uri === 'object') {
    return uri.href;
  } else {
    return uri;
  }
};

Hub.connectTimeout = 1000;

Hub.requestTimeout = 10000;
