@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===================================================
echo     Ayushman PDF Helper - IIS Production Setup
echo ===================================================
echo.

:: 1. Check for Administrator Privileges
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] Requesting Administrator privileges to configure IIS...
    powershell -Command "Start-Process '%~dpnx0' -Verb RunAs -WorkingDirectory '%cd%'"
    exit /b
)

:: 2. Check and Enable IIS Features
echo [INFO] Checking IIS Web Server status...
sc query w3svc >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] IIS is not installed. Enabling IIS Web Server features via DISM...
    dism /online /enable-feature /featurename:IIS-WebServerRole /featurename:IIS-WebServer /featurename:IIS-CommonHttpFeatures /featurename:IIS-StaticContent /featurename:IIS-DefaultDocument /featurename:IIS-DirectoryBrowsing /featurename:IIS-HttpErrors /featurename:IIS-ApplicationDevelopment /featurename:IIS-ISAPIExtensions /featurename:IIS-ISAPIFilter /featurename:IIS-HttpLogging /featurename:IIS-RequestFiltering /all
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] Failed to enable IIS features.
        echo Press any key to close...
        pause >nul
        exit /b !ERRORLEVEL!
      )
) else (
    echo [SUCCESS] IIS is already installed. Enabling ASP.NET/ISAPI extensions to support iisnode...
    dism /online /enable-feature /featurename:IIS-ApplicationDevelopment /featurename:IIS-ISAPIExtensions /featurename:IIS-ISAPIFilter /all
)

:: Ensure World Wide Web Publishing Service is running
echo [INFO] Starting IIS Service...
net start w3svc >nul 2>&1

:: 3. Validate Dependencies
echo.
echo ===================================================
echo         Validating System Dependencies
echo ===================================================

:: Check IIS URL Rewrite Module
if not exist "%windir%\System32\inetsrv\rewrite.dll" (
    echo [WARNING] IIS URL Rewrite Module is not installed!
    echo   This is REQUIRED for iisnode to rewrite requests to server.js.
    echo.
    set "install_choice=n"
    set /p "install_choice=Would you like to try to automatically download and install IIS URL Rewrite Module? (y/n) [n]: "
    if /i "!install_choice!"=="y" (
        echo [INFO] Downloading URL Rewrite Module...
        powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi' -OutFile '%TEMP%\rewrite_amd64_en-US.msi'"
        if !ERRORLEVEL! neq 0 (
            echo [ERROR] Failed to download URL Rewrite Module.
            echo.
            echo here is download loaction for URL rewrite - https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi
            echo.
        ) else (
            echo [INFO] Installing URL Rewrite Module...
            start /wait msiexec /i "%TEMP%\rewrite_amd64_en-US.msi" /passive /norestart
            del "%TEMP%\rewrite_amd64_en-US.msi" >nul 2>&1
            
            :: Check if it exists now
            if exist "%windir%\System32\inetsrv\rewrite.dll" (
                echo [SUCCESS] IIS URL Rewrite Module was successfully installed!
                echo.
            ) else (
                echo [ERROR] Installation failed.
                echo.
                echo here is download loaction for URL rewrite - https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi
                echo.
            )
        )
    ) else (
        echo.
        echo here is download loaction for URL rewrite - https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi
        echo.
    )
) else (
    echo [SUCCESS] IIS URL Rewrite Module is installed.
)

:: Check iisnode
set "iisnode_exists=0"
if exist "%SystemDrive%\Program Files\iisnode\iisnode.dll" set "iisnode_exists=1"
if exist "%SystemDrive%\Program Files (x86)\iisnode\iisnode.dll" set "iisnode_exists=1"

