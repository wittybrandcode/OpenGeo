/**
 * Transactional storage and validation for derived MegaTile PNG assets.
 * A sidecar manifest is the readiness marker; a PNG without its valid
 * manifest is never a cache hit.
 */
class MegaTileArtifactStore {
  constructor(options = {}) {
    this.artifactKind = options.artifactKind === 'finalize-revision' ? 'finalize-revision' : 'preview-cache';
    this.providerSignature = String(options.providerSignature || 'default');
    this.cacheSignature = String(options.cacheSignature || 'default');
    this.operationId = String(options.operationId || 'unknown');
    this.tileMatrix = String(options.tileMatrix || 'webMercator');
    this.stitchAlgorithmVersion = 'megatile-stitch/2.0';
    this.lockTtlMs = Number(options.lockTtlMs) || 30000;
    this.lockWaitMs = Number(options.lockWaitMs) || 10000;
  }

  createSpec(children, startX, startY, size, sourceTileSize, outputPath) {
    const columns = size / sourceTileSize;
    if (!Number.isInteger(columns) || columns < 1) {
      throw this._error('MEGATILE_GRID_INVALID', 'MegaTile size is not divisible by source tile size.');
    }
    const expectedCells = [];
    const childIdentities = [];
    for (const child of (Array.isArray(children) ? children : [])) {
      const cellX = Number(child.x) - startX;
      const cellY = Number(child.y) - startY;
      if (!Number.isInteger(cellX) || !Number.isInteger(cellY) ||
          cellX < 0 || cellY < 0 || cellX >= columns || cellY >= columns) {
        throw this._error('MEGATILE_CELL_OUT_OF_RANGE', `Child cell ${cellX},${cellY} is outside the MegaTile grid.`);
      }
      expectedCells.push(`${cellX},${cellY}`);
      childIdentities.push([
        child.downloadKey || '', child.placementKey || '',
        Number(child.z), Number(child.x), Number(child.y)
      ].join('|'));
    }
    const uniqueCells = new Set(expectedCells);
    if (!expectedCells.length || uniqueCells.size !== expectedCells.length) {
      throw this._error('MEGATILE_EXPECTED_CELLS_INVALID', 'MegaTile expected cells are empty or duplicated.');
    }
    return {
      outputPath,
      manifestPath: `${outputPath}.manifest.json`,
      lockPath: `${outputPath}.lock`,
      artifactKind: this.artifactKind,
      providerSignature: this.providerSignature,
      cacheSignature: this.cacheSignature,
      operationId: this.operationId,
      tileMatrix: this.tileMatrix,
      stitchAlgorithmVersion: this.stitchAlgorithmVersion,
      width: size,
      height: size,
      sourceTileSize,
      originalExpectedCount: expectedCells.length,
      expectedCells: expectedCells.sort(),
      childIdentities: childIdentities.sort(),
      fingerprinted: false
    };
  }

  async fingerprintChildren(spec, children) {
    const fs = require('fs');
    const crypto = require('crypto');
    const loadedChildren = [];
    const fingerprintedIdentities = [];
    for (const child of (Array.isArray(children) ? children : [])) {
      let buffer;
      try {
        buffer = await fs.promises.readFile(child.filePath);
      } catch (readError) {
        throw this._error(
          'MEGATILE_CHILD_READ_FAILED',
          `Failed to read MegaTile child ${child.placementKey || `${child.z}/${child.x}/${child.y}`}: ${readError.message}`
        );
      }
      const identity = [
        child.downloadKey || '', child.placementKey || '',
        Number(child.z), Number(child.x), Number(child.y)
      ].join('|');
      fingerprintedIdentities.push(
        `${identity}|${buffer.length}|${crypto.createHash('sha256').update(buffer).digest('hex')}`
      );
      loadedChildren.push({ child, buffer });
    }
    spec.childIdentities = fingerprintedIdentities.sort();
    spec.fingerprinted = true;
    if (spec.artifactKind === 'preview-cache') {
      spec.cacheSignature = crypto.createHash('sha256').update(this._canonicalJson({
        schemaVersion: 'megatile-cache-signature/1.0',
        providerSignature: spec.providerSignature,
        tileMatrix: spec.tileMatrix,
        sourceTileSize: spec.sourceTileSize,
        stitchAlgorithmVersion: spec.stitchAlgorithmVersion,
        width: spec.width,
        height: spec.height,
        expectedCells: spec.expectedCells,
        childIdentities: spec.childIdentities
      })).digest('hex');
    }
    return { spec, loadedChildren };
  }

  validateCache(spec) {
    if (this.artifactKind !== 'preview-cache' || !spec || !spec.fingerprinted) return null;
    return this._validatePair(spec);
  }

  assertFinalizeTargetAvailable(spec) {
    if (this.artifactKind !== 'finalize-revision') return;
    const fs = require('fs');
    if (fs.existsSync(spec.outputPath) || fs.existsSync(spec.manifestPath)) {
      throw this._error('MEGATILE_FINALIZE_TARGET_CONFLICT', 'Finalize MegaTile target already exists in this revision.');
    }
  }

