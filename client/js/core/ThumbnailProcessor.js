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

  /**
   * Samples a bounded set of evenly distributed indices along the trajectory.
   * Gives 4-5 samples per animated segment, capped at maxSamples (default 12).
   */
  sampleTrajectoryIndices(trajectory, maxSamples = 12) {
    if (!Array.isArray(trajectory) || trajectory.length === 0) return [];
    if (trajectory.length === 1) return [0];
    const total = trajectory.length;
    const targetCount = Math.max(2, Math.min(maxSamples, total));
    const indices = [];
    const step = (total - 1) / (targetCount - 1);
    for (let i = 0; i < targetCount; i++) {
      const idx = Math.min(total - 1, Math.round(i * step));
      if (!indices.includes(idx)) {
        indices.push(idx);
      }
    }
    return indices;
  }

  /**
   * Assembles an array of frame canvases or images into a single horizontal filmstrip sprite sheet.
   */
  async createFilmstrip(frames, filePath, options = {}) {
    const fs = require('fs');
    const path = require('path');
    const resolved = this._validatePath(filePath, path);
    if (!Array.isArray(frames) || frames.length === 0) {
      throw this._error('FILMSTRIP_FRAMES_EMPTY', 'No frames provided for filmstrip assembly.');
    }

    const frameWidth = Math.max(80, Math.min(640, Number(options.frameWidth) || 240));
    const frameHeight = Math.max(45, Math.min(480, Number(options.frameHeight) || 135));
    const totalWidth = frameWidth * frames.length;

    const canvas = document.createElement('canvas');
    canvas.width = totalWidth;
    canvas.height = frameHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw this._error('THUMBNAIL_CANVAS_UNAVAILABLE', 'Filmstrip canvas unavailable.');

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      context.drawImage(frame, i * frameWidth, 0, frameWidth, frameHeight);
    }

    let dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (error) {
      throw this._error('FILMSTRIP_EXPORT_FAILED', 'Filmstrip could not be encoded: ' + error.message);
    }

    const output = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    if (!output.length || output.length > 16777216) {
      throw this._error('THUMBNAIL_OUTPUT_INVALID', 'Filmstrip is invalid or exceeds 16 MB.');
    }

    this.inspectPng(output);
    await this._replaceAtomically(fs, resolved, output);
    const stat = await fs.promises.stat(resolved);

    return {
      path: resolved,
      frameCount: frames.length,
      frameWidth,
      frameHeight,
      totalWidth,
      bytes: stat.size,
      revision: Number(stat.mtimeMs)
    };
  }

  /**
   * Generates a high-quality multi-frame cinematic motion sequence from a source canvas.
   * Produces 8-12 crisp supersampled frames with subtle orbital/zoom drift so that every
   * map card exhibits a stunning, alive, smooth hover preview.
   */
  generateCinematicFrames(sourceCanvas, frameCount = 10, options = {}) {
    if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return [];
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

    const outW = Math.max(160, Math.min(640, Number(options.outWidth) || 480));
    const aspect = (frameWidth && frameHeight) ? (frameWidth / frameHeight) : (16 / 9);
    const outH = Math.max(90, Math.round(outW / (aspect > 0 ? aspect : (16 / 9))));

    const frames = [];
    const count = Math.max(4, Math.min(16, frameCount));

    for (let i = 0; i < count; i++) {
      const progress = count > 1 ? i / (count - 1) : 0;
      // 1:1 Faithful composition crop - zero zoom inflation
      const panOffsetX = (progress - 0.5) * (sourceWidth * 0.012);
      const panOffsetY = (Math.sin(progress * Math.PI * 2) * 0.5) * (sourceHeight * 0.006);

      const cropW = sourceWidth;
      const cropH = sourceHeight;
      const cropX = Math.max(0, Math.min(sourceCanvas.width - cropW, sourceX + panOffsetX));
      const cropY = Math.max(0, Math.min(sourceCanvas.height - cropH, sourceY + panOffsetY));

      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = outW;
      frameCanvas.height = outH;
      const ctx = frameCanvas.getContext('2d', { alpha: false });
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
      }
      frames.push(frameCanvas);
    }
    return frames;
  }

  /**
   * Renders a real map frame for a given camera position using downloaded tile assets.
   */
  async renderFrameFromTiles(camera, assets, width, height, options = {}) {
    const fs = require('fs');
    const tileSize = Number(options.tileSize) || 256;
    const zoom = Number(camera && camera.zoom) || 2;
    const lat = Number(camera && camera.lat) || 0;
    const lng = Number(camera && (camera.lon !== undefined ? camera.lon : camera.lng)) || 0;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(80, Math.round(width) || 480);
    canvas.height = Math.max(45, Math.round(height) || 270);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return canvas;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw base fallback from sourceCanvas if available
    if (options.sourceCanvas && options.sourceCanvas.width) {
      ctx.drawImage(options.sourceCanvas, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#10171e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (!Array.isArray(assets) || assets.length === 0) return canvas;

    const planner = typeof CoveragePlanner !== 'undefined' ? CoveragePlanner :
      (typeof window !== 'undefined' ? window.CoveragePlanner : null);
    if (!planner || typeof planner.planViewport !== 'function') return canvas;

    // Fast lookup for tile files
    const tileMap = new Map();
    for (const a of assets) {
      if (a && a.filePath) {
        tileMap.set(`${a.z}_${a.x}_${a.y}`, a.filePath);
      }
    }

    try {
      const planned = planner.planViewport({
        centerLat: lat,
        centerLng: lng,
        zoom: zoom,
        width: canvas.width,
        height: canvas.height,
        tileSize
      });

      const loadedImages = options.imageCache || new Map();
      for (const t of planned) {
        let filePath = tileMap.get(`${t.z}_${t.x}_${t.y}`);
        if (!filePath && t.z > 0) {
          filePath = tileMap.get(`${t.z - 1}_${Math.floor(t.x / 2)}_${Math.floor(t.y / 2)}`);
        }
        if (filePath) {
          try {
            let img = loadedImages.get(filePath);
            if (!img) {
              const buf = await fs.promises.readFile(filePath);
              const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
              img = await this._loadImage(dataUrl);
              loadedImages.set(filePath, img);
            }
            ctx.drawImage(img, t.screenX, t.screenY, t.drawSize, t.drawSize);
          } catch (_) {}
        }
      }
    } catch (_) {}

    return canvas;
  }

  /**
   * Saves an array of frame canvases as a sequence of distinct, high-quality PNG images.
   * e.g. thumb_[docId]_0.png, thumb_[docId]_1.png, ..., thumb_[docId]_[N-1].png
   */
  async savePngSequence(frames, basePathPattern) {
    const fs = require('fs');
    const path = require('path');
    if (!Array.isArray(frames) || frames.length === 0) return [];
    const saved = [];
    for (let i = 0; i < frames.length; i++) {
      const targetPath = basePathPattern.replace('%d', String(i));
      const resolved = this._validatePath(targetPath, path);
      const canvas = frames[i];
      let dataUrl = '';
      try {
        dataUrl = canvas.toDataURL('image/png');
      } catch (err) {
        continue;
      }
      const output = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
      if (!output.length) continue;
      this.inspectPng(output);
      await this._replaceAtomically(fs, resolved, output);
      const stat = await fs.promises.stat(resolved);
      saved.push({
        index: i,
        path: resolved,
        width: canvas.width,
        height: canvas.height,
        bytes: stat.size,
        revision: Number(stat.mtimeMs)
      });
    }
    return saved;
  }

  _error(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = ThumbnailProcessor;
else if (typeof window !== 'undefined') window.ThumbnailProcessor = ThumbnailProcessor;
