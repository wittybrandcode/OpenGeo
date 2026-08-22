# خطة إصلاح OpenGeo — Fix Plan

---

## 1. مشكلة OSM 403 (Blocked)

### السبب

OpenStreetMap يحظر طلبات الخرائط التي:
- لا تحتوي على `User-Agent` حقيقي (مثل المتصفحات)
- لا تحتوي على `Referer` صحيح
- تأتي من تطبيقات غير معروفة (مثل CEP embedded browser)

### الحل

**قبل:**
```javascript
fetch(url, { mode: 'cors', cache: 'no-cache' })
```

**بعد:**
```javascript
fetch(url, {
  mode: 'cors',
  cache: 'force-cache',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/120...',
    'Accept': 'image/avif,image/webp,image/apng,image/png,image/*,*/*;q=0.8',
    'Referer': 'https://www.openstreetmap.org/'
  }
})
```

**الملف:** `client/js/core/DownloadQueue.js`

---

## 2. مشكلة سلسلة الإمداد (No Fallback)

### السبب

عند فشل OSM، لا يوجد مصدر بديل. التطبيق يتوقف عن العمل.

### الحل

إضافة `fallbackChain` في `config.js`:
```
osm → osmDe (OSM Germany) → osmFr (OSM France)
```

و `DownloadQueue` يحاول URLs متعددة عند فشل الأولى.

**الملف:** `client/js/config.js`, `client/js/core/DownloadQueue.js`

---

## 3. مشكلة manifest.xml (الإضافة لا تظهر)

### السبب

```
- Missing <Resources> with <MainPath>
- Missing <Lifecycle> with <AutoVisible>
- Host Version format wrong (25.0 → [25.0,99.9])
- No <CEFCommandLine>
- CSXS version mismatch (11.0 → 12.0 for AE 2025)
- Icon path wrong (icons/ → client/assets/icons/)
```

### الحل

manifest.xml كامل مع:
- `MainPath`: `./client/index.html`
- `ScriptPath`: `./host/index.jsx`
- `CEFCommandLine`: `--enable-nodejs`, `--mixed-context`, `--allow-file-access-from-files`
- `Host Version`: `[25.0,99.9]`
- `CSXS Version`: `12.0`
- `Lifecycle AutoVisible`: `true`

**الملف:** `CSXS/manifest.xml`

---

## 4. مشكلة الـ PlayerDebugMode

### السبب

`PlayerDebugMode` يجب أن يكون **DWORD (REG_DWORD)** وليس String.

### الحل

```powershell
New-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.12" `
  -Name "PlayerDebugMode" -Value 1 -PropertyType DWord -Force
```

---

## 5. مشكلة هيكل المشروع

### السبب

الملفات كانت مبعثرة بين `src/` وجذر الإضافة بدون تنظيم احترافي.

### الحل

```
OpenGeo/
├── CSXS/manifest.xml
├── client/
│   ├── index.html           ← واجهة المستخدم
│   ├── css/style.css
│   ├── js/
│   │   ├── main.js
│   │   ├── config.js
│   │   ├── core/            ← المحرك (TileEngine, Viewport, Cache, Download)
│   │   └── ae/              ← طبقة التواصل (AEInterface)
│   ├── lib/CSInterface.js   ← مدمج محلياً
│   └── assets/icons/
├── host/
│   ├── index.jsx            ← ExtendScript API
│   └── utils.jsx
├── scripts/build.js
├── .debug                   ← Remote debugging port 8088
├── package.json
└── README.md
```

---

## 6. مشكلة عدم ظهور الخريطة

### الأسباب المحتملة

| المشكلة | الفحص | الحل |
|---------|-------|------|
| CSInterface.js لم يتم تحميله | Console | try-catch حول new CSInterface() |
| Canvas بحجم 0 | فحص clientWidth | setTimeout + resize |
| requestAnimationFrame يفشل | CEP log | fallback إلى render() مباشر |
| fetch محظور | CEP Preferences | تفعيل Allow Scripts to Access Network |

### أدوات التصحيح

1. **Remote Debugging:** `http://localhost:8088` (بعد تفعيل `.debug`)
2. **CEP Log:** `%LOCALAPPDATA%\Temp\CEP12-AEFT.log`
3. **Console:** Right-click panel → Inspect

---

## 7. ملخص التعديلات

| الملف | التعديل |
|-------|---------|
| `CSXS/manifest.xml` | كامل: MainPath, ScriptPath, CEFCommandLine, Lifecycle |
| `client/js/config.js` | 6 tile sources + fallbackChain + getTileUrls() |
| `client/js/core/DownloadQueue.js` | Browser headers + multiple URL fallback |
| `client/js/core/TileEngine.js` | يستخدم getTileUrls() بدل getTileUrl() |
| `.debug` | جديد — remote debugging على port 8088 |
| `client/js/ae/AEInterface.js` | جديد — Promise-based AE communication |
| `host/index.jsx` + `utils.jsx` | جديد — ExtendScript API |
| `client/lib/CSInterface.js` | جديد — مدمج محلياً |
| `scripts/build.js` | جديد — build pipeline |
