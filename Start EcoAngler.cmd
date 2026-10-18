@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
node scripts\build.mjs
if errorlevel 1 (
  echo The website could not be built. See the message above.
  pause
  exit /b 1
)
echo EcoAngler is opening at http://127.0.0.1:8787
echo Keep this window open while using the website.
start "" "http://127.0.0.1:8787"
node scripts\preview.mjs
pause
