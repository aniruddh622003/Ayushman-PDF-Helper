import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbConnection = null;

async function initializeDatabase(db) {
  // Enable foreign keys
  await db.run('PRAGMA foreign_keys = ON;');

  // Create cases table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      case_number TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      modified_at TEXT,
      image_count INTEGER NOT NULL,
      optimized_file_size INTEGER NOT NULL,
      optimized_file_type TEXT NOT NULL
    );
  `);

  // Alter cases table to add modified_at column if it doesn't exist
  try {
    await db.exec('ALTER TABLE cases ADD COLUMN modified_at TEXT;');
  } catch (error) {
    // Column already exists, ignore
  }

  // Backfill modified_at with created_at if it's null
  try {
    await db.exec('UPDATE cases SET modified_at = created_at WHERE modified_at IS NULL;');
  } catch (error) {
    // Ignore
  }

  // Create case_images table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS case_images (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      display_order INTEGER NOT NULL,
      created_at TEXT,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    );
  `);

  // Alter case_images table to add created_at column if it doesn't exist
  try {
    await db.exec('ALTER TABLE case_images ADD COLUMN created_at TEXT;');
  } catch (error) {
    // Column already exists, ignore
  }

  // Create logs table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      case_id TEXT,
      case_number TEXT,
      action TEXT NOT NULL,
      details TEXT NOT NULL
    );
  `);

  // Create artifacts table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      case_id TEXT NOT NULL,
      case_number TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    );
  `);

  // Alter logs table to add artifact_id column if it doesn't exist
  try {
    await db.exec('ALTER TABLE logs ADD COLUMN artifact_id TEXT;');
  } catch (error) {
    // Column already exists, ignore
  }

  // Indexes for faster lookups
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cases_case_number ON cases(case_number);
    CREATE INDEX IF NOT EXISTS idx_case_images_case_id ON case_images(case_id);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_case_id ON artifacts(case_id);
    CREATE INDEX IF NOT EXISTS idx_logs_artifact_id ON logs(artifact_id);
  `);
}

export async function getDb() {
  if (dbConnection) {
    return dbConnection;
  }

  try {
    dbConnection = await open({
      filename: path.join(__dirname, 'db.sqlite'),
      driver: sqlite3.Database
    });
    
    await initializeDatabase(dbConnection);
    console.log('Database initialized successfully.');
    return dbConnection;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

export async function logAction(caseId, caseNumber, action, details, artifactId = null) {
  try {
    const db = await getDb();
    const id = crypto.randomUUID ? crypto.randomUUID() : (await import('uuid')).v4();
    const timestamp = new Date().toISOString();
    await db.run(
      `INSERT INTO logs (id, timestamp, case_id, case_number, action, details, artifact_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, timestamp, caseId, caseNumber, action, details, artifactId]
    );
  } catch (error) {
    console.error('Failed to write log to database:', error);
  }
}
