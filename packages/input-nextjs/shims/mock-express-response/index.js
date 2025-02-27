'use strict'

//dependencies
var path = require('path')
var contentDisposition = require('content-disposition')
var onFinished = require('on-finished')
var escapeHtml = require('escape-html')
var merge = require('utils-merge')
var Utils = require('./utils')
var MockResponse = require('mock-res')
var util = require('util')
var send = require('send')
var mime = send.mime
var STATUS_CODES = require('http').STATUS_CODES
var deprecate = () => {}
var setCharset = Utils.setCharset
var normalizeType = Utils.normalizeType
var normalizeTypes = Utils.normalizeTypes
var isAbsolute = Utils.isAbsolute
var vary = require('vary')
var sign = require('cookie-signature').sign
var cookie = require('cookie')
var extname = path.extname

/**
 * @constructor
 * @description Express response mock
 * @public
 */
function MockExpressResponse(options) {
  options = options || {}

  MockResponse.call(this, options.finish)

  this.app = {
    'jsonp callback name': 'callback',
    render: function(view, data, fn) {
      //default implementation is
      //to return uncompiled view
      //
      //this must me ovveriden by view engine
      //of choice
      if ('function' === typeof options.runtime) {
        options.runtime(view, data, fn)
      } else {
        fn(null, view)
      }
    },
  }

  this.req =
    options.request ||
    new MockExpressRequest({
      query: {},
    })
}
util.inherits(MockExpressResponse, MockResponse)

//------------------------------------------------------------------------------
// Express respnse methods
//------------------------------------------------------------------------------

/**
 * Set status `code`.
 *
 * @param {Number} code
 * @return {ServerResponse}
 * @api public
 */
MockExpressResponse.prototype.status = function(code) {
  this.statusCode = code
  this.statusMessage = STATUS_CODES[this.statusCode]
  return this
}

/**
 * Set Link header field with the given `links`.
 *
 * Examples:
 *
 *    res.links({
 *      next: 'http://api.example.com/users?page=2',
 *      last: 'http://api.example.com/users?page=5'
 *    });
 *
 * @param {Object} links
 * @return {ServerResponse}
 * @api public
 */
MockExpressResponse.prototype.links = function(links) {
  var link = this.get('Link') || ''
  if (link) {
    link += ', '
  }
  return this.set(
    'Link',
    link +
      Object.keys(links)
        .map(function(rel) {
          return '<' + links[rel] + '>; rel="' + rel + '"'
        })
        .join(', ')
  )
}

/**
 * Send a response.
 *
 * Examples:
 *
 *     res.send(new Buffer('wahoo'));
 *     res.send({ some: 'json' });
 *     res.send('<p>some html</p>');
 *
 * @param {string|number|boolean|object|Buffer} body
 * @api public
 */
