import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import { getDb, logAction } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 3000;
const STORAGE_DIR = path.join(__dirname, 'storage');
const COLLECTIONS_DIR = path.join(STORAGE_DIR, 'collections');
const TEMP_DIR = path.join(STORAGE_DIR, 'temp');

// Ensure storage directories exist
async function ensureDirs() {
  await fs.mkdir(COLLECTIONS_DIR, { recursive: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

// Setup Multer for disk storage of uploaded originals
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // Generate a temporary folder inside temp
    const uploadTempDir = path.join(TEMP_DIR, 'uploads');
    await fs.mkdir(uploadTempDir, { recursive: true });
    cb(null, uploadTempDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${ext}. Only images are allowed.`), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB per file max for upload
  }
});

// Helper: Get local server IPs for intranet hosting info
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const IPs = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        IPs.push(iface.address);
      }
    }
  }
  return IPs;
}

// ----------------------------------------------------
// Adaptive Compression Algorithms
// ----------------------------------------------------

/**
 * Compresses a single image to a buffer targeting under 1MB.
 */
async function compressImageToBuffer(inputPath, targetMaxBytes = 950000, forceGrayscale = false) {
  let quality = 85;
  let width = 2048;
  
  const metadata = await sharp(inputPath).metadata();
  const originalWidth = metadata.width || 2048;
  
  width = Math.min(originalWidth, width);
  
  let attempts = 0;
  let buffer;
  let grayscale = forceGrayscale;
  
  while (attempts < 7) {
    let pipeline = sharp(inputPath).resize(width);
    if (grayscale) {
      pipeline = pipeline.grayscale();
    }
    
    buffer = await pipeline
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
      
    if (buffer.length <= targetMaxBytes || width <= 400) {
      break;
    }
    
    attempts++;
    width = Math.floor(width * 0.75);
    quality = Math.max(20, quality - 15);
    if (attempts >= 4) {
      grayscale = true; // Force grayscale as final fallback after 4 color attempts
    }
  }
  
  return buffer;
}

/**
 * Compresses multiple images and compiles them into a single PDF under 1MB.
 */
async function compressMultipleImagesToPdf(imagePaths, outputPath, forceGrayscale = false) {
  const N = imagePaths.length;
  const totalTargetBytes = 950000; // Leave 50KB safety room for PDF structures
  
  // Starting parameters adjusted dynamically based on count
  let width = 1600;
  let quality = 80;
  let grayscale = forceGrayscale;
  
  if (N > 5) { width = 1200; quality = 70; }
  if (N > 20) { width = 1000; quality = 55; }
  if (N > 50) { width = 800; quality = 45; }
  if (N > 100) { width = 600; quality = 35; }
  if (N > 150) { width = 500; quality = 30; }

  let attempts = 0;
  let success = false;
  let pdfBytes;
  
  while (attempts < 7 && !success) {
    const pdfDoc = await PDFDocument.create();
    
    try {
      for (const imgPath of imagePaths) {
        let pipeline = sharp(imgPath).resize(width);
        if (grayscale) {
          pipeline = pipeline.grayscale();
        }
        
        const jpegBuffer = await pipeline
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
          
        const pdfImage = await pdfDoc.embedJpg(jpegBuffer);
        const page = pdfDoc.addPage([pdfImage.width, pdfImage.height]);
        page.drawImage(pdfImage, {
          x: 0,
          y: 0,
          width: pdfImage.width,
          height: pdfImage.height
        });
      }
      
      pdfBytes = await pdfDoc.save();
      
      if (pdfBytes.length <= 1000000 || width <= 300) {
        await fs.writeFile(outputPath, pdfBytes);
        success = true;
        break;
      }
    } catch (err) {
      console.error(`PDF build attempt ${attempts} failed:`, err);
    }
    
    attempts++;
    width = Math.floor(width * 0.75);
    quality = Math.max(15, quality - 10);
    
    // Only force grayscale as a final fallback if we failed to fit color after 4 attempts
    if (attempts >= 4) {
      grayscale = true; 
    }
  }
  
  if (!success) {
    // If even lowest settings failed, write the last generated PDF anyway
    if (pdfBytes) {
      await fs.writeFile(outputPath, pdfBytes);
    } else {
      throw new Error('Failed to generate PDF document.');
    }
  }
}

/**
 * Generates a unique artifact name if it already exists in the database.
 */
async function getUniqueArtifactName(db, baseName) {
  let name = baseName;
  let counter = 1;
  while (true) {
    const existing = await db.get('SELECT id FROM artifacts WHERE name = ?', [name]);
    if (!existing) {
      return name;
    }
    const ext = path.extname(baseName);
    if (ext) {
      const baseWithoutExt = path.basename(baseName, ext);
      name = `${baseWithoutExt} (${counter})${ext}`;
    } else {
      name = `${baseName} (${counter})`;
    }
    counter++;
  }
}

// ----------------------------------------------------
// REST API Routes
// ----------------------------------------------------

// 1. Get dashboard statistics and network info
app.get('/api/system/status', async (req, res) => {
  try {
    const db = await getDb();
    
    const casesCount = await db.get('SELECT COUNT(*) as count FROM cases');
    const logsCount = await db.get('SELECT COUNT(*) as count FROM logs');
    
    // Get disk space metrics of the storage folder
    let storageSizeBytes = 0;
    async function getDirSize(dirPath) {
      try {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const stats = await fs.stat(filePath);
          if (stats.isDirectory()) {
            await getDirSize(filePath);
          } else {
            storageSizeBytes += stats.size;
          }
        }
      } catch (e) {
        // Folder might not exist yet
      }
    }
    await getDirSize(STORAGE_DIR);
    
    // Determine the public port (since process.env.PORT is a named pipe path in iisnode)
    const hostHeader = req.get('host') || '';
    let publicPort = '3000';
    if (hostHeader.includes(':')) {
      publicPort = hostHeader.split(':')[1];
    } else if (hostHeader) {
      publicPort = '80';
    } else if (typeof PORT === 'string' && !PORT.startsWith('\\\\.\\pipe\\')) {
      publicPort = PORT;
    } else if (typeof PORT === 'number') {
      publicPort = String(PORT);
    }

    res.json({
      casesCount: casesCount.count,
      logsCount: logsCount.count,
      storageSize: (storageSizeBytes / (1024 * 1024)).toFixed(2) + ' MB',
      localIPs: getLocalIPs(),
      port: publicPort,
      osPlatform: os.platform(),
      osRelease: os.release()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Browse cases directory (paginated and searchable)
app.get('/api/cases', async (req, res) => {
  try {
    const db = await getDb();
    const search = req.query.search || '';
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    let query = 'SELECT * FROM cases';
    let countQuery = 'SELECT COUNT(*) as count FROM cases';
    let params = [];
    
    if (search) {
      query += ' WHERE case_number LIKE ?';
      countQuery += ' WHERE case_number LIKE ?';
      params.push(`%${search}%`);
    }
    
    query += ' ORDER BY COALESCE(modified_at, created_at) DESC LIMIT ? OFFSET ?';
    const queryParams = [...params, limit, offset];
    
    const cases = await db.all(query, queryParams);
    const countResult = await db.get(countQuery, params);
    
    res.json({
      cases,
      totalCount: countResult.count,
      limit,
      offset
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Get detailed information for a specific case
app.get('/api/cases/:id', async (req, res) => {
  try {
    const db = await getDb();
    const caseId = req.params.id;
    
    const caseData = await db.get('SELECT * FROM cases WHERE id = ?', [caseId]);
    if (!caseData) {
      return res.status(404).json({ error: 'Patient case not found.' });
    }
    
    const images = await db.all(
      `SELECT id, original_filename, file_size, display_order, 
       COALESCE(created_at, (SELECT created_at FROM cases WHERE id = case_images.case_id)) as created_at 
       FROM case_images WHERE case_id = ? 
       ORDER BY created_at ASC, display_order ASC`,
      [caseId]
    );
    
    const logs = await db.all(
      'SELECT id, timestamp, action, details, artifact_id FROM logs WHERE case_id = ? ORDER BY timestamp DESC',
      [caseId]
    );
    
    const artifacts = await db.all(
      'SELECT id, name, file_size, file_type, created_at FROM artifacts WHERE case_id = ? ORDER BY created_at DESC',
      [caseId]
    );
    
    res.json({
      case: caseData,
      images,
      logs,
      artifacts
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Serve page thumbnails for UI gallery preview
app.get('/api/cases/:id/images/:imageId/thumbnail', async (req, res) => {
  try {
    const db = await getDb();
    const { id: caseId, imageId } = req.params;
    
    const imgInfo = await db.get(
      'SELECT stored_filename FROM case_images WHERE id = ? AND case_id = ?',
      [imageId, caseId]
    );
    
    if (!imgInfo) {
      return res.status(404).send('Image not found.');
    }
    
    const originalPath = path.join(COLLECTIONS_DIR, caseId, 'originals', imgInfo.stored_filename);
    const thumbDir = path.join(COLLECTIONS_DIR, caseId, 'thumbnails');
    await fs.mkdir(thumbDir, { recursive: true });
    
    const thumbPath = path.join(thumbDir, imgInfo.stored_filename + '-thumb.jpg');
    
    // Serve from cache if it exists
    if (existsSync(thumbPath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      return res.sendFile(thumbPath);
    }
    
    // Generate thumbnail
    await sharp(originalPath)
      .resize(180, 180, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toFile(thumbPath);
      
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(thumbPath);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// 5. Serve original resolution image file
app.get('/api/cases/:id/images/:imageId/original', async (req, res) => {
  try {
    const db = await getDb();
    const { id: caseId, imageId } = req.params;
    
    const imgInfo = await db.get(
      'SELECT stored_filename, original_filename FROM case_images WHERE id = ? AND case_id = ?',
      [imageId, caseId]
    );
    
    if (!imgInfo) {
      return res.status(404).send('Image not found.');
    }
    
    const originalPath = path.join(COLLECTIONS_DIR, caseId, 'originals', imgInfo.stored_filename);
    res.setHeader('Content-Disposition', `attachment; filename="${imgInfo.original_filename}"`);
    res.sendFile(originalPath);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// 6. Serve pre-compiled optimized upload package (JPG or PDF)
app.post('/api/cases/:id/download-optimized', async (req, res) => {
  try {
    const db = await getDb();
    const caseId = req.params.id;
    const { name } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Artifact name is required.' });
    }
    
    const caseData = await db.get('SELECT case_number, optimized_file_type FROM cases WHERE id = ?', [caseId]);
    if (!caseData) {
      return res.status(404).send('Case not found.');
    }
    
    const ext = caseData.optimized_file_type === 'pdf' ? '.pdf' : '.jpg';
    let baseName = name.trim();
    if (!baseName.toLowerCase().endsWith(ext)) {
      baseName += ext;
    }
    
    const uniqueName = await getUniqueArtifactName(db, baseName);
    const filename = caseData.optimized_file_type === 'pdf' 
      ? `${caseData.case_number}.pdf` 
      : `${caseData.case_number}.jpg`;
      
    const optimizedPath = path.join(COLLECTIONS_DIR, caseId, 'optimized', filename);
    
    if (!existsSync(optimizedPath)) {
      // Self-healing: Recover from the naming bug or regenerate if missing
      const caseOptimizedDir = path.join(COLLECTIONS_DIR, caseId, 'optimized');
      
      if (caseData.optimized_file_type === 'pdf') {
        const oldBuggyPath = path.join(caseOptimizedDir, `${caseData.case_number}.jpg`);
        if (existsSync(oldBuggyPath)) {
          await fs.rename(oldBuggyPath, optimizedPath);
          console.log(`Self-healed: renamed buggy PDF file from ${oldBuggyPath} to ${optimizedPath}`);
        }
      }
      
      // If it still doesn't exist, regenerate from original backups
      if (!existsSync(optimizedPath)) {
        const images = await db.all(
          'SELECT stored_filename FROM case_images WHERE case_id = ? ORDER BY display_order ASC',
          [caseId]
        );
        
        if (images && images.length > 0) {
          const caseOriginalsDir = path.join(COLLECTIONS_DIR, caseId, 'originals');
          const originalPaths = images.map(img => path.join(caseOriginalsDir, img.stored_filename));
          
          await fs.mkdir(caseOptimizedDir, { recursive: true });
          
          if (caseData.optimized_file_type === 'pdf') {
            await compressMultipleImagesToPdf(originalPaths, optimizedPath, false);
          } else {
            const compressedBuffer = await compressImageToBuffer(originalPaths[0], 950000, false);
            await fs.writeFile(optimizedPath, compressedBuffer);
          }
          console.log(`Self-healed: regenerated optimized file at ${optimizedPath}`);
        } else {
          return res.status(404).send('Optimized file not found and original backups are missing.');
        }
      }
    }
    
    // Save to artifacts directory
    const artifactId = uuidv4();
    const artifactsDir = path.join(STORAGE_DIR, 'artifacts');
    await fs.mkdir(artifactsDir, { recursive: true });
    
    const artifactPath = path.join(artifactsDir, `${artifactId}${ext}`);
    await fs.copyFile(optimizedPath, artifactPath);
    
    const stats = await fs.stat(artifactPath);
    const fileSize = stats.size;
    const timestamp = new Date().toISOString();
    
    // Insert into database
    await db.run(
      `INSERT INTO artifacts (id, name, file_path, file_size, file_type, case_id, case_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [artifactId, uniqueName, artifactPath, fileSize, caseData.optimized_file_type, caseId, caseData.case_number, timestamp]
    );

    // Update case modified_at timestamp
    await db.run(
      'UPDATE cases SET modified_at = ? WHERE id = ?',
      [timestamp, caseId]
    );
    
    // Write log with artifact_id
    await logAction(
      caseId, 
      caseData.case_number, 
      'Download Optimized File', 
      `Downloaded optimized artifact: ${uniqueName}`,
      artifactId
    );
    
    res.attachment(uniqueName);
    res.sendFile(artifactPath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Upload new Patient Case
app.post('/api/cases/upload', upload.array('files'), async (req, res) => {
  let uploadedFiles = [];
  try {
    const { case_number, force_grayscale } = req.body;
    
    // Validate case number format (alphanumeric/numbers, typical 20-digit target)
    if (!case_number || case_number.trim().length < 5 || case_number.trim().length > 32) {
      throw new Error('Case number must be between 5 and 32 characters.');
    }
    
    const caseNumStr = case_number.trim();
    const files = req.files;
    
    if (!files || files.length === 0) {
      throw new Error('No images uploaded.');
    }
    
    uploadedFiles = files; // reference for error cleanup
    
    const db = await getDb();
    
    // Check if case number already exists
    const existingCase = await db.get('SELECT id FROM cases WHERE case_number = ?', [caseNumStr]);
    if (existingCase) {
      throw new Error(`Case Number '${caseNumStr}' already exists in the database.`);
    }
    
    const caseId = uuidv4();
    const caseOriginalsDir = path.join(COLLECTIONS_DIR, caseId, 'originals');
    const caseOptimizedDir = path.join(COLLECTIONS_DIR, caseId, 'optimized');
    
    await fs.mkdir(caseOriginalsDir, { recursive: true });
    await fs.mkdir(caseOptimizedDir, { recursive: true });
    
    const imageRecords = [];
    const originalPathsOnDisk = [];
    
    // Copy files to permanent storage
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const imgId = uuidv4();
      const ext = path.extname(file.originalname);
      const storedName = `${imgId}${ext}`;
      const destPath = path.join(caseOriginalsDir, storedName);
      
      await fs.copyFile(file.path, destPath);
      originalPathsOnDisk.push(destPath);
      
      imageRecords.push({
        id: imgId,
        case_id: caseId,
        original_filename: file.originalname,
        stored_filename: storedName,
        file_size: file.size,
        display_order: i,
        created_at: new Date().toISOString()
      });
    }
    
    // Compile optimized package (under 1MB)
    let optFileType = 'jpg';
    let optFileName = '';
    let optPath = '';
    const isGrayscale = force_grayscale === 'true';
    
    if (files.length === 1) {
      optFileType = 'jpg';
      optFileName = `${caseNumStr}.jpg`;
      optPath = path.join(caseOptimizedDir, optFileName);
      const compressedBuffer = await compressImageToBuffer(originalPathsOnDisk[0], 950000, isGrayscale);
      await fs.writeFile(optPath, compressedBuffer);
    } else {
      optFileType = 'pdf';
      optFileName = `${caseNumStr}.pdf`;
      optPath = path.join(caseOptimizedDir, optFileName);
      await compressMultipleImagesToPdf(originalPathsOnDisk, optPath, isGrayscale);
    }
    
    const optStats = await fs.stat(optPath);
    const optSize = optStats.size;
    const timestamp = new Date().toISOString();
    
    // Transactional database writes
    await db.run('BEGIN TRANSACTION');
    try {
      await db.run(
        `INSERT INTO cases (id, case_number, created_at, modified_at, image_count, optimized_file_size, optimized_file_type) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [caseId, caseNumStr, timestamp, timestamp, files.length, optSize, optFileType]
      );
      
      for (const record of imageRecords) {
        await db.run(
          `INSERT INTO case_images (id, case_id, original_filename, stored_filename, file_size, display_order, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [record.id, record.case_id, record.original_filename, record.stored_filename, record.file_size, record.display_order, record.created_at]
        );
      }
      
      await db.run('COMMIT');
    } catch (dbErr) {
      await db.run('ROLLBACK');
      throw dbErr;
    }
    
    // Log the successful upload
    await logAction(
      caseId, 
      caseNumStr, 
      'Upload Case', 
      `Uploaded ${files.length} images. Compiled ${optFileType.toUpperCase()} size: ${(optSize / 1024).toFixed(1)} KB`
    );
    
    // Cleanup temporary files
    for (const file of files) {
      await fs.unlink(file.path).catch(() => {});
    }
    
    res.json({
      success: true,
      caseId,
      caseNumber: caseNumStr,
      fileType: optFileType,
      sizeBytes: optSize
    });
    
  } catch (error) {
    console.error('Upload handler error:', error);
    // Cleanup uploaded temp files on error
    for (const file of uploadedFiles) {
      await fs.unlink(file.path).catch(() => {});
    }
    res.status(400).json({ error: error.message });
  }
});

// 7.5. Add photos to an existing Case
app.post('/api/cases/:id/add-images', upload.array('files'), async (req, res) => {
  let uploadedFiles = [];
  try {
    const caseId = req.params.id;
    const files = req.files;
    
    if (!files || files.length === 0) {
      throw new Error('No images uploaded.');
    }
    
    uploadedFiles = files;
    
    const db = await getDb();
    
    const caseData = await db.get('SELECT * FROM cases WHERE id = ?', [caseId]);
    if (!caseData) {
      throw new Error('Case not found.');
    }
    
    const caseOriginalsDir = path.join(COLLECTIONS_DIR, caseId, 'originals');
    const caseOptimizedDir = path.join(COLLECTIONS_DIR, caseId, 'optimized');
    
    // Find next display order
    const maxOrderRow = await db.get('SELECT MAX(display_order) as max_order FROM case_images WHERE case_id = ?', [caseId]);
    let nextOrder = (maxOrderRow && maxOrderRow.max_order !== null) ? maxOrderRow.max_order + 1 : 0;
    
    const imageRecords = [];
    const originalPathsOnDisk = [];
    
    // Copy new files to originals directory
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const imgId = uuidv4();
      const ext = path.extname(file.originalname);
      const storedName = `${imgId}${ext}`;
      const destPath = path.join(caseOriginalsDir, storedName);
      
      await fs.copyFile(file.path, destPath);
      originalPathsOnDisk.push(destPath);
      
      imageRecords.push({
        id: imgId,
        case_id: caseId,
        original_filename: file.originalname,
        stored_filename: storedName,
        file_size: file.size,
        display_order: nextOrder + i,
        created_at: new Date().toISOString()
      });
    }
    
    // Insert new images into DB first
    await db.run('BEGIN TRANSACTION');
    try {
      for (const record of imageRecords) {
        await db.run(
          `INSERT INTO case_images (id, case_id, original_filename, stored_filename, file_size, display_order, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [record.id, record.case_id, record.original_filename, record.stored_filename, record.file_size, record.display_order, record.created_at]
        );
      }
      await db.run('COMMIT');
    } catch (dbErr) {
      await db.run('ROLLBACK');
      throw dbErr;
    }
    
    // Get all images of the case (both existing and new) to regenerate optimized bundle
    const allImages = await db.all(
      'SELECT stored_filename FROM case_images WHERE case_id = ? ORDER BY display_order ASC',
      [caseId]
    );
    const allPaths = allImages.map(img => path.join(caseOriginalsDir, img.stored_filename));
    
    // Delete existing optimized files
    const oldFileName = caseData.optimized_file_type === 'pdf'
      ? `${caseData.case_number}.pdf`
      : `${caseData.case_number}.jpg`;
    await fs.unlink(path.join(caseOptimizedDir, oldFileName)).catch(() => {});
    
    // Compile optimized package (under 1MB)
    let optFileType = 'jpg';
    let optFileName = '';
    let optPath = '';
    
    if (allPaths.length === 1) {
      optFileType = 'jpg';
      optFileName = `${caseData.case_number}.jpg`;
      optPath = path.join(caseOptimizedDir, optFileName);
      const compressedBuffer = await compressImageToBuffer(allPaths[0], 950000, false);
      await fs.writeFile(optPath, compressedBuffer);
    } else {
      optFileType = 'pdf';
      optFileName = `${caseData.case_number}.pdf`;
      optPath = path.join(caseOptimizedDir, optFileName);
      await compressMultipleImagesToPdf(allPaths, optPath, false);
    }
    
    const optStats = await fs.stat(optPath);
    const optSize = optStats.size;
    
    // Update case metadata
    await db.run(
      `UPDATE cases SET image_count = ?, optimized_file_size = ?, optimized_file_type = ?, modified_at = ? WHERE id = ?`,
      [allPaths.length, optSize, optFileType, new Date().toISOString(), caseId]
    );
    
    // Log the action
    await logAction(
      caseId,
      caseData.case_number,
      'Add Photos to Case',
      `Added ${files.length} images. Total images now: ${allPaths.length}. Optimized size: ${(optSize / 1024).toFixed(1)} KB`
    );
    
    // Cleanup temp files
    for (const file of files) {
      await fs.unlink(file.path).catch(() => {});
    }
    
    res.json({
      success: true,
      caseId,
      imageCount: allPaths.length,
      fileType: optFileType,
      sizeBytes: optSize
    });
  } catch (error) {
    console.error('Add photos handler error:', error);
    for (const file of uploadedFiles) {
      await fs.unlink(file.path).catch(() => {});
    }
    res.status(400).json({ error: error.message });
  }
});

// 8. Custom Downloader (ZIP or PDF bundle of selected page indexes, high-res or optimized)
app.post('/api/cases/:id/download-bundle', async (req, res) => {
  try {
    const db = await getDb();
    const caseId = req.params.id;
    const { imageIds, format, quality, name } = req.body; // imageIds = [], format = 'zip'|'pdf'|'jpg', quality = 'original'|'optimized-1mb', name = string
    
    const caseData = await db.get('SELECT case_number FROM cases WHERE id = ?', [caseId]);
    if (!caseData) {
      return res.status(404).json({ error: 'Case not found.' });
    }
    
    if (!imageIds || imageIds.length === 0) {
      return res.status(400).json({ error: 'No images selected for download.' });
    }

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Artifact name is required.' });
    }
    
    const ext = format === 'pdf' ? '.pdf' : (format === 'zip' ? '.zip' : '.jpg');
    let baseName = name.trim();
    if (!baseName.toLowerCase().endsWith(ext)) {
      baseName += ext;
    }
    const uniqueName = await getUniqueArtifactName(db, baseName);
    
    // Fetch image details from DB matching the selection
    const placeholders = imageIds.map(() => '?').join(',');
    const images = await db.all(
      `SELECT * FROM case_images WHERE case_id = ? AND id IN (${placeholders})`,
      [caseId, ...imageIds]
    );
    
    if (images.length === 0) {
      return res.status(400).json({ error: 'None of the selected images were found.' });
    }

    // Sort images to match selection order in imageIds
    const sortedImages = imageIds.map(id => images.find(img => img.id === id)).filter(Boolean);
    
    const caseOriginalsDir = path.join(COLLECTIONS_DIR, caseId, 'originals');
    const filePaths = sortedImages.map(img => path.join(caseOriginalsDir, img.stored_filename));
    
    const artifactsDir = path.join(STORAGE_DIR, 'artifacts');
    await fs.mkdir(artifactsDir, { recursive: true });
    
    const artifactId = uuidv4();
    const artifactPath = path.join(artifactsDir, `${artifactId}${ext}`);
    
    // Generate file response based on settings
    if (format === 'jpg' && sortedImages.length === 1) {
      const img = sortedImages[0];
      const srcPath = path.join(caseOriginalsDir, img.stored_filename);
      
      if (quality === 'original') {
        await fs.copyFile(srcPath, artifactPath);
      } else {
        const compBuffer = await compressImageToBuffer(srcPath, 950000, false);
        await fs.writeFile(artifactPath, compBuffer);
      }
    } 
    
    else if (format === 'pdf') {
      if (quality === 'original') {
        const pdfDoc = await PDFDocument.create();
        for (const filePath of filePaths) {
          const jpegBuffer = await sharp(filePath).jpeg({ quality: 90 }).toBuffer();
          const pdfImage = await pdfDoc.embedJpg(jpegBuffer);
          const page = pdfDoc.addPage([pdfImage.width, pdfImage.height]);
          page.drawImage(pdfImage, { x: 0, y: 0, width: pdfImage.width, height: pdfImage.height });
        }
        const pdfBytes = await pdfDoc.save();
        await fs.writeFile(artifactPath, pdfBytes);
      } else {
        await compressMultipleImagesToPdf(filePaths, artifactPath, false);
      }
    } 
    
    else if (format === 'zip') {
      const outputStream = fs.createWriteStream ? fs.createWriteStream(artifactPath) : (await import('fs')).createWriteStream(artifactPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      archive.pipe(outputStream);
      
      for (let i = 0; i < sortedImages.length; i++) {
        const img = sortedImages[i];
        const filePath = filePaths[i];
        
        if (quality === 'original') {
          archive.file(filePath, { name: img.original_filename });
        } else {
          const targetBytesPerImage = Math.floor(900000 / sortedImages.length);
          const compBuffer = await compressImageToBuffer(filePath, targetBytesPerImage, false);
          archive.append(compBuffer, { name: `opt-${img.original_filename}.jpg` });
        }
      }
      
      await archive.finalize();
      
      await new Promise((resolve) => {
        outputStream.on('close', resolve);
      });
    } else {
      return res.status(400).json({ error: 'Invalid file format or image count.' });
    }

    const stats = await fs.stat(artifactPath);
    const fileSize = stats.size;
    const timestamp = new Date().toISOString();
    
    // Insert artifact record
    await db.run(
      `INSERT INTO artifacts (id, name, file_path, file_size, file_type, case_id, case_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [artifactId, uniqueName, artifactPath, fileSize, format, caseId, caseData.case_number, timestamp]
    );

    // Update case modified_at timestamp
    await db.run(
      'UPDATE cases SET modified_at = ? WHERE id = ?',
      [timestamp, caseId]
    );
    
    // Log with artifact_id
    await logAction(
      caseId, 
      caseData.case_number, 
      `Download Custom ${format.toUpperCase()}`, 
      `Downloaded bundle artifact: ${uniqueName} (${sortedImages.length} images, Quality: ${quality})`,
      artifactId
    );
    
    res.attachment(uniqueName);
    res.sendFile(artifactPath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Get system action logs list
app.get('/api/logs', async (req, res) => {
  try {
    const db = await getDb();
    const limit = parseInt(req.query.limit) || 50;
    const logs = await db.all('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?', [limit]);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9.5. Get all downloaded artifacts list
app.get('/api/artifacts', async (req, res) => {
  try {
    const db = await getDb();
    const artifacts = await db.all('SELECT * FROM artifacts ORDER BY created_at DESC');
    res.json(artifacts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9.6. Download a saved artifact
app.get('/api/artifacts/download/:id', async (req, res) => {
  try {
    const db = await getDb();
    const artifactId = req.params.id;
    
    const artifact = await db.get('SELECT * FROM artifacts WHERE id = ?', [artifactId]);
    if (!artifact) {
      return res.status(404).send('Artifact not found.');
    }
    
    const filePath = artifact.file_path;
    if (!existsSync(filePath)) {
      return res.status(404).send('Artifact file not found on disk.');
    }
    
    // Log the re-download action but do NOT store the artifactId on the resulting log entry
    // to prevent displaying a redundant download button on the re-download log row.
    await logAction(
      artifact.case_id,
      artifact.case_number,
      'Re-download Artifact',
      `Re-downloaded artifact '${artifact.name}'`,
      null
    );
    
    const ext = path.extname(artifact.name).toLowerCase();
    if (ext === '.pdf' || ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp' || ext === '.bmp' || ext === '.tiff') {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(artifact.name)}"`);
      if (ext === '.pdf') {
        res.setHeader('Content-Type', 'application/pdf');
      } else if (ext === '.jpg' || ext === '.jpeg') {
        res.setHeader('Content-Type', 'image/jpeg');
      } else if (ext === '.png') {
        res.setHeader('Content-Type', 'image/png');
      } else if (ext === '.webp') {
        res.setHeader('Content-Type', 'image/webp');
      } else if (ext === '.bmp') {
        res.setHeader('Content-Type', 'image/bmp');
      } else if (ext === '.tiff') {
        res.setHeader('Content-Type', 'image/tiff');
      }
    } else {
      res.attachment(artifact.name);
    }
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Serve frontend static assets from public/ folder (built Vite assets)
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all route to serve the React index.html for SPA router compatibility
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Boot Server
ensureDirs()
  .then(() => {
    const isPipe = typeof PORT === 'string' && PORT.startsWith('\\\\.\\pipe\\');
    if (isPipe) {
      app.listen(PORT, () => {
        console.log(`==================================================`);
        console.log(`  Ayushman PDF Helper backend running on iisnode pipe:`);
        console.log(`    ${PORT}`);
        console.log(`==================================================`);
      });
    } else {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`==================================================`);
        console.log(`  Ayushman PDF Helper backend running on:`);
        console.log(`    - Localhost:       http://localhost:${PORT}`);
        getLocalIPs().forEach(ip => {
          console.log(`    - Local Network:   http://${ip}:${PORT}`);
        });
        console.log(`==================================================`);
      });
    }
  })
  .catch(err => {
    console.error('Failed to initialize directories:', err);
  });
