# OpenGeo — Codebase Inventory & Comprehensive Role Taxonomy

> **Scope:** Complete analysis of all 84 core code modules across `client/js/` (70 modules) and `host/` (14 modules).  
> **Taxonomy Classification:**  
> - **[CORE]**: Functional Core (Pure mathematics, projection algorithms, zero I/O, headless).  
> - **[SERVICE]**: Application Domain Service (Business logic, orchestration, session governance).  
> - **[SHELL]**: Imperative Shell / Adapter (Canvas blitting, DOM events, File system I/O, Network).  
> - **[UI]**: UI Controller / Presentation Component (Panels, HUD, dialogs, user interaction).  
> - **[HOST]**: After Effects ExtendScript Module (ECMAScript 3 host commands, timeline, layers).  

---

## 1. Client Architecture Overview

```
client/js/
├── ae/             # [SHELL] Host ExtendScript Bridge & Command Dispatcher (3 modules)
├── core/           # [SERVICE] Application Domain Orchestrators & Managers (15 modules)
├── engine/         # [SERVICE/SHELL] Tile Downloading, Stitching, and Packing (6 modules)
├── events/         # [SERVICE] EventBus & Event Contract Catalog (2 modules)
├── map/            # [CORE/SHELL] Viewport, Projections, and Canvas Rendering (5 modules)
├── overlays/       # [SHELL] Vector GeoJSON & Spatial Pin Rendering (4 modules)
├── tiles/          # [CORE/SHELL] Coverage Math, Caching, and Tile Downloader (9 modules)
├── ui/             # [UI] User Interface Panels, HUD, Dialogs, Inputs (10 modules)
├── app.js          # [SHELL] Application Bootstrap Entrypoint (1 module)
└── MapState.js     # [SERVICE] Central Reactive Map State Container (1 module)
```

---

## 2. Exhaustive File-by-File Taxonomy

### A. Core Bootstrap & Global State

| Path | SLOC | Category | Primary Responsibility | Architectural Health & Target |
| :--- | :---: | :---: | :--- | :--- |
| `client/js/app.js` | 185 | **[SHELL]** | Bootstraps CEP runtime, initializes managers, sets up DOM listeners, handles window resize. | **Good**. Pure orchestrator. Needs strict lifecycle hook formalization. |
| `client/js/MapState.js` | 78 | **[SERVICE]** | Central state holding lat, lng, zoom, pitch, bearing, dimensions. Emits state change events. | **Fair**. Currently allows direct mutations. Target for Unidirectional Data Flow (UDF). |

---

### B. Host Bridge (`client/js/ae/`)

| Path | SLOC | Category | Primary Responsibility | Architectural Health & Target |
| :--- | :---: | :---: | :--- | :--- |
| `client/js/ae/AEInterface.js` | 98 | **[SHELL]** | Low-level wrapper around `CSInterface.evalScript`. Handles Promise wrapping and timeout limits. | **Good**. Solid transport adapter. |
| `client/js/ae/BridgeProtocol.js` | 112 | **[SHELL]** | Serializes/deserializes JSON envelopes between Client and ExtendScript with schema checks. | **Good**. Strictly enforces Bridge Protocol v2. |
| `client/js/ae/CommandDispatcher.js` | 85 | **[SERVICE]** | Dispatches typed commands to AE (`createComp`, `syncCamera`, `importTiles`, `exportPins`). | **Good**. Well-structured typed command map. |

---

### C. Application Core Services (`client/js/core/`)