MockExpressResponse.prototype.send = function send(body) {
  var chunk = body
  var encoding
  var len
  var req = this.req
  var type

  // settings
  var app = this.app

  // allow status / body
  if (arguments.length === 2) {
    // res.send(body, status) backwards compat
    if (typeof arguments[0] !== 'number' && typeof arguments[1] === 'number') {
      deprecate('res.send(body, status): Use res.status(status).send(body) instead')
      this.statusCode = arguments[1]
    } else {
      deprecate('res.send(status, body): Use res.status(status).send(body) instead')
      this.statusCode = arguments[0]
      chunk = arguments[1]
    }
  }

  // disambiguate res.send(status) and res.send(status, num)
  if (typeof chunk === 'number' && arguments.length === 1) {
    // res.send(status) will set status message as text string
    if (!this.get('Content-Type')) {
      this.type('txt')
    }

    deprecate('res.send(status): Use res.sendStatus(status) instead')
    this.statusCode = chunk
    chunk = STATUS_CODES[chunk]
  }

  switch (typeof chunk) {
    // string defaulting to html
    case 'string':
      if (!this.get('Content-Type')) {
        this.type('html')
      }
      break
    case 'boolean':
    case 'number':
    case 'object':
      if (chunk === null) {
        chunk = ''
      } else if (Buffer.isBuffer(chunk)) {
        if (!this.get('Content-Type')) {
          this.type('bin')
        }
      } else {
        return this.json(chunk)
      }
      break
  }

  // write strings in utf-8
  if (typeof chunk === 'string') {
    encoding = 'utf8'
    type = this.get('Content-Type')

    // reflect this in content-type
    if (typeof type === 'string') {
      this.set('Content-Type', setCharset(type, 'utf-8'))
    }
  }

  // populate Content-Length
  if (chunk !== undefined) {
    if (!Buffer.isBuffer(chunk)) {
      // convert chunk to Buffer; saves later double conversions
      chunk = new Buffer(chunk, encoding)
      encoding = undefined
    }

    len = chunk.length
    this.set('Content-Length', len)
  }

  // populate ETag
  var etag
  var generateETag = len !== undefined && app['etag fn']
  if (typeof generateETag === 'function' && !this.get('ETag')) {
    if ((etag = generateETag(chunk, encoding))) {
      this.set('ETag', etag)
    }
  }

  // freshness
  if (req.fresh) {
    this.statusCode = 304
  }

  // strip irrelevant headers
  if (204 === this.statusCode || 304 === this.statusCode) {
    this.removeHeader('Content-Type')
    this.removeHeader('Content-Length')
    this.removeHeader('Transfer-Encoding')
    chunk = ''
  }

  if (req.method === 'HEAD') {
    // skip body for HEAD
    this.end()
  } else {
    // respond
    this.end(chunk, encoding)
  }

  return this
}

/**
 * Send JSON response.
 *
 * Examples:
 *
 *     res.json(null);
 *     res.json({ user: 'tj' });
 *
 * @param {string|number|boolean|object} obj
 * @api public
 */
MockExpressResponse.prototype.json = function json(obj) {
  var val = obj

  // allow status / body
  if (arguments.length === 2) {
    // res.json(body, status) backwards compat
    if (typeof arguments[1] === 'number') {
      deprecate('res.json(obj, status): Use res.status(status).json(obj) instead')
      this.statusCode = arguments[1]
    } else {
      deprecate('res.json(status, obj): Use res.status(status).json(obj) instead')
      this.statusCode = arguments[0]
      val = arguments[1]
    }
  }

  // settings
  var app = this.app
  var replacer = app['json replacer']
  var spaces = app['json spaces']
  var body = JSON.stringify(val, replacer, spaces)

  // content-type
  if (!this.get('Content-Type')) {
    this.set('Content-Type', 'application/json')
  }

  return this.send(body)
}

/**
 * Send JSON response with JSONP callback support.
 *
 * Examples:
 *
 *     res.jsonp(null);
 *     res.jsonp({ user: 'tj' });
 *
 * @param {string|number|boolean|object} obj
 * @api public
 */
MockExpressResponse.prototype.jsonp = function jsonp(obj) {
  var val = obj

  // allow status / body
  if (arguments.length === 2) {
    // res.json(body, status) backwards compat
    if (typeof arguments[1] === 'number') {
      deprecate('res.jsonp(obj, status): Use res.status(status).json(obj) instead')
      this.statusCode = arguments[1]
    } else {
      deprecate('res.jsonp(status, obj): Use res.status(status).jsonp(obj) instead')
      this.statusCode = arguments[0]
      val = arguments[1]
    }
  }

  // settings
  var app = this.app
  var replacer = app['json replacer']
  var spaces = app['json spaces']
  var body = JSON.stringify(val, replacer, spaces)
  var callback = this.req.query[app['jsonp callback name']]

  // content-type
  if (!this.get('Content-Type')) {
    this.set('X-Content-Type-Options', 'nosniff')
    this.set('Content-Type', 'application/json')
  }

  // fixup callback
  if (Array.isArray(callback)) {
    callback = callback[0]
  }

  // jsonp
  if (typeof callback === 'string' && callback.length !== 0) {
    this.charset = 'utf-8'
    this.set('X-Content-Type-Options', 'nosniff')
    this.set('Content-Type', 'text/javascript')

    // restrict callback charset
    callback = callback.replace(/[^\[\]\w$.]/g, '')

    // replace chars not allowed in JavaScript that are in JSON
    body = body.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

    // the /**/ is a specific security mitigation for "Rosetta Flash JSONP abuse"
    // the typeof check is just to reduce client error noise
    body =
      '/**/ typeof ' + callback + " === 'function' && " + callback + '(' + body + ');'
  }

  return this.send(body)
}