  async publish(buffer, spec, report, isCancelled) {
    const fs = require('fs');
    const crypto = require('crypto');
    const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (!spec || !spec.fingerprinted) {
      throw this._error('MEGATILE_CHILD_FINGERPRINTS_MISSING', 'MegaTile publication requires SHA-256 child fingerprints.');
    }
    this._assertReport(spec, report);
    const png = this._inspectPng(payload);
    if (png.width !== spec.width || png.height !== spec.height) {
      throw this._error('MEGATILE_PNG_DIMENSION_MISMATCH', `Expected ${spec.width}x${spec.height}, received ${png.width}x${png.height}.`);
    }
    if (isCancelled && isCancelled()) throw this._error('MEGATILE_CANCELLED', 'MegaTile publication was cancelled.');

    const lockHandle = await this._acquireLock(spec.lockPath, isCancelled);
    let tempPng = null;
    let tempManifest = null;
    let pngPublished = false;
    let manifestPublished = false;
    try {
      const concurrentHit = this.validateCache(spec);
      if (concurrentHit) return { manifest: concurrentHit, cached: true };
      this.assertFinalizeTargetAvailable(spec);
      this._removeInvalidPair(spec);
      this._cleanupTemps(spec);

      const nonce = `${Date.now()}-${Math.floor(Math.random() * 0x100000000).toString(16)}`;
      tempPng = `${spec.outputPath}.tmp-${nonce}.png`;
      tempManifest = `${spec.manifestPath}.tmp-${nonce}.json`;
      this._writeDurable(tempPng, payload);
      const manifest = {
        artifactKind: spec.artifactKind,
        cacheSignature: spec.artifactKind === 'preview-cache' ? spec.cacheSignature : null,
        childIdentities: spec.childIdentities,
        coverageMask: spec.expectedCells,
        decodedCells: spec.expectedCells,
        expectedCells: spec.expectedCells,
        height: png.height,
        operationId: spec.artifactKind === 'finalize-revision' ? spec.operationId : null,
        originalExpectedCount: spec.originalExpectedCount,
        outputBytes: payload.length,
        outputSha256: crypto.createHash('sha256').update(payload).digest('hex'),
        providerSignature: spec.providerSignature,
        schemaVersion: 'megatile-manifest/1.0',
        sourceTileSize: spec.sourceTileSize,
        stitchAlgorithmVersion: spec.stitchAlgorithmVersion,
        tileMatrix: spec.tileMatrix,
        width: png.width
      };
      this._writeDurable(tempManifest, Buffer.from(this._canonicalJson(manifest), 'utf8'));
      if (isCancelled && isCancelled()) throw this._error('MEGATILE_CANCELLED', 'MegaTile publication was cancelled.');

      fs.renameSync(tempPng, spec.outputPath);
      tempPng = null;
      pngPublished = true;
      fs.renameSync(tempManifest, spec.manifestPath);
      tempManifest = null;
      manifestPublished = true;
      const verified = this._validatePair(spec);
      if (!verified) throw this._error('MEGATILE_POST_PUBLISH_INVALID', 'Published MegaTile failed post-rename verification.');
      return { manifest: verified, cached: false };
    } catch (error) {
      if (manifestPublished) this._unlink(spec.manifestPath);
      if (pngPublished) this._unlink(spec.outputPath);
      throw error;
    } finally {
      if (tempPng) this._unlink(tempPng);
      if (tempManifest) this._unlink(tempManifest);
      try { fs.closeSync(lockHandle); } catch (_error) {}
      this._unlink(spec.lockPath);
    }
  }

  _validatePair(spec) {
    const fs = require('fs');
    const crypto = require('crypto');
    try {
      if (!fs.existsSync(spec.outputPath) || !fs.existsSync(spec.manifestPath)) return null;
      const manifest = JSON.parse(fs.readFileSync(spec.manifestPath, 'utf8'));
      const payload = fs.readFileSync(spec.outputPath);
      const png = this._inspectPng(payload);
      const exact = (left, right) => JSON.stringify((left || []).slice().sort()) === JSON.stringify((right || []).slice().sort());
      if (manifest.schemaVersion !== 'megatile-manifest/1.0' ||
          manifest.artifactKind !== spec.artifactKind ||
          manifest.providerSignature !== spec.providerSignature ||
          manifest.tileMatrix !== spec.tileMatrix ||
          manifest.sourceTileSize !== spec.sourceTileSize ||
          manifest.stitchAlgorithmVersion !== spec.stitchAlgorithmVersion ||
          manifest.width !== spec.width || manifest.height !== spec.height ||
          manifest.originalExpectedCount !== spec.originalExpectedCount ||
          manifest.outputBytes !== payload.length ||
          manifest.outputSha256 !== crypto.createHash('sha256').update(payload).digest('hex') ||
          !exact(manifest.expectedCells, spec.expectedCells) ||
          !exact(manifest.decodedCells, spec.expectedCells) ||
          !exact(manifest.coverageMask, spec.expectedCells) ||
          !exact(manifest.childIdentities, spec.childIdentities) ||
          (spec.artifactKind === 'preview-cache' && manifest.cacheSignature !== spec.cacheSignature) ||
          (spec.artifactKind === 'finalize-revision' && manifest.operationId !== spec.operationId)) {
        return null;
      }
      return manifest;
    } catch (_error) {
      return null;
    }
  }

