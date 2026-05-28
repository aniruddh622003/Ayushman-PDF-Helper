# Ayushman PDF Helper

Ayushman PDF Helper is a professional, high-performance image compression and PDF compilation utility. It is designed to optimize scanned or photographed medical document packets to comply with the Ayushman Bharat portal's strict **1MB file size limit**, while keeping high-resolution backups for recovery.

---

> ### ⚠️ LICENSE DISCLAIMER
>
> **PROPRIETARY & NON-COMMERCIAL USE ONLY.**
> This application and its source code are proprietary properties of **Debug Informatics Pvt Ltd**.
>
> - Redistribution of this source code or compiled binaries is **strictly prohibited**.
> - Commercial use or operational exploitation without prior written consent is prohibited.
> - Please read the [LICENSE](LICENSE) file for the full legal terms.

---

## Technical Architecture

- **Backend:** Node.js, Express, Multer, SQLite3 (`db.sqlite` database), Sharp (high-performance image manipulation), PDF-Lib (PDF compiler), Archiver.
- **Frontend:** React, Vite, Tailwind CSS, Lucide icons.
- **Storage Structure (`/storage`):**
  - `temp/`: Upload caching.
  - `collections/<case_id>/originals/`: HD original file backups.
  - `collections/<case_id>/optimized/`: Portal-ready compressed packages (under 1MB).
  - `collections/<case_id>/thumbnails/`: Gallery thumbnails.
  - `artifacts/`: Generated download bundles.

---

## Development & How to Build

### Prerequisites

- **Node.js** (v18.0.0 or higher recommended)
- **npm** (v9.0.0 or higher)

### Setup Instructions

1. Install dependencies for both the backend and frontend:

   ```bash
   # Install backend dependencies
   npm install

   # Install frontend dependencies
   cd frontend
   npm install
   ```

2. Build the production assets:
   ```bash
   # From the frontend directory:
   npm run build
   ```
   _This compiles the React application and outputs it directly into the backend's `/public` folder._

### Running the App Locally

- **Development Mode:**
  Runs the server with auto-reload:
  ```bash
  npm run dev
  ```
- **Production Mode:**
  Runs the compiled production bundle:
  ```bash
  npm run start
  ```
  The app will run at `http://localhost:3000` (or the configured port).

### Packaging a Release

To package a clean, self-contained production bundle for deployment:

1. Double-click `make-release.bat` in the root folder, or run it from a Windows prompt:
   ```cmd
   make-release.bat
   ```
2. This script:
   - Compiles the React frontend.
   - Clears any previous `release/` folder.
   - Collects the necessary server files (`server.js`, `db.js`, `clean.js`, `clean.bat`, `setup.bat`, `web.config`, `package.json`, `LICENSE`).
   - Copies the root `release-README.md` file as the main `README.md` inside `/release`.
   - Copies the compiled public assets recursively to `/release/public`.

> ⚠️ **IMPORTANT DEVELOPER NOTE:**
> If you make any changes to the project's structure, files, config files, or scripts, **you MUST update the copy commands inside `make-release.bat`** to keep the release pipeline current.

---

## Utility Tools

- **Database Syncing & Cleanup:**
  If case files or artifacts are manually deleted from the file system, run:
  ```bash
  npm run clean -- --sync
  ```
- **Clearing Temp Uploads:**
  ```bash
  npm run clean -- --temp
  ```
- **Wiping Dev Data (Reset):**
  ```bash
  npm run clean -- --reset
  ```
