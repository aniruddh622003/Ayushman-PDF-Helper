@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===================================================
echo     Ayushman PDF Helper - Build ^& Package Release
echo ===================================================
echo.

:: Check Node.js installation
node -v >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is required to compile and package the app.
    echo Please make sure Node.js is installed and in your system PATH.
    echo.
    pause
    exit /b 1
)

:: 1. Compile React Frontend
echo [INFO] Step 1: Compiling React frontend production assets...
cd frontend
call npm install
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to compile React frontend.
    cd ..
    pause
    exit /b %ERRORLEVEL%
)
cd ..

:: 2. Re-create clean release directory
echo.
echo [INFO] Step 2: Recreating clean release directory...
if exist "release" (
    rmdir /s /q "release"
)
mkdir "release"
mkdir "release\public"

:: 3. Copy production runtime files
echo.
echo [INFO] Step 3: Copying production backend and scripts...
copy "server.js" "release\" >nul
copy "index.cjs" "release\" >nul
copy "db.js" "release\" >nul
copy "clean.js" "release\" >nul
copy "clean.bat" "release\" >nul
copy "setup.bat" "release\" >nul
copy "web.config" "release\" >nul
copy "package.json" "release\" >nul
copy "LICENSE" "release\" >nul

:: Copy release README from source file
if exist "release-README.md" (
    copy "release-README.md" "release\README.md" >nul
) else (
    echo [WARNING] release-README.md source not found in root.
)

:: 4. Copy compiled frontend public assets recursively
echo.
echo [INFO] Step 4: Copying compiled public assets...
xcopy "public" "release\public" /E /I /H /Y /Q >nul

echo.
echo ===================================================
echo [SUCCESS] Release packaged successfully in /release
echo ===================================================
echo.
pause