if "%iisnode_exists%"=="0" (
    echo [WARNING] iisnode IIS module is not installed!
    echo   This is REQUIRED to run Node.js apps inside IIS.
    echo.
    set "install_choice=n"
    set /p "install_choice=Would you like to try to automatically download and install iisnode? (y/n) [n]: "
    if /i "!install_choice!"=="y" (
        echo [INFO] Downloading iisnode...
        powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/azure/iisnode/releases/download/v0.2.21/iisnode-full-v0.2.21-x64.msi' -OutFile '%TEMP%\iisnode-full-x64.msi'"
        if !ERRORLEVEL! neq 0 (
            echo [ERROR] Failed to download iisnode.
            echo.
            echo here is download location for iisnode - https://github.com/azure/iisnode/releases/download/v0.2.21/iisnode-full-v0.2.21-x64.msi
            echo.
        ) else (
            echo [INFO] Installing iisnode...
            start /wait msiexec /i "%TEMP%\iisnode-full-x64.msi" /passive /norestart
            del "%TEMP%\iisnode-full-x64.msi" >nul 2>&1
            
            :: Check if it exists now
            set "iisnode_exists=0"
            if exist "%SystemDrive%\Program Files\iisnode\iisnode.dll" set "iisnode_exists=1"
            if exist "%SystemDrive%\Program Files (x86)\iisnode\iisnode.dll" set "iisnode_exists=1"
            
            if "!iisnode_exists!"=="1" (
                echo [SUCCESS] iisnode was successfully installed!
                echo.
            ) else (
                echo [ERROR] Installation failed.
                echo.
                echo here is download location for iisnode - https://github.com/azure/iisnode/releases/download/v0.2.21/iisnode-full-v0.2.21-x64.msi
                echo.
            )
        )
    ) else (
        echo.
        echo here is download location for iisnode - https://github.com/azure/iisnode/releases/download/v0.2.21/iisnode-full-v0.2.21-x64.msi
        echo.
    )
) else (
    echo [SUCCESS] iisnode module is installed.
)

:: 3.5. Install production dependencies
echo.
echo [INFO] Installing production node modules in target directory...
call npm install --omit=dev
if !ERRORLEVEL! neq 0 (
    echo [WARNING] Failed to automatically install node modules via npm.
    echo Please make sure Node.js/npm are installed and run "npm install --omit=dev" manually in this directory.
)

:: 4. Set directory security permissions for SQLite and storage writes
echo.
echo [INFO] Setting directory permissions for IIS AppPool write operations...
set "physical_path=%~dp0"
if "!physical_path:~-1!"=="\" set "physical_path=!physical_path:~0,-1!"

icacls "!physical_path!" /grant "IIS_IUSRS:(OI)(CI)(F)" /T /Q
icacls "!physical_path!" /grant "IUSR:(OI)(CI)(F)" /T /Q
icacls "!physical_path!" /grant "IIS AppPool\AyushmanPDFHelper:(OI)(CI)(F)" /T /Q >nul 2>&1

:: 5. Configure IIS Website
echo.
echo [INFO] Configuring IIS Web Site "AyushmanImageManager" on Port 3000...
set "appcmd=%windir%\system32\inetsrv\appcmd.exe"

if exist "%appcmd%" (
    :: Unlock handlers and modules configuration sections
    echo [INFO] Unlocking IIS handler and module configurations...
    !appcmd! unlock config -section:system.webServer/handlers >nul 2>&1
    !appcmd! unlock config -section:system.webServer/modules >nul 2>&1

    :: Stop and delete existing website if it exists
    !appcmd! stop site "AyushmanPDFHelper" >nul 2>&1
    !appcmd! delete site "AyushmanPDFHelper" >nul 2>&1
    !appcmd! delete apppool "AyushmanPDFHelper" >nul 2>&1
    
    :: Add Application Pool without Managed .NET Runtime - Unmanaged code for Node.js
    !appcmd! add apppool /name:"AyushmanPDFHelper" /managedRuntimeVersion:""
    
    :: Add Website on Port 3000
    !appcmd! add site /name:"AyushmanPDFHelper" /bindings:http://*:3000 /physicalPath:"!physical_path!" /applicationDefaults.applicationPool:"AyushmanPDFHelper"
    
    :: Start Website
    !appcmd! start site "AyushmanPDFHelper" >nul 2>&1
    
    echo [SUCCESS] IIS Website "AyushmanPDFHelper" configured successfully!
) else (
    echo [ERROR] appcmd.exe not found at %appcmd%. Cannot configure IIS Web Site automatically.
)

echo.
echo ===================================================
echo               Deployment Complete!
echo ===================================================
echo The application has been deployed to IIS on Port 3000.
echo You can access the UI on the local network at:
echo   http://localhost:3000/
echo.
echo (Please ensure Node.js, URL Rewrite, and iisnode are installed for the app to function properly)
echo ===================================================
echo Press any key to close...
pause >nul
