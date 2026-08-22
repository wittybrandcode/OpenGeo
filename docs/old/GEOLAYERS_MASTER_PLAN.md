# OpenGeo Master Architecture Blueprint & Engineering Spec (GeoLayers Benchmark)

## 1. Codebase Audit & Architectural Diagnosis

Following a deep audit of the existing codebase (`client/js/`, `host/`), we identified the root technical causes of the current issues and defined the exact architecture required to reach **GeoLayers 3** benchmarks.

### Key Audit Findings

#### 1. Fallback Cross-Pollution Mechanism
* **Source Files:** `client/js/app.js` (lines 188–202), `client/js/config.js` (`fallbackChain`), `client/js/tiles/TileDownloader.js` (lines 99–130).
* **Diagnosis:** `_getTileUrls()` in `app.js` iterates over `config.fallbackChain = ['esri', 'osm']` and attaches OpenStreetMap URLs to every tile download task. When `TileDownloader` hits a rate limit or 404 on an ESRI Satellite tile, `_fetchWithFallback()` increments `task.urlIndex` and fetches the secondary URL (`osm`). This causes vector street map tiles to be rendered directly inside satellite imagery.
* **Resolution:** Eliminate `fallbackChain` across different provider types. Introduce **Parent Zoom Scaling ($z-1$)** inside `TileManager.js` so missing tiles render an upscaled segment of an existing parent tile instead of loading an incompatible provider.

#### 2. Canvas & Export Resolution Bottleneck
* **Source Files:** `client/js/export/PNGExporter.js`, `client/js/map/MapRenderer.js`.
* **Diagnosis:** Exporting to After Effects captures the current DOM HTML5 Canvas (`#map-canvas`), capping export resolution to the CEP panel window size (e.g., 600x400).
* **Resolution:** Build `client/js/export/TileStitcher.js` to render full bounding box matrices onto offscreen canvases at target composition LODs ($2K, 4K, 8K$).

#### 3. Single-Raster Flat Export
* **Source Files:** `client/js/export/AEBridge.js`, `host/index.jsx`.
* **Diagnosis:** `AEBridge.js` calls `opengeoSetMapRaster()`, dropping a single PNG layer into AE without separating satellite imagery, city labels, boundaries, or vector overlays.
* **Resolution:** Refactor `host/index.jsx` to build a **Multi-Comp Hierarchy** with isolated layers (`Base Satellite`, `Labels with Alpha`, `Vector Overlays`, and a `3D Map Camera Null`).

---

## 2. Complete File System Map

```
OpenGeo Extension File Hierarchy:
├── client/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── events/
│   │   │   └── EventBus.js            # Central Pub/Sub event bus
│   │   ├── map/
│   │   │   ├── MercatorProjection.js  # EPSG:3857 math conversion library
│   │   │   ├── Viewport.js            # Viewport center, zoom, bounds state
│   │   │   ├── TileGrid.js            # Visible tile matrix calculator
│   │   │   └── MapRenderer.js         # Canvas rendering engine
│   │   ├── tiles/
│   │   │   ├── MemoryCache.js         # In-memory tile LRU cache
│   │   │   ├── DiskCache.js           # CEP filesystem tile cache
│   │   │   ├── TileDownloader.js      # Async tile fetcher with priority queue
│   │   │   └── TileManager.js         # Tile lifecycle orchestrator
│   │   ├── overlays/
│   │   │   ├── MarkerLayer.js         # Map marker rendering layer
│   │   │   └── GeoJSONLayer.js        # Vector GIS GeoJSON rendering layer
│   │   ├── ui/
│   │   │   ├── InputHandler.js        # Mouse, touch, wheel input capture
│   │   │   ├── SearchPanel.js         # Geocoding & coordinate search
│   │   │   ├── SettingsPanel.js       # UI tile source & theme controls
│   │   │   └── Toast.js               # Notification toast system
│   │   ├── export/
│   │   │   ├── PNGExporter.js         # Canvas to PNG file writer
│   │   │   ├── TileStitcher.js        # [NEW] Offscreen 4K/8K tile stitcher
│   │   │   └── AEBridge.js            # CSInterface ExtendScript bridge
│   │   ├── ae/
│   │   │   ├── AESyncEngine.js        # [NEW] Bi-directional AE camera sync
│   │   │   └── MetadataManager.js     # [NEW] Comp XMP/comment state persistence
│   │   ├── config.js                  # Map provider configuration & metadata
│   │   └── app.js                     # Main application entry point
│   └── index.html                     # CEP extension HTML DOM structure
├── host/
│   ├── index.jsx                      # AE ExtendScript host functions
│   └── utils.jsx                      # AE ExtendScript helper functions
└── docs/
    ├── GEOLAYERS_MASTER_PLAN.md       # Master Architecture Blueprint
    └── task.md                        # Master Engineering Task Matrix
```

