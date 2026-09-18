# OpenGeo — Geospatial Engine for Adobe After Effects

![Version](https://img.shields.io/badge/version-1.0.1-emerald)
![Tests](https://img.shields.io/badge/tests-162%2F162%20passed-brightgreen)
![Adobe CEP](https://img.shields.io/badge/Adobe%20CEP-10%2B%20%7C%2011%2B%20%7C%2012%2B-blue)
![After Effects](https://img.shields.io/badge/After%20Effects-2022--2025%2B-purple)

**OpenGeo** is an enterprise-grade interactive geospatial map engine and CEP extension for Adobe After Effects. It enables motion designers, VFX artists, and animators to seamlessly navigate, frame, and synchronize high-resolution geographic map animations directly inside After Effects compositions.

---

## ✨ Key Features

* **Native 3D Camera Rig & Tilt:**
  * Interactive map pitch up to 45° with live HUD angle scrubbers.
  * Frustum-based edge-to-edge tile overscan to completely eliminate boundary clipping and black void seams.
  * True 3D ground-plane collapse (`threeDLayer`) with automatic camera billboarding for pins and labels.

* **High-Performance Multi-Provider Tile Engine:**
  * Multi-source imagery (Satellite Photogrammetry, OpenStreetMap, Carto Dark/Light).
  * Transactional tile downloading with in-memory caching and LRU eviction.
  * Deterministic MegaTile stitching with transparency fallbacks and bounded memory limits.

* **Spatial Pins & Vector GeoJSON:**
  * 3D spatial pin anchoring with dynamic scale compensation and layer parenting.
  * GeoJSON vector boundary rendering (countries, regions, custom polygons) directly as native After Effects shape layers.

* **Bi-Directional Camera Synchronization:**
  * Real-time CTI (Current Time Indicator) timeline scrubbing sync.
  * Keyframe trajectory recording (`Record`, `Add Key`, `Clear`) with smooth Bézier spatial interpolation.
  * Project Maps management: instant local map saves, thumbnails, and one-click workspace recall.

---

## 🚀 Installation

### Option 1: Automated Release ZIP
1. Download the latest `OpenGeo-v1.0.1.zip` from [Releases](https://github.com/wittybrandcode/OpenGeo/releases).
2. Extract the archive directly into your Adobe CEP extensions folder:
   * **Windows:** `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\OpenGeo`
     *(or `%APPDATA%\Adobe\CEP\extensions\OpenGeo`)*
   * **macOS:** `/Library/Application Support/Adobe/CEP/extensions/OpenGeo`
     *(or `~/Library/Application Support/Adobe/CEP/extensions/OpenGeo`)*
3. Restart Adobe After Effects.
4. Launch OpenGeo from **Window → Extensions → OpenGeo**.

---

## 🛠️ Development & Testing

### Enable Debug Mode
```powershell
# Windows
New-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.12" -Name "PlayerDebugMode" -Value 1 -PropertyType DWord -Force
```

### Verification & Quality Gate
OpenGeo enforces strict architectural integrity, supply chain provenance, and zero-regression automated test suites:

```bash
# Run Master QA Test Suite (162 automated tests)
npm test

# Verify package structure & release integrity
npm run verify:package

# Verify release bundle
npm run verify:release
```

---

## 📂 Architecture Overview

```
OpenGeo/
├── CSXS/                      # Adobe CEP Extension Manifest
├── client/                    # HTML5 / Chromium Panel UI
│   ├── css/                   # Precision emerald UI design tokens
│   ├── js/
│   │   ├── ae/                # Host ExtendScript bridge & event dispatcher
│   │   ├── core/              # SyncManager, ExportManager, VectorManager
│   │   ├── engine/            # OpenGeoEngine, TilePlanner, MegaTileStitcher
│   │   ├── map/               # Viewport, MapRenderer, CameraProjection3D
│   │   ├── tiles/             # CoveragePlanner, TileDownloader, TileCache
│   │   └── ui/                # HUD, Search, PinManager, Toast, DialogManager
├── host/                      # Adobe After Effects ExtendScript Modules
│   ├── index.jsx              # Main ExtendScript entrypoint & router
│   └── modules/               # compositionTiles, cameraRig, spatialPinHost, vectorHost
├── docs/                      # Architectural Decision Records (ADRs) & Specifications
└── scripts/                   # Verification gates, security audits, build runners
```

---

## 📄 License & Release Notes

For detailed release history and changes, see [CHANGELOG.md](CHANGELOG.md).  
OpenGeo is licensed and maintained by **wittybrandcode**.