/**
 * Send given HTTP status code.
 *
 * Sets the response status to `statusCode` and the body of the
 * response to the standard description from node's http.STATUS_CODES
 * or the statusCode number if no description.
 *
 * Examples:
 *
 *     res.sendStatus(200);
 *
 * @param {number} statusCode
 * @api public
 */
MockExpressResponse.prototype.sendStatus = function sendStatus(statusCode) {
  var body = STATUS_CODES[statusCode] || String(statusCode)

  this.statusCode = statusCode
  this.type('txt')

  return this.send(body)
}

// pipe the send file stream
function sendfile(res, file, options, callback) {
  var done = false
  var streaming

  // request aborted
  function onaborted() {
    if (done) {
      return
    }
    done = true

    var err = new Error('Request aborted')
    err.code = 'ECONNABORTED'
    callback(err)
  }

  // directory
  function ondirectory() {
    if (done) {
      return
    }
    done = true

    var err = new Error('EISDIR, read')
    err.code = 'EISDIR'
    callback(err)
  }

  // errors
  function onerror(err) {
    if (done) {
      return
    }
    done = true
    callback(err)
  }

  // ended
  function onend() {
    if (done) {
      return
    }
    done = true
    callback()
  }

  // file
  function onfile() {
    streaming = false
  }

  // finished
  function onfinish(err) {
    if (err && err.code === 'ECONNRESET') {
      return onaborted()
    }
    if (err) {
      return onerror(err)
    }
    if (done) {
      return
    }

    setImmediate(function() {
      if (streaming !== false && !done) {
        onaborted()
        return
      }

      if (done) {
        return
      }
      done = true
      callback()
    })
  }

  // streaming
  function onstream() {
    streaming = true
  }

  file.on('directory', ondirectory)
  file.on('end', onend)
  file.on('error', onerror)
  file.on('file', onfile)
  file.on('stream', onstream)
  onFinished(res, onfinish)

  if (options.headers) {
    // set headers on successful transfer
    file.on('headers', function headers(res) {
      var obj = options.headers
      var keys = Object.keys(obj)

      for (var i = 0; i < keys.length; i++) {
        var k = keys[i]
        res.setHeader(k, obj[k])
      }
    })
  }

  // pipe
  file.pipe(res)
}

/**
 * Transfer the file at the given `path`.
 *
 * Automatically sets the _Content-Type_ response header field.
 * The callback `fn(err)` is invoked when the transfer is complete
 * or when an error occurs. Be sure to check `res.sentHeader`
 * if you wish to attempt responding, as the header and some data
 * may have already been transferred.
 *
 * Options:
 *
 *   - `maxAge`   defaulting to 0 (can be string converted by `ms`)
 *   - `root`     root directory for relative filenames
 *   - `headers`  object of headers to serve with file
 *   - `dotfiles` serve dotfiles, defaulting to false; can be `"allow"` to send them
 *
 * Other options are passed along to `send`.
 *
 * Examples:
 *
 *  The following example illustrates how `res.sendFile()` may
 *  be used as an alternative for the `static()` middleware for
 *  dynamic situations. The code backing `res.sendFile()` is actually
 *  the same code, so HTTP cache support etc is identical.
 *
 *     app.get('/user/:uid/photos/:file', function(req, res){
 *       var uid = req.params.uid
 *         , file = req.params.file;
 *
 *       req.user.mayViewFilesFrom(uid, function(yes){
 *         if (yes) {
 *           res.sendFile('/uploads/' + uid + '/' + file);
 *         } else {
 *           res.send(403, 'Sorry! you cant see that.');
 *         }
 *       });
 *     });
 *
 * @api public
 */
