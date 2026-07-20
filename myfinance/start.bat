@echo off
title MyFinance Dashboard
echo Starting MyFinance...
cd /d "%~dp0"
rem The server opens its own dedicated app window (closable from inside the app),
rem so we do NOT open a browser tab here — a manually-opened tab cannot be closed
rem by the app's close button.
node server\index.js
rem Keep the window open only if the server crashed, so the error can be read.
if errorlevel 1 pause
