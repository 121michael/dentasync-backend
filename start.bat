@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo === DentaSync backend ===
echo Folder: %CD%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not in PATH.
  echo Install Node.js LTS, then reopen this terminal.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -v') do echo Node: %%V
if not exist "server.js" (
  echo ERROR: server.js not found in %CD%
  echo Make sure you are in C:\DentaSync-git\DentaSync-git
  echo.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo ERROR: package.json not found in %CD%
  echo.
  pause
  exit /b 1
)

REM Local API boot — do not use production secret checks.
set NODE_ENV=development
set DENTASYNC_PRODUCTION=

echo Starting server on http://localhost:5000 ...
echo Press Ctrl+C to stop.
echo.

node server.js
set EXITCODE=%ERRORLEVEL%

echo.
echo Server stopped. Exit code: %EXITCODE%
if not "%EXITCODE%"=="0" (
  echo.
  echo If this mentioned JWT_SECRET, keep NODE_ENV=development ^(this script already sets it^).
  echo If this mentioned PostgreSQL / ECONNREFUSED, start Postgres and check .env DB_* values.
)
echo.
pause
exit /b %EXITCODE%
