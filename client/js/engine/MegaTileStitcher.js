class MegaTileStitcher {
  constructor(cacheDir, compId, cacheSignature) {
    this.cacheDir = cacheDir.replace(/\\/g, '/').replace(/\/$/, '');
    this.compId = compId || 'global';
    this.cacheSignature = String(cacheSignature || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    this.coverageReports = [];
    
    // Worker Lifecycle Management (Singleton per instance)
    this.supportsWorker = typeof window.Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
    if (this.supportsWorker) {
      this.worker = new Worker('js/engine/stitcherWorker.js?v=5');
      this.jobQueue = new Map();
      this.jobCounter = 0;
      
      this.worker.onmessage = (e) => {
        const { id, status, buffer, outputPath, error, decodedCount, expectedCount, coverageMask } = e.data;
        const job = this.jobQueue.get(id);
        if (job) {
          this.jobQueue.delete(id);
          if (status === 'success') {
            const fs = require('fs');
            // Keep filesystem writes outside the CEP UI task. Resolve the
            // worker job only after the buffer is durably handed to Node.
            fs.writeFile(outputPath, Buffer.from(buffer), writeError => {
              if (writeError) {
                console.error("[MegaTileStitcher] FS Error writing worker buffer:", writeError);
                job.reject(writeError);
                return;
              }
              this.coverageReports.push({
                outputPath,
                decodedCount: decodedCount || 0,
                expectedCount: expectedCount || 0,
                coverageMask: coverageMask || [],
                cached: false
              });
              job.resolve(outputPath);
            });
          } else {
            console.error("[MegaTileStitcher] Worker Error:", error);
            job.reject(new Error(error));
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

  _baseAsset(tile) {
    return {
      placementKey: tile.placementKey || `legacy-placement/${tile.z}/${tile.x}/${tile.y}`,
      downloadKey: tile.downloadKey || null,
      sourcePlacementKeys: [tile.placementKey || `legacy-placement/${tile.z}/${tile.x}/${tile.y}`],
      filePath: tile.filePath,
      z: tile.z,
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
    return new Promise((resolve, reject) => {
      try {
          if (typeof require !== 'undefined') {
            const fs = require('fs');
            if (fs.existsSync(outputPath)) {
              const stat = fs.statSync(outputPath);
            if (stat.size > 1000) {
              this.coverageReports.push({
                outputPath,
                decodedCount: children.length,
                expectedCount: children.length,
                coverageMask: [],
                cached: true
              });
              return resolve(outputPath);
            }
          }
        } else {
          const cepFs = window.cep && window.cep.fs;
          if (cepFs) {
            const stat = cepFs.stat(outputPath);
            if (stat.err === 0 && stat.data && stat.data.size > 1000) {
              this.coverageReports.push({
                outputPath,
                decodedCount: children.length,
                expectedCount: children.length,
                coverageMask: [],
                cached: true
              });
              return resolve(outputPath);
            }
          }
        }
      } catch(e) {}

      // Worker Route
      if (this.supportsWorker && this.worker) {
        const jobId = ++this.jobCounter;
        this.jobQueue.set(jobId, { resolve, reject });
        
        // Node.js fs is available in the main thread of CEP.
        // We read the files into Node Buffers, convert them to ArrayBuffers, 
        // and send the raw memory directly to the worker.
        (async () => {
          try {
            const loadedChildren = [];
            const transferables = [];
            
            for (const child of children) {
              let nodeBuffer;
              try { nodeBuffer = await this._readFileAsync(child.filePath); }
              catch (readError) { continue; }
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
      const promises = children.map(child => {
        return new Promise((res) => {
          const img = new Image();
          img.onload = () => {
            const dx = (child.x - startX) * sourceTileSize;
            const dy = (child.y - startY) * sourceTileSize;
            ctx.drawImage(img, dx, dy, sourceTileSize, sourceTileSize);
            res({ ok: true, x: child.x - startX, y: child.y - startY });
          };
          img.onerror = () => res({ ok: false, x: child.x - startX, y: child.y - startY });
          img.src = "file:///" + child.filePath;
        });
      });
      
      Promise.all(promises).then((decodeResults) => {
        try {
          const decoded = decodeResults.filter(result => result.ok);
          if (decoded.length === 0) throw new Error('MegaTile contains no decodable child tiles');
          this.coverageReports.push({
            outputPath,
            decodedCount: decoded.length,
            expectedCount: children.length,
            coverageMask: decoded.map(result => `${result.x},${result.y}`),
            cached: false
          });
          const dataUrl = canvas.toDataURL('image/png');
          const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
          
          if (typeof require !== 'undefined') {
            const fs = require('fs');
            fs.writeFile(outputPath, Buffer.from(base64Data, 'base64'), writeError => {
              if (writeError) reject(writeError);
              else resolve(outputPath);
            });
          } else {
            const cepFs = window.cep && window.cep.fs;
            if (cepFs) {
              const enc = (window.cep && window.cep.encoding && window.cep.encoding.Base64) || 'Base64';
              const writeResult = cepFs.writeFile(outputPath, base64Data, enc);
              if (writeResult.err === 0) resolve(outputPath);
              else reject(new Error('Write failed'));
            } else resolve(null);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
  }
}

if (typeof window !== 'undefined') {
  window.MegaTileStitcher = MegaTileStitcher;
}