MockExpressResponse.prototype.sendFile = function sendFile(path, options, fn) {
  var req = this.req
  var res = this
  var next = req.next

  if (!path) {
    throw new TypeError('path argument is required to res.sendFile')
  }

  // support function as second arg
  if (typeof options === 'function') {
    fn = options
    options = {}
  }

  options = options || {}

  if (!options.root && !isAbsolute(path)) {
    throw new TypeError('path must be absolute or specify root to res.sendFile')
  }

  // create file stream
  var pathname = encodeURI(path)
  var file = send(req, pathname, options)

  // transfer
  sendfile(res, file, options, function(err) {
    if (fn) {
      return fn(err)
    }
    if (err && err.code === 'EISDIR') {
      return next()
    }

    // next() all but write errors
    if (err && err.code !== 'ECONNABORTED' && err.syscall !== 'write') {
      next(err)
    }
  })
}

// /**
//  * Transfer the file at the given `path`.
//  *
//  * Automatically sets the _Content-Type_ response header field.
//  * The callback `fn(err)` is invoked when the transfer is complete
//  * or when an error occurs. Be sure to check `res.sentHeader`
//  * if you wish to attempt responding, as the header and some data
//  * may have already been transferred.
//  *
//  * Options:
//  *
//  *   - `maxAge`   defaulting to 0 (can be string converted by `ms`)
//  *   - `root`     root directory for relative filenames
//  *   - `headers`  object of headers to serve with file
//  *   - `dotfiles` serve dotfiles, defaulting to false; can be `"allow"` to send them
//  *
//  * Other options are passed along to `send`.
//  *
//  * Examples:
//  *
//  *  The following example illustrates how `res.sendfile()` may
//  *  be used as an alternative for the `static()` middleware for
//  *  dynamic situations. The code backing `res.sendfile()` is actually
//  *  the same code, so HTTP cache support etc is identical.
//  *
//  *     app.get('/user/:uid/photos/:file', function(req, res){
//  *       var uid = req.params.uid
//  *         , file = req.params.file;
//  *
//  *       req.user.mayViewFilesFrom(uid, function(yes){
//  *         if (yes) {
//  *           res.sendfile('/uploads/' + uid + '/' + file);
//  *         } else {
//  *           res.send(403, 'Sorry! you cant see that.');
//  *         }
//  *       });
//  *     });
//  *
//  * @api public
//  */

// res.sendfile = function(path, options, fn){
//   var req = this.req;
//   var res = this;
//   var next = req.next;

//   // support function as second arg
//   if (typeof options === 'function') {
//     fn = options;
//     options = {};
//   }

//   options = options || {};

//   // create file stream
//   var file = send(req, path, options);

//   // transfer
//   sendfile(res, file, options, function (err) {
//     if (fn) return fn(err);
//     if (err && err.code === 'EISDIR') return next();

//     // next() all but write errors
//     if (err && err.code !== 'ECONNABORT' && err.syscall !== 'write') {
//       next(err);
//     }
//   });
// };

// res.sendfile = deprecate.function(res.sendfile,
//   'res.sendfile: Use res.sendFile instead');

// /**
//  * Transfer the file at the given `path` as an attachment.
//  *
//  * Optionally providing an alternate attachment `filename`,
//  * and optional callback `fn(err)`. The callback is invoked
//  * when the data transfer is complete, or when an error has
//  * ocurred. Be sure to check `res.headersSent` if you plan to respond.
//  *
//  * This method uses `res.sendfile()`.
//  *
//  * @api public
//  */

