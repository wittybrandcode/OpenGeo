/**
 * OpenGeo — ChunkedFileReader (Repository Storage Delegate)
 *
 * Handles file system paths, safe traversal bounds checks,
 * and chunked asynchronous/synchronous dataset reads.
 */

class ChunkedFileReader {
  /**
   * Resolves the root assets/data directory within CEP or local Node environment.
   * @param {object} pathModule Node.js 'path' module
   * @returns {string|null}
   */
  static resolveDataDir(pathModule) {
    if (!pathModule) return null;
    try {
      const cs = typeof CSInterface !== 'undefined' ? new CSInterface() : (typeof window !== 'undefined' && window.CSInterface ? new window.CSInterface() : null);
      if (cs && typeof window !== 'undefined' && window.SystemPath) {
        const extUri = cs.getSystemPath(window.SystemPath.EXTENSION);
        let extPath = extUri.replace(/^file:\/{2,3}/, '');
        extPath = decodeURIComponent(extPath);
        return pathModule.join(extPath, 'client', 'assets', 'data').replace(/\\/g, '/');
      }
    } catch (e) {
      /* CSInterface extension path resolution fallback */
    }

    try {
      return pathModule.resolve(__dirname, '../../../assets/data').replace(/\\/g, '/');
    } catch (ex) {
      return null;
    }
  }

  /**
   * Safely resolves a dataset file path, preventing directory traversal attacks.
   * @param {string} filename
   * @param {object} pathModule
   * @param {string} dataDir
   * @returns {string|null} Full sanitized path or null if traversal detected
   */
  static resolveDataFile(filename, pathModule, dataDir) {
    if (!filename || !pathModule || !dataDir) return null;
    const root = pathModule.resolve(dataDir);
    const candidate = pathModule.resolve(root, filename);
    const normalizedRoot = (root + pathModule.sep).toLowerCase();
    const normalizedCandidate = candidate.toLowerCase();
    return normalizedCandidate.indexOf(normalizedRoot) === 0 ? candidate : null;
  }

  /**
   * Reads a file synchronously with JSON parsing.
   * @param {string} fullPath
   * @param {object} fsModule
   * @returns {{data: object, bytes: number}|null}
   */
  static readJsonSync(fullPath, fsModule) {
    if (!fsModule || !fsModule.existsSync(fullPath)) return null;
    try {
      const dataStr = fsModule.readFileSync(fullPath, 'utf8');
      return {
        data: JSON.parse(dataStr),
        bytes: dataStr.length
      };
    } catch (e) {
      console.error(`[ChunkedFileReader] Failed to read/parse ${fullPath}:`, e);
      return null;
    }
  }

  /**
   * Reads a file asynchronously with byte limits and JSON parsing.
   * @param {string} fullPath
   * @param {object} fsModule
   * @param {number} [maxBytes=4194304]
   * @returns {Promise<{data: object, bytes: number}|null>}
   */
  static readJsonAsync(fullPath, fsModule, maxBytes = 4194304) {
    if (!fsModule) return Promise.resolve(null);
    return new Promise(resolve => {
      fsModule.stat(fullPath, (statError, stats) => {
        if (statError || !stats || !stats.isFile() || stats.size > maxBytes) {
          if (stats && stats.size > maxBytes) {
            console.warn(`[ChunkedFileReader] File exceeds ${maxBytes} bytes: ${fullPath}`);
          }
          resolve(null);
          return;
        }

        fsModule.readFile(fullPath, 'utf8', (readError, dataStr) => {
          if (readError) {
            console.error(`[ChunkedFileReader] Failed to read ${fullPath}:`, readError);
            resolve(null);
            return;
          }
          try {
            resolve({
              data: JSON.parse(dataStr),
              bytes: stats.size
            });
          } catch (parseError) {
            console.error(`[ChunkedFileReader] Failed to parse ${fullPath}:`, parseError);
            resolve(null);
          }
        });
      });
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChunkedFileReader;
}
if (typeof window !== 'undefined') {
  window.ChunkedFileReader = ChunkedFileReader;
}
