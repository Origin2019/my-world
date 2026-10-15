/* ============================================================
 * 我的世界 · 数据层 & 云同步（GitHub Gist 版）
 * ------------------------------------------------------------
 *  · 本地 localStorage 始终是随时可用的工作副本
 *  · 填一次 GitHub Token 后，数据自动同步到你的「私密 Gist」
 *  · api.github.com 国内手机、电脑都能直连，不需要代理
 *
 *  安全原则：
 *   1. 首次连接不自动覆盖，必须用户手动选择保留哪一份
 *   2. 空数据永远不能覆盖有数据的一方
 *   3. 每次覆盖前都留一份可恢复的备份
 * ============================================================ */
(function () {
    'use strict';

    var META_KEY = '__sync_meta';    // 本机最后修改时间
    var TOKEN_KEY = '__gh_token';    // GitHub Token
    var GIST_KEY = '__gh_gist';      // Gist ID
    var PAIRED_KEY = '__gh_paired';  // 是否已完成首次配对（选过保留哪一份）
    var BACKUP_KEY = '__last_backup'; // 上次覆盖前的数据备份
    var GIST_FILE = 'my-world.json';
    var POLL_MS = 30000;             // 轮询云端间隔
    var TOLERANCE = 1500;            // 时间比较容差（毫秒）

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
            k.indexOf('sb-') === 0;
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
            // 只删除业务数据键，保留 __ 开头的设备私有键（Token / Gist ID / 配对标记）
            var toRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!isInternal(k)) toRemove.push(k);
            }
            for (var j = 0; j < toRemove.length; j++) {
                Native.removeItem.call(localStorage, toRemove[j]);
            }
            var keys = Object.keys(obj);
            for (var m = 0; m < keys.length; m++) {
                Native.setItem.call(localStorage, keys[m], obj[keys[m]]);
            }
        } finally {
            suppress = false;
        }
    }

    function localTs() {
        return parseInt(localStorage.getItem(META_KEY) || '0', 10) || 0;
    }

    // 打上「本机刚改过」的时间戳。
    // 取「现在」和「上次看到的云端时间 +1」的较大值，
    // 保证本机改动在任何情况下都不会被判定为「比云端旧」而丢失。
    function stampLocal() {
        Native.setItem.call(localStorage, META_KEY, String(Math.max(Date.now(), lastRemoteTs + 1)));
    }

    function isEmptyData(obj) {
        return !obj || typeof obj !== 'object' || Object.keys(obj).length === 0;
    }

    /* ================= GitHub API ================= */
    var token = null;
    var gistId = null;
    var userLogin = '';
    var pushTimer = null;
    var pollTimer = null;
    var busy = false;
    var lastRemoteTs = 0;
    var pendingRemote = null;   // 首次配对时等待用户选择的云端数据

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

    /* ================= 界面状态 ================= */
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
        var choiceBox = document.getElementById('cloudChoice');
        if (choiceBox && choiceBox.style.display !== 'none') {
            // 正在等用户选择：先不显示其它两栏，避免误点
            inBox.style.display = 'none';
            outBox.style.display = 'none';
            return;
        }
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
            if (!document.hidden) sync();
        }, POLL_MS);
    }
    function stopPoll() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    /* ================= 备份 ================= */
    function saveBackup(label, data) {
        if (isEmptyData(data)) return;
        try {
            Native.setItem.call(localStorage, BACKUP_KEY,
                JSON.stringify({ ts: Date.now(), label: label, data: data }));
        } catch (e) { /* 存储满则忽略 */ }
    }

    /* ================= 同步核心 ================= */
    // 读取云端数据；返回 null 表示云端还没有这个文件
    function fetchRemote() {
        return ghFetch('/gists/' + gistId).then(function (g) {
            var f = g.files && g.files[GIST_FILE];
            if (!f) return null;
            var getText;
            if (f.content) {
                getText = Promise.resolve(f.content);
            } else if (f.truncated && f.raw_url) {
                getText = fetch(f.raw_url, { headers: { 'Authorization': 'Bearer ' + token } })
                    .then(function (r) { return r.text(); });
            } else {
                getText = Promise.resolve('');
            }
            return getText.then(function (text) {
                try { return JSON.parse(text); } catch (e) { return { __broken: true }; }
            });
        });
    }

    // 上传本机数据到云端
    function push() {
        if (!token || !gistId) return Promise.resolve();
        var data = snapshot();
        Native.setItem.call(localStorage, PAIRED_KEY, '1');
        stampLocal();
        var ts = localTs();
        var files = {};
        files[GIST_FILE] = { content: JSON.stringify({ updatedAt: ts, data: data }) };
        return ghFetch('/gists/' + gistId, {
            method: 'PATCH',
            body: JSON.stringify({ files: files })
        }).then(function () {
            lastRemoteTs = ts;
            setStatus('on', '已同步 · ' + new Date().toLocaleTimeString());
        }).catch(function (err) {
            setStatus('error', '❌ 上传失败：' + err.message);
        });
    }

    // 用云端数据覆盖本机（覆盖前先把本机数据存一份）
    function applyRemote(obj) {
        saveBackup('拉取云端前的本机数据', snapshot());
        var ts = obj.updatedAt || Date.now();
        if (ts > lastRemoteTs) lastRemoteTs = ts;
        applySnapshot(obj.data);
        Native.setItem.call(localStorage, META_KEY, String(ts));
        Native.setItem.call(localStorage, PAIRED_KEY, '1');
        setStatus('on', '已拉取云端更新，正在刷新…');
        setTimeout(function () { location.reload(); }, 300);
    }

    // 一次自动同步：先看云端，再判断「拉取」还是「上传」
    function sync() {
        // 等用户选择保留哪一份数据时，暂停一切自动同步
        if (pendingRemote) return Promise.resolve();
        if (!token || !gistId || busy || suppress) return Promise.resolve();
        busy = true;
        return fetchRemote()
            .then(function (obj) {
                busy = false;
                // 云端还没有文件 → 上传
                if (!obj) return push();
                // 云端文件损坏 → 不覆盖，用本机数据修复
                if (!obj.data || typeof obj.data !== 'object') {
                    if (!isEmptyData(snapshot())) return push();
                    setStatus('error', '❌ 云端数据异常，请点「⬆ 上传本机到云端」');
                    return;
                }
                var remoteTs = obj.updatedAt || 0;
                if (remoteTs > lastRemoteTs) lastRemoteTs = remoteTs;

                var rEmpty = isEmptyData(obj.data);
                var lEmpty = isEmptyData(snapshot());

                // ① 云端空、本机有 → 上传（绝不丢数据）
                if (rEmpty && !lEmpty) return push();
                // ② 本机空、云端有 → 下载（绝不拿空数据覆盖云端）
                if (lEmpty && !rEmpty) return applyRemote(obj);
                // ③ 两边都空 → 什么都不做
                if (rEmpty && lEmpty) return;
                // ④ 两边都有 → 谁新用谁
                if (remoteTs > localTs() + TOLERANCE) return applyRemote(obj);
                if (localTs() > remoteTs + TOLERANCE) return push();
                // ⑤ 时间几乎一致 → 已同步
            })
            .catch(function (err) {
                busy = false;
                setStatus('error', '❌ 同步失败：' + err.message);
            });
    }

    function schedulePush() {
        if (pendingRemote) return;   // 等用户选择时不要自动上传
        if (!token || !gistId) return;
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(function () { pushTimer = null; sync(); }, 1500);
    }

    /* ================= 首次配对的「二选一」 ================= */
    function askChoice(remoteObj) {
        pendingRemote = remoteObj;
        var info = document.getElementById('cloudChoiceInfo');
        if (info) {
            var when = remoteObj.updatedAt ? new Date(remoteObj.updatedAt).toLocaleString() : '未知时间';
            info.textContent = '云端数据：' + when + ' · 本机数据：' +
                Object.keys(snapshot()).length + ' 项。请选择保留哪一份（选错会覆盖数据）。';
        }
        var box = document.getElementById('cloudChoice');
        if (box) box.style.display = '';
        var modal = document.getElementById('cloudModal');
        if (modal) modal.style.display = 'flex';
        setStatus('syncing', '⚠️ 首次连接：请选择保留哪一份数据');
    }

    window.cloudChoose = function (which) {
        var box = document.getElementById('cloudChoice');
        if (box) box.style.display = 'none';
        var remote = pendingRemote;
        pendingRemote = null;
        Native.setItem.call(localStorage, PAIRED_KEY, '1');
        updatePanel();
        if (which === 'cloud' && remote) {
            applyRemote(remote);
        } else {
            saveBackup('被本机数据覆盖的云端数据', remote ? remote.data : null);
            setStatus('syncing', '正在上传本机数据到云端…');
            push().then(function () {
                if (token) setStatus('on', '✅ 已用本机数据覆盖云端，其它设备稍后会自动拉取');
            });
        }
    };

    /* ================= 连接 / 断开 ================= */
    function connect(tok) {
        token = tok;
        setStatus('syncing', '正在验证 Token…');
        return withTimeout(ghFetch('/user'), 20000, '验证')
            .then(function (u) {
                userLogin = u.login || '';
                setStatus('syncing', '验证成功（' + userLogin + '），正在查找云端数据…');
                return ghFetch('/gists?per_page=100');
            })
            .then(function (gists) {
                var found = null;
                var list = Array.isArray(gists) ? gists : [];
                var i;
                for (i = 0; i < list.length; i++) {
                    if (gistId && list[i].id === gistId) { found = list[i]; break; }
                }
                if (!found) {
                    for (i = 0; i < list.length; i++) {
                        if (list[i].files && list[i].files[GIST_FILE]) { found = list[i]; break; }
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
                var paired = localStorage.getItem(PAIRED_KEY) === '1';

                if (r.created) {
                    setStatus('syncing', '已创建云端数据，正在上传本机数据…');
                    return push();
                }
                // 云端已有仓库：先读出来看看
                return fetchRemote().then(function (obj) {
                    if (!obj || isEmptyData(obj.data)) {
                        setStatus('syncing', '云端还是空的，正在上传本机数据…');
                        return push();
                    }
                    if (!paired) {
                        askChoice(obj);   // 首次配对：交给用户决定，绝不自动覆盖
                        return;
                    }
                    return sync();
                });
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
        Native.removeItem.call(localStorage, PAIRED_KEY);
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
                Native.removeItem.call(localStorage, PAIRED_KEY);   // 新设备：需要重新选择一次
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
        sync: sync,
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
        sync();
    };
    // 强制把本机数据上传到云端（覆盖云端），用于数据被覆盖后恢复
    window.cloudForceUpload = function () {
        if (!token || !gistId) { setStatus('error', '❌ 请先连接 GitHub Token'); return; }
        if (isEmptyData(snapshot())) { setStatus('error', '❌ 本机没有数据可上传，请先「📂 从文件导入数据」'); return; }
        if (!window.confirm('确定要用本机数据覆盖云端吗？\n（云端现有数据会被替换，可用「↩ 恢复上次数据」找回）')) return;
        setStatus('syncing', '正在上传本机数据…');
        fetchRemote().then(function (obj) {
            if (obj && !isEmptyData(obj.data)) saveBackup('被本机数据覆盖的云端数据', obj.data);
            return push();
        }).then(function () {
            if (token) setStatus('on', '✅ 已上传！其它设备稍后会自动拉取');
        });
    };
    // 恢复「上次覆盖前」的数据
    window.cloudRestoreBackup = function () {
        var raw = localStorage.getItem(BACKUP_KEY);
        if (!raw) { setStatus('error', '没有可恢复的备份'); return; }
        var obj;
        try { obj = JSON.parse(raw); } catch (e) { setStatus('error', '备份已损坏'); return; }
        if (isEmptyData(obj.data)) { setStatus('error', '备份是空的，无法恢复'); return; }
        if (!window.confirm('恢复「' + (obj.label || '上次数据') + '」？\n（当前数据会被替换）')) return;
        applySnapshot(obj.data);
        stampLocal();
        setStatus('syncing', '已恢复，正在刷新…');
        setTimeout(function () { location.reload(); }, 300);
    };
    window.cloudDiagnose = function () {
        var localCount = Object.keys(snapshot()).length;
        var extra = '本机数据 ' + localCount + ' 项';
        if (!token) { setStatus('error', '❌ 还没连接，请先粘贴 GitHub Token（' + extra + '）'); return; }
        setStatus('syncing', '正在测试与 GitHub 的连接…');
        var t0 = Date.now();
        withTimeout(ghFetch('/user'), 15000, '连接测试')
            .then(function (u) {
                setStatus('on', '✅ 连接正常！账号 ' + u.login + ' · ' + extra + '（用时 ' + (Date.now() - t0) + ' ms）');
            })
            .catch(function (e) {
                setStatus('error', '❌ ' + e.message + '（' + extra + '）');
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
                // 兼容两种格式：{键:字符串} 或 {data:{键:字符串}}
                if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) obj = obj.data;
                if (isEmptyData(obj)) throw new Error('文件里没有数据');
                saveBackup('导入前的本机数据', snapshot());
                applySnapshot(obj);
                stampLocal();
                setStatus('syncing', '导入成功（' + Object.keys(obj).length + ' 项），正在刷新…');
                setTimeout(function () { location.reload(); }, 400);
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
            stampLocal();
            schedulePush();
        }
    };
    Storage.prototype.removeItem = function (k) {
        Native.removeItem.call(this, k);
        if (this === localStorage && !isInternal(k) && !suppress) {
            stampLocal();
            schedulePush();
        }
    };
    Storage.prototype.clear = function () {
        Native.clear.call(this);
        if (this === localStorage && !suppress) {
            stampLocal();
            schedulePush();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
