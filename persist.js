// https://github.com/jeremydurham/persist-js

(function () {
    if (window.google && google.gears)
        return;
    var F = null;
    if (typeof GearsFactory != 'undefined') {
        F = new GearsFactory();
    } else {
        try {
            F = new ActiveXObject('Gears.Factory');
            if (F.getBuildInfo().indexOf('ie_mobile') != -1)
                F.privateSetGlobalObject(this);
        } catch (e) {
            if ((typeof navigator.mimeTypes != 'undefined') && navigator.mimeTypes["application/x-googlegears"]) {
                F = document.createElement("object");
                F.style.display = "none";
                F.width = 0;
                F.height = 0;
                F.type = "application/x-googlegears";
                document.documentElement.appendChild(F);
            }
        }
    }
    if (!F)
        return;
    if (!window.google)
        google = {};
    if (!google.gears)
        google.gears = { factory : F };
})();
Persist = (function () {
    var VERSION = '0.2.0', P, B, esc, init, empty, ec;
    ec = (function () {
        var EPOCH = 'Thu, 01-Jan-1970 00:00:01 GMT', RATIO = 1000 * 60 * 60 * 24, KEYS = ['expires', 'path', 'domain'], esc = escape, un = unescape, doc = document, me;
        var get_now = function () {
            var r = new Date();
            r.setTime(r.getTime());
            return r;
        }
        var cookify = function (c_key, c_val) {
            var i, key, val, r = [], opt = (arguments.length > 2) ? arguments[2] : {};
            r.push(esc(c_key) + '=' + esc(c_val));
            for (i = 0; i < KEYS.length; i++) {
                key = KEYS[i];
                if (val = opt[key])
                    r.push(key + '=' + val);
            }
            if (opt.secure)
                r.push('secure');
            return r.join('; ');
        }
        var alive   = function () {
            var k = '__EC_TEST__', v = new Date();
            v = v.toGMTString();
            this.set(k, v);
            this.enabled = (this.remove(k) == v);
            return this.enabled;
        }
        me          = {
            set        : function (key, val) {
                var opt = (arguments.length > 2) ? arguments[2] : {}, now = get_now(), expire_at, cfg = {};
                if (opt.expires) {
                    cfg.expires = new Date(now.getTime() + opt.expires * RATIO);
                    cfg.expires = cfg.expires.toGMTString();
                }
                var keys = ['path', 'domain', 'secure'];
                for (i = 0; i < keys.length; i++)
                    if (opt[keys[i]])
                        cfg[keys[i]] = opt[keys[i]];
                var r = cookify(key, val, cfg);
                doc.cookie = r;
                return val;
            }, has     : function (key) {
                key = esc(key);
                var c = doc.cookie, ofs = c.indexOf(key + '='), len = ofs + key.length + 1, sub = c.substring(0, key.length);
                return ((!ofs && key != sub) || ofs < 0) ? false : true;
            }, get     : function (key) {
                key = esc(key);
                var c = doc.cookie, ofs = c.indexOf(key + '='), len = ofs + key.length + 1, sub = c.substring(0, key.length), end;
                if ((!ofs && key != sub) || ofs < 0)
                    return null;
                end = c.indexOf(';', len);
                if (end < 0)
                    end = c.length;
                return un(c.substring(len, end));
            }, remove  : function (k) {
                var r = me.get(k), opt = { expires : EPOCH };
                doc.cookie = cookify(k, '', opt);
                return r;
            }, keys    : function () {
                var c = doc.cookie, ps = c.split('; '), i, p, r = [];
                for (i = 0; i < ps.length; i++) {
                    p = ps[i].split('=');
                    r.push(un(p[0]));
                }
                return r;
            }, all     : function () {
                var c = doc.cookie, ps = c.split('; '), i, p, r = [];
                for (i = 0; i < ps.length; i++) {
                    p = ps[i].split('=');
                    r.push([un(p[0]), un(p[1])]);
                }
                return r;
            }, version : '0.2.1', enabled : false
        };
        me.enabled = alive.call(me);
        return me;
    }());
    var index_of = (function () {
        if (Array.prototype.indexOf)
            return function (ary, val) {return Array.prototype.indexOf.call(ary, val);}; else
            return function (ary, val) {
                var i, l;
                for (i = 0, l = ary.length; i < l; i++)
                    if (ary[i] == val)
                        return i;
                return -1;
            };
    })();
    empty = function () {};
    esc = function (str) {return 'PS' + str.replace(/_/g, '__').replace(/ /g, '_s');};
    C = {
        search_order : ['cefStorage', 'winOldStorage', 'winStoreStorage', 'macStorage', 'iosStorage', 'localChromeStorage', 'androidStorage', 'whatwg_db', 'localstorage', 'globalstorage', 'cookie', 'gears', 'ie', 'flash'],
        name_re      : /^[a-z][a-z0-9_ -]+$/i,
        methods      : ['init', 'get', 'set', 'remove', 'load', 'save'],
        sql          : {
            version : '1',
            create  : "CREATE TABLE IF NOT EXISTS persist_data (k TEXT UNIQUE NOT NULL PRIMARY KEY, v TEXT NOT NULL)",
            get     : "SELECT v FROM persist_data WHERE k = ?",
            set     : "INSERT INTO persist_data(k, v) VALUES (?, ?)",
            remove  : "DELETE FROM persist_data WHERE k = ?"
        },
        flash        : {
            div_id : '_persist_flash_wrap',
            id     : '_persist_flash',
            path   : 'persist.swf',
            size   : { w : 1, h : 1 },
            args   : { autostart : true }
        }
    };
    B = {
        gears                 : {
            size : -1, test : function () {return (window.google && window.google.gears) ? true : false;}, methods : {
                transaction : function (fn) {
                    var db = this.db;
                    db.execute('BEGIN').close();
                    fn.call(this, db);
                    db.execute('COMMIT').close();
                }, init     : function () {
                    var db;
                    db = this.db = google.gears.factory.create('beta.database');
                    db.open(esc(this.name));
                    db.execute(C.sql.create).close();
                }, get      : function (key, fn, scope) {
                    var r, sql = C.sql.get;
                    if (!fn)
                        return;
                    this.transaction(function (t) {
                        var is_valid, val;
                        r = t.execute(sql, [key]);
                        is_valid = r.isValidRow();
                        val = is_valid ? r.field(0) : null;
                        r.close();
                        fn.call(scope || this, is_valid, val);
                    });
                }, set      : function (key, val, fn, scope) {
                    var rm_sql = C.sql.remove, sql = C.sql.set, r;
                    this.transaction(function (t) {
                        t.execute(rm_sql, [key]).close();
                        t.execute(sql, [key, val]).close();
                        if (fn)
                            fn.call(scope || this, true, val);
                    });
                }, remove   : function (key, fn, scope) {
                    var get_sql = C.sql.get;
                    sql = C.sql.remove, r, val = null, is_valid = false;
                    this.transaction(function (t) {
                        if (fn) {
                            r = t.execute(get_sql, [key]);
                            is_valid = r.isValidRow();
                            val = is_valid ? r.field(0) : null;
                            r.close();
                        }
                        if (!fn || is_valid) {
                            t.execute(sql, [key]).close();
                        }
                        if (fn)
                            fn.call(scope || this, is_valid, val);
                    });
                }
            }
        }, cefStorage         : {
            size : -1, test : function () {return !!window.cefQuery;}, methods : {
                key    : function (key) {return esc(this.name) + esc(key);},
                init   : function () {},
                query  : function (method, paramString, callback) {
                    cefQuery({
                        request   : method + " " + paramString,
                        onSuccess : function (response) {callback(true, response);},
                        onFailure : function (error_code, error_message) {
                            console.error(method + " error: " + error_message);
                            callback(false);
                        }
                    });
                },
                get    : function (key, fn, scope) {
                    key = this.key(key);
                    if (!fn)
                        return;
                    scope = scope || this;
                    this.query("StorageGet", key, function (ok, results) {fn.call(scope, ok, results);});
                },
                set    : function (key, val, fn, scope) {
                    key = this.key(key);
                    scope = scope || this;
                    this.query("StorageSet", key + " " + val, function (ok) {if (fn)fn.call(scope, ok, val);});
                    return val;
                },
                remove : function (key, fn, scope) {
                    key = this.key(key);
                    scope = scope || this;
                    this.query("StorageRemove", key, function (ok) {if (fn)fn.call(scope, ok);});
                }
            }
        }, whatwg_db          : {
            size       : 200 * 1024, test : function () {
                var name = 'PersistJS Test', desc = 'Persistent database test.';
                if (!window.openDatabase)
                    return false;
                if (!window.openDatabase(name, C.sql.version, desc, B.whatwg_db.size))
                    return false;
                return true;
            }, methods : {
                transaction : function (fn) {
                    if (!this.db_created) {
                        this.db.transaction(function (t) {t.executeSql(C.sql.create, [], function () {this.db_created = true;});}, empty);
                    }
                    this.db.transaction(fn);
                },
                init        : function () {this.db = openDatabase(this.name, C.sql.version, this.o.about || ("Persistent storage for " + this.name), this.o.size || B.whatwg_db.size);},
                get         : function (key, fn, scope) {
                    var sql = C.sql.get;
                    if (!fn)
                        return;
                    scope = scope || this;
                    this.transaction(function (t) {
                        t.executeSql(sql, [key], function (t, r) {
                            if (r.rows.length > 0)
                                fn.call(scope, true, r.rows.item(0)['v']); else
                                fn.call(scope, false, null);
                        });
                    });
                },
                set         : function (key, val, fn, scope) {
                    var rm_sql = C.sql.remove, sql = C.sql.set;
                    this.transaction(function (t) {
                        t.executeSql(rm_sql, [key], function () {
                            t.executeSql(sql, [key, val], function (t, r) {
                                if (fn)
                                    fn.call(scope || this, true, val);
                            });
                        });
                    });
                    return val;
                },
                remove      : function (key, fn, scope) {
                    var get_sql = C.sql.get;
                    sql = C.sql.remove;
                    this.transaction(function (t) {
                        if (fn) {
                            t.executeSql(get_sql, [key], function (t, r) {
                                if (r.rows.length > 0) {
                                    var val = r.rows.item(0)['v'];
                                    t.executeSql(sql, [key], function (t, r) {fn.call(scope || this, true, val);});
                                } else {
                                    fn.call(scope || this, false, null);
                                }
                            });
                        } else {
                            t.executeSql(sql, [key]);
                        }
                    });
                }
            }
        }, globalstorage      : {
            size       : 5 * 1024 * 1024, test : function () {
                try {
                    if (window.globalStorage && window.globalStorage[this.o.domain])return true;
                } catch (e) {
                }
                return false;
            }, methods : {
                key    : function (key) {return esc(this.name) + esc(key);},
                init   : function () {this.store = globalStorage[this.o.domain];},
                get    : function (key, fn, scope) {
                    key = this.key(key);
                    if (fn)
                        fn.call(scope || this, true, this.store.getItem(key));
                },
                set    : function (key, val, fn, scope) {
                    key = this.key(key);
                    this.store.setItem(key, val);
                    if (fn)
                        fn.call(scope || this, true, val);
                },
                remove : function (key, fn, scope) {
                    var val;
                    key = this.key(key);
                    val = this.store[key];
                    this.store.removeItem(key);
                    if (fn)
                        fn.call(scope || this, (val !== null), val);
                }
            }
        }, localstorage       : {
            size       : -1, test : function () {
                try {
                    return window.localStorage ? true : false;
                } catch (e) {
                    return false;
                }
            }, methods : {
                key    : function (key) {return esc(this.name) + esc(key);},
                init   : function () {this.store = localStorage;},
                get    : function (key, fn, scope) {
                    key = this.key(key);
                    if (fn)
                        fn.call(scope || this, true, this.store.getItem(key));
                },
                set    : function (key, val, fn, scope) {
                    key = this.key(key);
                    this.store.setItem(key, val);
                    if (fn)
                        fn.call(scope || this, true, val);
                },
                remove : function (key, fn, scope) {
                    var val;
                    key = this.key(key);
                    val = this.store.getItem(key);
                    this.store.removeItem(key);
                    if (fn)
                        fn.call(scope || this, (val !== null), val);
                }
            }
        }, localChromeStorage : {
            size    : -1,
            test    : function () {
                try {
                    return window.chrome && window.chrome.storage && window.chrome.storage.local;
                } catch (e) {
                    return false;
                }
            },
            methods : {
                key    : function (key) {return esc(this.name) + esc(key);},
                init   : function () {this.store = chrome.storage.local;},
                get    : function (key, fn, scope) {
                    key = this.key(key);
                    scope = scope || this;
                    this.store.get(key, function (val) {if (fn)fn.call(scope, true, val[key]);});
                },
                set    : function (key, val, fn, scope) {
                    key = this.key(key);
                    var out = {};
                    out[key] = val;
                    if (fn) {
                        scope = scope || this;
                        this.store.set(out, function () {fn.call(scope, true, val);});
                    } else {
                        this.store.set(out);
                    }
                },
                remove : function (key, fn, scope) {
                    var val;
                    key = this.key(key);
                    if (fn) {
                        scope = scope || this;
                        this.store.get(key, function (val) {this.store.remove(key, function () {fn.call(scope, (val[key] !== null), val[key]);});});
                    } else {
                        this.store.remove(key);
                    }
                }
            }
        }, androidStorage     : {
            size       : -1, test : function () {
                try {
                    return window.androidStorage ? true : false;
                } catch (e) {
                    return false;
                }
            }, methods : {
                key    : function (key) {return esc(this.name) + esc(key);},
                init   : function () {this.store = androidStorage;},
                get    : function (key, fn, scope) {
                    key = this.key(key);
                    if (fn)
                        fn.call(scope || this, true, this.store.getItem(key));
                },
                set    : function (key, val, fn, scope) {
                    key = this.key(key);
                    this.store.setItem(key, val);
                    if (fn)
                        fn.call(scope || this, true, val);
                },
                remove : function (key, fn, scope) {
                    var val;
                    key = this.key(key);
                    val = this.store.getItem(key);
                    this.store.removeItem(key);
                    if (fn)
                        fn.call(scope || this, (val !== null), val);
                }
            }
        }, iosStorage         : {
            size       : -1, test : function () {
                try {
                    return window.isIosApp ? true : false;
                } catch (e) {
                    return false;
                }
            }, methods : {
                key     : function (key) {return esc(this.name) + esc(key);},
                init    : function () {},
                callIos : function (url) {
                    var iframe = document.createElement("IFRAME");
                    iframe.setAttribute("src", url);
                    document.documentElement.appendChild(iframe);
                    iframe.parentNode.removeChild(iframe);
                    iframe = null;
                },
                get     : function (key, fn, scope) {
                    if (!fn)return;
                    key = this.key(key);
                    var nonce = "storageget" + key + (+new Date);
                    window[nonce] = function (value) {
                        delete window[nonce];
                        fn.call(scope || this, true, value);
                    }
                    this.callIos("storageget://" + key + " " + nonce);
                },
                set     : function (key, val, fn, scope) {
                    key = this.key(key);
                    var nonce = "storageset" + key + (+new Date);
                    window[nonce] = function () {
                        delete window[nonce];
                        if (fn)fn.call(scope || this, true, val);
                    }
                    this.callIos("storageset://" + key + " " + nonce + " " + encodeURIComponent(encodeURIComponent(val)));
                },
                remove  : function (key, fn, scope) {
                    if (fn) {
                        this.get(key, function (val) {this._remove(key, fn, scope, val);}, this);
                    } else {
                        this._remove(key, fn, scope);
                    }
                },
                _remove : function (key, fn, scope, val) {
                    var val;
                    key = this.key(key);
                    var nonce = "storagerem" + key + (+new Date);
                    window[nonce] = function () {
                        delete window[nonce];
                        if (fn)fn.call(scope || this, (val !== null), val);
                    }
                    this.callIos("storagerem://" + key + " " + nonce + " " + encodeURIComponent(val));
                }
            }
        }, macStorage         : {
            size       : -1, test : function () {
                try {
                    return window.macStorage ? true : false;
                } catch (e) {
                    return false;
                }
            }, methods : {
                key    : function (key) {return esc(this.name) + esc(key);},
                init   : function () {this.store = macStorage;},
                get    : function (key, fn, scope) {
                    key = this.key(key);
                    if (fn)
                        fn.call(scope || this, true, this.store.objectForKey_(key));
                },
                set    : function (key, val, fn, scope) {
                    key = this.key(key);
                    this.store.setObject_forKey_(val, key);
                    if (fn)
                        fn.call(scope || this, true, val);
                },
                remove : function (key, fn, scope) {
                    var val;
                    key = this.key(key);
                    val = this.store.objectForKey_(key)
                    this.store.removeObjectForKey_(key);
                    if (fn)
                        fn.call(scope || this, (val !== null), val);
                }
            }
        }, winOldStorage      : {
            size       : -1, test : function () {
                try {
                    return window.external.IsWinOldApp();
                } catch (e) {
                    return false;
                }
            }, methods : {
                key    : function (key) {return esc(this.name) + esc(key);},
                init   : function () {this.store = window.external;},
                get    : function (key, fn, scope) {
                    key = this.key(key);
                    if (fn)
                        fn.call(scope || this, true, this.store.GetValue(key));
                },
                set    : function (key, val, fn, scope) {
                    key = this.key(key);
                    this.store.SetValue(key, val);
                    if (fn)
                        fn.call(scope || this, true, val);
                },
                remove : function (key, fn, scope) {
                    var val;
                    key = this.key(key);
                    val = this.store.GetValue(key)
                    this.store.DeleteValue(key);
                    if (fn)
                        fn.call(scope || this, (val !== null), val);
                }
            }
        }, winStoreStorage    : {
            size       : -1, test : function () {
                try {
                    return Windows.Storage.ApplicationData.current.roamingFolder;
                } catch (e) {
                    return false;
                }
            }, methods : {
                key           : function (key) {return esc(this.name) + esc(key);}, init : function () {
                    var self = this;

                    function doneLoadingWinStore() {
                        self.loaded = true;
                        for (var i = self.loadListeners.length - 1; i >= 0; i--) {
                            setTimeout(self.loadListeners[i], 0);
                        }
                    }

                    this.loaded = false;
                    this.loadListeners = [];
                    Windows.Storage.ApplicationData.current.roamingFolder.createFileAsync("data.txt", Windows.Storage.CreationCollisionOption.openIfExists).then(function (file) {
                        self.file = file;
                        return Windows.Storage.FileIO.readTextAsync(file);
                    }).done(function (data) {
                        self.store = {};
                        if (data && typeof data == "string") {
                            var rows = data.split("\n");
                            for (var i = rows.length - 1; i >= 0; i--) {
                                var row = rows[i].split("\t");
                                self.store[row[0]] = decodeURIComponent(row[1]);
                            }
                        }
                        doneLoadingWinStore();
                    }, function () {
                        self.store = {};
                        doneLoadingWinStore();
                    });
                }, get        : function (key, fn, scope) {
                    if (!this.loaded) {
                        var self = this;
                        this.loadListeners.push(function () {self.get(key, fn, scope)});
                        return;
                    }
                    key = this.key(key);
                    if (fn)
                        fn.call(scope || this, true, this.store[key]);
                }, set        : function (key, val, fn, scope) {
                    if (!this.loaded) {
                        var self = this;
                        this.loadListeners.push(function () {self.set(key, val, fn, scope)});
                        return;
                    }
                    key = this.key(key);
                    this.store[key] = val;
                    this.writeAsync();
                    if (fn)
                        fn.call(scope || this, true, val);
                }, remove     : function (key, fn, scope) {
                    if (!this.loaded) {
                        var self = this;
                        this.loadListeners.push(function () {self.remove(key, fn, scope)});
                        return;
                    }
                    var val;
                    key = this.key(key);
                    val = this.store[key];
                    delete this.store[key];
                    this.writeAsync();
                    if (fn)
                        fn.call(scope || this, (val !== null), val);
                }, writeAsync : function () {
                    var output = [];
                    for (var key in this.store) {
                        output.push(key, '\t', encodeURIComponent(this.store[key]), '\n');
                    }
                    Windows.Storage.FileIO.writeTextAsync(this.file, output.join(''));
                }
            }
        }, ie                 : {
            prefix        : '_persist_data-',
            size          : 64 * 1024,
            test          : function () {return window.ActiveXObject ? true : false;},
            make_userdata : function (id) {
                var el = document.createElement('div');
                el.id = id;
                el.style.display = 'none';
                el.addBehavior('#default#userdata');
                document.body.appendChild(el);
                return el;
            },
            methods       : {
                init   : function () {
                    var id = B.ie.prefix + esc(this.name);
                    this.el = B.ie.make_userdata(id);
                    if (this.o.defer)
                        this.load();
                },
                get    : function (key, fn, scope) {
                    var val;
                    key = esc(key);
                    if (!this.o.defer)
                        this.load();
                    val = this.el.getAttribute(key);
                    if (fn)
                        fn.call(scope || this, val ? true : false, val);
                },
                set    : function (key, val, fn, scope) {
                    key = esc(key);
                    this.el.setAttribute(key, val);
                    if (!this.o.defer)
                        this.save();
                    if (fn)
                        fn.call(scope || this, true, val);
                },
                remove : function (key, fn, scope) {
                    var val;
                    key = esc(key);
                    if (!this.o.defer)
                        this.load();
                    val = this.el.getAttribute(key);
                    this.el.removeAttribute(key);
                    if (!this.o.defer)
                        this.save();
                    if (fn)
                        fn.call(scope || this, val ? true : false, val);
                },
                load   : function () {this.el.load(esc(this.name));},
                save   : function () {this.el.save(esc(this.name));}
            }
        }, cookie             : {
            delim : ':', size : 4000, test : function () {return P.Cookie.enabled ? true : false;}, methods : {
                key       : function (key) {return this.name + B.cookie.delim + key;}, get : function (key, fn, scope) {
                    var val;
                    key = this.key(key);
                    val = ec.get(key);
                    if (fn)
                        fn.call(scope || this, val != null, val);
                }, set    : function (key, val, fn, scope) {
                    key = this.key(key);
                    ec.set(key, val, this.o);
                    if (fn)
                        fn.call(scope || this, true, val);
                }, remove : function (key, val, fn, scope) {
                    var val;
                    key = this.key(key);
                    val = ec.remove(key)
                    if (fn)
                        fn.call(scope || this, val != null, val);
                }
            }
        }, flash              : {
            test       : function () {
                if (!window.deconcept || !window.deconcept.SWFObjectUtil)
                    return false;
                var major = deconcept.SWFObjectUtil.getPlayerVersion().major;
                return (major >= 8) ? true : false;
            }, methods : {
                init      : function () {
                    if (!B.flash.el) {
                        var o, key, el, cfg = C.flash;
                        el = document.createElement('div');
                        el.id = cfg.div_id;
                        document.body.appendChild(el);
                        o = new deconcept.SWFObject(this.o.swf_path || cfg.path, cfg.id, cfg.size.w, cfg.size.h, '8');
                        for (key in cfg.args)
                            o.addVariable(key, cfg.args[key]);
                        o.write(el);
                        B.flash.el = document.getElementById(cfg.id);
                    }
                    this.el = B.flash.el;
                }, get    : function (key, fn, scope) {
                    var val;
                    key = esc(key);
                    val = this.el.get(this.name, key);
                    if (fn)
                        fn.call(scope || this, val !== null, val);
                }, set    : function (key, val, fn, scope) {
                    var old_val;
                    key = esc(key);
                    old_val = this.el.set(this.name, key, val);
                    if (fn)
                        fn.call(scope || this, true, val);
                }, remove : function (key, fn, scope) {
                    var val;
                    key = esc(key);
                    val = this.el.remove(this.name, key);
                    if (fn)
                        fn.call(scope || this, true, val);
                }
            }
        }
    };
    var init = function () {
        var i, l, b, key, fns = C.methods, keys = C.search_order;
        for (i = 0, l = fns.length; i < l; i++)
            P.Store.prototype[fns[i]] = empty;
        P.type = null;
        P.size = -1;
        for (i = 0, l = keys.length; !P.type && i < l; i++) {
            b = B[keys[i]];
            try {
                if (b.test()) {
                    P.type = keys[i];
                    P.size = b.size;
                    for (key in b.methods)
                        P.Store.prototype[key] = b.methods[key];
                }
            } catch (e) {
            }
        }
        P._init = true;
    };
    P = {
        VERSION   : VERSION, type : null, size : 0, add : function (o) {
            B[o.id] = o;
            C.search_order = [o.id].concat(C.search_order);
            init();
        }, remove : function (id) {
            var ofs = index_of(C.search_order, id);
            if (ofs < 0)
                return;
            C.search_order.splice(ofs, 1);
            delete B[id];
            init();
        }, Cookie : ec, Store : function (name, o) {
            if (!C.name_re.exec(name))
                throw new Error("Invalid name");
            if (!P.type)
                throw new Error("No suitable storage found");
            o = o || {};
            this.name = name;
            o.domain = o.domain || location.host || 'localhost';
            o.domain = o.domain.replace(/:\d+$/, '')
            this.o   = o;
            o.expires = o.expires || 365 * 2;
            o.path = o.path || '/';
            this.init();
        }
    };
    init();
    return P;
})();