@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set LOG=%CD%\dentasync-start.log
echo === DentaSync backend launcher ===> "%LOG%"
echo time=%DATE% %TIME%>> "%LOG%"
echo folder=%CD%>> "%LOG%"

echo.
echo === DentaSync backend ===
echo Folder: %CD%
echo Log:    %LOG%
echo.

where node >> "%LOG%" 2>&1
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not in PATH.
  echo ERROR: Node.js is not in PATH.>> "%LOG%"
  echo Install Node.js LTS from https://nodejs.org then reopen this window.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -v 2^>nul') do (
  echo Node: %%V
  echo node_version=%%V>> "%LOG%"
)

if not exist "server.js" (
  echo ERROR: server.js not found here.
  echo ERROR: server.js not found>> "%LOG%"
  pause
  exit /b 1
)

REM Bypass npm entirely. Force local development env.
set NODE_ENV=development
set DENTASYNC_PRODUCTION=
echo NODE_ENV=development>> "%LOG%"
echo Starting http://localhost:5000 ...
echo Press Ctrl+C to stop.
echo.

node server.js
set EXITCODE=%ERRORLEVEL%
echo exit_code=%EXITCODE%>> "%LOG%"

echo.
echo Server stopped. Exit code: %EXITCODE%
echo Full log saved to:
echo   %LOG%
if not "%EXITCODE%"=="0" (
  echo.
  echo Open dentasync-start.log and send its contents if you need help.
)
echo.
pause
exit /b %EXITCODE%
