@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地预览（浏览器会自动打开）...
start "" http://localhost:8123/
node serve.js
pause