  _assertReport(spec, report) {
    const expected = spec.expectedCells.slice().sort();
    const decoded = (report && Array.isArray(report.decodedCells) ? report.decodedCells : []).slice().sort();
    const coverage = (report && Array.isArray(report.coverageMask) ? report.coverageMask : []).slice().sort();
    if (!report || report.originalExpectedCount !== spec.originalExpectedCount ||
        report.decodedCount !== spec.originalExpectedCount ||
        JSON.stringify(decoded) !== JSON.stringify(expected) ||
        JSON.stringify(coverage) !== JSON.stringify(expected)) {
      throw this._error('MEGATILE_INCOMPLETE_COVERAGE', `MegaTile decoded ${report && report.decodedCount || 0}/${spec.originalExpectedCount} expected cells.`);
    }
  }

  _inspectPng(buffer) {
    if (!buffer || buffer.length < 45 ||
        buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47 ||
        buffer[4] !== 0x0d || buffer[5] !== 0x0a || buffer[6] !== 0x1a || buffer[7] !== 0x0a) {
      throw this._error('MEGATILE_PNG_INVALID', 'MegaTile output does not contain a valid PNG signature.');
    }
    let offset = 8;
    let width = 0;
    let height = 0;
    let sawHeader = false;
    let sawEnd = false;
    while (offset + 12 <= buffer.length) {
      const chunkLength = buffer.readUInt32BE(offset);
      const chunkEnd = offset + 12 + chunkLength;
      if (chunkEnd > buffer.length) {
        throw this._error('MEGATILE_PNG_TRUNCATED', 'MegaTile PNG contains a truncated chunk.');
      }
      const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
      if (!sawHeader) {
        if (chunkType !== 'IHDR' || chunkLength !== 13) {
          throw this._error('MEGATILE_PNG_INVALID', 'MegaTile PNG does not begin with a valid IHDR chunk.');
        }
        width = buffer.readUInt32BE(offset + 8);
        height = buffer.readUInt32BE(offset + 12);
        sawHeader = width > 0 && height > 0;
      }
      offset = chunkEnd;
      if (chunkType === 'IEND') {
        sawEnd = chunkLength === 0;
        break;
      }
    }
    if (!sawHeader || !sawEnd || offset !== buffer.length) {
      throw this._error('MEGATILE_PNG_INCOMPLETE', 'MegaTile PNG is missing a complete terminal IEND chunk.');
    }
    return { width, height };
  }

  _writeDurable(filePath, buffer) {
    const fs = require('fs');
    const descriptor = fs.openSync(filePath, 'wx');
    try {
      fs.writeFileSync(descriptor, buffer);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }

  async _acquireLock(lockPath, isCancelled) {
    const fs = require('fs');
    const deadline = Date.now() + this.lockWaitMs;
    while (true) {
      if (isCancelled && isCancelled()) throw this._error('MEGATILE_CANCELLED', 'MegaTile lock wait was cancelled.');
      try {
        return fs.openSync(lockPath, 'wx');
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw error;
        try {
          const age = Date.now() - fs.statSync(lockPath).mtimeMs;
          if (age > this.lockTtlMs) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch (_statError) {
          continue;
        }
        if (Date.now() >= deadline) throw this._error('MEGATILE_LOCK_TIMEOUT', 'Timed out waiting for a MegaTile publication lock.');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  _removeInvalidPair(spec) {
    if (this.artifactKind === 'finalize-revision') return;
    this._unlink(spec.outputPath);
    this._unlink(spec.manifestPath);
  }

  _cleanupTemps(spec) {
    const fs = require('fs');
    const path = require('path');
    const directory = path.dirname(spec.outputPath);
    const prefixes = [path.basename(spec.outputPath) + '.tmp-', path.basename(spec.manifestPath) + '.tmp-'];
    try {
      for (const name of fs.readdirSync(directory)) {
        if (!prefixes.some(prefix => name.indexOf(prefix) === 0)) continue;
        const candidate = path.resolve(directory, name);
        if (candidate.indexOf(path.resolve(directory) + path.sep) === 0) this._unlink(candidate);
      }
    } catch (_error) {}
  }

  _canonicalJson(value) {
    const normalize = input => {
      if (Array.isArray(input)) return input.map(normalize);
      if (input && typeof input === 'object') {
        const output = {};
        for (const key of Object.keys(input).sort()) output[key] = normalize(input[key]);
        return output;
      }
      return input;
    };
    return JSON.stringify(normalize(value));
  }

  _unlink(filePath) {
    const fs = require('fs');
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_error) {}
  }

  _error(code, message) {
    const error = new Error(message);
    error.name = 'MegaTileArtifactError';
    error.code = code;
    return error;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = MegaTileArtifactStore;
else if (typeof window !== 'undefined') window.MegaTileArtifactStore = MegaTileArtifactStore;
