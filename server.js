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

// Global in-memory progress tracker
export const uploadProgress = new Map();

// Progress check endpoint
app.get('/api/progress/:id', (req, res) => {
  const progress = uploadProgress.get(req.params.id);
  if (!progress) {
    return res.json({ status: 'not_found' });
  }
  res.json(progress);
});

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
export async function compressImageToBuffer(inputPath, targetMaxBytes = 950000, forceGrayscale = false, forceAggressive = false, uploadId = null) {
  let quality = 85;
  
  const metadata = await sharp(inputPath).metadata();
  const originalWidth = metadata.width || 2048;
  
  // Enforce a minimum width floor of 750px (500px if forceAggressive)
  const widthFloor = forceAggressive ? Math.min(originalWidth, 500) : Math.min(originalWidth, 750);
  let width = Math.min(originalWidth, 2048);
  
  let attempts = 0;
  let buffer;
  const useExtremeContrast = targetMaxBytes < 35000;
  let grayscale = forceGrayscale || useExtremeContrast;
  
  while (attempts < 8) {
    let pipeline = sharp(inputPath).resize(width);
    
    if (useExtremeContrast) {
      // Normalize contrast and darken mid-tones to make text pop without destroying photo details
      pipeline = pipeline.normalize().gamma(1.2);
    }
    
    if (grayscale) {
      // .grayscale() converts pixels to gray values.
      // .toColourspace('b-w') forces libvips to treat the pipeline as truly single-channel
      // before handing off to the JPEG encoder. Without this, mozjpeg promotes the image
      // back to 3-channel YCbCr internally, so both paths produce the same file size.
      pipeline = pipeline.grayscale().toColourspace('b-w');
    }

    // Mild sharpen to keep text strokes crisp at lower quality settings.
    // Default params (no args) are intentional — custom params with high m1 inflate
    // JPEG size by sharpening uniform background regions which are high-entropy for DCT.
    pipeline = pipeline.sharpen();
    
    if (grayscale) {
      // Standard libjpeg-turbo (mozjpeg: false) correctly outputs a 1-component grayscale
      // JPEG from a single-channel pipeline. mozjpeg re-promotes to YCbCr before encode,
      // defeating the channel reduction. No extra flags needed — the size reduction
      // comes entirely from .grayscale().toColourspace('b-w') forcing 1-channel output.
      buffer = await pipeline
        .jpeg({ quality })
        .toBuffer();
    } else {
      buffer = await pipeline
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
    }
      
    console.log(`[COMPRESSION] Single image attempt ${attempts}: width=${width}, quality=${quality}, grayscale=${grayscale}, extremeContrast=${useExtremeContrast}, size=${(buffer.length / 1024).toFixed(1)} KB`);

    if (uploadId) {
      uploadProgress.set(uploadId, {
        status: 'compressing',
        attempt: attempts,
        currentSize: buffer.length,
        grayscale: grayscale,
        totalPages: 1
      });
    }

    const minQualityLimit = (forceAggressive || useExtremeContrast) ? 30 : 50;
    if (buffer.length <= targetMaxBytes || (width <= widthFloor && quality <= minQualityLimit)) {
      break;
    }
    
    // Determine how much we overshot to adjust dimensions and quality
    const ratio = buffer.length / targetMaxBytes;
    
    // Aggressive width reductions (scaling down dimensions fast)
    let widthMultiplier = 0.70;
    // Slow quality reductions (preserving sharp text contrast)
    let qualityReduction = 4;
    
    if (ratio > 2.0) {
      widthMultiplier = 0.70;
      qualityReduction = 5;
    } else if (ratio > 1.5) {
      widthMultiplier = 0.76;
      qualityReduction = 4;
    } else if (ratio > 1.2) {
      widthMultiplier = 0.82;
      qualityReduction = 3;
    } else if (ratio > 1.05) {
      widthMultiplier = 0.88;
      qualityReduction = 2;
    } else {
      widthMultiplier = 0.94;
      qualityReduction = 1;
    }
    
    attempts++;
    
    // Decrease dimensions but never scale down past the width readability floor
    width = Math.max(widthFloor, Math.floor(width * widthMultiplier));
    
    // Decrease quality slowly, keeping a floor of 50 (or 30 if aggressive/extremeContrast is active)
    let currentQualityFloor = (forceAggressive || useExtremeContrast) ? 30 : 55;
    if (width <= widthFloor) {
      currentQualityFloor = (forceAggressive || useExtremeContrast) ? 30 : 50;
    }
    quality = Math.max(currentQualityFloor, quality - qualityReduction);
    
    // Trigger grayscale early for multi-page documents to save 40% size, keeping quality high
    if (attempts >= 1 && targetMaxBytes < 300000) {
      grayscale = true;
    } else if (attempts >= 2) {
      grayscale = true;
    }
  }
  
  return buffer;
}