| Path | SLOC | Category | Primary Responsibility | Architectural Health & Target |
| :--- | :---: | :---: | :--- | :--- |
| `client/js/core/CompositionManager.js` | 145 | **[SERVICE]** | Manages metadata synchronization between active AE composition and CEP client state. | **Fair**. Mixes JSON parsing with AE command formatting. |
| `client/js/core/ExportManager.js` | 210 | **[SERVICE]** | Handles export workflows, trajectory capture triggers, and composition builder payloads. | **Fair**. Target for FSM integration. |
| `client/js/core/FinalizeController.js` | 885 | **[SERVICE]** | Heavy orchestrator for 4K / MegaTile AE export, quality presets, and tile budgets. | **Monolith**. Highly complex (280 cyclomatic). Must be split into StagePlanner and CommitOrchestrator. |
| `client/js/core/GeoDataRepository.js` | 259 | **[SHELL]** | Caches and chunk-reads large GeoJSON vector datasets from local disk storage. | **Monolith**. High entropy (DOM + Math + I/O + Bridge). Target for pure Stream Reader extraction. |
| `client/js/core/MapSession.js` | 279 | **[SERVICE]** | Tracks active composition identity (`compId`, `documentId`), session state, and persistence. | **Good**. Clean transactional hydration. |
| `client/js/core/NetworkPolicy.js` | 42 | **[SERVICE]** | Enforces HTTPS protocol, blocks mixed content, validates external tile URLs. | **Clean**. Single-purpose security policy. |
| `client/js/core/OperationLogger.js` | 229 | **[SHELL]** | Writes structured diagnostics and redactions to disk for debugging and bug reports. | **Good**. Bounded JSONL writer. |
| `client/js/core/PreferencesStore.js` | 38 | **[SERVICE]** | Key-value persistent storage for user UI settings (provider, tile size, cache limits). | **Clean**. Lightweight wrapper over `localStorage`. |
| `client/js/core/PreviewController.js` | 74 | **[SERVICE]** | Manages live preview invalidation and frame-coalesced viewport tile updates. | **Clean**. Simple throttle coordinator. |
| `client/js/core/ProviderManager.js` | 110 | **[SERVICE]** | Registry for map imagery providers (Satellite, OSM, Carto). Validates URLs and attribution. | **Good**. Clean registry pattern. |
| `client/js/core/SecurityPolicy.js` | 26 | **[SERVICE]** | Enforces CSP, DOM sanitization, and safe SVG icon creation without `innerHTML`. | **Clean**. Security boundary. |
| `client/js/core/StateContracts.js` | 55 | **[SERVICE]** | JSON schema contracts for validating MapState and composition metadata migrations. | **Clean**. Data transfer contracts. |
| `client/js/core/StateHydrator.js` | 74 | **[SERVICE]** | Normalizes raw AE composition metadata and applies backward-compatibility defaults. | **Clean**. Clean deserializer. |
| `client/js/core/SyncManager.js` | 425 | **[SERVICE]** | Bi-directional AE camera synchronization, timeline CTI tracking, keyframe extraction. | **Complex**. High cyclomatic complexity (165). Mixes AE polling with trajectory math. |
| `client/js/core/ThumbnailProcessor.js` | 331 | **[SHELL]** | Captures, crops, and encodes PNG thumbnails for saved Project Maps. | **Fair**. Mixes Canvas pixel operations with file saving. |
| `client/js/core/VectorMapManager.js` | 307 | **[SERVICE]** | Manages GeoJSON vector layers, country border queries, and layer styling. | **Fair**. Mixes geometry filtering with AE export commands. |
| `client/js/core/VersionMigrations.js` | 75 | **[SERVICE]** | Migrates legacy N-2 composition schemas to modern 2.2 format. | **Clean**. Pure transformation logic. |

---

### D. Engine & Tile Pipeline (`client/js/engine/`)

| Path | SLOC | Category | Primary Responsibility | Architectural Health & Target |
| :--- | :---: | :---: | :--- | :--- |
| `client/js/engine/DownloadSession.js` | 73 | **[SERVICE]** | Manages cancellation tokens and concurrent batch downloads for a single viewport frame. | **Clean**. Well-isolated concurrency token. |
| `client/js/engine/MegaTileArtifactStore.js` | 331 | **[SHELL]** | Writes stitched MegaTile PNGs to disk, enforces revisions, and manages temporary cleanup. | **Good**. Solid disk storage manager. |
| `client/js/engine/MegaTileStitcher.js` | 374 | **[SHELL]** | Offscreen canvas stitcher combining individual 256x256 tiles into composite MegaTiles. | **Fair**. Complex pixel copying; worker integration works cleanly. |
| `client/js/engine/OpenGeoEngine.js` | 355 | **[SERVICE]** | Master engine linking Viewport, Downloader, Cache, and Renderer into cohesive pipeline. | **Monolith**. High entropy (92 complexity). Needs decomposition into pipeline stages. |
| `client/js/engine/stitcherWorker.js` | 84 | **[SHELL]** | WebWorker script for background MegaTile blitting without blocking UI thread. | **Good**. Isolated worker thread. |
| `client/js/engine/TilePlanner.js` | 88 | **[SERVICE]** | Calculates required tile sets for static framing and multi-keyframe camera trajectories. | **Good**. Delegates well to `CoveragePlanner`. |

