# OpenGeo: نظام جودة العرض والتجهيز النهائي (Quality Workflow & Finalize)

> **الرؤية:**
> بناء نظام احترافي ذكي يعمل بصمت في الخلفية أثناء العمل بجودة مخفضة (Draft)،
> ويوفر زراً واحداً **Finalize** يقوم بتحميل البلاطات بأعلى جودة عند الرندر النهائي.
> هذا النموذج مستوحى من سلوك GeoLayers ومبني على البنية الهندسية الحالية لـ OpenGeo.

---

## جدول المحتويات

1. [تحليل الوضع الحالي وما يجب تغييره](#1-تحليل-الوضع-الحالي-وما-يجب-تغييره)
2. [الفلسفة الجديدة: Always-On Draft + Finalize](#2-الفلسفة-الجديدة-always-on-draft--finalize)
3. [مستويات الجودة والمعادلات الرياضية](#3-مستويات-الجودة-والمعادلات-الرياضية)
4. [آلية عمل Finalize بالتفصيل](#4-آلية-عمل-finalize-بالتفصيل)
5. [آلية التزامن التلقائي (Always-On Sync)](#5-آلية-التزامن-التلقائي-always-on-sync)
6. [التغييرات المطلوبة في واجهة المستخدم (UI)](#6-التغييرات-المطلوبة-في-واجهة-المستخدم-ui)
7. [التغييرات المطلوبة في المحرك (Engine)](#7-التغييرات-المطلوبة-في-المحرك-engine)
8. [التغييرات المطلوبة في جسر AE (ExtendScript)](#8-التغييرات-المطلوبة-في-جسر-ae-extendscript)
9. [التغييرات المطلوبة في التطبيق (App.js)](#9-التغييرات-المطلوبة-في-التطبيق-appjs)
10. [خريطة الملفات المتأثرة](#10-خريطة-الملفات-المتأثرة)
11. [خطة التنفيذ خطوة بخطوة](#11-خطة-التنفيذ-خطوة-بخطوة)
12. [خطة الاختبار والتحقق](#12-خطة-الاختبار-والتحقق)

---

## 1. تحليل الوضع الحالي وما يجب تغييره

### 1.1 الأزرار الحالية ومشاكلها

| الزر | الدور الحالي | المشكلة |
|------|-------------|---------|
| **New Comp** | ينشئ كومبوزيشن جديدة ويفعّل Live Sync | ✅ سليم — يبقى كما هو |
| **Sync** | تشغيل/إيقاف المزامنة الحية يدوياً | ❌ لا معنى له — المزامنة يجب أن تعمل دائماً |
| **Export** | يصدّر اللقطة الحالية فقط | ❌ لا معنى له — الـ Sync التلقائي يقوم بهذا |
| **Bake** | يمسح الـ Timeline ويحمل كل البلاطات | ❌ مفهوم خاطئ — يجب أن يندمج في Finalize |
| **Keyframe** | يضيف كايفريم للموقع الحالي في AE | ✅ سليم — يبقى كما هو |
| **GeoJSON** | يحمل ملف GeoJSON | ✅ سليم — يبقى كما هو |
| **Clear** | يمسح العلامات | ✅ سليم — يبقى كما هو |

### 1.2 ملخص القرارات

```
الأزرار التي تُزال:    Sync, Export, Bake
الأزرار التي تُضاف:    Finalize
الأزرار التي تبقى:     New Comp, Keyframe, GeoJSON, Clear, Settings
الميزات الجديدة:       قائمة اختيار جودة Finalize + Auto-Sync Always-On
```

---

## 2. الفلسفة الجديدة: Always-On Draft + Finalize

### 2.1 المبدأ الأساسي

```
┌───────────────────────────────────────────────────────────────────────┐
│                    سير العمل الاحترافي (Pro Workflow)                  │
│                                                                       │
│   ┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐   │
│   │  New Comp    │────▶│  العمل في AE │────▶│     Finalize        │   │
│   │  (يُنشئ +   │     │  (Draft Auto │     │  (High Quality      │   │
│   │   يُفعّل      │     │   Sync)      │     │   Render-Ready)     │   │
│   │   الـ Sync) │     │              │     │                     │   │
│   └─────────────┘     └──────────────┘     └─────────────────────┘   │
│         ▲                    ▲                        ▲               │
│         │                    │                        │               │
│    جودة Draft           جودة Draft              جودة عالية          │
│    (Zoom - 2)           (Zoom - 2)           (Zoom + 0 / +1 / +2)   │
│    تلقائي               تلقائي                 يدوي بالضغط          │
└───────────────────────────────────────────────────────────────────────┘
```

### 2.2 شرح كل مرحلة

#### المرحلة الأولى: New Comp
- المستخدم يختار موقعاً في الخريطة ويضغط **New Comp**.
- يُنشئ الكومبوزيشن في AE ويبدأ الـ **Auto-Sync** فوراً.
- تُحمَّل البلاطات بجودة **Draft** (منخفضة) تلقائياً.

#### المرحلة الثانية: العمل في AE (التحريك والتصميم)
- المستخدم يضع **Keyframes** لحركة الكاميرا.
- يتحرك في الـ Timeline، يغير المواقع، يضبط الزوم.
- في كل لحظة، الـ Sync التلقائي يرصد موقع الكاميرا ويحمل البلاطات **Draft** اللازمة بصمت.
- After Effects يعمل بسرعة لأن البلاطات قليلة (Zoom منخفض = عدد أقل بكثير).
- الصورة تبدو "مبكسلة" قليلاً لكن كافية لرؤية المشهد والعمل.

#### المرحلة الثالثة: Finalize
- عند الانتهاء من كل التصميم والحركة، يضغط **Finalize**.
- يختار الجودة المطلوبة من القائمة (Normal / High / Ultra).
- الإضافة تمسح الـ Timeline بالكامل (Work Area)، تحسب كل البلاطات المرئية في كادر الكومبوزيشن.
- تحمل البلاطات بالجودة العالية المحددة.
- تضعها في الكومبوزيشن بجانب بلاطات Draft (أو تستبدلها).
- النتيجة: رندر نهائي بدقة فائقة الوضوح.

---

## 3. مستويات الجودة والمعادلات الرياضية

### 3.1 جدول مستويات الجودة

| المستوى | الاسم | Zoom Offset | عدد البلاطات التقريبي | الاستخدام |
|---------|-------|-------------|----------------------|-----------|
| Draft | مسودة | `compZoom - 2` | ~5-20 بلاطة | أثناء العمل والتصميم (Auto-Sync) |
| Normal | عادي | `compZoom + 0` | ~20-80 بلاطة | جودة متوسطة (Finalize) |
| High | عالي | `compZoom + 1` | ~80-300 بلاطة | جودة عالية (Finalize) |
| Ultra | فائق | `compZoom + 2` | ~300-1200 بلاطة | أقصى جودة (Finalize) |

### 3.2 المعادلة الرياضية لحساب Zoom التحميل

```
downloadZoom = Math.floor(compZoom + qualityOffset)
```

حيث:
- `compZoom` = مستوى الزوم الحقيقي للكومبوزيشن (من MapState).
- `qualityOffset` = الإزاحة حسب مستوى الجودة:
  - Draft: `-2`
  - Normal: `0`
  - High: `+1`
  - Ultra: `+2`

### 3.3 لماذا يعمل هذا رياضياً؟

المعادلة الموجودة حالياً في `index.jsx` هي:

```javascript
var scaleFactor = Math.pow(2, baseZoom - tile.z);
```

هذا يعني:
- إذا كان `baseZoom = 15` وبلاطة `tile.z = 13` (Draft)، فإن `scaleFactor = 4`.
  البلاطة ستُكبَّر 4 مرات لتغطي المساحة الصحيحة. الصورة مبكسلة لكن سريعة.
- إذا كان `baseZoom = 15` وبلاطة `tile.z = 16` (High)، فإن `scaleFactor = 0.5`.
  البلاطة ستُصغَّر للنصف. دقة فائقة لأن كل بكسل في الكومبوزيشن يُمثَّل ببكسلين من البلاطة.

**النتيجة:** الكود الحالي في AE جاهز بالفعل لاستقبال بلاطات بأي مستوى زوم ووضعها في المكان الصحيح بدقة مطلقة!

### 3.4 حساب عدد البلاطات لكل مستوى

عند كل زيادة بمقدار 1 في الـ Zoom، يتضاعف عدد البلاطات أفقياً وعمودياً (أي يتضاعف 4 مرات إجمالاً):

```
عدد البلاطات ≈ ceil(compWidth / 256) × ceil(compHeight / 256) × 4^(qualityOffset)
```

مثال عملي لكومبوزيشن 1920×1080:
```
Draft  (offset -2): ceil(1920/256) × ceil(1080/256) ÷ 16  ≈  8 × 5 ÷ 16  ≈  3 بلاطات
Normal (offset  0): ceil(1920/256) × ceil(1080/256)        ≈  8 × 5        ≈  40 بلاطة
High   (offset +1): ceil(1920/256) × ceil(1080/256) × 4    ≈  8 × 5 × 4    ≈  160 بلاطة
Ultra  (offset +2): ceil(1920/256) × ceil(1080/256) × 16   ≈  8 × 5 × 16   ≈  640 بلاطة
```

---

## 4. آلية عمل Finalize بالتفصيل

### 4.1 المخطط الانسيابي

```
المستخدم يضغط Finalize
         │
         ▼
┌─────────────────────────────┐
│  1. قراءة مستوى الجودة      │
│     المحدد من القائمة        │
│     (Normal / High / Ultra)  │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│  2. استدعاء opengeoGetTimelineTrajectory    │
│     من ExtendScript لقراءة مسار الكاميرا    │
│     من أول إلى آخر فريم في Work Area        │
│     (قراءة Latitude, Longitude, Zoom        │
│      عند كل فريم)                           │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│  3. لكل فريم في المسار:                     │
│     - حساب downloadZoom =                   │
│       floor(frameZoom + qualityOffset)       │
│     - حساب البلاطات المرئية في كادر         │
│       الكومبوزيشن عند هذا الفريم             │
│     - إضافة البلاطات الفريدة إلى مجموعة     │
│       التحميل (Set) لمنع التكرار             │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│  4. تحميل جميع البلاطات الفريدة             │
│     من الإنترنت إلى الذاكرة المحلية          │
│     (مع شريط تقدم Progress Bar)             │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│  5. إرسال البلاطات إلى AE عبر              │
│     opengeoBuildComposition                  │
│     (البلاطات الجديدة تُضاف بجانب القديمة   │
│      لأن الكود يتخطى البلاطات الموجودة)      │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│  6. إشعار المستخدم بالانتهاء                │
│     "Finalize complete: X tiles imported"    │
└─────────────────────────────────────────────┘
```

### 4.2 حساب البلاطات المرئية في كادر الكومبوزيشن

لكل فريم في مسار الكاميرا، نحتاج لحساب أي بلاطات ستظهر فعلاً داخل حدود الكومبوزيشن
(وليس خارجها). هذا هو المنطق:

```javascript
function getCompVisibleTiles(lat, lon, compZoom, compWidth, compHeight, qualityOffset) {
    // 1. حساب Zoom التحميل
    const downloadZoom = Math.max(0, Math.min(19, Math.floor(compZoom + qualityOffset)));
    
    // 2. حساب مركز الكاميرا بالبكسل العالمي عند compZoom
    const worldCenterX = GeoMath.lonToWorldPixel(lon, compZoom);
    const worldCenterY = GeoMath.latToWorldPixel(lat, compZoom);
    
    // 3. حساب حدود الكومبوزيشن بالبكسل العالمي
    const left   = worldCenterX - compWidth / 2;
    const right  = worldCenterX + compWidth / 2;
    const top    = worldCenterY - compHeight / 2;
    const bottom = worldCenterY + compHeight / 2;
    
    // 4. تحويل الحدود إلى أرقام بلاطات عند downloadZoom
    //    مع مراعاة فرق المقياس بين compZoom و downloadZoom
    const scale = Math.pow(2, downloadZoom - compZoom);
    const tileSize = 256;
    
    const minTileX = Math.floor((left * scale) / tileSize) - 1;
    const maxTileX = Math.floor((right * scale) / tileSize) + 1;
    const minTileY = Math.max(0, Math.floor((top * scale) / tileSize) - 1);
    const maxTileY = Math.min(Math.pow(2, downloadZoom),
                              Math.floor((bottom * scale) / tileSize) + 1);
    
    // 5. تجميع البلاطات
    const tiles = [];
    for (let tx = minTileX; tx <= maxTileX; tx++) {
        for (let ty = minTileY; ty <= maxTileY; ty++) {
            const wrappedX = ((tx % Math.pow(2, downloadZoom)) + Math.pow(2, downloadZoom))
                             % Math.pow(2, downloadZoom);
            tiles.push({
                x: wrappedX,
                y: ty,
                z: downloadZoom,
                key: downloadZoom + '/' + wrappedX + '/' + ty
            });
        }
    }
    return tiles;
}
```

### 4.3 لماذا لا نستبدل بلاطات Draft بـ High Quality؟

**نضيفها بجانبها، لا نستبدلها.** السبب:
- بلاطات Draft تكون بزوم مختلف (مثلاً z=13)، بينما بلاطات High Quality بزوم أعلى (مثلاً z=16).
- في `index.jsx` الحالي، كل بلاطة لها اسم فريد `tile_Z_X_Y`. لذا لن يحدث تكرار.
- عند الرندر، AE سيعرض كل الطبقات فوق بعضها. البلاطات عالية الجودة ستُغطي البلاطات المنخفضة لأنها أعلى في ترتيب الطبقات (أحدث = أعلى).

---

## 5. آلية التزامن التلقائي (Always-On Sync)

### 5.1 التغيير الجوهري

```
الوضع الحالي:
  - المزامنة تحتاج تفعيل يدوي بزر Sync.
  - تعمل بنفس جودة الكومبوزيشن (compZoom).

الوضع الجديد:
  - المزامنة تبدأ تلقائياً بمجرد إنشاء الكومبوزيشن (New Comp).
  - تعمل دائماً بجودة Draft (compZoom - 2).
  - لا يوجد زر تشغيل/إيقاف.
```

### 5.2 مخطط عمل Auto-Sync

```
AESyncEngine يستطلع AE كل 100ms (10fps)
         │
         ▼
هل تغير موقع الكاميرا في AE؟
    ├── لا ──► لا شيء
    └── نعم
         │
         ▼
تحديث MapState بالإحداثيات الجديدة
         │
         ▼
حساب البلاطات المرئية بجودة Draft
(downloadZoom = compZoom - 2)
         │
         ▼
تحميل البلاطات الناقصة (التي ليست في الـ Cache)
         │
         ▼
إرسالها إلى AE عبر opengeoBuildComposition
         │
         ▼
المستخدم يرى الخريطة فوراً في AE (بجودة مبكسلة قليلاً)
```

### 5.3 أداء Draft مقابل Normal

| المقياس | Normal (compZoom) | Draft (compZoom - 2) | التحسن |
|---------|-------------------|----------------------|--------|
| عدد البلاطات لكل فريم | ~40 | ~3 | **13x أسرع** |
| حجم البيانات لكل فريم | ~2.5 MB | ~150 KB | **16x أخف** |
| طبقات في AE Comp | ~40 | ~3 | **AE أسرع بكثير** |
| زمن التحميل | ~3 ثوانٍ | ~0.2 ثانية | **15x أسرع** |

---

## 6. التغييرات المطلوبة في واجهة المستخدم (UI)

### 6.1 الشريط السفلي الجديد

```html
<!-- الشريط السفلي (Bottom Bar) — بعد التعديل -->

[New Comp]  [Settings]  [Keyframe]  [Quality: ▼Normal]  [★ Finalize]  [GeoJSON]  [Clear]

<!-- الأزرار المحذوفة: Sync, Export, Bake -->
```

### 6.2 تفاصيل عنصر اختيار الجودة

```html
<select id="finalize-quality" class="quality-select">
    <option value="normal">Normal</option>
    <option value="high">High</option>
    <option value="ultra" selected>Ultra</option>
</select>
```

### 6.3 تفاصيل زر Finalize

```html
<button class="bottom-btn finalize-btn" id="finalize-btn" title="Finalize: Download high quality tiles for render">
    <svg viewBox="0 0 16 16">
        <path d="M8 1l2.5 5 5.5.8-4 3.9.9 5.3L8 13.5 3.1 16l.9-5.3-4-3.9 5.5-.8z"
              fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>
    Finalize
</button>
```

### 6.4 الملف المتأثر: `client/index.html`

التعديلات:
1. حذف أزرار `sync-btn`, `export-btn`, `bake-btn`.
2. إضافة `<select id="finalize-quality">` قبل زر Finalize.
3. إضافة زر `finalize-btn`.
4. الإبقاء على `keyframe-btn`, `create-comp-btn`, `settings-btn`, `load-geojson-btn`, `clear-markers-btn`.

### 6.5 تنسيق CSS الجديد (ملف `client/css/style.css`)

```css
/* قائمة اختيار الجودة */
.quality-select {
    background: rgba(255, 255, 255, 0.08);
    color: #ccc;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 10px;
    cursor: pointer;
    outline: none;
    height: 24px;
}

.quality-select:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
}

/* زر Finalize — يبرز عن بقية الأزرار */
.finalize-btn {
    background: linear-gradient(135deg, rgba(76, 175, 80, 0.25), rgba(76, 175, 80, 0.1));
    border: 1px solid rgba(76, 175, 80, 0.4) !important;
    color: #81c784;
}

.finalize-btn:hover {
    background: linear-gradient(135deg, rgba(76, 175, 80, 0.4), rgba(76, 175, 80, 0.2));
    color: #a5d6a7;
}
```

---

## 7. التغييرات المطلوبة في المحرك (Engine)

### 7.1 إضافة `qualityOffset` إلى `MapState.js`

```javascript
// في MapState.js — إضافة خاصية جديدة
class MapState {
    constructor() {
        // ... الخصائص الحالية ...
        
        // Quality offset for tile downloads
        // Draft = -2 (auto-sync)
        // Normal = 0, High = +1, Ultra = +2 (finalize)
        this.qualityOffset = -2; // Default: Draft during work
    }
    
    // حساب zoom التحميل
    getDownloadZoom() {
        return Math.max(0, Math.min(19,
            Math.floor(this.compZoom + this.qualityOffset)
        ));
    }
}
```

### 7.2 تعديل `OpenGeoEngine.js` — دالة `sync()`

حالياً تستخدم `Math.floor(cam.zoom)` مباشرة. يجب أن تأخذ `qualityOffset` بعين الاعتبار:

```javascript
Engine.prototype.sync = function (onProgress, qualityOffset) {
    var self = this;
    var cam = this._camera.getState();
    // استخدام qualityOffset لحساب zoom التحميل
    var offset = (qualityOffset !== undefined) ? qualityOffset : -2;
    var downloadZoom = Math.max(0, Math.min(19, Math.floor(cam.zoom + offset)));
    
    // تمرير downloadZoom بدلاً من cam.zoom
    var modifiedCam = {
        lat: cam.lat,
        lon: cam.lon,
        zoom: downloadZoom,
        viewportWidth: cam.viewportWidth,
        viewportHeight: cam.viewportHeight
    };
    var visible = this._tileGrid.getVisibleTiles(modifiedCam);
    // ...
};
```

### 7.3 إضافة دالة `getVisibleTilesForComp()` إلى `TileGrid`

دالة جديدة تحسب البلاطات المرئية بناءً على أبعاد الكومبوزيشن (وليس أبعاد الـ Canvas):

```javascript
// في TileGrid.js أو كدالة مستقلة
static getCompVisibleTiles(lat, lon, compZoom, compWidth, compHeight, downloadZoom) {
    const tileSize = 256;
    const n = Math.pow(2, downloadZoom);
    
    // مركز الكاميرا بالبكسل العالمي عند downloadZoom
    const centerWorldX = ((lon + 180) / 360) * tileSize * n;
    const latRad = lat * Math.PI / 180;
    const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    const centerWorldY = ((1 - mercN / Math.PI) / 2) * tileSize * n;
    
    // نسبة المقياس بين compZoom و downloadZoom
    const scale = Math.pow(2, downloadZoom - compZoom);
    
    // حدود الكومبوزيشن بالبكسل العالمي عند downloadZoom
    const halfW = (compWidth / 2) * scale;
    const halfH = (compHeight / 2) * scale;
    
    const minTX = Math.floor((centerWorldX - halfW) / tileSize) - 1;
    const maxTX = Math.floor((centerWorldX + halfW) / tileSize) + 1;
    const minTY = Math.max(0, Math.floor((centerWorldY - halfH) / tileSize) - 1);
    const maxTY = Math.min(n - 1, Math.floor((centerWorldY + halfH) / tileSize) + 1);
    
    const tiles = [];
    for (let tx = minTX; tx <= maxTX; tx++) {
        for (let ty = minTY; ty <= maxTY; ty++) {
            const wrappedX = ((tx % n) + n) % n;
            const key = downloadZoom + '/' + wrappedX + '/' + ty;
            tiles.push({ x: wrappedX, y: ty, z: downloadZoom, key: key });
        }
    }
    return tiles;
}
```

---

## 8. التغييرات المطلوبة في جسر AE (ExtendScript)

### 8.1 لا تحتاج تغييرات جذرية!

الكود الحالي في `host/index.jsx` جاهز بالفعل لاستقبال بلاطات من أي مستوى Zoom:

```javascript
// هذا السطر الموجود حالياً يتعامل مع أي zoom تلقائياً:
var scaleFactor = Math.pow(2, baseZoom - tile.z);
tileLayer.property("Scale").setValue([scaleFactor * 100, scaleFactor * 100]);
```

**ما يحدث:**
- بلاطة Draft (z=13 عندما baseZoom=15): `scaleFactor = 4` → تُكبَّر 400%
- بلاطة Normal (z=15 عندما baseZoom=15): `scaleFactor = 1` → بدون تغيير
- بلاطة High (z=16 عندما baseZoom=15): `scaleFactor = 0.5` → تُصغَّر 50%

كل هذا يحدث تلقائياً بفضل المعادلة الرياضية الموجودة.

### 8.2 التغيير الوحيد المطلوب

تعديل `opengeoGetTimelineTrajectory` ليأخذ عينات كل N فريم بدلاً من كل فريم
(لتسريع عملية Finalize على تايملاين طويل):

```javascript
function opengeoGetTimelineTrajectory(compId, sampleEveryN) {
    // ...
    var step = (sampleEveryN || 1) / fps;
    for (var t = start; t <= end; t += step) {
        // ...
    }
}
```

---

## 9. التغييرات المطلوبة في التطبيق (App.js)

### 9.1 إزالة الأكواد القديمة

```diff
  // حذف:
- document.getElementById('export-btn').addEventListener(...)
- document.getElementById('bake-btn').addEventListener(...)
- document.getElementById('sync-btn').addEventListener(...)

  // حذف الدوال:
- _queueAutoExport()
- _bakeTimeline()
  
  // حذف المتغيرات:
- this.autoSync
- this.exportTimer
```

### 9.2 تفعيل Auto-Sync دائماً عند New Comp

```javascript
document.getElementById('create-comp-btn').addEventListener('click', () => {
    this.syncEngine.setLiveSync(true); // يعمل دائماً
    this._exportToAE(true);
});
```

### 9.3 إضافة دالة `_finalize()`

```javascript
async _finalize() {
    if (!this.activeCompId) {
        globalEventBus.emit('toast:show', {
            message: 'No active comp! Create one first.',
            type: 'error'
        });
        return;
    }

    // 1. قراءة الجودة المحددة
    const qualitySelect = document.getElementById('finalize-quality');
    const quality = qualitySelect ? qualitySelect.value : 'normal';
    const qualityOffset = { normal: 0, high: 1, ultra: 2 }[quality] || 0;

    globalEventBus.emit('ui:status', {
        message: 'Finalize: Scanning timeline...',
        isError: false
    });

    // 2. قراءة مسار الكاميرا من AE
    const resultStr = await this.aeBridge._evalScript(
        `opengeoGetTimelineTrajectory("${this.activeCompId}", 5)`, // عينة كل 5 فريمات
        30000
    );
    
    if (!resultStr || resultStr.startsWith('error:')) {
        globalEventBus.emit('toast:show', {
            message: 'Failed to scan timeline',
            type: 'error'
        });
        return;
    }

    const data = JSON.parse(resultStr);
    const frames = data.frames;

    // 3. حساب البلاطات الفريدة عبر المسار بالكامل
    const uniqueTiles = {};
    for (const frame of frames) {
        const downloadZoom = Math.max(0, Math.min(19,
            Math.floor(frame.zoom + qualityOffset)));
        
        const tiles = TileGrid.getCompVisibleTiles(
            frame.lat, frame.lon,
            frame.zoom,
            this.mapState.compWidth, this.mapState.compHeight,
            downloadZoom
        );
        
        for (const t of tiles) {
            uniqueTiles[t.key] = t;
        }
    }

    const tilesToDownload = Object.values(uniqueTiles);
    
    globalEventBus.emit('ui:status', {
        message: `Finalize: Downloading ${tilesToDownload.length} tiles (${quality})...`,
        isError: false
    });

    // 4. تحميل البلاطات
    // ... (استخدام Engine أو TileDownloader مباشرة)

    // 5. إرسال إلى AE
    // ... (استخدام opengeoBuildComposition)

    globalEventBus.emit('toast:show', {
        message: `Finalize complete: ${tilesToDownload.length} tiles (${quality})`,
        type: 'success'
    });
}
```

### 9.4 تعديل Auto-Sync ليعمل بجودة Draft

```javascript
// في _exportToAE أو في sync engine
this._geoEngine.sync(progressCallback, -2); // دائماً Draft offset = -2
```

---

## 10. خريطة الملفات المتأثرة

| الملف | نوع التعديل | الأولوية |
|-------|-------------|---------|
| `client/index.html` | حذف أزرار + إضافة Finalize + Quality Select | 🔴 عالية |
| `client/css/style.css` | تنسيق الأزرار الجديدة | 🟡 متوسطة |
| `client/js/app.js` | حذف دوال قديمة + إضافة `_finalize()` + Auto-Sync Always-On | 🔴 عالية |
| `client/js/MapState.js` | إضافة `qualityOffset` و `getDownloadZoom()` | 🟡 متوسطة |
| `client/js/engine/OpenGeoEngine.js` | تعديل `sync()` لقبول `qualityOffset` | 🟡 متوسطة |
| `client/js/map/TileGrid.js` | إضافة `getCompVisibleTiles()` | 🟡 متوسطة |
| `client/js/ae/AESyncEngine.js` | إزالة زر التشغيل/الإيقاف + Draft دائم | 🟢 منخفضة |
| `host/index.jsx` | تعديل `opengeoGetTimelineTrajectory` (اختياري) | 🟢 منخفضة |

---

## 11. خطة التنفيذ خطوة بخطوة

### المرحلة 0: إصلاح خطأ تحريك كاميرا الإضافة (Camera Independence Fix) 🔴 حرج

**المشكلة الحالية:**
عند تحريك مؤشر الوقت (CTI) في Timeline داخل After Effects، تتحرك كاميرا واجهة الإضافة
(الخريطة في لوحة OpenGeo) لتتبع موقع الكاميرا في AE. هذا سلوك خاطئ.

**السبب الجذري:**
في ملف `client/js/ae/AESyncEngine.js`، السطران 99-100 يقومان بتحديث `MapState` و `Viewport`
بإحداثيات الكاميرا المقروءة من AE:

```javascript
// ❌ هذا هو الكود الخاطئ:
this.viewport.mapState.setCenter(state.camera.lat, state.camera.lng);
this.viewport.mapState.compZoom = state.camera.zoom;
```

**السلوك الصحيح:**
- كاميرا الإضافة (Viewport) يجب أن تكون **مستقلة تماماً** عن كاميرا AE.
- عند تحريك المؤشر في AE، يجب أن يقرأ الـ Sync موقع الكاميرا الجديد ويحمل بلاطات Draft
  **بدون تحريك واجهة الإضافة**. أي أن الاتجاه يكون:
  `AE Timeline → حساب بلاطات مرئية → تحميل Draft → إدراج في AE` فقط.

**الحل:**
- إزالة تحديث `viewport.mapState` من `_pollAfterEffects`.
- بدلاً من ذلك، تخزين إحداثيات AE في متغير داخلي `_aeCameraState` واستخدامه
  فقط لحساب البلاطات Draft اللازمة للتحميل.
- إبقاء حدث `viewport:changed_from_ae` لتحفيز تحميل البلاطات فقط، بدون تحريك الواجهة.

**الملفات المتأثرة:**

| الملف | التعديل |
|-------|---------|
| `client/js/ae/AESyncEngine.js` | إزالة تحديث viewport/mapState + تخزين في `_aeCameraState` |
| `client/js/app.js` | تعديل handler لحدث `viewport:changed_from_ae` ليقرأ من `_aeCameraState` |

**المهام:**
- [x] **0.1** إزالة السطرين `this.viewport.mapState.setCenter(...)` و `this.viewport.mapState.compZoom = ...` من `AESyncEngine._pollAfterEffects()`.
- [x] **0.2** إضافة خاصية `_aeCameraState` في `AESyncEngine` لتخزين آخر موقع كاميرا AE.
- [x] **0.3** تعديل `app.js` ليستخدم `syncEngine._aeCameraState` عند حساب بلاطات Auto-Sync بدلاً من `mapState`.

---

### المرحلة 1: تنظيف الواجهة (UI Cleanup)
- [x] **1.1** حذف أزرار `Sync`, `Export`, `Bake` من `index.html`.
- [x] **1.2** إضافة قائمة `finalize-quality` وزر `Finalize` في `index.html`.
- [x] **1.3** إضافة تنسيقات CSS الجديدة في `style.css`.

### المرحلة 2: Auto-Sync Always-On
- [x] **2.1** تعديل `app.js`: إزالة `autoSync` flag وجعل الـ Sync يبدأ تلقائياً مع New Comp.
- [x] **2.2** تعديل `_exportToAE` لتمرير `qualityOffset = -2` (Draft) دائماً.
- [x] **2.3** تعديل `OpenGeoEngine.js` → `sync()` لقبول `qualityOffset`.
- [x] **2.4** إزالة event listeners القديمة (sync-btn, export-btn, bake-btn).

### المرحلة 3: بناء Finalize
- [x] **3.1** إضافة `getCompVisibleTiles()` في `TileGrid.js`.
- [x] **3.2** إضافة `qualityOffset` و `getDownloadZoom()` في `MapState.js`.
- [x] **3.3** برمجة دالة `_finalize()` الكاملة في `app.js`.
- [x] **3.4** ربط زر `finalize-btn` بالدالة.

### المرحلة 4: الاختبار والتحقق
- [ ] **4.1** اختبار Auto-Sync: التحرك في Timeline والتأكد من تحميل بلاطات Draft تلقائياً.
- [ ] **4.2** اختبار Finalize: وضع Keyframes ثم الضغط على Finalize والتأكد من تحميل بلاطات عالية الجودة.
- [ ] **4.3** اختبار الأداء: مقارنة سرعة AE مع Draft مقابل Normal.

---

## 12. خطة الاختبار والتحقق

### 12.1 اختبار Auto-Sync (Draft Quality)

| الخطوة | الإجراء | النتيجة المتوقعة |
|--------|---------|-----------------|
| 1 | إنشاء Comp جديد | بلاطات Draft تظهر في AE |
| 2 | تحريك الكاميرا في الـ Timeline | بلاطات Draft جديدة تُحمَّل تلقائياً |
| 3 | الانتقال لموقع جغرافي بعيد | بلاطات Draft تُحمَّل للموقع الجديد |
| 4 | فحص عدد الطبقات في AE | عدد قليل (~3-10 لكل فريم) |

### 12.2 اختبار Finalize (High Quality)

| الخطوة | الإجراء | النتيجة المتوقعة |
|--------|---------|-----------------|
| 1 | وضع 3 Keyframes (مواقع مختلفة) | Keyframes تظهر في Timeline |
| 2 | اختيار "High" من القائمة | القائمة تتغير |
| 3 | الضغط على Finalize | شريط تقدم يظهر |
| 4 | انتظار الانتهاء | رسالة نجاح مع عدد البلاطات |
| 5 | فحص الرندر في AE | صورة واضحة وحادة (Crisp) |
| 6 | المقارنة مع Draft | الفرق واضح في الحدة والتفاصيل |

### 12.3 اختبار الأداء

| السيناريو | Draft | Normal | High | Ultra |
|-----------|-------|--------|------|-------|
| عدد البلاطات (1920×1080) | ~3-5 | ~40 | ~160 | ~640 |
| زمن التحميل التقريبي | <1s | ~5s | ~20s | ~60s |
| حجم البيانات التقريبي | ~150KB | ~2.5MB | ~10MB | ~40MB |
| سرعة AE (RAM Preview) | ممتاز | جيد | بطيء | بطيء جداً |

---

> **ملاحظة أخيرة:**
> هذه الخطة مبنية على البنية الهندسية الحالية لـ OpenGeo وتستفيد من المعادلات الرياضية
> الموجودة في `index.jsx` (خاصة `scaleFactor = Math.pow(2, baseZoom - tile.z)`)
> التي تسمح بخلط بلاطات من مستويات زوم مختلفة في نفس الكومبوزيشن بدقة مطلقة.
