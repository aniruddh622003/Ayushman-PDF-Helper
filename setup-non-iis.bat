@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===================================================
echo     Ayushman PDF Helper - Standalone Setup
echo ===================================================
echo.

:: 1. Verify Node.js is installed
echo [INFO] Verifying Node.js installation...
node -v >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in your system PATH.
    echo Please download and install Node.js from: https://nodejs.org/
    echo after installation, restart this setup script.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo [SUCCESS] Found Node.js version: %NODE_VERSION%
echo.

:: 2. Install production dependencies
echo ===================================================
echo         Installing Production Dependencies
echo ===================================================
echo [INFO] Running npm install --omit=dev...
call npm install --omit=dev
if %ERRORLEVEL% neq 0 (
    echo [WARNING] Dependency installation encountered errors.
    echo Please make sure you have internet access and run "npm install --omit=dev" manually.
    echo.
) else (
    echo [SUCCESS] Dependencies installed successfully.
)
echo.

:: 3. Configure Port
echo ===================================================
echo             Port Configuration
echo ===================================================
set "APP_PORT=3000"
set /p "USER_PORT=Enter the port number for the application [3000]: "
if not "%USER_PORT%"=="" set "APP_PORT=%USER_PORT%"
:: Remove spaces from port number to handle trailing/leading spaces
set "APP_PORT=%APP_PORT: =%"

:: Check if the port is already in use
netstat -aon | findstr /r /c:":%APP_PORT% *LISTENING" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [WARNING] Port %APP_PORT% appears to be in use.
    echo You may experience conflicts if another program is using it.
    echo.
)

:: 4. Generate Startup and Shutdown Scripts
echo [INFO] Creating startup scripts...

:: Create start-server.bat
echo @echo off > start-server.bat
echo cd /d "%%~dp0" >> start-server.bat
echo set PORT=%APP_PORT% >> start-server.bat
echo echo Starting Ayushman PDF Helper on Port %APP_PORT%... >> start-server.bat
echo node server.js >> start-server.bat
echo pause >> start-server.bat

:: Create stop-server.bat
echo @echo off > stop-server.bat
echo cd /d "%%~dp0" >> stop-server.bat
echo echo Stopping Ayushman PDF Helper on Port %APP_PORT%... >> stop-server.bat
echo for /f "tokens=5" %%%%a in ('netstat -aon ^^^| findstr :%APP_PORT% ^^^| findstr LISTENING') do ( >> stop-server.bat
echo     echo Killing process ID %%%%a... >> stop-server.bat
echo     taskkill /f /pid %%%%a >> stop-server.bat
echo ) >> stop-server.bat
echo echo Server stopped. >> stop-server.bat
echo pause >> stop-server.bat

:: Create run-hidden.vbs (silent background launcher)
echo Set fso = CreateObject("Scripting.FileSystemObject") > run-hidden.vbs
echo Set WshShell = CreateObject("WScript.Shell") >> run-hidden.vbs
echo scriptDir = fso.GetParentFolderName(WScript.ScriptFullName) >> run-hidden.vbs
echo WshShell.Run Chr(34) ^& scriptDir ^& "\start-server.bat" ^& Chr(34), 0, False >> run-hidden.vbs

:: Create launch-app.vbs (launches server if stopped, then opens default browser)
echo Set fso = CreateObject("Scripting.FileSystemObject") > launch-app.vbs
echo Set shell = CreateObject("WScript.Shell") >> launch-app.vbs
echo scriptDir = fso.GetParentFolderName(WScript.ScriptFullName) >> launch-app.vbs
echo. >> launch-app.vbs
echo port = "%APP_PORT%" >> launch-app.vbs
echo url = "http://localhost:" ^& port ^& "/" >> launch-app.vbs
echo. >> launch-app.vbs
echo Set exec = shell.Exec("cmd /c netstat -aon | findstr :" ^& port ^& " | findstr LISTENING") >> launch-app.vbs
echo Do While exec.Status = 0 >> launch-app.vbs
echo     WScript.Sleep 50 >> launch-app.vbs
echo Loop >> launch-app.vbs
echo. >> launch-app.vbs
echo If exec.ExitCode ^<^> 0 Then >> launch-app.vbs
echo     shell.Run Chr(34) ^& scriptDir ^& "\run-hidden.vbs" ^& Chr(34), 0, False >> launch-app.vbs
echo     WScript.Sleep 1500 >> launch-app.vbs
echo End If >> launch-app.vbs
echo. >> launch-app.vbs
echo shell.Run url >> launch-app.vbs

echo [SUCCESS] Created startup scripts and launchers.
echo.

:: 5. Create Shortcuts
echo ===================================================
echo             Shortcut Configurations
echo ===================================================

set "desktop_choice=y"
set /p "desktop_choice=Create a Desktop shortcut for starting the app? (y/n) [y]: "
if /i "%desktop_choice%"=="y" (
    echo [INFO] Creating Desktop shortcut...
    powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut([System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), 'Ayushman PDF Helper.lnk')); $Shortcut.TargetPath = [System.IO.Path]::Combine('%~dp0', 'launch-app.vbs'); $Shortcut.WorkingDirectory = '%~dp0'; $Shortcut.Save()"
    if !ERRORLEVEL! equ 0 (
        echo [SUCCESS] Desktop shortcut created.
    ) else (
        echo [ERROR] Failed to create Desktop shortcut.
    )
)
echo.

set "startup_choice=y"
set /p "startup_choice=Start the app automatically when Windows starts? (y/n) [y]: "
if /i "%startup_choice%"=="y" (
    echo [INFO] Registering app in Windows Startup...
    powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut([System.IO.Path]::Combine([System.Environment]::GetFolderPath('Startup'), 'Ayushman PDF Helper.lnk')); $Shortcut.TargetPath = [System.IO.Path]::Combine('%~dp0', 'run-hidden.vbs'); $Shortcut.WorkingDirectory = '%~dp0'; $Shortcut.Save()"
    if !ERRORLEVEL! equ 0 (
        echo [SUCCESS] App added to Windows Startup.
    ) else (
        echo [ERROR] Failed to add app to Windows Startup.
    )
)
echo.

:: 6. Display Completion Message
echo ===================================================
echo               Setup Complete!
echo ===================================================
echo The application is configured to run on Port %APP_PORT%.
echo.
echo To start the server in a visible console:
echo   Double-click: start-server.bat
echo.
echo To start the server silently in the background:
echo   Double-click: run-hidden.vbs
echo.
echo To stop the running server:
echo   Double-click: stop-server.bat
echo.
echo Once started, you can access the application at:
echo   http://localhost:%APP_PORT%/
echo ===================================================
echo Press any key to close...
pause >nul
