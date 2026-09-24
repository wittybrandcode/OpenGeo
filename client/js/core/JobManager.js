class JobManager {
  constructor() {
    this.fs = require('fs');
    this.path = require('path');
    this.tempDir = this._getTempDir();
    this.activeJobs = new Map();
    
    this._initTempDir();
  }

  _getTempDir() {
    try {
      const cs = typeof CSInterface !== 'undefined' ? new CSInterface() : new window.CSInterface();
      const extUri = cs.getSystemPath(window.SystemPath.USER_DATA);
      let extPath = extUri.replace(/^file:\/{2,3}/, '');
      extPath = decodeURIComponent(extPath);
      return this.path.join(extPath, 'OpenGeo', 'temp').replace(/\\/g, '/');
    } catch(e) {
      const os = require('os');
      return this.path.join(os.tmpdir(), 'OpenGeo', 'temp').replace(/\\/g, '/');
    }
  }

  _initTempDir() {
    if (!this.fs.existsSync(this.tempDir)) {
      try {
        this.fs.mkdirSync(this.tempDir, { recursive: true });
      } catch (e) {
        console.error('[JobManager] Failed to create temp directory', e);
      }
    }
    this._cleanupAbandonedFiles();
  }

  /**
   * Generates a universally unique identifier or unique string
   */
  generateUUID() {
    // Math.random combined with Date.now is perfectly sufficient for temporary job scoping
    // and avoids Node vs Browser crypto API incompatibilities in the CEP environment.
    return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
  }

  /**
   * Starts a new job and returns a unique Job ID.
   * @param {string} jobType 
   * @returns {string} jobId
   */
  startJob(jobType) {
    const jobId = `${jobType}_${this.generateUUID()}`;
    this.activeJobs.set(jobId, { type: jobType, tempFiles: [], startTime: Date.now() });
    return jobId;
  }

  /**
   * Registers a temporary file associated with a specific job.
   * @param {string} jobId 
   * @param {string} extension (e.g., '.json', '.png')
   * @returns {string} Absolute path to the unique temp file
   */
  createTempFile(jobId, extension = '.json') {
    const job = this.activeJobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (!/^\.[A-Za-z0-9]{1,10}$/.test(extension)) throw new Error('Temporary file extension is invalid');

    const tempFilePath = this.path.join(this.tempDir, `${jobId}${extension}`).replace(/\\/g, '/');
    job.tempFiles.push(tempFilePath);
    return tempFilePath;
  }

  /**
   * Cleans up all resources and temp files associated with a job.
   * @param {string} jobId 
   */
  finishJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    // Cleanup is asynchronous so a large temporary payload cannot stall CEP's
    // UI thread after AE has already completed the job.
    for (const filePath of job.tempFiles) {
      this.fs.unlink(filePath, error => {
        if (error && error.code !== 'ENOENT') console.warn(`[JobManager] Failed to delete temp file: ${filePath}`, error);
      });
    }

    this.activeJobs.delete(jobId);
  }

  _cleanupAbandonedFiles() {
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const entries = this.fs.readdirSync(this.tempDir);
      for (let index = 0; index < entries.length; index++) {
        const name = entries[index];
        if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,10}$/.test(name)) continue;
        const filePath = this.path.join(this.tempDir, name);
        const stats = this.fs.statSync(filePath);
        if (stats.isFile() && stats.mtimeMs < cutoff) {
          try { this.fs.unlinkSync(filePath); } catch (cleanupError) { /* ignore locked abandoned file */ }
        }
      }
    } catch (error) {
      console.warn('[JobManager] Abandoned temp-file cleanup was skipped:', error.message);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = JobManager;
} else if (typeof window !== 'undefined') {
  window.JobManager = JobManager;
}
