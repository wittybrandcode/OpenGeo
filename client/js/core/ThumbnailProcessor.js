/** Creates compact project thumbnails directly from the OpenGeo preview canvas. */
class ThumbnailProcessor {
  constructor(options = {}) {
    this.maxDimension = Math.max(320, Math.min(1600, Number(options.maxDimension) || 960));
    this.maxInputBytes = Math.max(1024, Number(options.maxInputBytes) || 67108864);
  }

  inspectPng(buffer) {
    if (!buffer || buffer.length < 33 || buffer.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw this._error('THUMBNAIL_PNG_INVALID', 'The captured file is not a valid PNG.');
    }
    const ihdrLength = buffer.readUInt32BE(8);
    if (ihdrLength !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
      throw this._error('THUMBNAIL_PNG_INVALID', 'The captured PNG has no valid IHDR header.');
    }
    const result = {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      bitDepth: buffer[24],
      colorType: buffer[25],
      hasColorProfile: false
    };
    let offset = 8;
    let foundEnd = false;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      if (length < 0 || offset + 12 + length > buffer.length) break;
      if (type === 'gAMA' || type === 'sRGB' || type === 'iCCP') result.hasColorProfile = true;
      offset += length + 12;
      if (type === 'IEND') { foundEnd = true; break; }
    }
    if (!foundEnd || !result.width || !result.height) {
      throw this._error('THUMBNAIL_PNG_INCOMPLETE', 'The captured PNG is incomplete.');
    }
    return result;
  }

  async normalize(filePath, options = {}) {
    const fs = require('fs');
    const path = require('path');
    const resolved = this._validatePath(filePath, path);
    const source = await fs.promises.readFile(resolved);
    if (!source.length || source.length > this.maxInputBytes) {
      throw this._error('THUMBNAIL_SIZE_INVALID', 'The captured thumbnail exceeds its input size limit.');
    }
    const png = this.inspectPng(source);
    const image = await this._loadImage('data:image/png;base64,' + source.toString('base64'));
    const scale = Math.min(1, this.maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw this._error('THUMBNAIL_CANVAS_UNAVAILABLE', 'The thumbnail canvas is unavailable.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/png');
    const output = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    if (!output.length || output.length > 16777216) {
      throw this._error('THUMBNAIL_OUTPUT_INVALID', 'The optimized thumbnail is invalid or exceeds 16 MB.');
    }
    await this._replaceAtomically(fs, resolved, output);
    const stat = await fs.promises.stat(resolved);
    return {
      path: resolved, width, height, bytes: stat.size, revision: Number(stat.mtimeMs),
      colorCorrected: false, colorStrategy: String(options.colorStrategy || 'ae-render-queue-srgb')
    };
  }

  async captureCanvas(sourceCanvas, filePath, options = {}) {
    const fs = require('fs');
    const path = require('path');
    const resolved = this._validatePath(filePath, path);
    if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) {
      throw this._error('THUMBNAIL_PREVIEW_UNAVAILABLE', 'The OpenGeo preview is not ready for capture.');
    }

    const logicalWidth = Math.max(1, Number(options.viewportWidth) || sourceCanvas.clientWidth || sourceCanvas.width);
    const logicalHeight = Math.max(1, Number(options.viewportHeight) || sourceCanvas.clientHeight || sourceCanvas.height);
    const frameWidth = Math.max(1, Math.min(logicalWidth, Number(options.frameWidth) || logicalWidth));
    const frameHeight = Math.max(1, Math.min(logicalHeight, Number(options.frameHeight) || logicalHeight));
    const pixelScaleX = sourceCanvas.width / logicalWidth;
    const pixelScaleY = sourceCanvas.height / logicalHeight;
    const sourceWidth = Math.max(1, frameWidth * pixelScaleX);
    const sourceHeight = Math.max(1, frameHeight * pixelScaleY);
    const sourceX = Math.max(0, (sourceCanvas.width - sourceWidth) / 2);
    const sourceY = Math.max(0, (sourceCanvas.height - sourceHeight) / 2);
    const outputScale = Math.min(1, this.maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * outputScale));
    const height = Math.max(1, Math.round(sourceHeight * outputScale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw this._error('THUMBNAIL_CANVAS_UNAVAILABLE', 'The thumbnail canvas is unavailable.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      sourceCanvas,
      sourceX, sourceY, sourceWidth, sourceHeight,
      0, 0, width, height
    );

    let dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (error) {
      throw this._error('THUMBNAIL_PREVIEW_EXPORT_FAILED', 'The OpenGeo preview could not be encoded: ' + error.message);
    }
    const output = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    if (!output.length || output.length > 16777216) {
      throw this._error('THUMBNAIL_OUTPUT_INVALID', 'The preview thumbnail is invalid or exceeds 16 MB.');
    }
    this.inspectPng(output);
    await this._replaceAtomically(fs, resolved, output);
    const stat = await fs.promises.stat(resolved);
    return {
      path: resolved,
      width,
      height,
      bytes: stat.size,
      revision: Number(stat.mtimeMs),
      colorCorrected: false,
      colorStrategy: 'opengeo-preview-canvas-srgb',
      source: 'opengeo-preview-canvas'
    };
  }

  _loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(this._error('THUMBNAIL_DECODE_FAILED', 'Chromium could not decode the captured PNG.'));
      image.src = source;
    });
  }

  _validatePath(filePath, path) {
    const resolved = path.resolve(String(filePath || ''));
    const parent = path.basename(path.dirname(resolved)).toLowerCase();
    const name = path.basename(resolved);
    if (parent !== 'thumbnails' || !/^thumb_[a-z0-9_-]+\.png$/i.test(name)) {
      throw this._error('THUMBNAIL_PATH_REJECTED', 'The thumbnail path is outside the managed project thumbnail folder.');
    }
    return resolved;
  }

  async _replaceAtomically(fs, target, output) {
    const nonce = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const temporary = target + '.normalize_' + nonce;
    const backup = target + '.normalize_backup_' + nonce;
    let hasBackup = false;
    try {
      await fs.promises.writeFile(temporary, output, { flag: 'wx' });
      let targetExists = false;
      try { await fs.promises.access(target); targetExists = true; } catch (_missingTargetError) {}
      if (targetExists) {
        await fs.promises.copyFile(target, backup);
        hasBackup = true;
        await fs.promises.unlink(target);
      }
      await fs.promises.rename(temporary, target);
      if (hasBackup) {
        await fs.promises.unlink(backup);
        hasBackup = false;
      }
    } catch (error) {
      try {
        if (hasBackup) {
          try { await fs.promises.unlink(target); } catch (_unlinkTargetError) {}
          await fs.promises.copyFile(backup, target);
        }
      } catch (_restoreError) {}
      throw this._error('THUMBNAIL_COMMIT_FAILED', 'The display-ready thumbnail could not be committed: ' + error.message);
    } finally {
      try { await fs.promises.unlink(temporary); } catch (_temporaryCleanupError) {}
      try { await fs.promises.unlink(backup); } catch (_backupCleanupError) {}
    }
  }

  _error(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = ThumbnailProcessor;
else if (typeof window !== 'undefined') window.ThumbnailProcessor = ThumbnailProcessor;
