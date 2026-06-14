@echo off
rem ===== MyBudget launcher =====
rem Double-click this file to start the app. It opens its own app window in
rem Chrome/Edge. Pressing "סגירת התוכנה" inside the app stops the server, which
rem ends this process and closes this window automatically.
title MyBudget
cd /d "%~dp0"
node server\index.js
