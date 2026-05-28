import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_DIR = path.join(__dirname, 'storage');
const COLLECTIONS_DIR = path.join(STORAGE_DIR, 'collections');
const TEMP_DIR = path.join(STORAGE_DIR, 'temp');

async function cleanTemp() {
  console.log('🧹 Clearing temporary upload folder...');
  try {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    console.log('✅ Temporary folder cleared successfully.');
  } catch (error) {
    console.error('❌ Failed to clear temporary folder:', error.message);
  }
}

async function syncDb() {
  console.log('🔄 Synchronising database with filesystem...');
  try {
    const db = await getDb();
    
    // 1. Check Artifacts
    console.log('Checking artifacts...');
    const artifacts = await db.all('SELECT id, name, file_path FROM artifacts');
    let removedArtifacts = 0;
    for (const art of artifacts) {
      if (!existsSync(art.file_path)) {
        await db.run('DELETE FROM artifacts WHERE id = ?', [art.id]);
        // Clear artifact reference in logs
        await db.run('UPDATE logs SET artifact_id = NULL WHERE artifact_id = ?', [art.id]);
        console.log(`- Removed artifact record: ${art.name} (file missing on disk)`);
        removedArtifacts++;
      }
    }
    
    // 2. Check Case Images
    console.log('Checking case images...');
    const images = await db.all('SELECT id, case_id, stored_filename, original_filename FROM case_images');
    let removedImages = 0;
    for (const img of images) {
      const origPath = path.join(COLLECTIONS_DIR, img.case_id, 'originals', img.stored_filename);
      const thumbPath = path.join(COLLECTIONS_DIR, img.case_id, 'thumbnails', img.stored_filename + '-thumb.jpg');
      if (!existsSync(origPath)) {
        await db.run('DELETE FROM case_images WHERE id = ?', [img.id]);
        if (existsSync(thumbPath)) {
          await fs.unlink(thumbPath).catch(() => {});
        }
        console.log(`- Removed image record: ${img.original_filename} (file missing on disk)`);
        removedImages++;
      }
    }
    
    // 3. Recalculate Case Metadata (image count, optimized bundle)
    console.log('Updating case metadata...');
    const cases = await db.all('SELECT id, case_number FROM cases');
    for (const c of cases) {
      const activeImages = await db.all('SELECT id FROM case_images WHERE case_id = ?', [c.id]);
      if (activeImages.length === 0) {
        // If no images left, delete the case
        await db.run('DELETE FROM cases WHERE id = ?', [c.id]);
        const caseDir = path.join(COLLECTIONS_DIR, c.id);
        await fs.rm(caseDir, { recursive: true, force: true }).catch(() => {});
        console.log(`- Deleted empty case record and directory: ${c.case_number}`);
      } else {
        // Update image count
        await db.run('UPDATE cases SET image_count = ? WHERE id = ?', [activeImages.length, c.id]);
      }
    }
    
    console.log(`✅ Database synchronization complete. (Removed ${removedArtifacts} artifacts, ${removedImages} images).`);
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
  }
}

async function resetApp() {
  console.log('⚠️ RESETTING DEV ENVIRONMENT (Deleting all cases and resetting database)...');
  try {
    // 1. Try to clear all database tables via SQL first (works even if file is locked)
    try {
      const db = await getDb();
      await db.run('PRAGMA foreign_keys = OFF;');
      await db.run('DELETE FROM case_images;');
      await db.run('DELETE FROM artifacts;');
      await db.run('DELETE FROM logs;');
      await db.run('DELETE FROM cases;');
      await db.run('VACUUM;');
      console.log('- Cleared all database tables (cases, case_images, artifacts, logs).');
    } catch (dbErr) {
      console.warn('- Warning: Could not clear database tables via SQL:', dbErr.message);
    }

    // 2. Try to close database connection to release lock
    try {
      const db = await getDb();
      await db.close();
      console.log('- Closed database connection.');
    } catch (closeErr) {
      // Ignore
    }

    // 3. Try to delete the database file
    const dbPath = path.join(__dirname, 'db.sqlite');
    if (existsSync(dbPath)) {
      try {
        await fs.unlink(dbPath);
        console.log('- Deleted db.sqlite database file.');
      } catch (unlinkErr) {
        console.log('- Note: db.sqlite file is locked by the running server. Tables were successfully cleared.');
      }
    }
    
    // 4. Delete and recreate storage directories
    await fs.rm(STORAGE_DIR, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    console.log('✅ App reset complete. Environment is clean.');
  } catch (error) {
    console.error('❌ Reset failed:', error.message);
  }
}

function showHelp() {
  console.log(`
Ayushman PDF Helper - Cleanup & Sync Tool

Usage:
  node clean.js <command>

Commands:
  --sync    Remove database records for images or artifacts deleted from the file system.
  --temp    Clear the temporary upload files directory.
  --reset   Wipe database and delete all uploaded case files (DANGER: starts fresh).
  --help    Show this help menu.
  `);
}

async function main() {
  const arg = process.argv[2];
  if (arg === '--sync') {
    await syncDb();
  } else if (arg === '--temp') {
    await cleanTemp();
  } else if (arg === '--reset') {
    await resetApp();
  } else {
    showHelp();
  }
  process.exit(0);
}

main();