// res.download = function download(path, filename, fn) {
//   // support function as second arg
//   if (typeof filename === 'function') {
//     fn = filename;
//     filename = null;
//   }

//   filename = filename || path;

//   // set Content-Disposition when file is sent
//   var headers = {
//     'Content-Disposition': contentDisposition(filename)
//   };

//   // Resolve the full path for sendFile
//   var fullPath = resolve(path);

//   return this.sendFile(fullPath, { headers: headers }, fn);
// };

/**
 * Set _Content-Type_ response header with `type` through `mime.lookup()`
 * when it does not contain "/", or set the Content-Type to `type` otherwise.
 *
 * Examples:
 *
 *     res.type('.html');
 *     res.type('html');
 *     res.type('json');
 *     res.type('application/json');
 *     res.type('png');
 *
 * @param {String} type
 * @return {ServerResponse} for chaining
 * @api public
 */
MockExpressResponse.prototype.contentType = MockExpressResponse.prototype.type = function(
  type
) {
  /*jshint bitwise:false*/
  return this.set('Content-Type', ~type.indexOf('/') ? type : mime.lookup(type))
  /*jshint bitwise:true*/
}

/**
 * Respond to the Acceptable formats using an `obj`
 * of mime-type callbacks.
 *
 * This method uses `req.accepted`, an array of
 * acceptable types ordered by their quality values.
 * When "Accept" is not present the _first_ callback
 * is invoked, otherwise the first match is used. When
 * no match is performed the server responds with
 * 406 "Not Acceptable".
 *
 * Content-Type is set for you, however if you choose
 * you may alter this within the callback using `res.type()`
 * or `res.set('Content-Type', ...)`.
 *
 *    res.format({
 *      'text/plain': function(){
 *        res.send('hey');
 *      },
 *
 *      'text/html': function(){
 *        res.send('<p>hey</p>');
 *      },
 *
 *      'appliation/json': function(){
 *        res.send({ message: 'hey' });
 *      }
 *    });
 *
 * In addition to canonicalized MIME types you may
 * also use extnames mapped to these types:
 *
 *    res.format({
 *      text: function(){
 *        res.send('hey');
 *      },
 *
 *      html: function(){
 *        res.send('<p>hey</p>');
 *      },
 *
 *      json: function(){
 *        res.send({ message: 'hey' });
 *      }
 *    });
 *
 * By default Express passes an `Error`
 * with a `.status` of 406 to `next(err)`
 * if a match is not made. If you provide
 * a `.default` callback it will be invoked
 * instead.
 *
 * @param {Object} obj
 * @return {ServerResponse} for chaining
 * @api public
 */
MockExpressResponse.prototype.format = function(obj) {
  var req = this.req
  var next = req.next

  var fn = obj.default
  if (fn) {
    delete obj.default
  }
  var keys = Object.keys(obj)

  var key = req.accepts(keys)

  this.vary('Accept')

  if (key) {
    this.set('Content-Type', normalizeType(key).value)
    obj[key](req, this, next)
  } else if (fn) {
    fn()
  } else {
    var err = new Error('Not Acceptable')
    err.status = 406
    err.types = normalizeTypes(keys).map(function(o) {
      return o.value
    })
    next(err)
  }

  return this
}

/**
 * Set _Content-Disposition_ header to _attachment_ with optional `filename`.
 *
 * @param {String} filename
 * @return {ServerResponse}
 * @api public
 */
MockExpressResponse.prototype.attachment = function attachment(filename) {
  if (filename) {
    this.type(extname(filename))
  }

  this.set('Content-Disposition', contentDisposition(filename))

  return this
}