---

### E. Events (`client/js/events/`)

| Path | SLOC | Category | Primary Responsibility | Architectural Health & Target |
| :--- | :---: | :---: | :--- | :--- |
| `client/js/events/EventBus.js` | 73 | **[SERVICE]** | Central pub/sub event bus with asynchronous error capture and subscription tracking. | **Clean**. Robust core bus. |
| `client/js/events/EventContracts.js` | 84 | **[SERVICE]** | Typed catalog of all permissible event strings and payload interfaces. | **Clean**. Solid contract governance. |

---

### F. Map & Projections (`client/js/map/`)

| Path | SLOC | Category | Primary Responsibility | Architectural Health & Target |
| :--- | :---: | :---: | :--- | :--- |
| `client/js/map/CameraProjection3D.js` | 145 | **[CORE]** | Calculates 3D perspective projection, pitch matrices, and ground plane intersections. | **Good Core**. Needs separation of pure matrix math from viewport instances. |
| `client/js/map/MapRenderer.js` | 141 | **[SHELL]** | Double-buffered HTML5 Canvas renderer blitting tiles, overlays, and pins. | **Good Shell**. Clean blitting loop. |
| `client/js/map/MercatorProjection.js` | 53 | **[CORE]** | Pure Spherical Mercator (EPSG:3857) math: latLngToPoint and pointToLatLng. | **Pristine Core**. 100% pure function candidate. |
| `client/js/map/TileGrid.js` | 18 | **[CORE]** | Helper methods for grid row/col bounding. | **Pristine Core**. Tiny pure utility. |
| `client/js/map/UniversalGeoParser.js` | 400 | **[CORE]** | Parses GeoJSON, KML, and TopoJSON into normalized coordinate arrays. | **Fair**. Large parsing functions; pure, but high cyclomatic complexity. |
| `client/js/map/Viewport.js` | 163 | **[SERVICE]** | Camera viewport state, zoomAtGeoPoint, panning, and coordinate translation. | **Critical Core**. Mixes state, zoom math, and interaction coordinate anchors. |

---

### G. Overlays (`client/js/overlays/`)

| Path | SLOC | Category | Primary Responsibility | Architectural Health & Target |
| :--- | :---: | :---: | :--- | :--- |
| `client/js/overlays/FeatureOverlayLayer.js` | 75 | **[SHELL]** | Base class for rendering vector shapes onto canvas. | **Clean**. Clean abstraction. |
| `client/js/overlays/GeoJSONLayer.js` | 116 | **[SHELL]** | Renders arbitrary user GeoJSON features onto the map canvas. | **Good**. Solid rendering delegate. |
| `client/js/overlays/MarkerLayer.js` | 63 | **[SHELL]** | Renders spatial pin markers, labels, and anchor points. | **Clean**. Simple canvas marker blitter. |
| `client/js/overlays/VectorPreviewLayer.js` | 366 | **[SHELL]** | High-performance vector border preview using pre-indexed Natural Earth geometries. | **Fair**. Complex polygon clipping logic. |

---

### H. Tiles & Caching (`client/js/tiles/`)

