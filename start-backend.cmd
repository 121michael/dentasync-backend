@echo off
setlocal
REM Windows helper: start the DentaSync API in development mode (same as npm start).
cd /d "%~dp0"
set NODE_ENV=development
echo Starting DentaSync backend...
node .\server.js
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo Backend exited with code %EXITCODE%.
  echo If you saw a JWT_SECRET error, set NODE_ENV=development in .env or remove template secrets.
  echo You can also run: node server.js
  pause
)
exit /b %EXITCODE%
