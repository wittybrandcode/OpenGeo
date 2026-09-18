# OpenGeo — Modular Decomposition & Refactoring Specification

> **Governance:** Zero Functional Regressions | Zero API Breaking Changes  
> **Pattern:** Façade Pattern + Functional Core Extraction  

---

## 1. Specification 01: `client/js/engine/OpenGeoEngine.js`

### A. Problem Diagnosis
* **SLOC:** 355 | **Complexity:** 92 | **Entropy:** 4 Domains (DOM UI, Geo Math, Network I/O, AE Bridge).
* **Violations:**
  * Coordinates Viewport, TileManager, and Renderer while also listening directly to AE bridge events and managing UI status notifications.
  * Violates SRP by handling both operational workflow orchestration and direct data synchronization.

### B. Target Decomposition

```
client/js/engine/
├── OpenGeoEngine.js              # [Façade] Keeps existing constructor & public API intact
├── pipeline/
│   ├── TilePipelineSession.js    # [Service] Manages current frame tile planning, fetch, and blit
│   └── EngineSyncBridge.js       # [Adapter] Listens to AE CTI & camera sync events
```

### C. Façade Preservation Contract
The following methods on `OpenGeoEngine` must remain 100% backward-compatible:
* `constructor(options)`
* `setProvider(providerId)`
* `setTileSize(size)`
* `invalidate(options)`
* `destroy()`

---

## 2. Specification 02: `client/js/map/Viewport.js`

### A. Problem Diagnosis
* **SLOC:** 163 | **Complexity:** 54 | **Entropy:** 3 Domains (Interaction Anchoring, Camera State, Frustum Math).
* **Violations:**
  * Coordinates pan, zoom, pitch, and bearing while also calculating inverse ground-plane intersections and screen-point anchors.
  * When mouse wheel zoom was fixed (`zoomAtGeoPoint`), the calculation was added directly into `Viewport.js`.

### B. Target Decomposition

```
client/js/map/
├── Viewport.js                   # [Façade] Unchanged public interface
├── core/
│   ├── ViewportTransform.js      # [Core] Pure screen-to-geo and geo-to-screen matrix math
│   └── ViewportAnchor.js         # [Core] Calculates zoomAtGeoPoint anchor offsets
```

### C. Façade Preservation Contract
* `latLngToPoint(lat, lng)`
* `pointToLatLng(point)`
* `zoomAtGeoPoint(newZoom, geoLat, geoLng, px, py)`
* `getBounds()`
* `setPitch(degrees)` / `getPitch()`

---

## 3. Specification 03: `client/js/core/GeoDataRepository.js`

### A. Problem Diagnosis
* **SLOC:** 259 | **Complexity:** 120 | **Entropy:** 4 Domains (Disk I/O, GeoJSON parsing, In-memory chunk cache, AE bridge logging).
* **Violations:**
  * Mixes low-level Node.js `fs` file streaming with high-level GeoJSON coordinate normalization and caching logic.

### B. Target Decomposition

```
client/js/core/repository/
├── GeoDataRepository.js          # [Façade] Existing public methods preserved
├── ChunkedFileReader.js          # [Shell] Pure file system chunk streaming
└── GeometryMemoryCache.js        # [Service] LRU in-memory store for parsed geometry chunks
```

---

## 4. Specification 04: `host/modules/vectorHost.jsx`

### A. Problem Diagnosis
* **SLOC:** 753 | **Complexity:** 388 | **Language:** ExtendScript ES3.
* **Violations:**
  * The single largest file in the entire repository.
  * Handles GeoJSON point-to-bezier coordinate projection, After Effects Shape Layer creation, Vector Group hierarchy, Stroke/Fill styling, and Expression injection.
  * Lacks top-level IIFE encapsulation, polluting the ExtendScript global scope.

### B. Target Decomposition

```
host/modules/
├── vectorHost.jsx                # [Dispatcher] Routes commands: importGeoJson, updateVectorStyle
├── vector/
│   ├── vectorPathBuilder.jsx     # [Builder] Converts Geo coordinates to Shape() bezier vectors
│   ├── vectorLayerFactory.jsx    # [Factory] Creates ShapeLayers, sets 3D orientation & controller parenting
│   └── vectorStyleEngine.jsx     # [Styler] Sets stroke color, width, dash array, fill, and opacity
```

### C. ExtendScript Safety Envelope
Every new submodule must be strictly wrapped:
```javascript
(function(context) {
    'use strict';
    if (!context.vector) { context.vector = {}; }
    context.vector.pathBuilder = { ... };
})($._opengeo);
```

---

## 5. Specification 05: Universal ExtendScript IIFE & Memory Teardown (`host/modules/*.jsx`)

### A. Problem Diagnosis
* 13 host modules are loaded into After Effects without individual IIFE closures.
* In `helpers.jsx`, root-level `var` statements are exposed to the global scope.
* Heavy AE objects (`FootageItem`, `CompItem`, `AVLayer`) are not explicitly set to `null` on task completion, creating risk of RAM retention in After Effects.

### B. Target Refactoring Protocol
1. Encapsulate all modules in `(function(context) { ... })($._opengeo);`.
2. Wrap all host operations in atomic `app.beginUndoGroup()` / `app.endUndoGroup()`.
3. Add a mandatory `finally` block in long-running operations:
   ```javascript
   var comp = null;
   var footage = null;
   try {
       comp = app.project.activeItem;
       // ... work ...
   } finally {
       comp = null;
       footage = null;
   }
   ```
