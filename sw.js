/* Service Worker：让网页可“安装”到主屏幕，并在断网时仍能打开界面。
 * 策略：同源资源「网络优先（强制向服务器校验，不用本地过期缓存），失败回退缓存」，
 *       保证每次都能拿到最新代码，不会出现「新 JS 配旧 HTML」的错配。 */
var CACHE = 'myworld-v7';
var ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './lyrics.js',
    './sync.js',
    './manifest.webmanifest',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
    './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(CACHE).then(function (c) {
            // cache:'reload' 强制绕过本地缓存，确保缓存里放的也是最新版本
            return Promise.all(ASSETS.map(function (u) {
                return fetch(u, { cache: 'reload' }).then(function (r) {
                    if (r && r.ok) return c.put(u, r);
                }).catch(function () { /* 个别资源缺失不影响安装 */ });
            }));
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) {
                if (k !== CACHE) return caches.delete(k);
            }));
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;

    var url = new URL(req.url);
    // 跨域（Supabase、CDN）交给浏览器直接走网络
    if (url.origin !== self.location.origin) return;

    e.respondWith(
        // no-cache：允许用缓存里的副本，但必须先向服务器校验（有更新就拿新的）
        fetch(req, { cache: 'no-cache' }).then(function (res) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () { });
            return res;
        }).catch(function () {
            return caches.match(req).then(function (hit) {
                return hit || caches.match('./index.html');
            });
        })
    );
});
