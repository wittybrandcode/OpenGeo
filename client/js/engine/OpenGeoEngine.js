/**
 * OpenGeo Engine v2 — Pure JavaScript IIFE bundle for CEP.
 * Contains: GeoMath, Camera, TileGrid, TileDownloader, Engine
 */
var OpenGeo = (function () {

  // ============================
  // GeoMath
  // ============================
  var TILE_SIZE = 256;

  var GeoMath = {
    TILE_SIZE: TILE_SIZE,

    lon2tile: function (lon, zoom) {
      return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
    },
    lat2tile: function (lat, zoom) {
      return Math.floor(
        ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) *
          Math.pow(2, zoom)
      );
    },
    tile2lon: function (x, z) {
      return (x / Math.pow(2, z)) * 360 - 180;
    },
    tile2lat: function (y, z) {
      var n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
      return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    },
    lonToWorldPixel: function (lon, zoom) {
      return ((lon + 180) / 360) * TILE_SIZE * Math.pow(2, zoom);
    },
    latToWorldPixel: function (lat, zoom) {
      var latRad = (lat * Math.PI) / 180;
      var mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
      return ((1 - mercN / Math.PI) / 2) * TILE_SIZE * Math.pow(2, zoom);
    }
  };

  // ============================
  // Camera
  // ============================
  function Camera(init) {
    init = init || {};
    this._state = {
      lat: init.lat != null ? init.lat : 0,
      lon: init.lon != null ? init.lon : 0,
      zoom: init.zoom != null ? init.zoom : 2,
      viewportWidth: init.viewportWidth != null ? init.viewportWidth : 1920,
      viewportHeight: init.viewportHeight != null ? init.viewportHeight : 1080
    };
  }
  Camera.prototype.getState = function () { return this._state; };
  Camera.prototype.setPosition = function (lat, lon) {
    this._state.lat = Math.max(-85.05, Math.min(85.05, lat));
    this._state.lon = ((lon + 180) % 360 + 360) % 360 - 180;
  };
  Camera.prototype.setZoom = function (zoom) {
    this._state.zoom = Math.max(0, Math.min(19, zoom));
  };
  Camera.prototype.setViewport = function (w, h) {
    this._state.viewportWidth = w;
    this._state.viewportHeight = h;
  };

  // ============================
  // Coverage adapter — all geometry is owned by shared CoveragePlanner.
  // ============================
  function TileGrid(urlTemplate) {
    this._url = urlTemplate || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  }
  TileGrid.prototype.setUrlTemplate = function (t) { this._url = t; };
  TileGrid.prototype.getVisibleTiles = function (cam) {
    var baseZoom = Math.floor(cam.zoom);
    var tiles = CoveragePlanner.planComposition(
      { lat: cam.lat, lon: cam.lon, zoom: cam.compZoom !== undefined ? cam.compZoom : baseZoom },
      {
        width: cam.viewportWidth || cam.compWidth || 1920,
        height: cam.viewportHeight || cam.compHeight || 1080,
        downloadZoom: baseZoom,
        tileSize: GeoMath.TILE_SIZE
      }
    );
    for (var index = 0; index < tiles.length; index++) {
      var tile = tiles[index];
      tile.url = this._url.replace('{z}', baseZoom).replace('{x}', tile.wrappedX).replace('{y}', tile.y);
    }
    return tiles;
  };

  // ============================
  // TileDownloader
  // ============================
  function TileDownloader(cacheDir, maxConcurrent) {
    this._cacheDir = cacheDir.replace(/\\/g, '/').replace(/\/$/, '');
    this._max = maxConcurrent || 20;
    this._active = 0;
    this._queue = [];
    this._cancelled = false;
    this._activeRequests = [];
    this._cacheNamespace = 'default';
  }

  TileDownloader.prototype.downloadBatch = function (tiles, onProgress) {
    var self = this;
    self._cancelled = false;
    var results = [];
    var done = 0;
    var total = tiles.length;
    var promises = tiles.map(function (tile) {
      return self.downloadSingle(tile).then(function (r) {
        done++;
        results.push(r);
        if (onProgress) onProgress(done, total, r);
        return r;
      });
    });
    return Promise.all(promises).then(function () { return results; });
  };

  TileDownloader.prototype.downloadSingle = function (tile) {
    if (this._cancelled) return Promise.resolve({ tile: tile, status: 'cancelled', filePath: null });
    var fpPng = this.filePath(tile, '.png');
    if (this._exists(fpPng)) {
      return Promise.resolve({ tile: tile, status: 'complete', filePath: fpPng });
    }
    var fpJpg = this.filePath(tile, '.jpg');
    if (this._exists(fpJpg)) {
      return Promise.resolve({ tile: tile, status: 'complete', filePath: fpJpg });
    }
    var self = this;
    return new Promise(function (resolve) {
      self._queue.push({ tile: tile, resolve: resolve });
      self._flush();
    });
  };

  TileDownloader.prototype.filePath = function (tile, ext) {
    ext = ext || '.png';
    return this._cacheDir + '/' + CachePolicy.diskFilename(this._cacheNamespace, tile, ext);
  };

  TileDownloader.prototype.setCacheNamespace = function (namespace) {
    this._cacheNamespace = CachePolicy.sanitizeNamespace(namespace);
  };

  TileDownloader.prototype._flush = function () {
    var self = this;
    if (self._cancelled) {
      while (self._queue.length) {
        var cancelledItem = self._queue.shift();
        cancelledItem.resolve({ tile: cancelledItem.tile, status: 'cancelled', filePath: null });
      }
      return;
    }
    while (self._active < self._max && self._queue.length > 0) {
      var item = self._queue.shift();
      self._active++;
      (function (it) {
        self._fetch(it.tile).then(function (r) {
          self._active--;
          it.resolve(r);
          self._flush();
        });
      })(item);
    }
  };

  TileDownloader.prototype._fetch = function (tile, attempt) {
    attempt = attempt || 1;
    var self = this;
    if (self._cancelled) return Promise.resolve({ tile: tile, status: 'cancelled', filePath: null });
    return self._httpGet(tile.url).then(function (res) {
      if (self._cancelled) return { tile: tile, status: 'cancelled', filePath: null };
      var ext = res.ext || '.png';
      var fp = self.filePath(tile, ext);
      if (self._write(fp, res.buffer)) {
        return { tile: tile, status: 'complete', filePath: fp };
      }
      return { tile: tile, status: 'error', filePath: null, error: 'fs write failed' };
    }).catch(function (err) {
      if (self._cancelled) return { tile: tile, status: 'cancelled', filePath: null };
      if (attempt < 3) {
        return new Promise(function(resolve) {
          setTimeout(function() {
            resolve(self._fetch(tile, attempt + 1));
          }, attempt * 1000);
        });
      }
      console.error('[TileDownloader] ' + tile.key + ' failed after 3 attempts', err);
      return { tile: tile, status: 'error', filePath: null, error: err.message || String(err) };
    });
  };

  TileDownloader.prototype._httpGet = function (url) {
    if (typeof TileTransport === 'undefined') return Promise.reject(new Error('Shared TileTransport is unavailable'));
    return TileTransport.request(url, { responseType: 'arraybuffer', timeoutMs: 15000, minBytes: 500, maxBytes: 16 * 1024 * 1024 }).promise.then(function (buf) {
      var header = new Uint8Array(buf, 0, 4);
      var isPng = (header[0] === 0x89 && header[1] === 0x50);
      var isJpg = (header[0] === 0xFF && header[1] === 0xD8);
      if (!isPng && !isJpg) throw new Error('Not a valid PNG/JPG image');
      return { buffer: buf, ext: isJpg ? '.jpg' : '.png' };
    });
  };

  TileDownloader.prototype.cancelAll = function () {
    this._cancelled = true;
    for (var i = 0; i < this._activeRequests.length; i++) {
      try { this._activeRequests[i].abort(); } catch (ignoreAbort) {}
    }
    this._activeRequests = [];
    this._flush();
  };

  TileDownloader.prototype._toBase64 = function (buf) {
    var bytes = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  };

  TileDownloader.prototype._write = function (fp, buffer) {
    try {
      this._mkdir(this._cacheDir);
      if (typeof require !== 'undefined') {
        var fs = require('fs');
        fs.writeFileSync(fp, Buffer.from(buffer));
        return true;
      } else {
        var cepFs = window.cep && window.cep.fs;
        if (!cepFs) return false;
        var b64 = this._toBase64(buffer);
        var enc = (window.cep && window.cep.encoding && window.cep.encoding.Base64) || 'Base64';
        return cepFs.writeFile(fp, b64, enc).err === 0;
      }
    } catch (e) { return false; }
  };

  TileDownloader.prototype._mkdir = function (dir) {
    try {
      if (typeof require !== 'undefined') {
        var fs = require('fs');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      } else {
        var cepFs = window.cep && window.cep.fs;
        if (cepFs && cepFs.stat(dir).err !== 0) cepFs.makedir(dir);
      }
    } catch (e) {}
  };

  TileDownloader.prototype._exists = function (fp) {
    try {
      if (typeof require !== 'undefined') {
        var fs = require('fs');
        if (fs.existsSync(fp)) {
          var stat = fs.statSync(fp);
          if (stat.size < 500) {
            fs.unlinkSync(fp);
            return false;
          }
          // JPEG magic bytes check
          if (fp.slice(-4).toLowerCase() === '.png') {
            try {
              var fd = fs.openSync(fp, 'r');
              var buffer = Buffer.alloc(2);
              fs.readSync(fd, buffer, 0, 2, 0);
              fs.closeSync(fd);
              if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
                console.log('[TileDownloader] Purging misnamed JPEG file:', fp);
                fs.unlinkSync(fp);
                return false;
              }
            } catch (ex) {}
          }
          return true;
        }
        return false;
      } else {
        var cepFs = window.cep && window.cep.fs;
        if (!cepFs) return false;
        var stat = cepFs.stat(fp);
        if (stat.err !== 0) return false;
        if (stat.data && stat.data.size < 500) {
          cepFs.deleteFile(fp);
          return false;
        }
        if (fp.slice(-4).toLowerCase() === '.png') {
          var enc = (window.cep && window.cep.encoding && window.cep.encoding.Base64) || 'Base64';
          var readRes = cepFs.readFile(fp, enc);
          if (readRes.err === 0 && readRes.data) {
            try {
              var raw = atob(readRes.data.slice(0, 32));
              if (raw.charCodeAt(0) === 0xFF && raw.charCodeAt(1) === 0xD8) {
                console.log('[TileDownloader] Purging misnamed JPEG file:', fp);
                cepFs.deleteFile(fp);
                return false;
              }
            } catch (ex) {}
          }
        }
        return true;
      }
    } catch(e) { return false; }
  };

  // ============================
  // Engine
  // ============================
  function Engine(config) {
    this._camera = new Camera({ viewportWidth: config.compWidth || 1920, viewportHeight: config.compHeight || 1080 });
    this._tileGrid = new TileGrid(config.urlTemplate);
    this._downloader = new TileDownloader(config.cacheDir, config.maxConcurrent || 6);
  }

  Engine.prototype.setCamera = function (lat, lon, zoom) {
    this._camera.setPosition(lat, lon);
    if (zoom !== undefined) this._camera.setZoom(zoom);
  };
  Engine.prototype.setZoom = function (z) { this._camera.setZoom(z); };
  Engine.prototype.setViewport = function (w, h) { this._camera.setViewport(w, h); };
  Engine.prototype.getCameraState = function () { return this._camera.getState(); };
  Engine.prototype.setUrlTemplate = function (t) { this._tileGrid.setUrlTemplate(t); };
  Engine.prototype.setCacheNamespace = function (namespace) { this._downloader.setCacheNamespace(namespace); };

  Engine.prototype.sync = function (onProgress, qualityOffset) {
    var cam = this._camera.getState();
    var offset = (qualityOffset !== undefined) ? qualityOffset : -2;
    var downloadZoom = Math.max(0, Math.min(19, Math.floor(cam.zoom + offset)));
    
    var modifiedCam = {
      lat: cam.lat,
      lon: cam.lon,
      zoom: downloadZoom,
      compZoom: cam.compZoom || cam.zoom,
      compWidth: cam.compWidth,
      compHeight: cam.compHeight,
      viewportWidth: cam.viewportWidth,
      viewportHeight: cam.viewportHeight
    };
    
    var visible = this._tileGrid.getVisibleTiles(modifiedCam);

    return this._downloader.downloadBatch(visible, function (c, t) {
      if (onProgress) onProgress(c, t);
    }).then(function (results) {
      var ok = [];
      var errors = [];
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (r.status === 'complete' && r.filePath) {
          var tObj = { key: r.tile.key, filePath: r.filePath, pixelX: r.tile.pixelX, pixelY: r.tile.pixelY, z: r.tile.z, x: r.tile.x, y: r.tile.y };
          ok.push(tObj);
        } else {
          errors.push(r);
        }
      }
      if (errors.length) console.warn('[OpenGeo.Engine] ' + errors.length + ' tiles failed');
      return { tiles: ok, errors: errors, camera: { lat: cam.lat, lon: cam.lon, zoom: cam.zoom, viewportWidth: cam.viewportWidth, viewportHeight: cam.viewportHeight } };
    });
  };

  Engine.prototype.downloadTiles = function (tiles, onProgress) {
    return this._downloader.downloadBatch(tiles, onProgress);
  };
  Engine.prototype.cancelDownloads = function () { this._downloader.cancelAll(); };

  Engine.getDefaultCacheDir = function () {
    try {
      var cs = new CSInterface();
      var uri = cs.getSystemPath(SystemPath.USER_DATA);
      var p = uri.replace(/^file:\/{2,3}/, '');
      p = decodeURIComponent(p).replace(/\\/g, '/');
      return p + '/OpenGeo_TileCache';
    } catch (e) {
      return 'C:/Users/Public/OpenGeo_TileCache';
    }
  };

  // Public API
  return {
    GeoMath: GeoMath,
    Camera: Camera,
    TileGrid: TileGrid,
    TileDownloader: TileDownloader,
    Engine: Engine
  };

})();
