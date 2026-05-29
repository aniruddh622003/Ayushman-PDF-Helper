# Ayushman PDF Helper - Production Release

This directory contains the production-ready build of **Ayushman PDF Helper**, a utility designed to optimize scanned or photographed medical document packets to comply with the Ayushman Bharat portal's **1MB file size limit**, while keeping high-resolution backups for recovery.

---

> ### ⚠️ PROPRIETARY NOTICE
> This software is proprietary to **Debug Informatics Pvt Ltd**. All rights reserved.
> * This application is for **non-commercial use only**.
> * Redistribution of source code or compiled binaries is **strictly prohibited**.
> * Please refer to the `LICENSE` file in this directory for details.

---

## 💻 System Requirements
* **Operating System:** Windows Server / Windows 10/11
* **Runtime:** Node.js (v18.0.0 or higher recommended)
* **Web Server (Optional):** Internet Information Services (IIS)

---

## 🚀 Installation & Deployment

You can run this application in one of two ways:

### Method A: Deployed on IIS (Recommended for Intranet)
This release includes a `setup.bat` script that automatically sets up and registers the application as an IIS website running on **Port 3000**.

1. **Pre-install Node.js:** Make sure Node.js is installed on the machine.
2. **Run Setup:** Right-click `setup.bat` and select **Run as Administrator**.
3. **Automatic Configuration:** The script will automatically:
   * Enable required IIS Web Server roles on Windows.
   * Offer to download and install necessary IIS extensions (IIS URL Rewrite Module and `iisnode`).
   * Grant secure folder access permissions so IIS can read/write data and manage the SQLite database.
   * Register the application pool and configure the IIS website "AyushmanPDFHelper" on Port 3000.
4. **Access the App:** Open your browser and navigate to:
   `http://localhost:3000/` or `http://<your-server-ip>:3000/`

### Method B: Standalone Mode (Recommended for Non-IIS Systems)
This release includes a `setup-non-iis.bat` script that configures the application to run standalone on your Windows machine.

1. **Pre-install Node.js:** Make sure Node.js is installed on the machine.
2. **Run Setup:** Double-click `setup-non-iis.bat`.
3. **Automatic Configuration:** The script will automatically:
   * Install required production dependencies.
   * Ask for a custom port configuration (defaults to 3000).
   * Generate `start-server.bat` (to run server in console), `run-hidden.vbs` (to run server silently in background), and `stop-server.bat` (to stop the running server).
   * Offer to create a Desktop shortcut and register the app in the Windows Startup folder for automatic start at logon.
4. **Access the App:** Open your browser and navigate to `http://localhost:<configured-port>/`

---

## ⚙️ Maintenance & Cleanup Tools

This release includes `clean.bat`, a utility to manage and clean up the server database and storage directory. Double-click `clean.bat` or run it from the command line:

* **Sync database with disk:** 
  ```cmd
  clean.bat --sync
  ```
  If you manually delete files or directories inside the `storage/` folder, run this command. It scans the filesystem, checks if corresponding database records exist, and deletes orphaned records from the registry so they disappear from the UI.
  
* **Clear temporary file cache:** 
  ```cmd
  clean.bat --temp
  ```
  Cleans the temporary uploads directory to reclaim server disk space.
  
* **Full Reset (Start Fresh):** 
  ```cmd
  clean.bat --reset
  ```
  *Warning: Wipes the SQLite database tables and deletes all stored cases and backup images.*