/**
 * Compresses multiple images and compiles them into a single PDF under 1MB.
 */
export async function compressMultipleImagesToPdf(imagePaths, outputPath, forceGrayscale = false, forceAggressive = false, uploadId = null) {
  const N = imagePaths.length;
  
  // 1. Calculate the total budget for all images, leaving room for PDF overhead
  let totalTargetBytes = 950000;
  if (N > 10) {
    totalTargetBytes = Math.max(500000, 950000 - (N * 800)); // leave safety room for large page counts
  }
  
  // 2. Gather original file sizes
  const originalSizes = [];
  let totalOriginalSize = 0;
  for (const imgPath of imagePaths) {
    try {
      const stats = await fs.stat(imgPath);
      originalSizes.push(stats.size);
      totalOriginalSize += stats.size;
    } catch (e) {
      originalSizes.push(500000); // fallback if stat fails
      totalOriginalSize += 500000;
    }
  }
  
  // 3. Distribute budget proportionally with a minimum floor per image (e.g. 35KB max floor, no 10KB minimum floor)
  const minFloor = Math.min(35000, Math.floor((totalTargetBytes * 0.9) / N));
  const reservedBudget = N * minFloor;
  const distributableBudget = Math.max(0, totalTargetBytes - reservedBudget);
  
  const targetBytes = [];
  for (let i = 0; i < N; i++) {
    const proportion = totalOriginalSize > 0 ? (originalSizes[i] / totalOriginalSize) : (1 / N);
    targetBytes.push(Math.floor(minFloor + distributableBudget * proportion));
  }
  
  // 4. Compress each image to its allocated budget and compile into PDF
  let attempts = 0;
  let success = false;
  let pdfBytes;
  
  let budgetScale = 1.0;
  let currentForceGrayscale = forceGrayscale;
  const sizeHistory = [];
  const grayscaleHistory = []; // tracks the grayscale mode used for each attempt in sizeHistory
  
  while (attempts < 6 && !success) {
    const pdfDoc = await PDFDocument.create();
    console.log(`[COMPRESSION] PDF attempt ${attempts}: N=${N}, totalBudget=${(totalTargetBytes * budgetScale / 1024).toFixed(1)} KB, grayscale=${currentForceGrayscale}`);
    
    if (uploadId) {
      uploadProgress.set(uploadId, {
        status: 'compressing',
        attempt: attempts,
        currentSize: pdfBytes ? pdfBytes.length : 0,
        grayscale: currentForceGrayscale,
        totalPages: N,
        processedPages: 0,
        prevAttemptSize: sizeHistory.length > 0 ? sizeHistory[sizeHistory.length - 1] : null,
        prevAttemptGrayscale: sizeHistory.length > 0 ? grayscaleHistory[sizeHistory.length - 1] : null
      });
    }

    try {
      for (let i = 0; i < N; i++) {
        const imgPath = imagePaths[i];
        const imgTargetBytes = Math.floor(targetBytes[i] * budgetScale);
        
        if (uploadId) {
          uploadProgress.set(uploadId, {
            status: 'compressing',
            attempt: attempts,
            currentSize: pdfBytes ? pdfBytes.length : 0,
            grayscale: currentForceGrayscale,
            totalPages: N,
            processedPages: i,
            prevAttemptSize: sizeHistory.length > 0 ? sizeHistory[sizeHistory.length - 1] : null,
            prevAttemptGrayscale: sizeHistory.length > 0 ? grayscaleHistory[sizeHistory.length - 1] : null
          });
        }
        
        // Compress this single image to its proportional budget (uploadId passed as null so it doesn't overwrite overall PDF progress)
        const jpegBuffer = await compressImageToBuffer(imgPath, imgTargetBytes, currentForceGrayscale, forceAggressive, null);
        
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
      const currentSize = pdfBytes.length;
      console.log(`[COMPRESSION] PDF attempt ${attempts} result size: ${(currentSize / 1024).toFixed(1)} KB`);
      
      if (uploadId) {
        uploadProgress.set(uploadId, {
          status: 'compressing',
          attempt: attempts,
          currentSize: currentSize,
          grayscale: currentForceGrayscale,
          totalPages: N,
          processedPages: N,
          prevAttemptSize: sizeHistory.length > 0 ? sizeHistory[sizeHistory.length - 1] : null,
          prevAttemptGrayscale: sizeHistory.length > 0 ? grayscaleHistory[sizeHistory.length - 1] : null
        });
      }

      if (currentSize <= 1000000) {
        await fs.writeFile(outputPath, pdfBytes);
        success = true;
        break;
      }
      
      // Loop-stuck check: if size change is negligible but still above 1MB (readability limits reached)
      if (sizeHistory.length > 0) {
        const prevSize = sizeHistory[sizeHistory.length - 1];
        const sizeDiff = Math.abs(currentSize - prevSize);
        const percentChange = sizeDiff / prevSize;
        
        if (currentSize > 1000000) {
          const isVirtuallyUnchanged = sizeDiff < 100;
          const isNegligibleReduction = currentSize > 1010000 && (sizeDiff < 10240 || percentChange < 0.01);
          
          if (isVirtuallyUnchanged || isNegligibleReduction) {
            console.log(`[COMPRESSION] PDF size is stuck/negligible reduction at ${(currentSize / 1024).toFixed(1)} KB (diff: ${(sizeDiff / 1024).toFixed(1)} KB, change: ${(percentChange * 100).toFixed(2)}%).`);
            if (forceAggressive) {
              // In aggressive mode: save the best-effort file instead of cancelling the upload
              console.log(`[COMPRESSION] Aggressive mode: saving best-effort PDF at ${(currentSize / 1024).toFixed(1)} KB.`);
              break; // exits while loop, hits the !success path which writes the file
            } else {
              const err = new Error('oversized_legible');
              err.currentSize = currentSize;
              throw err;
            }
          }
        }
      }
      sizeHistory.push(currentSize);
      grayscaleHistory.push(currentForceGrayscale);

      const ratio = currentSize / 1000000;
      attempts++;
      
      if (N > 10 && !currentForceGrayscale && (attempts >= 1 || ratio > 1.3)) {
        currentForceGrayscale = true;
        console.log(`[COMPRESSION] PDF overshot. Enabling grayscale fallback.`);
        continue;
      }
      
      budgetScale = budgetScale * Math.min(0.95, 1.0 / ratio);
      
    } catch (err) {
      if (err.message === 'oversized_legible') {
        throw err;
      }
      console.error(`[COMPRESSION] PDF build attempt ${attempts} failed:`, err);
      attempts++;
      budgetScale = budgetScale * 0.85;
    }
  }
  
  if (!success) {
    if (pdfBytes) {
      // Save best-effort PDF even if over 1MB — caller decides whether to warn user
      await fs.writeFile(outputPath, pdfBytes);
      return { oversized: true, finalSize: pdfBytes.length };
    } else {
      throw new Error('Failed to generate PDF document.');
    }
  }
  return { oversized: false, finalSize: pdfBytes ? pdfBytes.length : 0 };
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
    const { name, forceGrayscale } = req.body;
    const isGrayscale = !!forceGrayscale;
    
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
    
    // Save to artifacts directory
    const artifactId = uuidv4();
    const artifactsDir = path.join(STORAGE_DIR, 'artifacts');
    await fs.mkdir(artifactsDir, { recursive: true });
    
    const artifactPath = path.join(artifactsDir, `${artifactId}${ext}`);
    
    if (isGrayscale) {
      // Compile on-the-fly directly to artifactPath in grayscale
      const images = await db.all(
        'SELECT stored_filename FROM case_images WHERE case_id = ? ORDER BY display_order ASC',
        [caseId]
      );
      
      if (!images || images.length === 0) {
        return res.status(404).send('No images found in this case to compile.');
      }
      
      const caseOriginalsDir = path.join(COLLECTIONS_DIR, caseId, 'originals');
      const originalPaths = images.map(img => path.join(caseOriginalsDir, img.stored_filename));
      
      if (caseData.optimized_file_type === 'pdf') {
        await compressMultipleImagesToPdf(originalPaths, artifactPath, true);
      } else {
        const compressedBuffer = await compressImageToBuffer(originalPaths[0], 950000, true);
        await fs.writeFile(artifactPath, compressedBuffer);
      }
      console.log(`Generated on-the-fly grayscale optimized file at ${artifactPath}`);
    } else {
      // Standard flow: Use cache if it exists, or self-heal/regenerate standard (color)
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
      
      await fs.copyFile(optimizedPath, artifactPath);
    }
    
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
  let caseId = null;
  try {
    const { case_number, force_grayscale, upload_id, force_aggressive } = req.body;
    const isGrayscale = force_grayscale === 'true';
    const isAggressive = force_aggressive === 'true';
    
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
    
    caseId = uuidv4();
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
    
    let oversizedWarning = false;

    if (files.length === 1) {
      optFileType = 'jpg';
      optFileName = `${caseNumStr}.jpg`;
      optPath = path.join(caseOptimizedDir, optFileName);
      const compressedBuffer = await compressImageToBuffer(originalPathsOnDisk[0], 950000, isGrayscale, isAggressive, upload_id);
      
      if (compressedBuffer.length > 1000000) {
        if (!isAggressive) {
          // Standard mode: cancel upload, let user retry with aggressive
          const err = new Error('oversized_legible');
          err.currentSize = compressedBuffer.length;
          throw err;
        }
        // Aggressive mode: save best-effort, warn user
        oversizedWarning = true;
        console.log(`[COMPRESSION] Aggressive mode single-image: saving best-effort at ${(compressedBuffer.length / 1024).toFixed(1)} KB.`);
      }
      
      await fs.writeFile(optPath, compressedBuffer);
    } else {
      optFileType = 'pdf';
      optFileName = `${caseNumStr}.pdf`;
      optPath = path.join(caseOptimizedDir, optFileName);
      const pdfResult = await compressMultipleImagesToPdf(originalPathsOnDisk, optPath, isGrayscale, isAggressive, upload_id);
      if (pdfResult && pdfResult.oversized) {
        oversizedWarning = true;
      }
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

    if (upload_id) {
      uploadProgress.delete(upload_id);
    }
    
    res.json({
      success: true,
      caseId,
      caseNumber: caseNumStr,
      fileType: optFileType,
      sizeBytes: optSize,
      oversizedWarning  // true when best-effort file exceeds 1MB after aggressive compression
    });
    
  } catch (error) {
    console.error('Upload handler error:', error);
    // Cleanup uploaded temp files on error
    for (const file of uploadedFiles) {
      await fs.unlink(file.path).catch(() => {});
    }
    // Cleanup original files if case was aborted due to oversized legible limits
    if (caseId) {
      const caseDir = path.join(COLLECTIONS_DIR, caseId);
      await fs.rm(caseDir, { recursive: true, force: true }).catch(() => {});
    }
    const { upload_id } = req.body;
    if (upload_id) {
      uploadProgress.delete(upload_id);
    }
    if (error.message === 'oversized_legible') {
      return res.status(422).json({
        error: 'oversized_legible',
        message: 'This case cannot fit under 1MB while keeping document text legible.',
        sizeBytes: error.currentSize
      });
    }
    res.status(400).json({ error: error.message });
  }
});

// 7.5. Add photos to an existing Case
app.post('/api/cases/:id/add-images', upload.array('files'), async (req, res) => {
  let uploadedFiles = [];
  const imageRecords = [];
  const caseId = req.params.id;
  try {
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
    
    // Begin atomic transaction
    await db.run('BEGIN TRANSACTION');
    try {
      for (const record of imageRecords) {
        await db.run(
          `INSERT INTO case_images (id, case_id, original_filename, stored_filename, file_size, display_order, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [record.id, record.case_id, record.original_filename, record.stored_filename, record.file_size, record.display_order, record.created_at]
        );
      }
      
      // Get all images of the case (both existing and new) to regenerate optimized bundle
      const allImages = await db.all(
        'SELECT stored_filename FROM case_images WHERE case_id = ? ORDER BY display_order ASC',
        [caseId]
      );
      const allPaths = allImages.map(img => path.join(caseOriginalsDir, img.stored_filename));
      
      // Delete existing optimized file
      const oldFileName = caseData.optimized_file_type === 'pdf'
        ? `${caseData.case_number}.pdf`
        : `${caseData.case_number}.jpg`;
      await fs.unlink(path.join(caseOptimizedDir, oldFileName)).catch(() => {});
      
      // Compile optimized package (under 1MB)
      let optFileType = 'jpg';
      let optFileName = '';
      let optPath = '';
      
      const { upload_id, force_aggressive } = req.body;
      const isAggressive = force_aggressive === 'true';

      let oversizedWarning = false;

      if (allPaths.length === 1) {
        optFileType = 'jpg';
        optFileName = `${caseData.case_number}.jpg`;
        optPath = path.join(caseOptimizedDir, optFileName);
        const compressedBuffer = await compressImageToBuffer(allPaths[0], 950000, false, isAggressive, upload_id);
        
        if (compressedBuffer.length > 1000000) {
          if (!isAggressive) {
            const err = new Error('oversized_legible');
            err.currentSize = compressedBuffer.length;
            throw err;
          }
          oversizedWarning = true;
          console.log(`[COMPRESSION] Aggressive mode single-image: saving best-effort at ${(compressedBuffer.length / 1024).toFixed(1)} KB.`);
        }
        
        await fs.writeFile(optPath, compressedBuffer);
      } else {
        optFileType = 'pdf';
        optFileName = `${caseData.case_number}.pdf`;
        optPath = path.join(caseOptimizedDir, optFileName);
        const pdfResult = await compressMultipleImagesToPdf(allPaths, optPath, false, isAggressive, upload_id);
        if (pdfResult && pdfResult.oversized) {
          oversizedWarning = true;
        }
      }
      
      const optStats = await fs.stat(optPath);
      const optSize = optStats.size;
      
      // Update case metadata
      await db.run(
        `UPDATE cases SET image_count = ?, optimized_file_size = ?, optimized_file_type = ?, modified_at = ? WHERE id = ?`,
        [allPaths.length, optSize, optFileType, new Date().toISOString(), caseId]
      );
      
      await db.run('COMMIT');
      
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

      if (upload_id) {
        uploadProgress.delete(upload_id);
      }
      
      res.json({
        success: true,
        caseId,
        imageCount: allPaths.length,
        fileType: optFileType,
        sizeBytes: optSize,
        oversizedWarning
      });

    } catch (innerErr) {
      await db.run('ROLLBACK');
      
      // Clean up newly copied original files on disk to prevent orphaned files
      const caseOriginalsDir = path.join(COLLECTIONS_DIR, caseId, 'originals');
      for (const record of imageRecords) {
        const destPath = path.join(caseOriginalsDir, record.stored_filename);
        await fs.unlink(destPath).catch(() => {});
      }
      
      throw innerErr;
    }
  } catch (error) {
    console.error('Add photos handler error:', error);
    for (const file of uploadedFiles) {
      await fs.unlink(file.path).catch(() => {});
    }
    const { upload_id } = req.body;
    if (upload_id) {
      uploadProgress.delete(upload_id);
    }
    if (error.message === 'oversized_legible') {
      return res.status(422).json({
        error: 'oversized_legible',
        message: 'This case cannot fit under 1MB while keeping document text legible.',
        sizeBytes: error.currentSize
      });
    }
    res.status(400).json({ error: error.message });
  }
});

// 8. Custom Downloader (ZIP or PDF bundle of selected page indexes, high-res or optimized)
app.post('/api/cases/:id/download-bundle', async (req, res) => {
  try {
    const db = await getDb();
    const caseId = req.params.id;
    const { imageIds, format, quality, name, forceGrayscale } = req.body; // imageIds = [], format = 'zip'|'pdf'|'jpg', quality = 'original'|'optimized-1mb', name = string, forceGrayscale = boolean
    const isGrayscale = !!forceGrayscale;
    
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
        if (isGrayscale) {
          const compBuffer = await sharp(srcPath).grayscale().toColourspace('b-w').jpeg().toBuffer();
          await fs.writeFile(artifactPath, compBuffer);
        } else {
          await fs.copyFile(srcPath, artifactPath);
        }
      } else {
        const compBuffer = await compressImageToBuffer(srcPath, 950000, isGrayscale);
        await fs.writeFile(artifactPath, compBuffer);
      }
    } 
    
    else if (format === 'pdf') {
      if (quality === 'original') {
        const pdfDoc = await PDFDocument.create();
        for (const filePath of filePaths) {
          let pipeline = sharp(filePath);
          if (isGrayscale) {
            pipeline = pipeline.grayscale().toColourspace('b-w');
          }
          const jpegBuffer = await pipeline.jpeg({ quality: 90 }).toBuffer();
          const pdfImage = await pdfDoc.embedJpg(jpegBuffer);
          const page = pdfDoc.addPage([pdfImage.width, pdfImage.height]);
          page.drawImage(pdfImage, { x: 0, y: 0, width: pdfImage.width, height: pdfImage.height });
        }
        const pdfBytes = await pdfDoc.save();
        await fs.writeFile(artifactPath, pdfBytes);
      } else {
        await compressMultipleImagesToPdf(filePaths, artifactPath, isGrayscale, true);
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
          if (isGrayscale) {
            const compBuffer = await sharp(filePath).grayscale().toColourspace('b-w').jpeg().toBuffer();
            archive.append(compBuffer, { name: img.original_filename });
          } else {
            archive.file(filePath, { name: img.original_filename });
          }
        } else {
          const targetBytesPerImage = Math.floor(900000 / sortedImages.length);
          const compBuffer = await compressImageToBuffer(filePath, targetBytesPerImage, isGrayscale);
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
