# OpenGeo — Interactive Map Extension for After Effects

CEP extension that displays an interactive world map inside After Effects, with tile loading, pan, zoom, and camera synchronization.

## Installation

Copy `OpenGeo/` to:

**Windows:**
- `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
- or `%appdata%\Adobe\CEP\extensions\`

Then open After Effects → `Window → Extensions → OpenGeo`.

## Development

### Enable Debug Mode

```powershell
New-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.12" -Name "PlayerDebugMode" -Value 1 -PropertyType DWord -Force
```

### Remote Debugging

1. Ensure `.debug` file exists in extension root
2. Restart After Effects
3. Open `http://localhost:8088` in Chrome
4. Or use `chrome://inspect`

### Project Structure

```
OpenGeo/
├── CSXS/manifest.xml          (Adobe CEP Manifest)
├── client/
│   ├── index.html
│   ├── css/style.css
│   ├── assets/                (Icons, GeoJSON data)
│   └── js/
│       ├── core/              (Managers: Export, Sync, Provider, Vector)
│       ├── engine/            (MegaTileStitcher, OpenGeoEngine)
│       ├── map/               (MapRenderer, TileGrid, Viewport)
│       ├── tiles/             (Caches, Downloaders)
│       ├── ui/                (Panels, Search, Toast)
│       └── app.js             (Bootstrap logic)
├── host/
│   ├── index.jsx              (AE ExtendScript entry)
│   └── modules/               (compBuilder, spatialPinHost, etc)
├── scripts/
│   ├── build.js               (Build pipeline)
│   ├── test.js                (Smoke & Security tests)
│   └── verify-package.js      (Quality Gate)
└── docs/
```

## Build & Release

We use automated scripts to test, verify, and pack the extension to ensure security and integrity.

```bash
# Run tests
npm test

# Build the release (Copies files to release/stage, excluding dev files)
npm run build

# Run all tests, build, sync versions, verify package, and create a ZXP
npm run package:zxp
```

## Communication

JS ↔ AE: Use `AEInterface.evalScript()` from `client/js/ae/AEInterface.js`.
