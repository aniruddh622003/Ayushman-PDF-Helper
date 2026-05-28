@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: Header
echo ===================================================
echo     Ayushman PDF Helper - Clean ^& Sync Tool
echo ===================================================
echo.

:: Check if Node.js is installed
node -v >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [ERROR] Node.js is required to run the cleanup script but was not found.
    echo Please make sure Node.js is installed and added to your system PATH.
    echo.
    pause
    exit /b 1
)

:: If a command line parameter is provided, execute directly
if "%~1"=="--sync" goto run_sync
if "%~1"=="--temp" goto run_temp
if "%~1"=="--reset" goto run_reset
if "%~1"=="--help" goto run_help
if "%~1"=="-h" goto run_help

if not "%~1"=="" (
    echo [ERROR] Unknown option: %~1
    goto run_help
)

:menu
echo Select an operation to perform:
echo  [1] Sync Database with Filesystem (Removes DB entries for manually deleted files)
echo  [2] Clear Temporary Uploads Directory (Frees up server disk space)
echo  [3] Reset Environment (DANGER: Wipes database and all patient cases)
echo  [4] Exit
echo.
set /p opt="Choose option [1-4]: "

if "%opt%"=="1" goto run_sync
if "%opt%"=="2" goto run_temp
if "%opt%"=="3" goto ask_confirm_reset
if "%opt%"=="4" exit /b 0

echo.
echo [ERROR] Invalid option selected. Please select a number from 1 to 4.
echo.
goto menu

:ask_confirm_reset
echo.
echo ⚠️  WARNING: This will permanently delete db.sqlite and all files inside the storage directory.
set /p confirm="Are you sure you want to proceed? [y/N]: "
if /i "%confirm%"=="y" goto run_reset
if /i "%confirm%"=="yes" goto run_reset
echo Action cancelled.
echo.
goto menu

:run_sync
echo [INFO] Synchronising database records with filesystem...
node clean.js --sync
echo.
if "%~1"=="" pause
exit /b 0

:run_temp
echo [INFO] Cleaning up temporary files...
node clean.js --temp
echo.
if "%~1"=="" pause
exit /b 0

:run_reset
echo [INFO] Resetting application environment...
node clean.js --reset
echo.
if "%~1"=="" pause
exit /b 0

:run_help
echo Usage:
echo   clean.bat [options]
echo.
echo Options:
echo   --sync   Run database sync directly (non-interactive)
echo   --temp   Clear temporary files directly (non-interactive)
echo   --reset  Reset environment directly (non-interactive)
echo   --help   Show this help message
echo.
if "%~1"=="" pause
exit /b 0