/**
 * Append additional header `field` with value `val`.
 *
 * Example:
 *
 *    res.append('Link', ['<http://localhost/>', '<http://localhost:3000/>']);
 *    res.append('Set-Cookie', 'foo=bar; Path=/; HttpOnly');
 *    res.append('Warning', '199 Miscellaneous warning');
 *
 * @param {String} field
 * @param {String|Array} val
 * @return {ServerResponse} for chaining
 * @api public
 */
MockExpressResponse.prototype.append = function append(field, val) {
  var prev = this.get(field)
  var value = val

  if (prev) {
    // concat the new and prev vals
    value = Array.isArray(prev)
      ? prev.concat(val)
      : Array.isArray(val)
      ? [prev].concat(val)
      : [prev, val]
  }

  return this.set(field, value)
}

/**
 * Set header `field` to `val`, or pass
 * an object of header fields.
 *
 * Examples:
 *
 *    res.set('Foo', ['bar', 'baz']);
 *    res.set('Accept', 'application/json');
 *    res.set({ Accept: 'text/plain', 'X-API-Key': 'tobi' });
 *
 * Aliased as `res.header()`.
 *
 * @param {String|Object|Array} field
 * @param {String} val
 * @return {ServerResponse} for chaining
 * @api public
 */
MockExpressResponse.prototype.set = MockExpressResponse.prototype.header = function header(
  field,
  val
) {
  if (arguments.length === 2) {
    if (Array.isArray(val)) {
      val = val.map(String)
    } else {
      val = String(val)
    }
    if ('content-type' === field.toLowerCase() && !/;\s*charset\s*=/.test(val)) {
      var charset = mime.charsets.lookup(val.split(';')[0])
      if (charset) {
        val += '; charset=' + charset.toLowerCase()
      }
    }
    this.setHeader(field, val)
  } else {
    for (var key in field) {
      this.set(key, field[key])
    }
  }
  return this
}

/**
 * Get value for header `field`.
 *
 * @param {String} field
 * @return {String}
 * @api public
 */
MockExpressResponse.prototype.get = function(field) {
  return this.getHeader(field)
}

/**
 * Clear cookie `name`.
 *
 * @param {String} name
 * @param {Object} options
 * @return {ServerResponse} for chaining
 * @api public
 */
MockExpressResponse.prototype.clearCookie = function(name, options) {
  var opts = {
    expires: new Date(1),
    path: '/',
  }
  return this.cookie(name, '', options ? merge(opts, options) : opts)
}

/**
 * Set cookie `name` to `val`, with the given `options`.
 *
 * Options:
 *
 *    - `maxAge`   max-age in milliseconds, converted to `expires`
 *    - `signed`   sign the cookie
 *    - `path`     defaults to "/"
 *
 * Examples:
 *
 *    // "Remember Me" for 15 minutes
 *    res.cookie('rememberme', '1', { expires: new Date(Date.now() + 900000), httpOnly: true });
 *
 *    // save as above
 *    res.cookie('rememberme', '1', { maxAge: 900000, httpOnly: true })
 *
 * @param {String} name
 * @param {String|Object} val
 * @param {Options} options
 * @return {ServerResponse} for chaining
 * @api public
 */
MockExpressResponse.prototype.cookie = function(name, val, options) {
  options = merge({}, options)
  var secret = this.req.secret
  var signed = options.signed
  if (signed && !secret) {
    throw new Error('cookieParser("secret") required for signed cookies')
  }
  if ('number' === typeof val) {
    val = val.toString()
  }
  if ('object' === typeof val) {
    val = 'j:' + JSON.stringify(val)
  }
  if (signed) {
    val = 's:' + sign(val, secret)
  }
  if ('maxAge' in options) {
    options.expires = new Date(Date.now() + options.maxAge)
    options.maxAge /= 1000
  }
  if (null === options.path) {
    options.path = '/'
  }
  var headerVal = cookie.serialize(name, String(val), options)

  // supports multiple 'res.cookie' calls by getting previous value
  var prev = this.get('Set-Cookie')
  if (prev) {
    if (Array.isArray(prev)) {
      headerVal = prev.concat(headerVal)
    } else {
      headerVal = [prev, headerVal]
    }
  }
  this.set('Set-Cookie', headerVal)
  return this
}

