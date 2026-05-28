@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo ===================================================
echo     Ayushman PDF Helper - Developer Build
echo ===================================================
echo.

:: Check if Node.js is installed
node -v >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [WARNING] Node.js is not installed on this system!
    
    rem Check for Admin rights to install Node
    net session >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo [INFO] Requesting Administrator privileges to install Node.js...
        powershell -Command "Start-Process '%~dpnx0' -Verb RunAs -WorkingDirectory '%cd%'"
        exit /b
    )
    
    echo [INFO] Downloading Node.js v22.17.0 MSI installer...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.17.0/node-v22.17.0-x64.msi' -OutFile '%TEMP%\node-install.msi'"
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] Failed to download Node.js installer. Please install it manually.
        echo Press any key to close...
        pause >nul
        exit /b 1
    )
    
    echo [INFO] Installing Node.js silently ^(this may take a minute^)...
    start "" /wait msiexec /i "%TEMP%\node-install.msi" /qn /norestart
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] Silent installation of Node.js failed. Please install it manually.
        echo Press any key to close...
        pause >nul
        exit /b 1
    )
    echo [SUCCESS] Node.js installed successfully!
    set "PATH=!PATH!;C:\Program Files\nodejs"
)

echo [INFO] Node.js is installed:
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
for /f "tokens=*" %%i in ('npm -v') do set NPM_VER=%%i
echo   - Node.js version: %NODE_VER%
echo   - npm version:     %NPM_VER%
echo.

echo 1. Installing backend dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install backend dependencies.
    echo Press any key to close...
    pause >nul
    exit /b %ERRORLEVEL%
)

echo.
echo 2. Installing frontend dependencies...
cd frontend
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install frontend dependencies.
    cd ..
    echo Press any key to close...
    pause >nul
    exit /b %ERRORLEVEL%
)

echo.
echo 3. Building frontend production assets...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to compile React frontend.
    cd ..
    echo Press any key to close...
    pause >nul
    exit /b %ERRORLEVEL%
)

cd ..
echo.
echo ===================================================
echo [SUCCESS] Frontend compiled and outputted to /public.
echo Ready for deployment.
echo ===================================================
echo Press any key to close...
pause >nul
