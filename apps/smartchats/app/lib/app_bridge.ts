/**
 * App Platform — Bridge Library
 *
 * Returns the JavaScript source code injected into every app iframe.
 * This is host-authored, NOT agent-authored. It provides the SmartChats.*
 * API that app code uses to interact with the platform.
 *
 * Bridge protocol:
 *   Iframe → Host: app_util_call, app_function_result, app_function_error, app_log, app_feedback
 *   Host → Iframe: app_init, call_function, util_result, util_error, user_input, workspace_sync
 */

export function getAppBridgeSource(): string {
    return `
'use strict';

var SmartChats = {
    // ── Internal State ──
    _pendingCalls: new Map(),
    _callId: 0,
    _inputResolve: null,
    _ready: false,

    // ── AppHandle ──
    app: {
        dom: document,
        state: {},
        fns: {},
        manifest: {},
        el: function(sel) { return document.querySelector(sel); },
        // setState + onRender stubs — replaced with real implementations in _init
        setState: function(patch) {
            if (patch && typeof patch === 'object') {
                for (var k in patch) {
                    if (Object.prototype.hasOwnProperty.call(patch, k)) {
                        this.state[k] = patch[k];
                    }
                }
            }
        },
        onRender: function(fn) { this._pendingRenderFn = fn; },
        _pendingRenderFn: null,
    },

    // ── Function Registration ──
    registerFunction: function(name, fn) {
        this.app.fns[name] = fn;
    },

    // ── Util (populated by _initUtil based on granted permissions) ──
    util: {},

    // ── Tier 0 methods (always available) ──
    log: function(msg) {
        window.parent.postMessage({ type: 'app_log', message: String(msg) }, '*');
    },

    feedback: function(feedbackType) {
        window.parent.postMessage({ type: 'app_feedback', feedbackType: feedbackType }, '*');
    },

    // ── Bridge Call (sends request to host, returns promise) ──
    _call: function(method, args) {
        var callId = ++this._callId;
        var self = this;
        return new Promise(function(resolve, reject) {
            self._pendingCalls.set(callId, { resolve: resolve, reject: reject });
            window.parent.postMessage({
                type: 'app_util_call',
                method: method,
                args: args !== undefined ? args : {},
                callId: callId
            }, '*');
        });
    },

    // ── Initialization (called by host after iframe loads) ──
    _initUtil: function(grantedMethods) {
        var self = this;
        for (var i = 0; i < grantedMethods.length; i++) {
            (function(method) {
                self.util[method] = function(args) {
                    return self._call(method, args);
                };
            })(grantedMethods[i]);
        }
        // log and feedback are always available directly on SmartChats
        // but also add them to util for consistency
        self.util.log = self.log.bind(self);
        self.util.feedback = self.feedback.bind(self);
    },

    _initSmartChatsFunctions: function(grantedFunctions) {
        var self = this;
        self.util.smartchats = {};
        for (var i = 0; i < grantedFunctions.length; i++) {
            (function(fnName) {
                self.util.smartchats[fnName] = function(params) {
                    return self._call('smartchats.' + fnName, params);
                };
            })(grantedFunctions[i]);
        }
    },

    _init: function(config) {
        this.log('_init v=' + (config.manifest && config.manifest.version || '?') + ' onActivate=' + (config.onActivate || 'none'));
        var self = this;
        try {
            this.app.manifest = config.manifest || {};
            // Merge into existing state object (preserves references held by app scripts)
            var _initState = config.initialState || {};
            for (var _ik in _initState) {
                if (Object.prototype.hasOwnProperty.call(_initState, _ik)) {
                    this.app.state[_ik] = _initState[_ik];
                }
            }
            this._initUtil(config.grantedUtilMethods || []);
            this._initSmartChatsFunctions(config.grantedFunctions || []);
            this._ready = true;
            this.log('_init: basics done');

            // ── Reactive state: setState + onRender ──
            var _renderFn = this.app._pendingRenderFn || null;
            var _changedKeys = new Set();
            var _renderScheduled = false;

            this.app.onRender = function(fn) { _renderFn = fn; };

            this.app.setState = function(patch) {
                if (!patch || typeof patch !== 'object') return;
                var keys = [];
                for (var k in patch) {
                    if (Object.prototype.hasOwnProperty.call(patch, k)) {
                        self.app.state[k] = patch[k];
                        _changedKeys.add(k);
                        keys.push(k);
                    }
                }
                self.log('setState: keys=' + keys.join(',') + ' renderFn=' + !!_renderFn);
                if (!_renderScheduled && _renderFn) {
                    _renderScheduled = true;
                    Promise.resolve().then(function() {
                        _renderScheduled = false;
                        var changed = _changedKeys;
                        _changedKeys = new Set();
                        self.log('onRender firing: changed=' + Array.from(changed).join(','));
                        try { _renderFn(self.app.state, changed); }
                        catch (e) { self.log('onRender error: ' + (e.message || e)); }
                    });
                }
            };
            this.log('_init: setState/onRender done');

            // Built-in state accessors (used by get_app_state / set_app_state)
            function safeSerialize(val) {
                try { return JSON.parse(JSON.stringify(val)); }
                catch (e) { return '[unserializable: ' + (e.message || e) + ']'; }
            }
            this.registerFunction('__get_state', function(args) {
                try {
                    if (args && args.key) return safeSerialize(self.app.state[args.key]);
                    return safeSerialize(self.app.state);
                } catch (e) {
                    return { error: 'Failed to read state: ' + (e.message || e) };
                }
            });
            this.registerFunction('__set_state', function(args) {
                try {
                    self.app.state[args.key] = args.value;
                    return { ok: true };
                } catch (e) {
                    return { error: 'Failed to write state: ' + (e.message || e) };
                }
            });
            this.log('_init: state accessors done, fns=' + Object.keys(this.app.fns).join(','));

            // Call on_activate hook
            if (config.onActivate) {
                var activateFn = this.app.fns[config.onActivate];
                if (!activateFn) {
                    this.log('on_activate: "' + config.onActivate + '" not found');
                } else {
                    this.log('on_activate: calling ' + config.onActivate);
                    Promise.resolve().then(function() {
                        return activateFn({}, self.app, self.util);
                    }).then(function(result) {
                        self.log('on_activate completed');
                    }).catch(function(err) {
                        self.log('on_activate error: ' + (err && err.message ? err.message : String(err)));
                    });
                }
            }
        } catch (e) {
            this.log('_init CRASHED: ' + (e && e.message ? e.message : String(e)));
        }
    },
};

// ── Base Message Handler ──
window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
        case 'app_init':
            SmartChats._init(msg.config);
            break;

        case 'call_function': {
            var fn = SmartChats.app.fns[msg.name];
            if (!fn) {
                window.parent.postMessage({
                    type: 'app_function_error',
                    callId: msg.callId,
                    error: 'Function not found: ' + msg.name
                }, '*');
                break;
            }
            Promise.resolve().then(function() {
                return fn(msg.args || {}, SmartChats.app, SmartChats.util);
            }).then(function(result) {
                window.parent.postMessage({
                    type: 'app_function_result',
                    callId: msg.callId,
                    result: result
                }, '*');
            }).catch(function(err) {
                window.parent.postMessage({
                    type: 'app_function_error',
                    callId: msg.callId,
                    error: (err && err.message) ? err.message : String(err)
                }, '*');
            });
            break;
        }

        case 'util_result': {
            var pending = SmartChats._pendingCalls.get(msg.callId);
            if (pending) {
                pending.resolve(msg.result);
                SmartChats._pendingCalls.delete(msg.callId);
            }
            break;
        }

        case 'util_error': {
            var pendingErr = SmartChats._pendingCalls.get(msg.callId);
            if (pendingErr) {
                pendingErr.reject(new Error(msg.error || 'Unknown error'));
                SmartChats._pendingCalls.delete(msg.callId);
            }
            break;
        }

        case 'user_input': {
            if (SmartChats._inputResolve) {
                SmartChats._inputResolve(msg.text);
                SmartChats._inputResolve = null;
            }
            break;
        }

        case 'workspace_sync': {
            if (msg.state) {
                Object.assign(SmartChats.app.state, msg.state);
            }
            break;
        }

        case 'theme_update': {
            // Apply updated CSS vars to iframe :root
            if (msg.tokens) {
                var root = document.documentElement;
                for (var key in msg.tokens) {
                    if (msg.tokens.hasOwnProperty(key)) {
                        root.style.setProperty(key, msg.tokens[key]);
                    }
                }
            }
            break;
        }
    }
});

// Special handling for get_user_input: resolves via 'user_input' message
// Override the util method after init to use the dedicated channel
(function() {
    var originalInit = SmartChats._initUtil;
    SmartChats._initUtil = function(grantedMethods) {
        originalInit.call(this, grantedMethods);
        // Override get_user_input to use the dedicated input channel
        if (this.util.get_user_input) {
            var self = this;
            this.util.get_user_input = function() {
                return new Promise(function(resolve) {
                    self._inputResolve = resolve;
                    window.parent.postMessage({
                        type: 'app_util_call',
                        method: 'get_user_input',
                        args: {},
                        callId: ++self._callId
                    }, '*');
                });
            };
        }
    };
})();

// Signal that bridge is loaded
window.parent.postMessage({ type: 'app_bridge_ready' }, '*');
`
}
