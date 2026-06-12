@echo off
title MyFinance Dashboard
echo Starting MyFinance...
cd /d "%~dp0"
start "" "http://localhost:3000"
node server/index.js
pause
