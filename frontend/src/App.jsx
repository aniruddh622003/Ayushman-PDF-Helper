import React, { useState, useEffect, useRef } from 'react';
import { 
  UploadCloud, 
  FolderOpen, 
  Activity, 
  HardDrive, 
  Search, 
  RefreshCw, 
  X, 
  Image, 
  FileText, 
  Check, 
  AlertCircle, 
  CheckCircle2, 
  Download, 
  Network,
  Calendar,
  Layers,
  ChevronRight,
  ListFilter,
  Trash2
} from 'lucide-react';
import './App.css';

function App() {
  // Tabs & Navigation
  const [activeTab, setActiveTab] = useState('upload');
  
  // Dashboard Status
  const [systemStatus, setSystemStatus] = useState({
    casesCount: 0,
    logsCount: 0,
    storageSize: '0.00 MB',
    localIPs: [],
    port: 3000
  });

  // Alerts
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Upload Panel State
  const [caseNumber, setCaseNumber] = useState('');
  const [uploadFiles, setUploadFiles] = useState([]);
  const [forceGrayscale, setForceGrayscale] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatusText, setUploadStatusText] = useState('');
  const dragDropRef = useRef(null);
  const fileInputRef = useRef(null);

  // Browse Directory State
  const [searchQuery, setSearchQuery] = useState('');
  const [casesList, setCasesList] = useState([]);
  const [totalCases, setTotalCases] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingCases, setLoadingCases] = useState(false);
  const casesLimit = 15;

  // Selected Case Detail View State
  const [selectedCase, setSelectedCase] = useState(null);
  const [selectedImages, setSelectedImages] = useState([]);
  const [modalTab, setModalTab] = useState('photos');
  
  // Download Bundle Dialog State
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState('zip');
  const [downloadQuality, setDownloadQuality] = useState('original');
  const [bundling, setBundling] = useState(false);

  // New States for Artifacts, Naming, and Add Photos
  const [browseSubTab, setBrowseSubTab] = useState('photos');
  const [artifactsList, setArtifactsList] = useState([]);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);
  
  const [namingModalOpen, setNamingModalOpen] = useState(false);
  const [namingTargetCase, setNamingTargetCase] = useState(null);
  const [namingArtifactName, setNamingArtifactName] = useState('');
  const [downloadingOptimized, setDownloadingOptimized] = useState(false);
  const [downloadGrayscale, setDownloadGrayscale] = useState(false);
  
  const [bundleArtifactName, setBundleArtifactName] = useState('');
  const [bundleGrayscale, setBundleGrayscale] = useState(false);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [uploadProgressInfo, setUploadProgressInfo] = useState(null);
  const [oversizedError, setOversizedError] = useState(null);  // for 422 non-aggressive failures
  const [oversizedWarning, setOversizedWarning] = useState(null); // for saved-but-over-1MB warnings

  // Logs state
  const [systemLogs, setSystemLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Initial loads
  useEffect(() => {
    fetchSystemStatus();
    fetchCases();
    fetchArtifacts();
    fetchLogs();
    
    // Auto-refresh stats and logs periodically
    const interval = setInterval(() => {
      fetchSystemStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Fetch lists when page or search query changes
  useEffect(() => {
    fetchCases();
  }, [currentPage, searchQuery]);

  // Helper alert triggers
  const showSuccess = (msg) => {
    setSuccessMessage(msg);
    setErrorMessage('');
    setTimeout(() => setSuccessMessage(''), 5000);
  };

  const showError = (msg) => {
    setErrorMessage(msg);
    setSuccessMessage('');
    setTimeout(() => setErrorMessage(''), 6000);
  };

  // ----------------------------------------------------
  // API Request Functions
  // ----------------------------------------------------

  const fetchSystemStatus = async () => {
    try {
      const res = await fetch('/api/system/status');
      if (res.ok) {
        const data = await res.json();
        setSystemStatus(data);
      }
    } catch (err) {
      console.error('Error fetching system status:', err);
    }
  };

  const fetchCases = async () => {
    setLoadingCases(true);
    try {
      const offset = (currentPage - 1) * casesLimit;
      const res = await fetch(`/api/cases?search=${encodeURIComponent(searchQuery)}&limit=${casesLimit}&offset=${offset}`);
      if (res.ok) {
        const data = await res.json();
        setCasesList(data.cases);
        setTotalCases(data.totalCount);
      }
    } catch (err) {
      console.error('Error fetching patient cases:', err);
    } finally {
      setLoadingCases(false);
    }
  };

  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch('/api/logs?limit=50');
      if (res.ok) {
        const data = await res.json();
        setSystemLogs(data);
      }
    } catch (err) {
      console.error('Error fetching logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  const fetchArtifacts = async () => {
    setLoadingArtifacts(true);
    try {
      const res = await fetch('/api/artifacts');
      if (res.ok) {
        const data = await res.json();
        setArtifactsList(data);
      }
    } catch (err) {
      console.error('Error fetching artifacts:', err);
    } finally {
      setLoadingArtifacts(false);
    }
  };

  const handleCaseSelect = async (caseId) => {
    try {
      const res = await fetch(`/api/cases/${caseId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedCase(data);
        setSelectedImages([]); // reset selections
        setModalTab('photos'); // Reset modal tab
        
        // Auto set default download format based on images quantity
        if (data.images.length === 1) {
          setDownloadFormat('jpg');
        } else {
          setDownloadFormat('zip');
        }
      } else {
        showError('Could not load case details.');
      }
    } catch (err) {
      showError('Error connecting to server.');
    }
  };

  // ----------------------------------------------------
  // Drag and Drop Uploader Logic
  // ----------------------------------------------------

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragDropRef.current) {
      dragDropRef.current.classList.add('active');
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragDropRef.current) {
      dragDropRef.current.classList.remove('active');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragDropRef.current) {
      dragDropRef.current.classList.remove('active');
    }
    
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    processFiles(files);
  };

  const processFiles = (files) => {
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff'];
    const validFiles = files.filter(file => {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      return allowedExtensions.includes(ext);
    });
    
    if (validFiles.length < files.length) {
      showError('Some files were filtered out. Only image formats (JPG, PNG, BMP, WEBP, TIFF) are allowed.');
    }
    
    // Add local preview URL only for the first 12 files to prevent Chrome Out of Memory crashes
    const currentQueueCount = uploadFiles.length;
    const filesWithPreviews = validFiles.map((file, idx) => {
      if (currentQueueCount + idx < 12) {
        file.previewUrl = URL.createObjectURL(file);
      } else {
        file.previewUrl = null;
      }
      return file;
    });

    setUploadFiles(prev => [...prev, ...filesWithPreviews]);
  };

  const removeFileFromQueue = (index) => {
    setUploadFiles(prev => {
      const updated = [...prev];
      // Revoke URL if it exists
      if (updated[index].previewUrl) {
        URL.revokeObjectURL(updated[index].previewUrl);
      }
      updated.splice(index, 1);
      
      // Dynamically generate previews for next-in-line files if we are now under 12 previews
      for (let i = 0; i < updated.length; i++) {
        if (i < 12 && !updated[i].previewUrl) {
          updated[i].previewUrl = URL.createObjectURL(updated[i]);
        }
      }
      return updated;
    });
  };

  const clearQueue = () => {
    uploadFiles.forEach(file => {
      if (file.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }
    });
    setUploadFiles([]);
  };

  // Validate patient case number (must be 5 to 32 digits/alphanumeric, target recommended is 20)
  const isCaseNumberValid = () => {
    const val = caseNumber.trim();
    return val.length >= 5 && val.length <= 32;
  };

  const isCaseNumberDigitsOnly = () => {
    return /^\d+$/.test(caseNumber.trim());
  };

  const pollProgress = (uploadId, setStatusText, setProgressInfo) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/progress/${uploadId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'compressing') {
            setProgressInfo(data);
            const sizeStr = data.currentSize > 0 ? `(${(data.currentSize / 1024).toFixed(1)} KB)` : '';
            const grayStr = data.grayscale ? 'Grayscale' : 'Color';
            const pageInfo = data.totalPages > 1 ? `Page compilation` : `Image processing`;
            setStatusText(`${pageInfo} in progress... Attempt ${data.attempt + 1} [${grayStr}] ${sizeStr}`);
          }
        }
      } catch (e) {
        // Silent error for progress endpoints
      }
    }, 800);
    return interval;
  };

  const handleUploadSubmit = async (e, forceAggressive = false) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!isCaseNumberValid()) {
      showError('Please enter a valid Patient Case Number (5 to 32 characters).');
      return;
    }
    if (uploadFiles.length === 0) {
      showError('Please select or drag images to upload.');
      return;
    }
    
    // Guard check to prevent Denial of Service (DOS) or system lockup
    if (uploadFiles.length > 150 && !forceAggressive) {
      const totalMB = (uploadFiles.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(1);
      const proceed = window.confirm(
        `⚠️ LARGE BATCH WARNING:\nYou are attempting to upload ${uploadFiles.length} files (${totalMB} MB).\n\n` +
        `Compiling this many documents into a single PDF under 1MB requires heavy image processing and can take up to 30-45 seconds.\n\n` +
        `Do you want to proceed?`
      );
      if (!proceed) return;
    }

    setUploading(true);
    setUploadProgressInfo(null);
    const activeUploadId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    setUploadStatusText('Uploading images to server...');
    
    const formData = new FormData();
    formData.append('case_number', caseNumber.trim());
    formData.append('force_grayscale', forceGrayscale);
    formData.append('upload_id', activeUploadId);
    if (forceAggressive) {
      formData.append('force_aggressive', 'true');
    }
    
    uploadFiles.forEach(file => {
      formData.append('files', file);
    });

    let progressInterval = pollProgress(activeUploadId, setUploadStatusText, setUploadProgressInfo);

    try {
      const res = await fetch('/api/cases/upload', {
        method: 'POST',
        body: formData
      });

      clearInterval(progressInterval);

      const data = await res.json();
      
      if (res.ok) {
        const sizeTxt = `${(data.sizeBytes / 1024).toFixed(1)} KB`;
        if (data.oversizedWarning) {
          // Case saved but PDF is still over 1MB even after aggressive compression
          setOversizedWarning({
            caseNumber: caseNumber.trim(),
            caseId: data.caseId,
            sizeBytes: data.sizeBytes,
            fileType: data.fileType
          });
          fetchSystemStatus();
          fetchCases();
          fetchLogs();
          setOversizedError(null);
          setCaseNumber('');
          clearQueue();
          setActiveTab('browse');
        } else {
          showSuccess(`Case '${caseNumber}' created successfully! Optimized ${data.fileType.toUpperCase()} file size is ${sizeTxt}.`);
          setCaseNumber('');
          clearQueue();
          fetchSystemStatus();
          fetchCases();
          fetchLogs();
          setOversizedError(null);
          setActiveTab('browse');
        }
      } else if (res.status === 422 && data.error === 'oversized_legible') {
        // Standard (non-aggressive) limit hit — ask user to retry with aggressive
        setOversizedError({
          caseNumber: caseNumber.trim(),
          files: uploadFiles,
          sizeBytes: data.sizeBytes,
          isGrayscale: forceGrayscale,
          isAddPhotos: false,
          isAggressive: forceAggressive
        });
      } else {
        showError(data.error || 'Failed to process case upload.');
      }
    } catch (err) {
      clearInterval(progressInterval);
      showError('Server connection failed during upload processing.');
    } finally {
      setUploading(false);
      setUploadStatusText('');
      setUploadProgressInfo(null);
    }
  };

  // ----------------------------------------------------
  // Extraction & Custom Bundle Downloads
  // ----------------------------------------------------

  const handleImageToggle = (imageId) => {
    setSelectedImages(prev => {
      if (prev.includes(imageId)) {
        return prev.filter(id => id !== imageId);
      } else {
        return [...prev, imageId];
      }
    });
  };

  const handleSelectAllImages = () => {
    if (!selectedCase) return;
    if (selectedImages.length === selectedCase.images.length) {
      setSelectedImages([]); // Deselect all
    } else {
      setSelectedImages(selectedCase.images.map(img => img.id)); // Select all
    }
  };

  const openDownloadModal = () => {
    if (selectedImages.length === 0) {
      showError('Select at least one page/image to download.');
      return;
    }
    
    // Default formatting rules based on selection count
    if (selectedImages.length === 1) {
      setDownloadFormat('jpg');
    } else {
      setDownloadFormat('zip');
    }
    
    setBundleArtifactName(`${selectedCase.case.case_number}_bundle`);
    setBundleGrayscale(false);
    setDownloadModalOpen(true);
  };

  const handleOpenNamingModal = (caseItem) => {
    setNamingTargetCase(caseItem);
    setNamingArtifactName(`${caseItem.case_number}_optimized`);
    setDownloadGrayscale(false);
    setNamingModalOpen(true);
  };

  const handleDownloadOptimized = async (e) => {
    e.preventDefault();
    if (!namingArtifactName.trim()) {
      showError('Please enter a valid artifact name.');
      return;
    }
    
    setDownloadingOptimized(true);
    try {
      const caseId = namingTargetCase.id;
      const res = await fetch(`/api/cases/${caseId}/download-optimized`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          name: namingArtifactName.trim(),
          forceGrayscale: downloadGrayscale
        })
      });
      
      if (!res.ok) {
        throw new Error('Failed to download optimized file.');
      }
      
      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = `${namingTargetCase.case_number}_optimized.pdf`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) {
          filename = decodeURIComponent(match[1]);
        }
      }
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      showSuccess(`Optimized file downloaded as '${filename}'.`);
      setNamingModalOpen(false);
      
      // Refresh list of artifacts and logs
      fetchArtifacts();
      fetchLogs();
      fetchSystemStatus();
      if (selectedCase && selectedCase.case.id === caseId) {
        handleCaseSelect(caseId); // Refresh modal view
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setDownloadingOptimized(false);
    }
  };

  const handleAddPhotos = async (e, forceAggressive = false, retryFiles = null) => {
    let files;
    if (e && e.target && e.target.files) {
      files = Array.from(e.target.files);
    } else {
      files = retryFiles;
    }
    
    if (!files || files.length === 0) return;
    
    let validFiles = files;
    if (e && e.target && e.target.files) {
      const allowedExtensions = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff'];
      validFiles = files.filter(file => {
        const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
        return allowedExtensions.includes(ext);
      });
      
      if (validFiles.length < files.length) {
        showError('Some files were filtered out. Only image formats are allowed.');
      }
      
      if (validFiles.length === 0) return;
    }
    
    setAddingPhotos(true);
    setUploadProgressInfo(null);
    setUploadStatusText('Uploading new images...');
    const activeUploadId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    
    const formData = new FormData();
    validFiles.forEach(file => {
      formData.append('files', file);
    });
    formData.append('upload_id', activeUploadId);
    if (forceAggressive) {
      formData.append('force_aggressive', 'true');
    }
    
    let progressInterval = pollProgress(activeUploadId, setUploadStatusText, setUploadProgressInfo);
    
    try {
      const caseId = selectedCase.case.id;
      const res = await fetch(`/api/cases/${caseId}/add-images`, {
        method: 'POST',
        body: formData
      });
      
      clearInterval(progressInterval);
      const data = await res.json();
      
      if (res.ok) {
        if (data.oversizedWarning) {
          setOversizedWarning({
            caseNumber: selectedCase.case.case_number,
            caseId,
            sizeBytes: data.sizeBytes,
            fileType: data.fileType
          });
        } else {
          showSuccess(`Added ${validFiles.length} photos successfully.`);
        }
        handleCaseSelect(caseId);
        fetchSystemStatus();
        fetchCases();
        fetchLogs();
        setOversizedError(null);
      } else if (res.status === 422 && data.error === 'oversized_legible') {
        setOversizedError({
          caseNumber: selectedCase.case.case_number,
          files: validFiles,
          sizeBytes: data.sizeBytes,
          isGrayscale: false,
          isAddPhotos: true,
          targetCaseId: caseId,
          isAggressive: forceAggressive
        });
      } else {
        showError(data.error || 'Failed to add photos.');
      }
    } catch (err) {
      clearInterval(progressInterval);
      showError('Server connection failed while adding photos.');
    } finally {
      setAddingPhotos(false);
      setUploadStatusText('');
      setUploadProgressInfo(null);
    }
  };

  const executeBundleDownload = async () => {
    if (!bundleArtifactName.trim()) {
      showError('Please enter a valid artifact name.');
      return;
    }
    setBundling(true);
    try {
      const response = await fetch(`/api/cases/${selectedCase.case.id}/download-bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageIds: selectedImages,
          format: downloadFormat,
          quality: downloadQuality,
          name: bundleArtifactName.trim(),
          forceGrayscale: bundleGrayscale
        })
      });
      
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to bundle and download images.');
      }
      
      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `extract-${selectedCase.case.case_number}.${downloadFormat}`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) {
          filename = decodeURIComponent(match[1]);
        }
      }

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      showSuccess(`Custom bundle '${filename}' downloaded successfully.`);
      setDownloadModalOpen(false);
      
      fetchSystemStatus();
      fetchLogs();
      fetchArtifacts();
      handleCaseSelect(selectedCase.case.id);
    } catch (err) {
      showError(err.message);
    } finally {
      setBundling(false);
    }
  };

  const groupItemsByDate = (items, dateField = 'created_at') => {
    const getGroupHeader = (dateStr) => {
      const dateObj = new Date(dateStr);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      
      if (dateObj.toDateString() === today.toDateString()) {
        return 'Today';
      } else if (dateObj.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
      } else {
        return dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      }
    };

    const groups = {};
    items.forEach(item => {
      const dateStr = item[dateField] || item.created_at || item.timestamp;
      if (!dateStr) return;
      
      const key = new Date(dateStr).toDateString();
      if (!groups[key]) {
        groups[key] = {
          title: getGroupHeader(dateStr),
          date: new Date(dateStr),
          items: []
        };
      }
      groups[key].items.push(item);
    });
    
    return Object.values(groups).sort((a, b) => b.date - a.date);
  };

  const renderProgressContent = () => {
    const info = uploadProgressInfo;
    const prevSizeKB = info?.prevAttemptSize ? (info.prevAttemptSize / 1024).toFixed(1) : null;
    const currSizeKB = info?.currentSize > 0 ? (info.currentSize / 1024).toFixed(1) : null;
    // Detect a color→grayscale transition: previous attempt was color, current is grayscale
    const wasColorNowGray = info && info.grayscale && info.prevAttemptGrayscale === false;

    return (
      <>
        <div className="spinner"></div>
        {info ? (
          <div className="progress-details" style={{ width: '100%', maxWidth: '400px', marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center' }}>
            <div className="progress-title" style={{ fontWeight: 600, fontSize: '1.1rem' }}>
              PDF Attempt {info.attempt + 1}
              <span style={{
                marginLeft: '0.5rem',
                fontSize: '0.8rem',
                fontWeight: 500,
                padding: '0.15rem 0.5rem',
                borderRadius: '4px',
                background: info.grayscale ? 'rgba(107,114,128,0.25)' : 'rgba(59,130,246,0.2)',
                color: info.grayscale ? '#9ca3af' : '#60a5fa'
              }}>
                {info.grayscale ? '⬛ Grayscale' : '🎨 Color'}
              </span>
            </div>
            
            {info.totalPages > 1 && (
              <div className="progress-bar-container" style={{ width: '100%', background: 'rgba(255,255,255,0.1)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                <div 
                  className="progress-bar-fill" 
                  style={{ 
                    width: `${Math.min(100, Math.round((info.processedPages / info.totalPages) * 100))}%`, 
                    background: info.grayscale ? '#6b7280' : 'var(--primary)', 
                    height: '100%',
                    transition: 'width 0.3s ease' 
                  }}
                ></div>
              </div>
            )}
            
            <div className="progress-stats" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {info.totalPages > 1 ? (
                <span>Processed {info.processedPages} of {info.totalPages} pages {currSizeKB ? `— ${currSizeKB} KB so far` : ''}</span>
              ) : (
                <span>Processing single image...</span>
              )}
            </div>
            
            {prevSizeKB && (
              wasColorNowGray ? (
                // Special callout: shows size drop from switching color→grayscale
                <div style={{ fontSize: '0.8rem', width: '100%', background: 'rgba(107,114,128,0.12)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(107,114,128,0.25)' }}>
                  <div style={{ color: '#9ca3af', marginBottom: '0.3rem', fontWeight: 600 }}>🔄 Switching to Grayscale</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ color: '#60a5fa' }}>Color: <strong>{prevSizeKB} KB</strong></span>
                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                    <span style={{ color: '#9ca3af' }}>Grayscale attempt in progress...</span>
                  </div>
                </div>
              ) : (
                <div className="prev-attempt-info" style={{ fontSize: '0.8rem', color: 'var(--warning)', background: 'rgba(245, 158, 11, 0.1)', padding: '0.35rem 0.75rem', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                  Previous attempt ({info.prevAttemptGrayscale ? '⬛ Grayscale' : '🎨 Color'}): <strong>{prevSizeKB} KB</strong>
                </div>
              )
            )}
          </div>
        ) : (
          <div className="progress-text">{uploadStatusText || 'Initializing...'}</div>
        )}
        <div className="progress-subtext" style={{ marginTop: '0.5rem' }}>Optimising and sizing down to comply strictly with the 1MB portal limit.</div>
      </>
    );
  };

  return (
    <div className="app-container">
      {/* Header section */}
      <header className="app-header">
        <div className="logo-section">
          <h1>Ayushman PDF Helper</h1>
          <p>By Debug Informatics Pvt Ltd</p>
        </div>
        <div className="system-status-pill">
          <div className="status-dot"></div>
          <span>Server Online</span>
          <span style={{ color: 'var(--text-muted)' }}>|</span>
          <span>Port: {systemStatus.port}</span>
        </div>
      </header>

      {/* Dashboard metrics */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon-wrapper">
            <Layers size={22} />
          </div>
          <div className="stat-info">
            <div className="stat-value">{systemStatus.casesCount}</div>
            <div className="stat-label">Total Patient Cases</div>
          </div>
        </div>
        <div className="stat-card success">
          <div className="stat-icon-wrapper">
            <HardDrive size={22} />
          </div>
          <div className="stat-info">
            <div className="stat-value">{systemStatus.storageSize}</div>
            <div className="stat-label">Disk Storage Used</div>
          </div>
        </div>
        <div className="stat-card warning">
          <div className="stat-icon-wrapper">
            <Activity size={22} />
          </div>
          <div className="stat-info">
            <div className="stat-value">{systemStatus.logsCount}</div>
            <div className="stat-label">Audit Logs Logged</div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      <div className="alerts-container">
        {successMessage && (
          <div className="alert alert-success">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={18} />
              <span>{successMessage}</span>
            </div>
            <button className="btn-alert-close" onClick={() => setSuccessMessage('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {errorMessage && (
          <div className="alert alert-error">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={18} />
              <span>{errorMessage}</span>
            </div>
            <button className="btn-alert-close" onClick={() => setErrorMessage('')}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Tab Buttons & Server IP Navigation */}
      <div className="tab-navigation">
        <div className="tab-buttons">
          <button 
            className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            <UploadCloud size={18} />
            Upload New Case
          </button>
          <button 
            className={`tab-btn ${activeTab === 'browse' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('browse');
              fetchCases();
            }}
          >
            <FolderOpen size={18} />
            Browse Cases Directory
          </button>
          <button 
            className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('logs');
              fetchLogs();
            }}
          >
            <Activity size={18} />
            Intranet Audit Logs
          </button>
        </div>
        
        {systemStatus.localIPs && systemStatus.localIPs.length > 0 && (
          <div className="server-ip-info">
            <Network size={16} />
            Local Network Sharing: 
            <span>http://{systemStatus.localIPs[0]}:{systemStatus.port}</span>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------
          UPLOAD NEW CASE TAB
         ---------------------------------------------------- */}
      {activeTab === 'upload' && (
        <div className="glass-panel">
          <h2 className="panel-title">
            <UploadCloud size={20} style={{ color: 'var(--primary)' }} />
            Compile & Optimise Patient Case Files
          </h2>
          
          {uploading ? (
            <div className="progress-overlay">
              {renderProgressContent()}
            </div>
          ) : (
            <form onSubmit={handleUploadSubmit} className="upload-form-grid">
              <div className="form-controls">
                <div className="form-group">
                  <label htmlFor="case-number">Patient Case Number</label>
                  <input 
                    type="text" 
                    id="case-number"
                    className="input-text"
                    placeholder="Enter Patient Case ID"
                    value={caseNumber}
                    onChange={(e) => setCaseNumber(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
                    disabled={uploading}
                    required
                  />
                  {caseNumber.trim().length > 0 && (
                    <div className={`validation-helper ${isCaseNumberValid() ? 'valid' : 'invalid'}`}>
                      {caseNumber.trim().length} characters 
                      {!isCaseNumberDigitsOnly() ? ' (Warning: contains alphabets)' : ''}
                      {caseNumber.trim().length !== 20 && isCaseNumberValid() ? ' (Ayushman standard is typically 20 digits)' : ''}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Advanced Compression Options</label>
                  <label className="toggle-container">
                    <input 
                      type="checkbox" 
                      checked={forceGrayscale}
                      onChange={(e) => setForceGrayscale(e.target.checked)}
                      disabled={uploading}
                    />
                    <div className="toggle-switch"></div>
                    <div className="toggle-label">
                      Force Grayscale
                      <span>Saves massive file size for 100+ document page packets</span>
                    </div>
                  </label>
                </div>

                <button 
                  type="submit" 
                  className="btn-upload"
                  disabled={uploading || uploadFiles.length === 0 || !isCaseNumberValid()}
                >
                  <UploadCloud size={18} />
                  Process & Upload Case
                </button>
              </div>

              {/* Uploader Drag zone */}
              <div>
                <div 
                  ref={dragDropRef}
                  className="drag-drop-zone"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                >
                  <div className="drag-icon-wrapper">
                    <UploadCloud size={48} />
                  </div>
                  <div>
                    <p>Drag and drop scan/camera images here, or <strong>click to browse files</strong></p>
                    <span>Supports JPG, PNG, BMP, WEBP, and TIFF. Multiple images are auto-compiled into a 1MB PDF.</span>
                  </div>
                  <input 
                    type="file"
                    ref={fileInputRef}
                    className="file-input"
                    multiple
                    accept="image/*"
                    onChange={handleFileSelect}
                  />
                </div>

                {/* Queue display */}
                {uploadFiles.length > 0 && (
                  <div className="upload-queue-container">
                    <div className="queue-header">
                      <div className="queue-title">
                        Images in Queue ({uploadFiles.length})
                      </div>
                      <button 
                        type="button" 
                        className="btn-clear-queue"
                        onClick={clearQueue}
                      >
                        <Trash2 size={14} />
                        Clear Queue
                      </button>
                    </div>
                    
                    {uploadFiles.length > 50 && (
                      <div className="alert alert-error" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fef3c7', border: '1px solid rgba(245, 158, 11, 0.35)', marginBottom: '1.25rem', flexDirection: 'column', alignItems: 'flex-start', gap: '0.4rem', padding: '0.85rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                          <AlertCircle size={18} style={{ color: 'var(--warning)' }} />
                          <span>Large Batch Compression Warning</span>
                        </div>
                        <p style={{ fontSize: '0.8rem', color: '#fde68a', lineHeight: 1.4, margin: 0, textAlign: 'left' }}>
                          You are uploading <strong>{uploadFiles.length} images</strong> ({(uploadFiles.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(1)} MB). 
                          Compiling this many documents into a single PDF under 1MB requires heavy image processing and can take up to 30-45 seconds. Previews are limited to the first 12 files to prevent browser memory issues.
                        </p>
                      </div>
                    )}
                    
                    <div className="queue-grid">
                      {uploadFiles.map((file, idx) => (
                        <div key={idx} className="queue-item">
                          <button 
                            type="button" 
                            className="queue-item-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFileFromQueue(idx);
                            }}
                          >
                            <X size={12} />
                          </button>
                          <div className="queue-thumbnail-wrapper">
                            {file.previewUrl ? (
                              <img src={file.previewUrl} className="queue-thumbnail" alt="" />
                            ) : (
                              <Image className="queue-placeholder-icon" size={24} />
                            )}
                          </div>
                          <div className="queue-filename" title={file.name}>{file.name}</div>
                          <div className="queue-filesize">{(file.size / 1024).toFixed(1)} KB</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </form>
          )}
        </div>
      )}

      {/* ----------------------------------------------------
          BROWSE CASES TAB
         ---------------------------------------------------- */}
      {activeTab === 'browse' && (
        <div>
          <div className="search-filter-bar">
            <div className="search-input-wrapper">
              <Search className="search-icon" size={18} />
              <input 
                type="text" 
                className="input-search"
                placeholder="Search case registry by Case ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button className="btn-refresh" onClick={fetchCases} title="Refresh Directory">
              <RefreshCw size={18} />
            </button>
          </div>

          {/* Sub tabs in browse */}
          <div className="browse-subtabs">
            <button 
              className={`subtab-btn ${browseSubTab === 'photos' ? 'active' : ''}`}
              onClick={() => setBrowseSubTab('photos')}
            >
              <Image size={16} />
              Photos / Cases
            </button>
            <button 
              className={`subtab-btn ${browseSubTab === 'artifacts' ? 'active' : ''}`}
              onClick={() => {
                setBrowseSubTab('artifacts');
                fetchArtifacts();
              }}
            >
              <Download size={16} />
              Previously Downloaded Artifacts
            </button>
          </div>

          {browseSubTab === 'photos' && (
            loadingCases ? (
              <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem 0' }}>
                <div className="spinner" style={{ margin: '0 auto 1.5rem' }}></div>
                <p style={{ color: 'var(--text-secondary)' }}>Loading directory records...</p>
              </div>
            ) : (
              <div className="grouped-container">
                {casesList.length === 0 ? (
                  <div className="glass-panel empty-cases">
                    <FolderOpen className="empty-icon" size={48} />
                    <p>No patient cases found matching "{searchQuery}"</p>
                  </div>
                ) : (
                  groupItemsByDate(casesList, 'modified_at').map((group) => (
                    <div key={group.title} className="date-group-section">
                      <div className="date-group-header">
                        <Calendar size={16} className="date-group-icon" />
                        <span>{group.title} (by modified date)</span>
                      </div>
                      <div className="cases-grid">
                        {group.items.map((caseItem) => (
                          <div 
                            key={caseItem.id} 
                            className="case-card"
                            onClick={() => handleCaseSelect(caseItem.id)}
                          >
                            <div className="case-card-header">
                              <div className="case-card-number">{caseItem.case_number}</div>
                              <span className={`file-type-badge ${caseItem.optimized_file_type}`}>
                                {caseItem.optimized_file_type}
                              </span>
                            </div>
                            <div className="case-card-body">
                              <div className="case-info-row">
                                <span className="label">Pages:</span>
                                <span>{caseItem.image_count} images</span>
                              </div>
                              <div className="case-info-row">
                                <span className="label">portal upload size:</span>
                                <span>{(caseItem.optimized_file_size / 1024).toFixed(1)} KB</span>
                              </div>
                              <div className="case-info-row">
                                <span className="label">Modified Time:</span>
                                <span>{new Date(caseItem.modified_at || caseItem.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            </div>
                            <div className="case-card-footer" onClick={(e) => e.stopPropagation()}>
                              <button 
                                className="btn-card-action primary"
                                onClick={() => handleOpenNamingModal(caseItem)}
                              >
                                <Download size={14} />
                                Download 1MB File
                              </button>
                              <button 
                                className="btn-card-action secondary"
                                onClick={() => handleCaseSelect(caseItem.id)}
                              >
                                Browse Pages
                                <ChevronRight size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )
          )}

          {browseSubTab === 'artifacts' && (
            loadingArtifacts ? (
              <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem 0' }}>
                <div className="spinner" style={{ margin: '0 auto 1.5rem' }}></div>
                <p style={{ color: 'var(--text-secondary)' }}>Loading artifacts...</p>
              </div>
            ) : (
              <div className="grouped-container">
                {artifactsList.length === 0 ? (
                  <div className="glass-panel empty-cases">
                    <Download className="empty-icon" size={48} />
                    <p>No downloaded artifacts recorded yet.</p>
                  </div>
                ) : (
                  groupItemsByDate(artifactsList, 'created_at').map((group) => (
                    <div key={group.title} className="date-group-section">
                      <div className="date-group-header">
                        <Calendar size={16} className="date-group-icon" />
                        <span>{group.title}</span>
                      </div>
                      <div className="artifacts-list-container">
                        {group.items.map((artifact) => (
                          <div key={artifact.id} className="artifact-row-card">
                            <div className="artifact-main-info">
                              <span className={`file-type-badge ${artifact.file_type}`}>
                                {artifact.file_type}
                              </span>
                              <div className="artifact-details-text">
                                <span className="artifact-name-title" title={artifact.name}>
                                  {artifact.name}
                                </span>
                                <span className="artifact-subtitle">
                                  Case: <strong>{artifact.case_number}</strong> &bull; Size: {(artifact.file_size / 1024).toFixed(1)} KB &bull; Created at {new Date(artifact.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>
                            <div className="artifact-actions">
                              <a 
                                href={`/api/artifacts/download/${artifact.id}`} 
                                className="btn-card-action primary" 
                                style={{ textDecoration: 'none', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                                download
                              >
                                <Download size={14} />
                                Re-Download
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* ----------------------------------------------------
          INTRANET AUDIT LOGS TAB
         ---------------------------------------------------- */}
      {activeTab === 'logs' && (
        <div className="glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 className="panel-title" style={{ margin: 0 }}>
              <Activity size={20} style={{ color: 'var(--warning)' }} />
              Intranet Audit Logs
            </h2>
            <button className="btn-refresh" onClick={fetchLogs} title="Refresh Logs">
              <RefreshCw size={16} />
            </button>
          </div>
          
          {loadingLogs ? (
            <div style={{ textAlign: 'center', padding: '3rem 0' }}>
              <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading transaction records...</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="logs-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Patient Case</th>
                    <th>Action</th>
                    <th>Operation Details</th>
                  </tr>
                </thead>
                <tbody>
                  {systemLogs.length === 0 ? (
                    <tr>
                      <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                        No audit events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    systemLogs.map((log) => {
                      let badgeClass = '';
                      if (log.action.includes('Upload')) badgeClass = 'upload';
                      if (log.action.includes('Download')) badgeClass = 'download';
                      if (log.action.includes('Add Photos')) badgeClass = 'upload';
                      
                      return (
                        <tr key={log.id}>
                          <td className="log-time">{new Date(log.timestamp).toLocaleString()}</td>
                          <td><strong>{log.case_number || 'N/A'}</strong></td>
                          <td>
                            <span className={`log-action-badge ${badgeClass}`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="log-details">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                              <span>{log.details}</span>
                              {log.artifact_id && (
                                <a 
                                  href={`/api/artifacts/download/${log.artifact_id}`} 
                                  className="log-download-link"
                                  title="View/Download artifact file"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Download size={12} />
                                  <span>Download</span>
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {/* ----------------------------------------------------
          CASE DETAILS DIALOG / VIEWER MODAL
         ---------------------------------------------------- */}
      {selectedCase && (
        <div className="modal-backdrop" onClick={() => setSelectedCase(null)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ paddingBottom: '0.75rem', borderBottom: 'none' }}>
              <div className="modal-title">
                <h3>Patient Case: {selectedCase.case.case_number}</h3>
                <p>
                  Created on {new Date(selectedCase.case.created_at).toLocaleString()}
                  {selectedCase.case.modified_at && selectedCase.case.modified_at !== selectedCase.case.created_at && (
                    <span> &bull; Modified on {new Date(selectedCase.case.modified_at).toLocaleString()}</span>
                  )}
                </p>
              </div>
              <button className="btn-modal-close" onClick={() => setSelectedCase(null)}>
                <X size={20} />
              </button>
            </div>
            
            {/* Modal Navigation Tabs */}
            <div className="modal-tabs">
              <button 
                className={`modal-tab-btn ${modalTab === 'photos' ? 'active' : ''}`}
                onClick={() => setModalTab('photos')}
              >
                <Image size={16} />
                Photos ({selectedCase.images.length})
              </button>
              <button 
                className={`modal-tab-btn ${modalTab === 'artifacts' ? 'active' : ''}`}
                onClick={() => setModalTab('artifacts')}
              >
                <Download size={16} />
                Artifacts ({selectedCase.artifacts ? selectedCase.artifacts.length : 0})
              </button>
              <button 
                className={`modal-tab-btn ${modalTab === 'logs' ? 'active' : ''}`}
                onClick={() => setModalTab('logs')}
              >
                <Activity size={16} />
                Audit Logs ({selectedCase.logs ? selectedCase.logs.length : 0})
              </button>
            </div>
            
            <div className="modal-body">
              {modalTab === 'photos' && (
                addingPhotos ? (
                  <div className="progress-overlay" style={{ minHeight: '300px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                    {renderProgressContent()}
                  </div>
                ) : (
                  <>
                    {/* Summary banner */}
                  <div className="modal-detail-banner">
                    <div className="detail-metric">
                      <label>Portal Upload File</label>
                      <span>
                        {selectedCase.case.optimized_file_type.toUpperCase()} ({(selectedCase.case.optimized_file_size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <div className="detail-metric">
                      <label>Total Backups</label>
                      <span>{selectedCase.images.length} high-res images</span>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                      <button 
                        className="btn-primary"
                        style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                        onClick={() => {
                          handleOpenNamingModal(selectedCase.case);
                        }}
                      >
                        <Download size={14} />
                        Download Standard 1MB File
                      </button>
                    </div>
                  </div>
     
                  {/* Selection actions bar */}
                  <div className="detail-selection-header">
                    <div className="selection-actions">
                      <button className="btn-link-select" onClick={handleSelectAllImages}>
                        {selectedImages.length === selectedCase.images.length ? 'Deselect All' : 'Select All'}
                      </button>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        ({selectedImages.length} of {selectedCase.images.length} selected)
                      </span>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button 
                        className="btn-primary" 
                        disabled={selectedImages.length === 0}
                        onClick={openDownloadModal}
                        style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                      >
                        <Download size={14} />
                        Download Selected Bundle
                      </button>
                      
                      <button 
                        className="btn-secondary" 
                        style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                        onClick={() => document.getElementById('case-add-photos-input').click()}
                        disabled={addingPhotos}
                      >
                        {addingPhotos ? (
                          <>
                            <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></div>
                            Adding...
                          </>
                        ) : (
                          <>
                            <span>+ Add Photos</span>
                          </>
                        )}
                      </button>
                      <input 
                        type="file"
                        id="case-add-photos-input"
                        multiple
                        accept="image/*"
                        onChange={handleAddPhotos}
                        style={{ display: 'none' }}
                      />
                    </div>
                  </div>
     
                  {/* Grid of gallery thumbnails grouped by upload date */}
                  <div className="modal-grouped-photos-container">
                    {groupItemsByDate(selectedCase.images, 'created_at').map(group => (
                      <div key={group.title} className="modal-date-group-section" style={{ marginBottom: '1.5rem' }}>
                        <div className="modal-date-group-header">
                          <Calendar size={14} style={{ color: 'var(--primary)' }} />
                          <span>{group.title}</span>
                        </div>
                        <div className="image-gallery-grid">
                          {group.items.map((img) => {
                            const selectedIndex = selectedImages.indexOf(img.id);
                            const isSelected = selectedIndex !== -1;
                            const originalIndex = selectedCase.images.findIndex(item => item.id === img.id);
                            return (
                              <div 
                                key={img.id}
                                className={`gallery-card ${isSelected ? 'selected' : ''}`}
                                onClick={() => handleImageToggle(img.id)}
                              >
                                <div className={`gallery-selection-indicator ${isSelected ? 'selected' : ''}`}>
                                  {isSelected ? selectedIndex + 1 : ''}
                                </div>
                                
                                <div className="gallery-thumbnail-box">
                                  <img 
                                    src={`/api/cases/${selectedCase.case.id}/images/${img.id}/thumbnail`} 
                                    className="gallery-thumbnail" 
                                    alt="" 
                                    loading="lazy"
                                  />
                                </div>
                                
                                <div className="gallery-card-footer">
                                  <span className="gallery-filename" title={img.original_filename}>
                                    Page {originalIndex + 1}
                                  </span>
                                  <span className="gallery-filesize">
                                    {(img.file_size / (1024 * 1024)).toFixed(2)} MB
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  </>
                )
              )}

              {modalTab === 'artifacts' && (
                <div style={{ marginTop: '0.5rem' }}>
                  {selectedCase.artifacts && selectedCase.artifacts.length > 0 ? (
                    <div className="modal-grouped-artifacts-container">
                      {groupItemsByDate(selectedCase.artifacts, 'created_at').map((group) => (
                        <div key={group.title} className="modal-date-group-section" style={{ marginBottom: '1.5rem' }}>
                          <div className="modal-date-group-header">
                            <Calendar size={14} style={{ color: 'var(--primary)' }} />
                            <span>{group.title}</span>
                          </div>
                          <div className="modal-artifacts-grid">
                            {group.items.map((artifact) => (
                              <div key={artifact.id} className="modal-artifact-card">
                                <div className="modal-artifact-header">
                                  <span className={`file-type-badge ${artifact.file_type}`}>{artifact.file_type}</span>
                                  <span className="modal-artifact-size">{(artifact.file_size / 1024).toFixed(1)} KB</span>
                                </div>
                                <span className="modal-artifact-name" title={artifact.name}>{artifact.name}</span>
                                <span className="modal-artifact-date">{new Date(artifact.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                                <a 
                                  href={`/api/artifacts/download/${artifact.id}`} 
                                  className="btn-modal-artifact-download"
                                  download
                                >
                                  <Download size={12} />
                                  Re-download
                                </a>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
                      <Download size={48} style={{ marginBottom: '1.25rem', opacity: 0.35, color: 'var(--primary)' }} />
                      <p>No generated artifacts for this case yet.</p>
                    </div>
                  )}
                </div>
              )}
 
              {modalTab === 'logs' && (
                <div style={{ marginTop: '0.5rem' }}>
                  {selectedCase.logs && selectedCase.logs.length > 0 ? (
                    <div className="table-wrapper" style={{ maxHeight: '450px', overflowY: 'auto' }}>
                      <table className="logs-table">
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Action</th>
                            <th>Operation Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCase.logs.map((log, idx) => (
                            <tr key={idx}>
                              <td className="log-time" style={{ padding: '0.65rem 0.85rem' }}>{new Date(log.timestamp).toLocaleString()}</td>
                              <td style={{ padding: '0.65rem 0.85rem', fontWeight: 600 }}>{log.action}</td>
                              <td className="log-details" style={{ padding: '0.65rem 0.85rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                                  <span>{log.details}</span>
                                  {log.artifact_id && (
                                    <a 
                                      href={`/api/artifacts/download/${log.artifact_id}`} 
                                      className="log-download-link"
                                      title="View/Download artifact file"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <Download size={10} />
                                      <span>Download</span>
                                    </a>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
                      <Activity size={48} style={{ marginBottom: '1.25rem', opacity: 0.35, color: 'var(--warning)' }} />
                      <p>No audit events recorded for this case yet.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setSelectedCase(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          CUSTOM DOWNLOAD BUNDLE CONFIG DIALOG
         ---------------------------------------------------- */}
      {downloadModalOpen && selectedCase && (
        <div className="modal-backdrop" style={{ zIndex: 100 }} onClick={() => setDownloadModalOpen(false)}>
          <div className="modal-container" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <h3>Download Options</h3>
                <p>Configure bundle size and format ({selectedImages.length} page(s) selected)</p>
              </div>
              <button className="btn-modal-close" onClick={() => setDownloadModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body download-dialog-body">
              {/* Artifact Name field */}
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label htmlFor="bundle-artifact-name">Artifact Name</label>
                <input 
                  type="text" 
                  id="bundle-artifact-name"
                  className="input-text"
                  placeholder="Enter bundle artifact name"
                  value={bundleArtifactName}
                  onChange={(e) => setBundleArtifactName(e.target.value)}
                  required
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Will be saved as: <strong>{bundleArtifactName || 'untitled'}{downloadFormat === 'pdf' ? '.pdf' : (downloadFormat === 'zip' ? '.zip' : '.jpg')}</strong>
                </span>
              </div>

              {/* Format selection */}
              <div className="form-group">
                <label>Output Archive Format</label>
                <div className="radio-group">
                  {selectedImages.length === 1 && (
                    <label className={`radio-option ${downloadFormat === 'jpg' ? 'selected' : ''}`}>
                      <input 
                        type="radio" 
                        name="format" 
                        value="jpg" 
                        checked={downloadFormat === 'jpg'} 
                        onChange={() => setDownloadFormat('jpg')}
                      />
                      <div className="radio-text">
                        <span className="radio-label">Single JPG File</span>
                        <span className="radio-desc">Download as a raw JPEG image file.</span>
                      </div>
                    </label>
                  )}
                  
                  <label className={`radio-option ${downloadFormat === 'pdf' ? 'selected' : ''}`}>
                    <input 
                      type="radio" 
                      name="format" 
                      value="pdf" 
                      checked={downloadFormat === 'pdf'} 
                      onChange={() => setDownloadFormat('pdf')}
                    />
                    <div className="radio-text">
                      <span className="radio-label">Compiled PDF Document</span>
                      <span className="radio-desc">Combine selected pages into a single PDF.</span>
                    </div>
                  </label>
 
                  <label className={`radio-option ${downloadFormat === 'zip' ? 'selected' : ''}`}>
                    <input 
                      type="radio" 
                      name="format" 
                      value="zip" 
                      checked={downloadFormat === 'zip'} 
                      onChange={() => setDownloadFormat('zip')}
                    />
                    <div className="radio-text">
                      <span className="radio-label">ZIP Archive</span>
                      <span className="radio-desc">Compress selected items into a ZIP folder.</span>
                    </div>
                  </label>
                </div>
              </div>
 
              {/* Quality target selection */}
              <div className="form-group" style={{ marginTop: '0.5rem' }}>
                <label>File Quality and Sizing</label>
                <div className="radio-group">
                  <label className={`radio-option ${downloadQuality === 'original' ? 'selected' : ''}`}>
                    <input 
                      type="radio" 
                      name="quality" 
                      value="original" 
                      checked={downloadQuality === 'original'} 
                      onChange={() => setDownloadQuality('original')}
                    />
                    <div className="radio-text">
                      <span className="radio-label">Full Original Resolution</span>
                      <span className="radio-desc">Extract exact high-definition backups as uploaded.</span>
                    </div>
                  </label>
 
                  <label className={`radio-option ${downloadQuality === 'optimized-1mb' ? 'selected' : ''}`}>
                    <input 
                      type="radio" 
                      name="quality" 
                      value="optimized-1mb" 
                      checked={downloadQuality === 'optimized-1mb'} 
                      onChange={() => setDownloadQuality('optimized-1mb')}
                    />
                    <div className="radio-text">
                      <span className="radio-label">Optimised Limit (Target: &lt; 1MB total)</span>
                      <span className="radio-desc">Compress selection to fit strictly under 1MB.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '1.2rem' }}>
                <label>Color Options</label>
                <label className="toggle-container">
                  <input 
                    type="checkbox" 
                    checked={bundleGrayscale}
                    onChange={(e) => setBundleGrayscale(e.target.checked)}
                    disabled={bundling}
                  />
                  <div className="toggle-switch"></div>
                  <div className="toggle-label">
                    Download in Grayscale
                    <span>Converts all pages in the bundle to black and white</span>
                  </div>
                </label>
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                className="btn-secondary" 
                onClick={() => setDownloadModalOpen(false)}
                disabled={bundling}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={executeBundleDownload}
                disabled={bundling}
              >
                {bundling ? (
                  <>
                    <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div>
                    Bundling...
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    Download Bundle
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          STANDARD DOWNLOAD ARTIFACT NAMING DIALOG
         ---------------------------------------------------- */}
      {namingModalOpen && namingTargetCase && (
        <div className="modal-backdrop" style={{ zIndex: 100 }} onClick={() => setNamingModalOpen(false)}>
          <div className="modal-container" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <h3>Save Artifact</h3>
                <p>Provide a name for the downloaded file</p>
              </div>
              <button className="btn-modal-close" onClick={() => setNamingModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleDownloadOptimized}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="artifact-name">Artifact Name</label>
                  <input 
                    type="text" 
                    id="artifact-name"
                    className="input-text"
                    placeholder="Enter file name"
                    value={namingArtifactName}
                    onChange={(e) => setNamingArtifactName(e.target.value)}
                    required
                    disabled={downloadingOptimized}
                    autoFocus
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem', display: 'block' }}>
                    Will be saved as: <strong>{namingArtifactName || 'untitled'}{namingTargetCase.optimized_file_type === 'pdf' ? '.pdf' : '.jpg'}</strong>
                  </span>
                </div>

                <div className="form-group" style={{ marginTop: '1.2rem' }}>
                  <label>Color Options</label>
                  <label className="toggle-container">
                    <input 
                      type="checkbox" 
                      checked={downloadGrayscale}
                      onChange={(e) => setDownloadGrayscale(e.target.checked)}
                      disabled={downloadingOptimized}
                    />
                    <div className="toggle-switch"></div>
                    <div className="toggle-label">
                      Download in Grayscale
                      <span>Converts document pages to grayscale (saves size & increases contrast)</span>
                    </div>
                  </label>
                </div>
              </div>
              
              <div className="modal-footer">
                <button 
                  type="button"
                  className="btn-secondary" 
                  onClick={() => setNamingModalOpen(false)}
                  disabled={downloadingOptimized}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  disabled={downloadingOptimized}
                >
                  {downloadingOptimized ? (
                    <>
                      <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div>
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      Download & Save
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ----------------------------------------------------
          OVERSIZED LEGIBLE — STANDARD MODE RETRY DIALOG
         ---------------------------------------------------- */}
      {oversizedError && (
        <div className="modal-backdrop" style={{ zIndex: 110 }} onClick={() => setOversizedError(null)}>
          <div className="modal-container" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <h3 style={{ color: '#f59e0b' }}>⚠️ Sizing Limitation</h3>
                <p>Cannot meet 1MB limit at standard quality settings.</p>
              </div>
              <button className="btn-modal-close" onClick={() => setOversizedError(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body" style={{ color: 'var(--text-color)' }}>
              <p style={{ marginBottom: '1rem', lineHeight: '1.5' }}>
                The compiled document is <strong>{(oversizedError.sizeBytes / 1024).toFixed(1)} KB</strong> — above the 1MB portal limit — even at standard quality and grayscale settings.
              </p>
              
              <div style={{ backgroundColor: 'rgba(255,255,255,0.04)', padding: '1rem', borderRadius: '6px', marginBottom: '1.2rem', fontSize: '0.85rem' }}>
                <strong>Options:</strong>
                <ul style={{ paddingLeft: '1.2rem', marginTop: '0.5rem', lineHeight: '1.6' }}>
                  <li><strong>Force aggressive sizing:</strong> Shrinks dimensions to 450px width at quality 60. The case will be <em>saved regardless</em> — even if it remains slightly over 1MB, you can browse it and selectively download specific pages.</li>
                  <li><strong>Cancel &amp; Adjust:</strong> Remove some pages or split the upload into multiple cases.</li>
                </ul>
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                className="btn-secondary" 
                onClick={() => setOversizedError(null)}
              >
                Cancel &amp; Adjust
              </button>
              
              <button 
                className="btn-primary" 
                style={{ backgroundColor: '#f59e0b', borderColor: '#f59e0b' }}
                onClick={() => {
                  const err = oversizedError;
                  setOversizedError(null);
                  if (err.isAddPhotos) {
                    handleAddPhotos(null, true, err.files);
                  } else {
                    handleUploadSubmit(null, true);
                  }
                }}
              >
                Force Aggressive Sizing &amp; Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          OVERSIZED WARNING — CASE SAVED BUT STILL OVER 1MB
         ---------------------------------------------------- */}
      {oversizedWarning && (
        <div className="modal-backdrop" style={{ zIndex: 110 }} onClick={() => setOversizedWarning(null)}>
          <div className="modal-container" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <h3 style={{ color: '#10b981' }}>✅ Case Saved</h3>
                <p>Case <strong>{oversizedWarning.caseNumber}</strong> was uploaded successfully.</p>
              </div>
              <button className="btn-modal-close" onClick={() => setOversizedWarning(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body" style={{ color: 'var(--text-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', padding: '0.85rem 1rem', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                <AlertCircle size={20} style={{ color: '#f59e0b', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, color: '#f59e0b', fontSize: '0.9rem' }}>Compiled file is {(oversizedWarning.sizeBytes / 1024).toFixed(1)} KB — above the 1MB portal limit</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>Even with aggressive compression, this batch is too large to fit under 1MB.</div>
                </div>
              </div>

              <div style={{ backgroundColor: 'rgba(255,255,255,0.04)', padding: '1rem', borderRadius: '6px', fontSize: '0.85rem', lineHeight: '1.6' }}>
                <strong>What you can do:</strong>
                <ul style={{ paddingLeft: '1.2rem', marginTop: '0.5rem' }}>
                  <li>Open the case and <strong>select specific pages</strong> to download as a smaller bundle instead of all pages at once.</li>
                  <li>Use <strong>Download Selected Bundle</strong> to get a subset of pages that fits under 1MB.</li>
                  <li>Or split the pages across multiple separate cases.</li>
                </ul>
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                className="btn-secondary" 
                onClick={() => setOversizedWarning(null)}
              >
                Dismiss
              </button>
              <button 
                className="btn-primary"
                onClick={() => {
                  setOversizedWarning(null);
                  setActiveTab('browse');
                }}
              >
                Browse Case &amp; Select Pages
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
