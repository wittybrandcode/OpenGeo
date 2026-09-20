class MegaTileStitcher {
  constructor(cacheDir, compId, cacheSignature, options = {}) {
    this.cacheDir = cacheDir.replace(/\\/g, '/').replace(/\/$/, '');
    this.compId = compId || 'global';
    this.cacheSignature = String(cacheSignature || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    this.coverageReports = [];
    this._destroyed = false;
    this.artifactStore = new MegaTileArtifactStore({
      artifactKind: options.artifactKind || 'preview-cache',
      providerSignature: options.providerSignature || cacheSignature || 'default',
      cacheSignature: this.cacheSignature,
      operationId: options.operationId || compId || 'unknown',
      tileMatrix: options.tileMatrix || 'webMercator'
    });
    
    // Worker Lifecycle Management (Singleton per instance)
    this.supportsWorker = typeof window.Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
    if (this.supportsWorker) {
      this.worker = new Worker('js/engine/stitcherWorker.js?v=5');
      this.jobQueue = new Map();
      this.jobCounter = 0;
      
      this.worker.onmessage = (e) => {
        const { id, status, buffer, error } = e.data;
        const job = this.jobQueue.get(id);
        if (job) {
          if (status === 'success') {
            this._publishWorkerResult(job, e.data).then(job.resolve, job.reject).finally(() => {
              this.jobQueue.delete(id);
            });
          } else {
            console.error("[MegaTileStitcher] Worker Error:", error);
            this.jobQueue.delete(id);
            const workerError = new Error(error || 'MegaTile worker failed');
            workerError.code = e.data.code || 'MEGATILE_WORKER_FAILED';
            job.reject(workerError);
          }
        }
      };
      
      this.worker.onerror = (err) => {
        console.error("[MegaTileStitcher] Worker unhandled error:", err);
        // Reject all pending jobs
        for (const [id, job] of this.jobQueue.entries()) {
          job.reject(new Error("Worker crashed"));
        }
        this.jobQueue.clear();
      };
    }
  }

  destroy() {
    this._destroyed = true;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      for (const job of this.jobQueue.values()) job.reject(new Error('MegaTile stitcher was disposed'));
      this.jobQueue.clear();
    }
  }

  getCoverageReport() {
    return this.coverageReports.slice();
  }

  async _publishWorkerResult(job, message) {
    const report = {
      originalExpectedCount: message.originalExpectedCount,
      decodedCount: message.decodedCount,
      decodedCells: message.decodedCells || [],
      coverageMask: message.coverageMask || []
    };
    const publication = await this.artifactStore.publish(
      Buffer.from(message.buffer), job.spec, report, () => this._destroyed
    );
    this._recordCoverage(job.spec, publication.manifest, publication.cached);
    return job.spec.outputPath;
  }

  _recordCoverage(spec, manifest, cached) {
    this.coverageReports.push({
      outputPath: spec.outputPath,
      decodedCount: (manifest.decodedCells || []).length,
      expectedCount: spec.originalExpectedCount,
      expectedCells: spec.expectedCells.slice(),
      decodedCells: (manifest.decodedCells || []).slice(),
      coverageMask: (manifest.coverageMask || []).slice(),
      cached: !!cached,
      manifestPath: spec.manifestPath,
      outputSha256: manifest.outputSha256
    });
  }

  _baseAsset(tile) {
    return {
      placementKey: tile.placementKey || `legacy-placement/${tile.z}/${tile.x}/${tile.y}`,
      downloadKey: tile.downloadKey || null,
      sourcePlacementKeys: [tile.placementKey || `legacy-placement/${tile.z}/${tile.x}/${tile.y}`],
      filePath: tile.filePath,
      z: tile.z,
      sourceZoom: tile.z,
      x: tile.x,
      y: tile.y
    };
  }

  _megaAsset(group, canvasSize, filePath) {
    return {
      placementKey: `megatile/${canvasSize}/${group.z}/${group.x}/${group.y}`,
      downloadKey: null,
      sourcePlacementKeys: group.children.map(child => child.placementKey || `legacy-placement/${child.z}/${child.x}/${child.y}`),
      filePath,
      z: group.z,
      sourceZoom: group.children && group.children[0] ? group.children[0].z : group.z,
      x: group.x,
      y: group.y
    };
  }

  _readFileAsync(filePath) {
    return new Promise((resolve, reject) => {
      const fs = require('fs');
      fs.readFile(filePath, (error, buffer) => error ? reject(error) : resolve(buffer));
    });
  }

  /**
   * Hierarchically pack 256px tiles to minimize layer count.
   * - > 4 tiles in a Z-2 block -> 1024px MegaTile
   * - > 1 tile in a Z-1 block -> 512px MegaTile
   * - 1 tile -> 256px Base Tile
   * @param {Array} tiles - Array of objects { z, x, y, filePath }
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Array>} Array of output tiles ready for AE
   */
  async stitchHierarchical(tiles, onProgress, sourceTileSize) {
    sourceTileSize = sourceTileSize || 256;
    if (!tiles || tiles.length === 0) return [];

    // Group all tiles by their Z level first!
    const tilesByZ = {};
    for (const t of tiles) {
      if (!tilesByZ[t.z]) tilesByZ[t.z] = [];
      tilesByZ[t.z].push(t);
    }

    const allOutputTiles = [];
    let done = 0;
    
    // Calculate total groups across all Z levels for progress
    let totalGroups = 0;
    const z3GroupsByZ = {};
    for (const zStr of Object.keys(tilesByZ)) {
      const baseZ = parseInt(zStr, 10);
      const zTiles = tilesByZ[baseZ];
      
      if (baseZ < 2) {
        // Base Z too small for MegaTiles
        continue;
      }
      
      z3GroupsByZ[baseZ] = {};
      for (const t of zTiles) {
        if (!t.filePath) continue;
        const z3_x = Math.floor(t.x / 8);
        const z3_y = Math.floor(t.y / 8);
        const key = `${baseZ-3}_${z3_x}_${z3_y}`;
        if (!z3GroupsByZ[baseZ][key]) z3GroupsByZ[baseZ][key] = { z: baseZ-3, x: z3_x, y: z3_y, children: [] };
        z3GroupsByZ[baseZ][key].children.push(t);
      }
      totalGroups += Object.keys(z3GroupsByZ[baseZ]).length;
    }

    for (const zStr of Object.keys(tilesByZ)) {
      const baseZ = parseInt(zStr, 10);
      const zTiles = tilesByZ[baseZ];

      if (baseZ < 2) {
        for (const t of zTiles) {
          allOutputTiles.push(this._baseAsset(t));
        }
        continue;
      }

      const z3Groups = z3GroupsByZ[baseZ];

      for (const key of Object.keys(z3Groups)) {
        const z3Group = z3Groups[key];

        if (z3Group.children.length > 16) {
          // Pack into 8x8 blocks
          const canvasSize = 8 * sourceTileSize;
          const megaFilePath = `${this.cacheDir}/mega${canvasSize}_${this.compId}_${this.cacheSignature}_${z3Group.z}_${z3Group.x}_${z3Group.y}.png`;
          const stitchedPath = await this._stitchCanvas(z3Group.children, z3Group.x * 8, z3Group.y * 8, canvasSize, sourceTileSize, megaFilePath);
          if (stitchedPath) {
            allOutputTiles.push(this._megaAsset(z3Group, canvasSize, stitchedPath));
          } else {
            // Fallback: if stitching failed, return original base tiles
            for (const child of z3Group.children) {
              allOutputTiles.push(this._baseAsset(child));
            }
          }
        } else {
          // Group by Z-2 (4x4 blocks -> 1024px)
          const z2Groups = {};
          for (const child of z3Group.children) {
            const z2_x = Math.floor(child.x / 4);
            const z2_y = Math.floor(child.y / 4);
            const z2Key = `${baseZ-2}_${z2_x}_${z2_y}`;
            if (!z2Groups[z2Key]) z2Groups[z2Key] = { z: baseZ-2, x: z2_x, y: z2_y, children: [] };
            z2Groups[z2Key].children.push(child);
          }

          for (const z2Key of Object.keys(z2Groups)) {
            const z2Group = z2Groups[z2Key];
            
            if (z2Group.children.length > 4) {
              // Pack into 4x4 blocks
              const canvasSize = 4 * sourceTileSize;
              const megaFilePath = `${this.cacheDir}/mega${canvasSize}_${this.compId}_${this.cacheSignature}_${z2Group.z}_${z2Group.x}_${z2Group.y}.png`;
              const stitchedPath = await this._stitchCanvas(z2Group.children, z2Group.x * 4, z2Group.y * 4, canvasSize, sourceTileSize, megaFilePath);
              if (stitchedPath) {
                allOutputTiles.push(this._megaAsset(z2Group, canvasSize, stitchedPath));
              } else {
                for (const child of z2Group.children) {
                  allOutputTiles.push(this._baseAsset(child));
                }
              }
            } else {
              // Group by Z-1 (2x2 blocks -> 512px)
              const z1Groups = {};
              for (const child of z2Group.children) {
                const z1_x = Math.floor(child.x / 2);
                const z1_y = Math.floor(child.y / 2);
                const z1Key = `${baseZ-1}_${z1_x}_${z1_y}`;
                if (!z1Groups[z1Key]) z1Groups[z1Key] = { z: baseZ-1, x: z1_x, y: z1_y, children: [] };
                z1Groups[z1Key].children.push(child);
              }

              for (const z1Key of Object.keys(z1Groups)) {
                const z1Group = z1Groups[z1Key];
                if (z1Group.children.length > 1) {
                  // Pack into 2x2 blocks
                  const canvasSize = 2 * sourceTileSize;
                  const megaFilePath = `${this.cacheDir}/mega${canvasSize}_${this.compId}_${this.cacheSignature}_${z1Group.z}_${z1Group.x}_${z1Group.y}.png`;
                  const stitchedPath = await this._stitchCanvas(z1Group.children, z1Group.x * 2, z1Group.y * 2, canvasSize, sourceTileSize, megaFilePath);
                  if (stitchedPath) {
                    allOutputTiles.push(this._megaAsset(z1Group, canvasSize, stitchedPath));
                  } else {
                    for (const child of z1Group.children) {
                      allOutputTiles.push(this._baseAsset(child));
                    }
                  }
                } else {
                  // Keep as base 256px tile
                  const t = z1Group.children[0];
                  allOutputTiles.push(this._baseAsset(t));
                }
              }
            }
          }
        }

        done++;
        if (onProgress) onProgress(done, totalGroups);
      }
    }

    return allOutputTiles;
  }

  _stitchCanvas(children, startX, startY, size, sourceTileSize, outputPath) {
    let spec;
    try {
      spec = this.artifactStore.createSpec(children, startX, startY, size, sourceTileSize, outputPath);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.artifactStore.fingerprintChildren(spec, children).then(prepared =>
      this._scheduleStitch(children, startX, startY, size, sourceTileSize, outputPath, prepared)
    );
  }

  _scheduleStitch(children, startX, startY, size, sourceTileSize, outputPath, prepared) {
    const spec = prepared.spec;
    if (this._destroyed) {
      const cancelled = new Error('MegaTile stitcher was disposed before publication.');
      cancelled.code = 'MEGATILE_CANCELLED';
      return Promise.reject(cancelled);
    }
    const flightKey = `${outputPath}|${spec.cacheSignature}`;
    const active = MegaTileStitcher._singleFlights.get(flightKey);
    if (active) {
      if (this.artifactStore.artifactKind !== 'preview-cache') {
        const conflict = new Error('Finalize MegaTile target is already being produced.');
        conflict.code = 'MEGATILE_FINALIZE_SINGLE_FLIGHT_CONFLICT';
        return Promise.reject(conflict);
      }
      return active.then(() => {
        const manifest = this.artifactStore.validateCache(spec);
        if (!manifest) {
          const error = new Error('Concurrent Preview MegaTile publication did not produce a valid artifact.');
          error.code = 'MEGATILE_SINGLE_FLIGHT_INVALID';
          throw error;
        }
        this._recordCoverage(spec, manifest, true);
        return outputPath;
      });
    }
    const flight = this._stitchCanvasOwned(
      children, startX, startY, size, sourceTileSize, outputPath, spec, prepared.loadedChildren
    );
    MegaTileStitcher._singleFlights.set(flightKey, flight);
    const release = () => {
      if (MegaTileStitcher._singleFlights.get(flightKey) === flight) MegaTileStitcher._singleFlights.delete(flightKey);
    };
    flight.then(release, release);
    return flight;
  }

  _stitchCanvasOwned(children, startX, startY, size, sourceTileSize, outputPath, spec, fingerprintedChildren) {
    return new Promise((resolve, reject) => {
      try {
        if (this._destroyed) {
          const cancelled = new Error('MegaTile stitcher was disposed before cache validation.');
          cancelled.code = 'MEGATILE_CANCELLED';
          throw cancelled;
        }
        const cachedManifest = this.artifactStore.validateCache(spec);
        if (cachedManifest) {
          this._recordCoverage(spec, cachedManifest, true);
          return resolve(outputPath);
        }
        this.artifactStore.assertFinalizeTargetAvailable(spec);
      } catch(error) {
        return reject(error);
      }

      // Worker Route
      if (this.supportsWorker && this.worker) {
        const jobId = ++this.jobCounter;
        this.jobQueue.set(jobId, { resolve, reject, spec });
        
        // Child bytes were read and SHA-256 fingerprinted before the cache
        // decision. Reuse those exact bytes for the Worker to avoid a TOCTOU
        // gap and a second filesystem read.
        (async () => {
          try {
            const loadedChildren = [];
            const transferables = [];
            
            for (const loaded of fingerprintedChildren) {
              const child = loaded.child;
              const nodeBuffer = loaded.buffer;
              // Extract underlying ArrayBuffer from Node Buffer
              const arrayBuffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
              
              loadedChildren.push({
                x: child.x,
                y: child.y,
                buffer: arrayBuffer
              });
              transferables.push(arrayBuffer);
            }
            
            this.worker.postMessage({
              id: jobId,
              children: loadedChildren,
              originalExpectedCount: spec.originalExpectedCount,
              expectedCells: spec.expectedCells,
              startX: startX,
              startY: startY,
              size: size,
              sourceTileSize: sourceTileSize,
              outputPath: outputPath
            }, transferables);
            
          } catch (err) {
            console.error("[MegaTileStitcher] Error reading files for worker:", err);
            this.jobQueue.delete(jobId);
            reject(err);
          }
        })();
        
        return; // Exit here, let worker handle it
      }

      // Legacy Main Thread Fallback (for older CEP versions < CC 2020)
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const promises = fingerprintedChildren.map(loaded => {
        const child = loaded.child;
        return new Promise((res) => {
          const img = new Image();
          img.onload = () => {
            const dx = (child.x - startX) * sourceTileSize;
            const dy = (child.y - startY) * sourceTileSize;
            ctx.drawImage(img, dx, dy, sourceTileSize, sourceTileSize);
            res({ ok: true, x: child.x - startX, y: child.y - startY });
          };
          img.onerror = () => res({ ok: false, x: child.x - startX, y: child.y - startY });
          const mime = loaded.buffer[0] === 0x89 && loaded.buffer[1] === 0x50 ? 'image/png' : 'image/jpeg';
          img.src = `data:${mime};base64,${loaded.buffer.toString('base64')}`;
        });
      });
      
      Promise.all(promises).then((decodeResults) => {
        try {
          const decoded = decodeResults.filter(result => result.ok);
          const decodedCells = decoded.map(result => `${result.x},${result.y}`).sort();
          const report = {
            originalExpectedCount: spec.originalExpectedCount,
            decodedCount: decoded.length,
            decodedCells,
            coverageMask: decodedCells
          };
          this.artifactStore._assertReport(spec, report);
          const dataUrl = canvas.toDataURL('image/png');
          const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
          canvas.width = 0;
          canvas.height = 0;
          this.artifactStore.publish(
            Buffer.from(base64Data, 'base64'), spec, report, () => this._destroyed
          ).then(publication => {
            this._recordCoverage(spec, publication.manifest, publication.cached);
            resolve(outputPath);
          }, reject);
        } catch (e) {
          try { canvas.width = 0; canvas.height = 0; } catch (_ce) {}
          reject(e);
        }
      });
    });
  }
}

MegaTileStitcher._singleFlights = new Map();

if (typeof window !== 'undefined') {
  window.MegaTileStitcher = MegaTileStitcher;
}
