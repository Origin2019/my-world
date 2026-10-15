/* ============================================================
 * 我的世界 · 数据层 & 云同步
 * ------------------------------------------------------------
 *  本地 localStorage 始终是随时可用的工作副本；
 *  在「云同步」面板登录后，会和 Supabase 云端自动双向同步。
 *  同一账号在手机、电脑上登录，数据即自动互通。
 * ============================================================ */
(function () {
    'use strict';

    var META_KEY = '__sync_meta';   // 本机最后修改时间
    var POLL_MS = 10000;            // 轮询云端间隔
    var TOLERANCE = 1500;           // 时间比较容差（毫秒）

    // 保存原生方法（下面会被 hook 覆盖）
    var Native = {
        setItem: Storage.prototype.setItem,
        removeItem: Storage.prototype.removeItem,
        clear: Storage.prototype.clear
    };

    // 不参与同步的内部键：同步元数据、Supabase 会话等
    function isInternal(k) {
        return k === META_KEY ||
            k.indexOf('__') === 0 ||
            k.indexOf('sb-') === 0 ||
            k.indexOf('supabase') === 0;
    }

    function snapshot() {
        var out = {};
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (isInternal(k)) continue;
            out[k] = localStorage.getItem(k);
        }
        return out;
    }

    var suppress = false;   // 应用云端数据时，屏蔽 hook 避免回写

    function applySnapshot(obj) {
        if (!obj || typeof obj !== 'object') return;
        suppress = true;
        try {
            Native.clear.call(localStorage);
            var keys = Object.keys(obj);
            for (var i = 0; i < keys.length; i++) {
                Native.setItem.call(localStorage, keys[i], obj[keys[i]]);
            }
        } finally {
            suppress = false;
        }
    }

    function localTs() {
        return parseInt(localStorage.getItem(META_KEY) || '0', 10) || 0;
    }
    function setLocalTs(t) {
        Native.setItem.call(localStorage, META_KEY, String(t));
    }

    /* ------------------------------------------------ 云客户端 */
    var CFG = window.SUPABASE_CONFIG || {};
    var hasSDK = !!window.supabase;
    var configured = !!(CFG.url && CFG.anonKey && CFG.url.indexOf('http') === 0);
    var client = null;
    var session = null;
    var pushTimer = null;
    var pollTimer = null;
    var busy = false;

    var BADGE = {
        off: '☁ 未登录',
        syncing: '☁ 同步中…',
        on: '☁ 已同步',
        error: '☁ 同步失败',
        noconfig: '☁ 未配置'
    };

    function setStatus(state, msg) {
        var btn = document.getElementById('cloudBtn');
        if (btn) {
            btn.dataset.state = state;
            btn.textContent = BADGE[state] || '☁ 云同步';
        }
        var line = document.getElementById('cloudStatusLine');
        if (line) {
            line.textContent = msg || '';
            line.dataset.state = state;
        }
        updatePanel();
    }

    // 给请求加超时：手机网络不通时不会一直“没反应”
    function withTimeout(promise, ms, label) {
        return Promise.race([
            promise,
            new Promise(function (_resolve, reject) {
                setTimeout(function () {
                    reject(new Error((label || '请求') + '超过 ' + Math.round(ms / 1000) + ' 秒无响应'));
                }, ms);
            })
        ]);
    }

    function updatePanel() {
        var inBox = document.getElementById('cloudLoggedIn');
        var outBox = document.getElementById('cloudLoggedOut');
        if (!inBox || !outBox) return;
        if (session) {
            inBox.style.display = '';
            outBox.style.display = 'none';
            var e = document.getElementById('cloudEmailShow');
            if (e) e.textContent = (session.user && session.user.email) || '已登录';
        } else {
            inBox.style.display = 'none';
            outBox.style.display = '';
        }
    }

    function active() { return !!session; }

    function schedulePush() {
        if (!active()) return;
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(function () {
            pushTimer = null;
            push();
        }, 1500);
    }

    function push() {
        if (!active()) return Promise.resolve();
        var ts = localTs() || Date.now();
        var payload = {
            user_id: session.user.id,
            data: snapshot(),
            updated_at: new Date(ts).toISOString()
        };
        return client.from('userdata').upsert(payload, { onConflict: 'user_id' })
            .then(function (r) {
                if (r.error) { setStatus('error', '上传失败：' + r.error.message); return; }
                setStatus('on', '已同步 · ' + new Date().toLocaleTimeString());
            })
            .catch(function () { setStatus('error', '网络异常，将自动重试'); });
    }

    function pull() {
        if (!active() || busy || suppress) return Promise.resolve();
        busy = true;
        return client.from('userdata')
            .select('data,updated_at')
            .eq('user_id', session.user.id)
            .maybeSingle()
            .then(function (r) {
                busy = false;
                if (r.error) { setStatus('error', '读取失败：' + r.error.message); return; }
                var row = r.data;
                if (!row) { return push(); }
                var remoteTs = Date.parse(row.updated_at) || 0;
                if (remoteTs > localTs() + TOLERANCE) {
                    applySnapshot(row.data);
                    setLocalTs(remoteTs);
                    setStatus('on', '已拉取云端更新，正在刷新…');
                    location.reload();
                }
            })
            .catch(function () { busy = false; setStatus('error', '网络异常'); });
    }

    function onSignedIn() {
        setStatus('syncing', '正在与云端同步…');
        return client.from('userdata')
            .select('data,updated_at')
            .eq('user_id', session.user.id)
            .maybeSingle()
            .then(function (r) {
                if (r.error) { setStatus('error', '读取失败：' + r.error.message); return; }
                var row = r.data;
                var remoteTs = row ? (Date.parse(row.updated_at) || 0) : 0;
                if (remoteTs > localTs() + TOLERANCE) {
                    applySnapshot(row.data);
                    setLocalTs(remoteTs);
                    setStatus('on', '已载入云端数据，正在刷新…');
                    location.reload();
                    return;
                }
                return push().then(startPoll);
            })
            .catch(function () { setStatus('error', '网络异常'); });
    }

    function startPoll() {
        stopPoll();
        pollTimer = setInterval(pull, POLL_MS);
    }
    function stopPoll() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    /* ------------------------------------------------ 登录 / 注册 */
    function signIn(email, password) {
        return client.auth.signInWithPassword({ email: email, password: password })
            .then(function (r) {
                if (r.error) throw new Error(r.error.message);
                return r.data;
            });
    }
    function signUp(email, password) {
        return client.auth.signUp({ email: email, password: password })
            .then(function (r) {
                if (r.error) throw new Error(r.error.message);
                return r.data;
            });
    }
    function signOut() {
        stopPoll();
        return client.auth.signOut()
            .catch(function () { })
            .then(function () {
                session = null;
                setStatus('off', '已退出登录，数据仍保留在本机');
            });
    }

    /* ------------------------------------------------ 启动 */
    function boot() {
        if (!hasSDK || !configured) {
            setStatus(configured ? 'error' : 'noconfig',
                configured ? 'Supabase 脚本加载失败，请检查网络' : '尚未填写 supabase-config.js');
            return;
        }
        try {
            client = window.supabase.createClient(CFG.url, CFG.anonKey);
        } catch (e) {
            setStatus('error', 'Supabase 配置有误：' + e.message);
            return;
        }
        client.auth.getSession().then(function (r) {
            session = r.data.session;
            if (session) onSignedIn();
            else setStatus('off', '未登录（数据仅保存在本机）');
        });
        client.auth.onAuthStateChange(function (evt, s) {
            var had = !!session;
            session = s;
            if (s && !had) onSignedIn();
            if (!s) { stopPoll(); setStatus('off', '未登录（数据仅保存在本机）'); }
        });
    }

    /* ------------------------------------------------ 对外接口 */
    window.__sync = {
        schedulePush: schedulePush,
        push: push,
        pull: pull,
        signIn: signIn,
        signUp: signUp,
        signOut: signOut,
        active: active,
        ready: function () { return !!client; },
        setStatus: setStatus
    };

    /* ------------------------------------------------ 面板交互 */
    function creds() {
        var email = (document.getElementById('cloudEmail').value || '').trim();
        var password = document.getElementById('cloudPassword').value || '';
        return { email: email, password: password };
    }

    window.openCloudModal = function () {
        updatePanel();
        document.getElementById('cloudModal').style.display = 'flex';
    };
    window.closeCloudModal = function (event) {
        if (event && event.target !== document.getElementById('cloudModal')) return;
        document.getElementById('cloudModal').style.display = 'none';
    };
    window.cloudSignIn = function () {
        if (!hasSDK) { setStatus('error', '❌ Supabase 组件没加载成功，请下拉刷新页面'); return; }
        if (!client) { setStatus('error', '❌ 配置/网络异常，请先点「🔍 测试连接」'); return; }
        var c = creds();
        if (!c.email || !c.password) { setStatus('error', '请先填写邮箱和密码'); return; }
        setStatus('syncing', '正在登录…（超 15 秒无反应多为网络问题）');
        withTimeout(signIn(c.email, c.password), 15000, '登录')
            .then(function () { setStatus('syncing', '登录成功，正在同步数据…'); })
            .catch(function (err) { setStatus('error', '❌ 登录失败：' + err.message); });
    };
    window.cloudSignUp = function () {
        if (!hasSDK) { setStatus('error', '❌ Supabase 组件没加载成功，请下拉刷新页面'); return; }
        if (!client) { setStatus('error', '❌ 配置/网络异常，请先点「🔍 测试连接」'); return; }
        var c = creds();
        if (!c.email || !c.password) { setStatus('error', '请先填写邮箱和密码'); return; }
        if (c.password.length < 6) { setStatus('error', '密码至少 6 位'); return; }
        setStatus('syncing', '正在注册…（超 15 秒无反应多为网络问题）');
        withTimeout(signUp(c.email, c.password), 15000, '注册')
            .then(function (data) {
                if (data && data.session) {
                    setStatus('syncing', '注册成功，正在同步数据…');
                } else {
                    setStatus('off', '注册成功！请到邮箱点开验证链接，再回来登录');
                }
            })
            .catch(function (err) {
                setStatus('error', '❌ 注册失败：' + err.message);
            });
    };

    // 一键自检：组件 / 配置 / 网络 / 数据库 四项逐一检查
    window.cloudDiagnose = function () {
        if (!hasSDK) { setStatus('error', '❌ supabase-js.js 没加载成功（文件缺失或被拦截）'); return; }
        if (!configured) { setStatus('error', '❌ 配置是空的：请检查 supabase-config.js 是否上传成功'); return; }
        if (!client) { setStatus('error', '❌ 客户端创建失败，请刷新页面重试'); return; }
        setStatus('syncing', '正在测试与 Supabase 的连接…');
        var t0 = Date.now();
        withTimeout(client.from('userdata').select('user_id').limit(1), 15000, '连接测试')
            .then(function (r) {
                if (r.error) { setStatus('error', '❌ 连接异常：' + r.error.message); return; }
                setStatus('on', '✅ 全部正常！组件 ✓ 配置 ✓ 网络 ✓ 数据库 ✓（用时 ' + (Date.now() - t0) + ' ms）');
            })
            .catch(function (e) {
                setStatus('error', '❌ ' + e.message + ' —— 说明手机访问 Supabase 被网络限制，请换 WiFi / 用流量 / 开代理后重试');
            });
    };
    window.cloudSignOut = function () { signOut(); };
    window.cloudSyncNow = function () {
        setStatus('syncing', '正在同步…');
        push().then(pull);
    };

    /* ------------- 本机数据导入 / 导出（把桌面版数据搬上云） ------------- */
    window.exportUserData = function () {
        var blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'userdata.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };

    window.importUserData = function () {
        document.getElementById('importFile').click();
    };

    window.handleImportFile = function (event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            try {
                var obj = JSON.parse(reader.result);
                if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('文件内容不是对象');
                applySnapshot(obj);
                setLocalTs(Date.now());
                setStatus('syncing', '导入成功，正在刷新…');
                location.reload();
            } catch (err) {
                setStatus('error', '导入失败：' + err.message);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    /* ------------------------------------------------ hook 本地写入 */
    Storage.prototype.setItem = function (k, v) {
        Native.setItem.call(this, k, v);
        if (this === localStorage && !isInternal(k) && !suppress) {
            setLocalTs(Date.now());
            schedulePush();
        }
    };
    Storage.prototype.removeItem = function (k) {
        Native.removeItem.call(this, k);
        if (this === localStorage && !isInternal(k) && !suppress) {
            setLocalTs(Date.now());
            schedulePush();
        }
    };
    Storage.prototype.clear = function () {
        Native.clear.call(this);
        if (this === localStorage && !suppress) {
            setLocalTs(Date.now());
            schedulePush();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