| Path | SLOC | Category | Primary Responsibility | Architectural Health & Target |
| :--- | :---: | :---: | :--- | :--- |
| `client/js/tiles/CachePolicy.js` | 21 | **[CORE]** | Computes HTTP caching directives and expiration timestamps. | **Clean Core**. Pure helper. |
| `client/js/tiles/CoverageContract.js` | 185 | **[CORE]** | Validates tile coverage bounds, row/col ranges, and overscan descriptors. | **Good Core**. Strict contract checking. |
| `client/js/tiles/CoveragePlanner.js` | 82 | **[CORE]** | Calculates visible tile coordinates with 3D pitch overscan and horizon gutter. | **Key Core**. Pure algorithm; works flawlessly with pitch-3d. |
| `client/js/tiles/MemoryCache.js` | 51 | **[SERVICE]** | In-memory LRU cache storing decoded Image objects with memory budget eviction. | **Clean**. Standard LRU cache. |
| `client/js/tiles/PlacementExpander.js` | 115 | **[CORE]** | Expands tile bounding box for 4K / wide angle camera frames. | **Clean Core**. Pure bounding calculation. |
| `client/js/tiles/TileAddress.js` | 81 | **[CORE]** | Value object representing (x, y, z) tile coordinates with hashing and validation. | **Pristine Core**. Pure immutable value object. |
| `client/js/tiles/TileDownloader.js` | 204 | **[SHELL]** | Concurrent HTTP tile fetcher with retry backoff, queue priority, and memory deduplication. | **Good Shell**. Well-tested async queue. |
| `client/js/tiles/TileManager.js` | 169 | **[SERVICE]** | Facade over Downloader, MemoryCache, and CoveragePlanner. | **Fair**. Good service coordinator. |
| `client/js/tiles/TileTransport.js` | 76 | **[SHELL]** | Low-level fetch wrapper enforcing HTTPS, timeouts, and byte limits. | **Clean Shell**. Single-purpose network adapter. |

---

### I. User Interface Controllers (`client/js/ui/`)

| Path | SLOC | Category | Primary Responsibility | Architectural Health & Target |
| :--- | :---: | :---: | :--- | :--- |
| `client/js/ui/DialogManager.js` | 139 | **[UI]** | Theme-native custom modal dialogs (alerts, confirmations, prompts) replacing browser alerts. | **Clean UI**. Accessible modal controller. |
| `client/js/ui/InputHandler.js` | 253 | **[UI]** | Captures mouse drag, wheel zoom, 3D pitch tilt, and keyboard navigation. | **Fair UI**. Complex coordinate conversions; delegates to Viewport. |
| `client/js/ui/LayersPanel.js` | 82 | **[UI]** | Drawer panel managing active vector layers, visibility toggles, and deletion. | **Clean UI**. Simple list renderer. |
| `client/js/ui/LocationHudController.js` | 336 | **[UI]** | Live HUD displaying lat/lng, zoom, pitch angle scrubber, and AE camera sync status. | **Complex UI**. Contains coordinate formatting and angle scrub math (114 complexity). |
| `client/js/ui/OperationPresenter.js` | 133 | **[UI]** | Progress bars, loading spinners, and status text for long-running export/download operations. | **Clean UI**. Status presenter. |
| `client/js/ui/PinManager.js` | 195 | **[UI]** | Manages spatial pin creation, icon selection, color pickers, and AE pin synchronization. | **Fair UI**. Mixes UI form logic with pin metadata creation. |
| `client/js/ui/ProjectMapsPanel.js` | 414 | **[UI]** | Grid panel displaying saved maps, thumbnail previews, renaming, and one-click comp opening. | **Fair UI**. Handles file system listings and thumbnail rendering. |
| `client/js/ui/SearchPanel.js` | 513 | **[UI]** | Geocoding search input, autocomplete list, country outline selection, and camera framing. | **Complex UI**. Monolithic search view (227 complexity). Mixes search API with vector staging. |
| `client/js/ui/SettingsPanel.js` | 115 | **[UI]** | Settings modal for cache clearing, tile size selection, and debug logging toggles. | **Clean UI**. Simple form binding. |
| `client/js/ui/Toast.js` | 42 | **[UI]** | Non-intrusive floating toast notifications for user feedback. | **Clean UI**. Tiny UI utility. |
| `client/js/ui/ToolbarController.js` | 595 | **[UI]** | Main navigation toolbar, tool mode toggles (Pan, Pin, Draw, Measure), and export button. | **Complex UI**. Monolithic event wiring. |
| `client/js/ui/TooltipManager.js` | 138 | **[UI]** | Custom theme-styled tooltips for HUD and toolbar buttons. | **Clean UI**. Simple overlay manager. |

