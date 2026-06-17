@echo off
REM ============================================================================
REM  MyBudget - One-click installer (Windows)
REM
REM  What this does, in order:
REM    1. Checks that Node.js 22.5+ is installed (offers winget install if not).
REM    2. Installs the npm packages.
REM    3. Builds the web interface.
REM    4. Makes sure Puppeteer's Chrome (chrome.exe) is present, because the bank
REM       scraping needs it. If Chrome's .zip was only partially extracted during
REM       install (a common antivirus / interrupted-download problem), it:
REM         a) tries to extract any leftover .zip in the cache manually, then
REM         b) re-downloads Chrome from scratch.
REM
REM  Safe to run repeatedly. It never deletes your data and only writes inside
REM  this folder and the Puppeteer cache.
REM ============================================================================

setlocal enabledelayedexpansion
title MyBudget - Installation
cd /d "%~dp0"

echo ============================================
echo    MyBudget - Installation
echo ============================================
echo.

REM -------- 1. Node.js --------
where node >nul 2>&1
if errorlevel 1 (
  echo [!] Node.js is not installed.
  where winget >nul 2>&1
  if errorlevel 1 (
    echo [X] winget is not available on this PC.
    echo     Please install Node.js 22.5 or newer manually from:
    echo         https://nodejs.org   ^(choose the LTS version^)
    echo     Then run installation.bat again.
    echo.
    pause
    exit /b 1
  )
  echo [*] Installing Node.js LTS via winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo [i] Node.js was installed. Please CLOSE this window and run
  echo     installation.bat again so the updated PATH takes effect.
  echo.
  pause
  exit /b 0
)

for /f "tokens=*" %%v in ('node --version') do set "NODEVER=%%v"
echo [OK] Node.js found: !NODEVER!
echo.

REM -------- 2. npm install --------
echo [*] Installing npm packages ^(this can take 2-5 minutes^)...
call npm install
if errorlevel 1 (
  echo [X] npm install failed. Check your internet connection and try again.
  echo.
  pause
  exit /b 1
)
echo [OK] npm packages installed.
echo.

REM -------- 3. Build the UI --------
echo [*] Building the user interface...
call npm run build
if errorlevel 1 (
  echo [X] Build failed.
  echo.
  pause
  exit /b 1
)
echo [OK] Interface built.
echo.

REM -------- 4. Ensure Chrome for Puppeteer --------
echo [*] Making sure the bundled Chrome browser is installed...
call npx --yes puppeteer browsers install chrome
echo.

REM -------- 5. Verify chrome.exe --------
call :CHECK_CHROME
if "!CHROME_OK!"=="1" goto :DONE

echo [!] chrome.exe was not found after the install.
echo     Trying manual recovery: extracting any leftover .zip in the cache...
echo.

if "%PUPPETEER_CACHE_DIR%"=="" ( set "CACHE=%USERPROFILE%\.cache\puppeteer" ) else ( set "CACHE=%PUPPETEER_CACHE_DIR%" )

powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = Join-Path '!CACHE!' 'chrome'; if (Test-Path $root) { Get-ChildItem -Path $root -Recurse -Filter *.zip -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('  extracting: ' + $_.FullName); try { Expand-Archive -LiteralPath $_.FullName -DestinationPath $_.DirectoryName -Force } catch { Write-Host ('  failed: ' + $_.Exception.Message) } } } else { Write-Host '  no cache folder found.' }"
echo.

call :CHECK_CHROME
if "!CHROME_OK!"=="1" goto :DONE

echo [!] Manual extraction did not produce chrome.exe. Re-downloading Chrome...
echo.
call npx --yes puppeteer browsers install chrome
echo.

call :CHECK_CHROME
if "!CHROME_OK!"=="1" goto :DONE

echo ============================================
echo [X] Chrome installation FAILED.
echo     Possible causes: antivirus blocking the download, no internet,
echo     or low disk space. Temporarily pause your antivirus and run
echo     installation.bat again.
echo ============================================
echo.
pause
exit /b 1

:DONE
echo ============================================
echo    Installation complete!
echo.
echo    Chrome: !CHROME_PATH!
echo.
echo    Start the app by double-clicking  MyBudget.bat
echo ============================================
echo.
pause
exit /b 0

REM ============================================================================
REM  Subroutine: locate chrome.exe in the Puppeteer cache.
REM  Sets CHROME_OK=1 and CHROME_PATH=<full path> when found.
REM ============================================================================
:CHECK_CHROME
set "CHROME_OK=0"
set "CHROME_PATH="
if "%PUPPETEER_CACHE_DIR%"=="" ( set "CACHE=%USERPROFILE%\.cache\puppeteer" ) else ( set "CACHE=%PUPPETEER_CACHE_DIR%" )
for /f "delims=" %%p in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Join-Path '!CACHE!' 'chrome'; if (Test-Path $c) { $f = Get-ChildItem -Path $c -Recurse -Filter chrome.exe -ErrorAction SilentlyContinue ^| Sort-Object FullName -Descending ^| Select-Object -First 1; if ($f) { $f.FullName } }"') do set "CHROME_PATH=%%p"
if not "!CHROME_PATH!"=="" (
  echo [OK] chrome.exe found: !CHROME_PATH!
  set "CHROME_OK=1"
)
exit /b 0
