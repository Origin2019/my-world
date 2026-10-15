// 本地预览用的极简静态服务器（仅本机使用，不需要上传到 GitHub）
// 用法：双击「本地预览.bat」，或在此目录执行 node serve.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8123;
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json',
    '.ico': 'image/x-icon'
};

http.createServer(function (req, res) {
    var p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    var file = path.join(ROOT, p);
    fs.readFile(file, function (err, data) {
        if (err) { res.writeHead(404); res.end('404 Not Found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
    });
}).listen(PORT, function () {
    console.log('本地预览已启动： http://localhost:' + PORT + '  （按 Ctrl+C 结束）');
});