---

## 3. After Effects ExtendScript Architecture (`host/`)

All modules in `host/` run in the single-threaded, ECMAScript 3 engine of Adobe After Effects.

| Path | SLOC | Category | Primary Responsibility | Architectural Assessment & Directives |
| :--- | :---: | :---: | :--- | :--- |
| `host/index.jsx` | 13 | **[HOST]** | Entrypoint file that `#include`s all other modules in deterministic order. | **Clean**. Master include table. |
| `host/modules/bridgeDispatcher.jsx` | 88 | **[HOST]** | Receives JSON string from CEP, routes command to appropriate module, wraps in error envelope. | **Good**. Command router. Needs strict IIFE encapsulation. |
| `host/modules/cameraRig.jsx` | 197 | **[HOST]** | Builds the 3D Camera Rig: MapPivot (3D Null), Camera, and OpenGeo Controller (3D Null with sliders). | **Critical Host**. Complex layer parenting and expression wiring. |
| `host/modules/compBuilder.jsx` | 93 | **[HOST]** | Creates map compositions (`mapComp`), sets dimensions, framerate, and duration. | **Clean**. Pure composition factory. |
| `host/modules/compositionAssets.jsx` | 65 | **[HOST]** | Creates footage folders (`OpenGeo Assets`), imports footage files, and avoids duplicates. | **Good**. Folder/Footage manager. |
| `host/modules/compositionResult.jsx` | 7 | **[HOST]** | Serializes host response objects into JSON strings. | **Tiny Utility**. Simple serializer. |
| `host/modules/compositionRig.jsx` | 197 | **[HOST]** | Ensures Controller Null and sliders (`Zoom`, `Pitch`, `Bearing`) exist on active composition. | **Good**. Rig assertion service. |
| `host/modules/compositionTiles.jsx` | 51 | **[HOST]** | Places MegaTile layers onto the comp, enables 3D collapsed transformation, sets blend modes. | **Good**. Tile layer placer. |
| `host/modules/compositionTransaction.jsx` | 458 | **[HOST]** | Atomic staging/commit engine for tiles and layers. Handles rollbacks on import failure. | **Complex Host**. High cyclomatic complexity (197). Must enforce IIFE and null cleanup. |
| `host/modules/helpers.jsx` | 156 | **[HOST]** | Utility functions: JSON polyfill, string trimming, color conversion, logging. | **Needs Cleanup**. Root `var` declarations must be encapsulated in `$._opengeo.helpers`. |
| `host/modules/metadataSync.jsx` | 381 | **[HOST]** | Reads/writes OpenGeo JSON descriptors stored inside `comp.comment`. Migrates legacy schemas. | **Solid Host**. Robust metadata serializer. |
| `host/modules/projectMapsHost.jsx` | 200 | **[HOST]** | Scans AE project items, locates OpenGeo compositions, matches `documentId`, returns comp list. | **Good**. Clean discovery queries. |
| `host/modules/spatialPinHost.jsx` | 236 | **[HOST]** | Creates 3D spatial pins, applies auto-orient / camera billboarding expressions, links to MapPivot. | **Good**. Well-structured pin builder. |
| `host/modules/trajectoryScanner.jsx` | 142 | **[HOST]** | Extracts camera keyframes (Position, Zoom, Pitch, Bearing) across the timeline. | **Good**. Timeline trajectory extractor. |
| `host/modules/vectorHost.jsx` | 753 | **[HOST]** | Converts GeoJSON polygons/lines into AE Shape Layers with bezier paths, strokes, fills. | **Monolith**. Massive file (388 complexity). Prime candidate for decomposition. |
