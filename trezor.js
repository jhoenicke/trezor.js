var trezor = (function () {

//
// Bare-bones promise implementation
//
// License: MIT
// Copyright (c) 2013 Forbes Lindesay
// https://github.com/then/promise
//

var Promise = (function () {

    'use strict'

    // var asap = require('asap')
    var asap = function(fn) { setTimeout(fn, 0) }

    function Promise(fn) {
      if (!(this instanceof Promise)) return new Promise(fn)
      if (typeof fn !== 'function') throw new TypeError('not a function')
      var state = null
      var value = null
      var deferreds = []
      var self = this

      this.then = function(onFulfilled, onRejected) {
        return new Promise(function(resolve, reject) {
          handle(new Handler(onFulfilled, onRejected, resolve, reject))
        })
      }

      function handle(deferred) {
        if (state === null) {
          deferreds.push(deferred)
          return
        }
        asap(function() {
          var cb = state ? deferred.onFulfilled : deferred.onRejected
          if (cb === null) {
            (state ? deferred.resolve : deferred.reject)(value)
            return
          }
          var ret
          try {
            ret = cb(value)
          }
          catch (e) {
            deferred.reject(e)
            return
          }
          deferred.resolve(ret)
        })
      }

      function resolve(newValue) {
        try { //Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
          if (newValue === self) throw new TypeError('A promise cannot be resolved with itself.')
          if (newValue && (typeof newValue === 'object' || typeof newValue === 'function')) {
            var then = newValue.then
            if (typeof then === 'function') {
              doResolve(then.bind(newValue), resolve, reject)
              return
            }
          }
          state = true
          value = newValue
          finale()
        } catch (e) { reject(e) }
      }

      function reject(newValue) {
        state = false
        value = newValue
        finale()
      }

      function finale() {
        for (var i = 0, len = deferreds.length; i < len; i++)
          handle(deferreds[i])
        deferreds = null
      }

      doResolve(fn, resolve, reject)
    }


    function Handler(onFulfilled, onRejected, resolve, reject){
      this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null
      this.onRejected = typeof onRejected === 'function' ? onRejected : null
      this.resolve = resolve
      this.reject = reject
    }

    /**
     * Take a potentially misbehaving resolver function and make sure
     * onFulfilled and onRejected are only called once.
     *
     * Makes no guarantees about asynchrony.
     */
    function doResolve(fn, onFulfilled, onRejected) {
      var done = false;
      try {
        fn(function (value) {
          if (done) return
          done = true
          onFulfilled(value)
        }, function (reason) {
          if (done) return
          done = true
          onRejected(reason)
        })
      } catch (ex) {
        if (done) return
        done = true
        onRejected(ex)
      }
    }

    return Promise;

}());

//
// Hex codec
//
var Hex = (function () {

    'use strict';

    // Encode binary string to hex string
    function encode(bin) {
        var i, chr, hex = '';

        for (i = 0; i < bin.length; i++) {
            chr = (bin.charCodeAt(i) & 0xFF).toString(16);
            hex += chr.length < 2 ? '0' + chr : chr;
        }

        return hex;
    }

    // Decode hex string to binary string
    function decode(hex) {
        var i, bytes = [];

        for (i = 0; i < hex.length - 1; i += 2)
            bytes.push(parseInt(hex.substr(i, 2), 16));

        return String.fromCharCode.apply(String, bytes);
    }

    return {
        encode: encode,
        decode: decode
    };

}());

//
// Takes care of injecting the trezor plugin into the webpage.
//
var BrowserPlugin = (function () {

    'use strict';

    var PLUGIN_ID = '__trezor-plugin',
        PLUGIN_CALLBACK = '__trezorPluginLoaded',
        PLUGIN_MIMETYPE = 'application/x-bitcointrezorplugin';

    var PLUGIN_DOWNLOAD_URLS = {
        win: 'http://localhost:8000/trezor-plugin.msi',
        mac: 'http://localhost:8000/trezor-plugin.dmg',
        deb: 'http://localhost:8000/trezor-plugin.deb',
        rpm: 'http://localhost:8000/trezor-plugin.rpm'
    };

    var loaded = null,
        waiting, timer;

    // Load trezor browser plugin, optionally with a timeout.
    // In case plugin is not found, calls errback with an err and
    // the install fn.
    function load(callback, errback, timeout){

        if (loaded)
            return callback(loaded);

        if (waiting)
            return errback(new Error('Already being loaded'));

        if (!installed(PLUGIN_MIMETYPE))
            return errback(new Error('Not installed'), install);

        waiting = { // register callbacks
            callback: callback,
            errback: errback
        };
        inject(PLUGIN_ID, PLUGIN_MIMETYPE, PLUGIN_CALLBACK, timeout);
    }

    // Injects browser plugin into the webpage, using provided params.
    // callback is a _global_ function name!
    function inject(id, mimetype, callback, timeout) {

        var loadFn = function () {
                resolve(null, document.getElementById(id));
            },
            timeoutFn = function () {
                resolve(new Error('Loading timed out'));
            };

        var body = document.getElementsByTagName('body')[0],
            elem = document.createElement('div');

        navigator.plugins.refresh(false); // refresh installed plugins

        // register load cb, inject <object>
        window[callback] = loadFn;
        body.appendChild(elem);
        elem.innerHTML =
            '<object width="1" height="1" id="'+id+'" type="'+mimetype+'">'+
            ' <param name="onload" value="'+callback+'" />'+
            '</object>';

        if (timeout) // register timeout cb
            timer = setTimeout(timeoutFn, timeout);
    }

    // Resolves the plugin loading process, either with an error
    // or a plugin object.
    function resolve(err, plugin) {

        if (!waiting) return;

        var callback = waiting.callback,
            errback = waiting.errback;

        if (timer) clearTimeout(timer);
        timer = waiting = null;

        if (err || !plugin || !plugin.version)
            if (errback)
                return errback(err);

        loaded = plugin;
        if (callback)
            callback(plugin);
    }

    // Returns true if plugin with a given mimetype is installed.
    function installed(mimetype) {
        return !!navigator.mimeTypes[mimetype];
    }

    // Promps a download dialog for the user.
    function install() {
        var body = document.getElementsByTagName('body')[0],
            elem = document.createElement('div');

        body.appendChild(elem);
        elem.innerHTML =
            '<div id="__trezor-install" style="'+
            '   width: 420px; height: 250px;'+
            '   position: absolute; top: 50%; right: 50%;'+
            '   margin: -125px -210px 0 0; padding: 10px 30px;'+
            '   box-shadow: 3px 3px 0 3px rgba(0, 0, 0, 0.2);'+
            '   background: #f6f6f6; color: #222;'+
            '   font-family: Helvetica, Arial, sans-serif; font-size: 16px;'+
            '   ">'+
            ' <h1 style="font-size: 42px; letter-spacing: -1px">Bitcoin Trezor Plugin</h1>'+
            ' <p style="margin-bottom: 40px; line-height: 1.5">Please install the Bitcoin Trezor Plugin to continue. Please install the Bitcoin Trezor Plugin to continue.</p>'+
            ' <a href="" id="__trezor-install-button" style="'+
            '   padding: 10px 20px; margin-right: 10px;'+
            '   text-decoration: none;'+
            '   background: #97bf0f; color: #fff;'+
            '   font-weight: bold;'+
            '   box-shadow: 2px 2px 0 1px rgba(0, 0, 0, 0.1)'+
            '   ">Download</a>'+
            ' <select id="__trezor-install-select" style="'+
            '   font-size: 16px;'+
            '   ">'+
            '  <option value="win"'+(sys==='win'?' selected':'')+'>for Windows</option>'+
            '  <option value="mac"'+(sys==='mac'?' selected':'')+'>for Mac OS X</option>'+
            '  <option value="deb"'+(sys==='linux'?' selected':'')+'>for Linux (deb)</option>'+
            '  <option value="rpm">for Linux (rpm)</option>'+
            ' </select>'+
            '</div>';

        var button = document.getElementById('__trezor-install-button'),
            select = document.getElementById('__trezor-install-select');

        var assign_ = bind(select, 'change', assign),
            ground_ = bind(elem, 'click', ground),
            cancel_ = bind(document, 'click', cancel);

        var opts = ['win', 'mac', 'deb', 'rpm'],
            sys = system();

        if (sys) {
            select.selectedIndex = opts.indexOf(sys);
            assign();
        }

        function assign() {
            var opt = select.options[select.selectedIndex];
            button.href = PLUGIN_DOWNLOAD_URLS[opt.value];
        }

        function cancel() {
            body.removeChild(elem);
            cancel_();
            ground_();
            assign_();
        }

        function ground(ev) {
            ev.stopPropagation();
        }

        // Binds the event handler. Returns a thunk for unbinding.
        function bind(el, ev, fn) {
            if (el.addEventListener)
                el.addEventListener(ev, fn, false);
            else
                el.attachEvent('on' + ev, fn);

            return function () { unbind(el, ev, fn); };
        }

        // Unbinds the event handler.
        function unbind(el, ev, fn) {
            if (el.removeEventListener)
                el.removeEventListener(ev, fn, false);
            else
                el.detachEvent('on' + ev, fn);
        }
    }

    // Detects the OS.
    function system() {
        var ver = navigator.appVersion;

        if (ver.match(/Win/)) return 'win';
        if (ver.match(/Mac/)) return 'mac';
        if (ver.match(/Linux/)) return 'linux';
    }

    return {
        load: load,
        install: install,
        installed: installed
    };

}());

//
// Trezor API module
//
var TrezorApi = function(Promise) {

    'use strict';

    var DEFAULT_URL = 'http://localhost:8000/signer/config_signed.bin';

    //
    // Trezor
    //
    var Trezor = function (plugin, url) {
        this._plugin = plugin;
        this._configure(url || DEFAULT_URL);
    };

    // Downloads configuration from given url in blocking way and
    // configures the plugin.
    // Throws on error.
    Trezor.prototype._configure = function (url) {
        var req = new XMLHttpRequest(),
            time = new Date().getTime();

        req.open('get', url + '?' + time, false);
        req.send();

        if (req.status !== 200)
            throw Error('Failed to load configuration');

        this._plugin.configure(req.responseText);
    };

    // Returns the plugin version.
    Trezor.prototype.version = function () {
        return this._plugin.version;
    };

    // Returns the list of connected Trezor devices.
    Trezor.prototype.devices = function () {
        return this._plugin.devices;
    };

    // Opens a given device and returns a Session object.
    Trezor.prototype.open = function (device, on) {
        var session = new Session(device, on);
        session.open();
        return session;
    };

    //
    // Trezor device session handle.
    //
    // Handlers:
    //  openSuccess
    //  openError
    //
    var Session = function (device, on) {
        this._device = device;
        this._on = on || {};
    };

    // Opens the session and acquires the HID device handle.
    Session.prototype.open = function () {
        var self = this;
        this._log('Opening');
        this._device.open({
            openSuccess: function() {
                self._log('Opened');
                if (self._on.openSuccess)
                    self._on.openSuccess(self);
            },
            openError: function() {
                self._log('Opening error');
                if (self._on.openError)
                    self._on.openError(self);
            },
            close: function() {
                self._log('Closed');
                if (self._on.close)
                    self._on.close(self);
            }
        });
    };

    // Closes the session and the HID device.
    Session.prototype.close = function () {
        this._log('Closing');
        this._device.close(false); // do not block until the thread closes
    };

    Session.prototype.initialize = function () {
        return this._typedCommonCall('Initialize', 'Features');
    };

    Session.prototype.getEntropy = function (size) {
        return this._typedCommonCall('GetEntropy', 'Entropy', {
            size: size
        });
    };

    Session.prototype.getAddress = function (address_n) {
        return this._typedCommonCall('GetAddress', 'Address', {
            address_n: address_n
        });
    };

    Session.prototype.getMasterPublicKey = function () {
        return this._typedCommonCall('GetMasterPublicKey', 'MasterPublicKey');
    };

    Session.prototype.signTx = function (inputs, outputs) {
        var self = this,
            signatures = [],
            serializedTx = '',
            signTx = {
                inputs_count: inputs.length,
                outputs_count: outputs.length
            };

        return this._typedCommonCall('SignTx', 'TxInputRequest', signTx).then(process);

        function process(res) {
            var m = res.message;

            if (m.serialized_tx)
                serializedTx += m.serialized_tx;

            if (m.signature && m.signed_index >= 0)
                signatures[m.signed_index] = m.signature;

            if (m.request_index < 0)
                return {
                    signatures: signatures,
                    serializedTx: serializedTx
                };

            if (m.request_type == 'TXINPUT')
                return self._typedCommonCall('TxInput', 'TxInputRequest',
                    inputs[m.request_index]).then(process);
            else
                return self._typedCommonCall('TxOutput', 'TxInputRequest',
                    outputs[m.request_index]).then(process);
        }
    };

    Session.prototype._typedCommonCall = function (type, resType, msg) {
        var self = this;

        return this._commonCall(type, msg).then(function (res) {
            return self._assertType(res, resType);
        });
    };

    Session.prototype._assertType = function (res, resType) {
        if (res.type !== resType)
            throw new TypeError('Response of unexpected type: ' + res.type);
        return res;
    };

    Session.prototype._commonCall = function (type, msg) {
        var self = this,
            callpr = this._call(type, msg);

        return callpr.then(function (res) {
            return self._filterCommonTypes(res);
        });
    };

    Session.prototype._filterCommonTypes = function (res) {
        var self = this;

        if (res.type === 'Failure')
            throw res.message; // TODO: wrap in Error instead?

        if (res.type === 'ButtonRequest')
            return this._commonCall('ButtonAck');

        if (res.type === 'PinMatrixRequest')
            return this._promptPin().then(
                function (pin) {
                    return self._commonCall('PinMatrixAck', { pin: pin });
                },
                function () {
                    return self._commonCall('PinMatrixCancel');
                }
            );

        return res;
    };

    Session.prototype._promptPin = function () {
        var self = this;

        return new Promise(function (resolve, reject) {
            var pinfn = self._on.pin || function (callback) {
                self._log('PIN callback not configured, cancelling PIN request');
                callback(null);
            };
            pinfn(function (pin) {
                if (pin)
                    resolve(pin);
                else
                    reject();
            });
        });
    };

    Session.prototype._call = function (type, msg) {
        var self = this;

        msg = msg || {};

        return new Promise(function (resolve, reject) {
            self._log('Sending:', type, msg);
            self._device.call(type, msg, function (err, t, m) {
                if (err) {
                    self._log('Received error:', err);
                    reject(err);
                } else {
                    self._log('Received:', t, m);
                    resolve({
                        type: t,
                        message: m
                    });
                }
            });
        });
    };

    Session.prototype._log = function () {
        if (!console || !console.log)
            return;
        [].unshift.call(arguments, '[trezor]');
        if (console.log.apply)
            console.log.apply(console, arguments);
        else
            console.log(arguments);
    };

    return {
        Trezor: Trezor
    };

}(Promise);

// Loads the plugin.
// options = { timeout, configUrl }
function load(callback, errback, options) {

    'use strict';

    var success = function (plugin) {
        var trezor = new TrezorApi.Trezor(plugin, options.configUrl);
        callback(trezor);
    };
    options = options || {};
    BrowserPlugin.load(success, options.timeout);
}

return {
    Hex: Hex,
    TrezorApi: TrezorApi,
    BrowserPlugin: BrowserPlugin,
    load: load
};

}({}));