---

## 3. Detailed Component Architecture

### 3.1 `TileManager` Parent-Scaling Fallback Algorithm (`tiles/TileManager.js`)
When a tile $(x, y, z)$ is requested and not yet loaded in memory cache:
1. Search `MemoryCache` for parent tile $(\lfloor x/2 \rfloor, \lfloor y/2 \rfloor, z-1)$.
2. If parent exists, crop sub-quadrant $(x \bmod 2, y \bmod 2)$ and render scaled $2\times$ as placeholder.
3. Queue actual tile request $(x, y, z)$ via `TileDownloader`.
4. Replace placeholder seamlessly when high-res tile arrives.

### 3.2 `TileStitcher` Offscreen High-DPI Assembly (`export/TileStitcher.js`)
```
+-------------------------------------------------------------+
| Offscreen Canvas Bounding Box (e.g. 4096 x 4096 px)          |
| +-----------+-----------+-----------+-----------+           |
| | Tile(0,0) | Tile(1,0) | Tile(2,0) | Tile(3,0) |           |
| +-----------+-----------+-----------+-----------+           |
| | Tile(0,1) | Tile(1,1) | Tile(2,1) | Tile(3,1) |           |
| +-----------+-----------+-----------+-----------+           |
|  ...                                                        |
+-------------------------------------------------------------+
```
* Calculates min/max tile bounds $[X_{\min}, X_{\max}] \times [Y_{\min}, Y_{\max}]$ to cover requested AE composition resolution.
* Draws tiles into an offscreen `<canvas>` context without scaling distortion.
* Emits progress events `stitch:progress` for UI progress bar feedback.

### 3.3 Bi-Directional Camera Sync Protocol (`ae/AESyncEngine.js`)
* Listens to AE active comp camera transformations:
  $$\text{Zoom}_{\text{AE}} = \frac{f}{\text{comp.height}} \implies z = \log_2\left(\frac{\text{mapWidth}}{S}\right)$$
* Synchronizes CEP Viewport coordinates with AE camera in real-time ($30\text{ fps}$).

---

## 4. Phased Implementation Roadmap

### Phase 1: Source Isolation & Parent-Tile Scaling [CRITICAL FIX]
- Clean `app.js` `_getTileUrls()`: remove cross-provider `fallbackChain`.
- Implement parent-tile scaling fallback in `TileManager.js`.
- Add `overlays/LayerManager.js` to manage Base Map vs Label overlays separately.

### Phase 2: High-Res Tile Stitcher & Export LOD
- Implement `export/TileStitcher.js` for offscreen 4K/8K tile rendering.
- Add progress bar streaming to `app.js` / `Toast.js`.
- Update `AEBridge.js` to transfer high-res rasters to ExtendScript.

### Phase 3: Bi-Directional AE Sync & Metadata Persistence
- Build `ae/MetadataManager.js` for comp XMP metadata storage.
- Build `ae/AESyncEngine.js` for live AE camera tracking.
- Implement comp selection listener in CEP.

### Phase 4: Multi-Composition Assembly in ExtendScript
- Update `host/index.jsx` to create structured pre-comps (`Base Map`, `Labels Alpha`, `3D Camera Null`).
- Add ExtendScript controls for layer opacity and blending modes.

### Phase 5: 3D Georeferenced Spatial Pinning & Flight Paths
- Build `ae/SpatialPin.js` for WGS84 $\to$ AE 3D space conversion.
- Implement ExtendScript 3D Null placement (`opengeoAddSpatialPin`).
- Build camera trajectory keyframe generator.
