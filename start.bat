@echo off
setlocal
cd /d "%~dp0"
call tools\node.bat || goto failed
node tools\stop-bridge.cjs || goto failed
node build.cjs || goto failed
node bridge\server.cjs --open
pause
exit /b 0

:failed
pause
exit /b 1
