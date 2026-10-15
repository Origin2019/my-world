/* ============================================================
 * 我的世界 · 数据层 & 云同步（GitHub Gist 版）
 * ------------------------------------------------------------
 *  · 本地 localStorage 始终是随时可用的工作副本
 *  · 填一次 GitHub Token 后，数据自动同步到你的「私密 Gist」
 *  · api.github.com 国内手机、电脑都能直连，不需要代理
 * ============================================================ */
(function () {
    'use strict';

    var META_KEY = '__sync_meta';   // 本机最后修改时间
    var TOKEN_KEY = '__gh_token';   // GitHub Token
    var GIST_KEY = '__gh_gist';     // Gist ID
    var GIST_FILE = 'my-world.json';
    var POLL_MS = 30000;            // 轮询云端间隔
    var TOLERANCE = 1500;           // 时间比较容差（毫秒）

    // 保存原生方法（下面会被 hook 覆盖）
    var Native = {
        setItem: Storage.prototype.setItem,
        removeItem: Storage.prototype.removeItem,
        clear: Storage.prototype.clear
    };

    // 这些键不参与同步：同步元数据、Token 等设备私有信息
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

    var suppress = false;   // 应用云端数据时屏蔽 hook，避免回写

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

    /* ================= GitHub API ================= */
    var token = null;
    var gistId = null;
    var userLogin = '';
    var pushTimer = null;
    var pollTimer = null;
    var busy = false;

    var BADGE = {
        off: '☁ 未连接',
        syncing: '☁ 同步中…',
        on: '☁ 已同步',
        error: '☁ 同步失败'
    };

    function ghFetch(path, options) {
        options = options || {};
        var headers = {
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
        if (options.body) headers['Content-Type'] = 'application/json';
        options.headers = headers;
        return fetch('https://api.github.com' + path, options).then(function (res) {
            return res.text().then(function (text) {
                var body = null;
                try { body = text ? JSON.parse(text) : null; } catch (e) { body = { message: text }; }
                if (!res.ok) {
                    var msg = (body && body.message) || ('HTTP ' + res.status);
                    if (res.status === 401) msg = 'Token 无效或已过期（' + msg + '）';
                    else if (res.status === 403) msg = '权限不足或请求太频繁（' + msg + '）';
                    throw new Error(msg);
                }
                return body;
            });
        });
    }

    // 给请求加超时：网络不通时不会一直“没反应”
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

    function updatePanel() {
        var inBox = document.getElementById('cloudLoggedIn');
        var outBox = document.getElementById('cloudLoggedOut');
        if (!inBox || !outBox) return;
        if (token) {
            inBox.style.display = '';
            outBox.style.display = 'none';
            var e = document.getElementById('cloudEmailShow');
            if (e) e.textContent = userLogin ? ('GitHub · ' + userLogin) : '已连接';
        } else {
            inBox.style.display = 'none';
            outBox.style.display = '';
        }
    }

    function startPoll() {
        stopPoll();
        pollTimer = setInterval(function () {
            if (!document.hidden) pull();
        }, POLL_MS);
    }
    function stopPoll() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    /* ================= 同步核心 ================= */
    function push() {
        if (!token || !gistId) return Promise.resolve();
        var ts = localTs() || Date.now();
        var files = {};
        files[GIST_FILE] = { content: JSON.stringify({ updatedAt: ts, data: snapshot() }) };
        return ghFetch('/gists/' + gistId, {
            method: 'PATCH',
            body: JSON.stringify({ files: files })
        }).then(function () {
            setStatus('on', '已同步 · ' + new Date().toLocaleTimeString());
        }).catch(function (err) {
            setStatus('error', '❌ 上传失败：' + err.message);
        });
    }

    function applyRemoteText(text) {
        var obj;
        try { obj = JSON.parse(text); } catch (e) { setStatus('error', '❌ 云端数据格式损坏'); return; }
        var remoteTs = (obj && obj.updatedAt) || 0;
        if (remoteTs > localTs() + TOLERANCE) {
            applySnapshot(obj.data);
            setLocalTs(remoteTs);
            setStatus('on', '已拉取云端更新，正在刷新…');
            location.reload();
        }
    }

    function pull() {
        if (!token || !gistId || busy || suppress) return Promise.resolve();
        busy = true;
        return ghFetch('/gists/' + gistId)
            .then(function (g) {
                busy = false;
                var f = g.files && g.files[GIST_FILE];
                if (!f) return push();
                if (f.content) return applyRemoteText(f.content);
                if (f.truncated && f.raw_url) {
                    return fetch(f.raw_url, { headers: { 'Authorization': 'Bearer ' + token } })
                        .then(function (r) { return r.text(); })
                        .then(applyRemoteText);
                }
            })
            .catch(function (err) {
                busy = false;
                setStatus('error', '❌ 读取失败：' + err.message);
            });
    }

    function schedulePush() {
        if (!token || !gistId) return;
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(function () { pushTimer = null; push(); }, 1500);
    }

    /* ================= 连接 / 断开 ================= */
    function connect(tok) {
        token = tok;
        setStatus('syncing', '正在验证 Token…');
        var me = null;
        return withTimeout(ghFetch('/user'), 20000, '验证')
            .then(function (u) {
                me = u;
                userLogin = u.login || '';
                setStatus('syncing', '验证成功（' + userLogin + '），正在查找云端数据…');
                return ghFetch('/gists?per_page=100');
            })
            .then(function (gists) {
                var found = null;
                var list = Array.isArray(gists) ? gists : [];
                for (var i = 0; i < list.length; i++) {
                    if (gistId && list[i].id === gistId) { found = list[i]; break; }
                }
                if (!found) {
                    for (var j = 0; j < list.length; j++) {
                        if (list[j].files && list[j].files[GIST_FILE]) { found = list[j]; break; }
                    }
                }
                if (found) {
                    gistId = found.id;
                    return { created: false };
                }
                var files = {};
                files[GIST_FILE] = { content: JSON.stringify({ updatedAt: Date.now(), data: snapshot() }) };
                return ghFetch('/gists', {
                    method: 'POST',
                    body: JSON.stringify({
                        description: '我的世界 · 数据同步（勿删）',
                        public: false,
                        files: files
                    })
                }).then(function (g) { gistId = g.id; return { created: true }; });
            })
            .then(function (r) {
                Native.setItem.call(localStorage, TOKEN_KEY, token);
                Native.setItem.call(localStorage, GIST_KEY, gistId);
                setStatus('syncing', r.created ? '已创建云端数据，正在上传…' : '已找到云端数据，正在同步…');
                return pull().then(function () { return push(); });
            })
            .then(function () {
                startPoll();
            })
            .catch(function (err) {
                if (!userLogin) { token = null; gistId = null; }
                setStatus('error', '❌ 连接失败：' + err.message);
            });
    }

    function disconnect() {
        stopPoll();
        Native.removeItem.call(localStorage, TOKEN_KEY);
        Native.removeItem.call(localStorage, GIST_KEY);
        token = null;
        gistId = null;
        userLogin = '';
        setStatus('off', '已断开连接（本机数据保留，云端 Gist 未删除）');
    }

    /* ================= 启动 ================= */
    function boot() {
        // 支持通过链接 ?gh_token=xxx&gh_gist=yyy 在手机上快速配置
        try {
            var q = new URLSearchParams(location.search);
            if (q.get('gh_token')) {
                Native.setItem.call(localStorage, TOKEN_KEY, q.get('gh_token'));
                if (q.get('gh_gist')) Native.setItem.call(localStorage, GIST_KEY, q.get('gh_gist'));
                q.delete('gh_token');
                q.delete('gh_gist');
                var rest = q.toString();
                history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
                setStatus('syncing', '已从链接读取配置，正在连接…');
            }
        } catch (e) { /* 忽略 */ }

        token = localStorage.getItem(TOKEN_KEY) || null;
        gistId = localStorage.getItem(GIST_KEY) || null;
        if (token) {
            connect(token);
        } else {
            setStatus('off', '未连接（数据仅保存在本机）');
        }
    }

    /* ================= 对外接口 ================= */
    window.__sync = {
        schedulePush: schedulePush,
        push: push,
        pull: pull,
        active: function () { return !!token; }
    };

    /* ================= 面板交互 ================= */
    window.openCloudModal = function () {
        updatePanel();
        document.getElementById('cloudModal').style.display = 'flex';
    };
    window.closeCloudModal = function (event) {
        if (event && event.target !== document.getElementById('cloudModal')) return;
        document.getElementById('cloudModal').style.display = 'none';
    };
    window.cloudConnect = function () {
        var t = (document.getElementById('cloudToken').value || '').trim();
        if (!t) { setStatus('error', '请先粘贴 GitHub Token'); return; }
        if (t.indexOf('ghp_') !== 0 && t.indexOf('github_pat_') !== 0) {
            setStatus('error', '⚠️ 这看起来不像 GitHub Token（应以 ghp_ 或 github_pat_ 开头）');
            return;
        }
        connect(t);
    };
    window.cloudDisconnect = function () { disconnect(); };
    window.cloudSyncNow = function () {
        setStatus('syncing', '正在同步…');
        pull().then(function () { return push(); });
    };
    window.cloudDiagnose = function () {
        if (!token) { setStatus('error', '❌ 还没连接，请先粘贴 GitHub Token'); return; }
        setStatus('syncing', '正在测试与 GitHub 的连接…');
        var t0 = Date.now();
        withTimeout(ghFetch('/user'), 15000, '连接测试')
            .then(function (u) {
                setStatus('on', '✅ 连接正常！账号 ' + u.login + '（用时 ' + (Date.now() - t0) + ' ms）');
            })
            .catch(function (e) {
                setStatus('error', '❌ ' + e.message);
            });
    };
    window.cloudPhoneLink = function () {
        if (!token || !gistId) { setStatus('error', '请先连接'); return; }
        var base = location.origin + location.pathname;
        var link = base + '?gh_token=' + encodeURIComponent(token) + '&gh_gist=' + encodeURIComponent(gistId);
        window.prompt('复制下面这条链接，发到手机上打开，就会自动配置好：', link);
    };

    /* ================= 本机数据导入 / 导出 ================= */
    window.exportUserData = function () {
        var blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'my-world-backup.json';
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

    /* ================= hook 本地写入 ================= */
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
