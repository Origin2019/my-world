/* Service Worker：让网页可“安装”到主屏幕，并在断网时仍能打开界面。
 * 策略：同源资源「网络优先，失败回退缓存」，保证每次都能拿到最新代码。 */
var CACHE = 'myworld-v3';
var ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './sync.js',
    './manifest.webmanifest',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
    './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(CACHE)
            .then(function (c) { return c.addAll(ASSETS); })
            .catch(function () { /* 个别资源缺失不影响安装 */ })
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
        fetch(req).then(function (res) {
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