/**
 * Set the location header to `url`.
 *
 * The given `url` can also be "back", which redirects
 * to the _Referrer_ or _Referer_ headers or "/".
 *
 * Examples:
 *
 *    res.location('/foo/bar').;
 *    res.location('http://example.com');
 *    res.location('../login');
 *
 * @param {String} url
 * @return {ServerResponse} for chaining
 * @api public
 */
MockExpressResponse.prototype.location = function(url) {
  var req = this.req

  // "back" is an alias for the referrer
  if ('back' === url) {
    url = req.get('Referrer') || '/'
  }

  // Respond
  this.set('Location', url)
  return this
}

/**
 * Redirect to the given `url` with optional response `status`
 * defaulting to 302.
 *
 * The resulting `url` is determined by `res.location()`, so
 * it will play nicely with mounted apps, relative paths,
 * `"back"` etc.
 *
 * Examples:
 *
 *    res.redirect('/foo/bar');
 *    res.redirect('http://example.com');
 *    res.redirect(301, 'http://example.com');
 *    res.redirect('../login'); // /blog/post/1 -> /blog/login
 *
 * @api public
 */
MockExpressResponse.prototype.redirect = function redirect(url) {
  var address = url
  var body
  var status = 302

  // allow status / url
  if (arguments.length === 2) {
    if (typeof arguments[0] === 'number') {
      status = arguments[0]
      address = arguments[1]
    } else {
      deprecate('res.redirect(url, status): Use res.redirect(status, url) instead')
      status = arguments[1]
    }
  }

  // Set location header
  this.location(address)
  address = this.get('Location')

  // Support text/{plain,html} by default
  this.format({
    text: function() {
      body = STATUS_CODES[status] + '. Redirecting to ' + encodeURI(address)
    },

    html: function() {
      var u = escapeHtml(address)
      body =
        '<p>' +
        STATUS_CODES[status] +
        '. Redirecting to <a href="' +
        u +
        '">' +
        u +
        '</a></p>'
    },

    default: function() {
      body = ''
    },
  })

  // Respond
  this.statusCode = status
  this.set('Content-Length', Buffer.byteLength(body))

  if (this.req.method === 'HEAD') {
    this.end()
  } else {
    this.end(body)
  }
}

/**
 * Add `field` to Vary. If already present in the Vary set, then
 * this call is simply ignored.
 *
 * @param {Array|String} field
 * @return {ServerResponse} for chaining
 * @api public
 */
MockExpressResponse.prototype.vary = function(field) {
  // checks for back-compat
  if (!field || (Array.isArray(field) && !field.length)) {
    deprecate('res.vary(): Provide a field name')
    return this
  }

  vary(this, field)

  return this
}

/**
 * Render `view` with the given `options` and optional callback `fn`.
 * When a callback function is given a response will _not_ be made
 * automatically, otherwise a response of _200_ and _text/html_ is given.
 *
 * Options:
 *
 *  - `cache`     boolean hinting to the engine it should cache
 *  - `filename`  filename of the view being rendered
 *
 * @api public
 */
MockExpressResponse.prototype.render = function(view, options, fn) {
  options = options || {}
  var self = this
  var req = this.req
  var app = this.app

  // support callback function as second arg
  if ('function' === typeof options) {
    ;(fn = options), (options = {})
  }

  // merge res.locals
  options._locals = self.locals

  // default callback to respond
  fn =
    fn ||
    function(err, str) {
      if (err) {
        return req.next(err)
      }

      self.send(str)
    }

  // render
  app.render(view, options, fn)
}

/**
 * @description export MockExpressResponse
 * @type {[type]}
 */
module.exports = MockExpressResponse
