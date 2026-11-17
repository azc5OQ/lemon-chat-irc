@echo off
rem called by start.bat and build-windows.bat.
rem uses Node.js 22.12 or later when it is installed, otherwise downloads the latest Node.js 24 into .tools\ and puts it on PATH.
rem set NODEJS_ORG_MIRROR to download from a mirror of https://nodejs.org/dist

call :check && exit /b 0
set "LEMON_TOOLS=%~dp0..\.tools"
for /d %%d in ("%LEMON_TOOLS%\node-v*-win-*") do if exist "%%~fd\node.exe" set "PATH=%%~fd;%PATH%"
call :check && exit /b 0

set "LEMON_MIRROR=%NODEJS_ORG_MIRROR%"
if not defined LEMON_MIRROR set "LEMON_MIRROR=https://nodejs.org/dist"
set "LEMON_ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "LEMON_ARCH=arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "LEMON_ARCH=arm64"
if not exist "%LEMON_TOOLS%" mkdir "%LEMON_TOOLS%"
echo Node.js 22.12 or later wasn't found. Downloading Node.js 24 into .tools ...
call :fetch "%LEMON_MIRROR%/latest-v24.x/SHASUMS256.txt" "%LEMON_TOOLS%\SHASUMS256.txt" || goto failed

set "LEMON_FILE="
set "LEMON_EXPECTED="
for /f "tokens=1,2" %%a in ('findstr /l /c:"-win-%LEMON_ARCH%.zip" "%LEMON_TOOLS%\SHASUMS256.txt"') do (
    set "LEMON_EXPECTED=%%a"
    set "LEMON_FILE=%%b"
)
if not defined LEMON_FILE (
    echo The Node.js release list has no win-%LEMON_ARCH% download.
    goto failed
)
call :fetch "%LEMON_MIRROR%/latest-v24.x/%LEMON_FILE%" "%LEMON_TOOLS%\%LEMON_FILE%" || goto failed

set "LEMON_ACTUAL="
for /f "skip=1 delims=" %%h in ('certutil -hashfile "%LEMON_TOOLS%\%LEMON_FILE%" SHA256') do if not defined LEMON_ACTUAL set "LEMON_ACTUAL=%%h"
if not defined LEMON_ACTUAL goto badsum
set "LEMON_ACTUAL=%LEMON_ACTUAL: =%"
if /i not "%LEMON_ACTUAL%"=="%LEMON_EXPECTED%" goto badsum

tar -xf "%LEMON_TOOLS%\%LEMON_FILE%" -C "%LEMON_TOOLS%" 2>nul
if not exist "%LEMON_TOOLS%\%LEMON_FILE:.zip=%\node.exe" powershell -NoProfile -Command "Expand-Archive -LiteralPath '%LEMON_TOOLS%\%LEMON_FILE%' -DestinationPath '%LEMON_TOOLS%' -Force"
if not exist "%LEMON_TOOLS%\%LEMON_FILE:.zip=%\node.exe" goto failed
del "%LEMON_TOOLS%\%LEMON_FILE%" "%LEMON_TOOLS%\SHASUMS256.txt" 2>nul
set "PATH=%LEMON_TOOLS%\%LEMON_FILE:.zip=%;%PATH%"
call :check && exit /b 0
goto failed

:badsum
del "%LEMON_TOOLS%\%LEMON_FILE%" 2>nul
echo The Node.js download doesn't match its published checksum.

:failed
echo Install Node.js 24 from https://nodejs.org and run this again.
exit /b 1

:check
where node >nul 2>nul || exit /b 1
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)" 2>nul
exit /b %errorlevel%

:fetch
del "%~2" 2>nul
where curl.exe >nul 2>nul && curl.exe -fsSL --retry 2 -o "%~2" "%~1" && exit /b 0
bitsadmin /transfer lemonirc /download /priority foreground "%~1" "%~f2" >nul 2>nul && exit /b 0
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%~1' -OutFile '%~f2'" && exit /b 0
echo Downloading %~1 failed.
exit /b 1
