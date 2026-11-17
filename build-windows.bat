@echo off
rem Installs build dependencies and packages Lemon IRC as one portable Windows .exe in dist\
setlocal
cd /d "%~dp0"
call tools\node.bat || exit /b 1
echo Installing build dependencies...
call npm ci --no-audit --no-fund
if errorlevel 1 (
    echo npm ci failed.
    exit /b 1
)
echo Packaging the Electron app...
call npm run dist:win
if errorlevel 1 (
    echo Packaging failed.
    exit /b 1
)
echo.
echo Done. Output is in "%~dp0dist"
