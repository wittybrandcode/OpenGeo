# OpenGeo — Roadmap

> **Phase:** P0 — Foundation (Complete)
> **Version:** 1.0.0
> **Target:** Production-ready CEP extension for After Effects 2025

---

## ✅ P0 — Foundation

- [x] Project structure (Adobe CEP production standards)
- [x] `CSXS/manifest.xml` with `CEFCommandLine`, `MainPath`, `ScriptPath`
- [x] `.debug` remote debugging (port `8088`)
- [x] `PlayerDebugMode` registry configuration
- [x] `lib/CSInterface.js` bundled locally
- [x] `client/js/ae/AEInterface.js` — Promise-based JS ↔ ExtendScript bridge
- [x] `host/index.jsx` + `host/utils.jsx` — ExtendScript API
- [x] `scripts/build.js` — build pipeline

---

## 🗺️ P1 — Tile Engine Core

- [x] `ViewportController.js` — Lat/Lng → Tile math, visible tiles calculation
- [x] `TileCache.js` — LRU memory cache
- [x] `DownloadQueue.js` — priority queue, retry, fallback URLs, browser headers
- [x] `TileEngine.js` — orchestrator, canvas render loop
- [x] `config.js` — tile sources (OSM, OSM.de, OSM.fr, fallback chain)

### Issues Fixed

| Issue | Solution |
|-------|----------|
| OSM 403 blocked | Added real `User-Agent`, `Referer`, `Accept` headers |
| Tile server fails | Fallback chain: `osm → osmDe → osmFr` |
| No cache fallback | `force-cache` mode in fetch |

---

## 🖥️ P2 — CEP Panel UI

- [x] `client/index.html` — compact Adobe Spectrum design
- [x] `client/css/style.css` — dark theme, CSS variables
- [x] Toolbar: zoom in/out, coordinates, center button
- [x] Search bar with Nominatim geocoding
- [x] Settings panel: tile source, tile size
- [x] Bottom bar: New Comp, Settings, status
- [x] SVG icons (inline, no Unicode/emoji)
- [x] Drag-to-pan + wheel zoom on canvas

### Completed

- [x] Loading indicator on tiles (shimmer animation in `_drawShimmer`)
- [x] Attribution display (© OpenStreetMap contributors, bottom-right)

---

## 🔄 P3 — AE Communication

### ExtendScript API (`host/`)
- [x] `initMap(width, height)` → create Comp + Camera
- [x] `moveCamera(compId, x, y, zoom)` → camera position + Z distance
- [x] `addTile(compId, key, x, y, size, filePath)` → import file + image layer
- [x] `removeTile(compId, key)` / `clearTiles(compId)` → cleanup layers
- [x] `getCompState(compId)` → read Comp properties
- [x] `log(msg)` → ExtendScript-side logging
- [x] `calcZoomDistance(zoom)` → zoom → Z position math

### JS Bridge (`client/js/ae/AEInterface.js`)
- [x] `evalScript()` — Promise wrapper with 5s timeout
- [x] `initMap`, `moveCamera`, `addTile`, `removeTile`, `clearTiles`, `getCompState`, `log`

### UI Integration
- [x] **Sync toggle button** — bottom bar, blue highlight when active
- [x] **Auto-create comp** on Sync if none exists
- [x] **Camera sync on pan/zoom** — debounced (80ms) → `moveCamera`
- [x] **Sync off** → disconnect, keep comp open

### Completed
- [x] Camera FOV sync (`cameraOption.zoom = 600 + zoom * 200`)
- [x] Comp resolution auto-matching (matches viewport size on init)
- [x] Tile layer sync (canvas snapshot → base64 → temp file → AE layer via `addTile`)

### Completed
- [x] Incremental tile sync (individual tile layers: `onTileBitmapReady` → save to file → `AE.addTile`, reconcile on viewport change)

---

## ⚡ P4 — Performance

- [x] HiDPI / Retina support (`devicePixelRatio` canvas sizing)
- [x] Throttle AE evalScript calls (80ms debounce via `syncCamera`)
- [x] Smooth pan/zoom animation (inertia: velocity tracking → exponential decay 0.9, threshold 0.5px)
- [x] Resolution cascade (load Z-1 tiles when zooming in, display scaled 2x as placeholders)
- [x] LRU cache tuning (memory limit 200 → 300, stats display in settings panel)
- [x] Placeholder shimmer animation (animated gradient sweep over unloaded tiles)

---

## ✨ P5 — Polish

- [x] Error UI (toast messages with 3 types: info/error/success)
- [x] Dark/Light theme toggle (`theme-light` CSS class, localStorage `opengeo_theme`)
- [x] Last settings persistence (LocalStorage `opengeo_prefs`: source, tileSize, lat, lng, zoom)
- [x] Extension icons (16/48/128 SVG inline, no external images)

---

## 🚀 P6 — Advanced

- [x] Mapbox/Stadia/Cyclo satellite tiles (API key input in Settings, saved to LocalStorage)
- [x] Markers (double-click to add, rendered as circles, Clear button)
- [x] GeoJSON import (file dialog → Point/LineString/Polygon/Multi* rendering as overlays)
- [x] Full Comp export (export canvas → base64 PNG → temp file → AE layer via `addTile`)
- [x] ZXP packaging (scripts/zxp.js with self-signed + signed modes)

---

## Log

| Date | Version | Change | Status |
|------|---------|--------|--------|
| 2026-07-26 | 0.1.0 | Initial project structure | ✅ |
| 2026-07-26 | 0.2.0 | P0 foundation complete | ✅ |
| 2026-07-26 | 0.3.0 | P1 + P2 complete, OSM fix | ✅ |
| 2026-07-26 | 1.0.0 | P3 AE sync: addTile/removeTile/clearTiles, camera zoom + FOV, sync toggle, comp auto-resolution, canvas snapshot → AE | ✅ |
| 2026-07-26 | 1.1.0 | P4 Performance: inertia, resolution cascade, LRU tuning (300), shimmer, HiDPI | ✅ |
| 2026-07-26 | 1.2.0 | P5 Polish: toasts, theme toggle, LocalStorage persistence, icons | ✅ |
| 2026-07-26 | 2.0.0 | P6 Advanced: API keys, markers, GeoJSON, export, ZXP script | ✅ |
