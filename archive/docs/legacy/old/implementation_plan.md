# OpenGeo Engine: Comprehensive Architecture, Mathematical Specification & Master Execution Plan

> **الرؤية المعمارية الشاملة:**
> "بناء محرك خرائط متقدم، مفتوح المصدر للتطبيقات الإبداعية، يدمج الهندسة العكسية لسلوك GEOlayers مع معمارية الكادر الموحد (Explorer-Bound Framing) وتراكم الجلسات الاستكشافية، لدعم الحركة والتنقل بين الكي فريمات بكفاءة وسلاسة تامة دون تقطع بصري."

---

## المظلة المعمارية العامة (Architectural Overview)

يعتمد **OpenGeo Engine** على بنية هندسية معزولة تماماً تفصل بين 4 طبقات رئيسية:

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           1. UI & Viewport Layer                                 │
│    - Canvas Viewport Renderer                                                    │
│    - Aspect Ratio Bounding Frame (16:9 / Custom Comp Framing)                    │
│    - Input & Navigation Controller (Pan, Zoom, Drag)                             │
└──────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         2. Core OpenGeo Engine (TS/JS)                           │
│    - Camera (Single Source of Truth)                                             │
│    - GeoMath (EPSG:3857 Spherical Mercator Engine)                               │
│    - TileGrid (Visible Grid & Boundary Calculator)                               │
│    - TileAccumulator (Session-wide Discovered Tile Collector)                    │
│    - TileDownloader (Binary XHR + Magic-Byte Validation + cep.fs Disk Writer)   │
└──────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                       3. Bridge & Payload Transport Layer                        │
│    - CSInterface EvalScript Payload Escaper                                      │
│    - JSON Session Serializer                                                     │
└──────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                      4. After Effects ExtendScript Adapter                       │
│    - opengeoBuildComposition Engine                                              │
│    - Comp Builder (OpenGeo Map & OpenGeo World Mapcomp)                          │
│    - Null Controller Rigging (MapPivot & Map Anchor)                             │
│    - Footage Auto-Import & Anchor Alignment ([0,0] Top-Left Snap)                │
│    - Expression Engine Linkage for Timeline Scrubbing                            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. الملخص الهندسي والتحليل الاستكشافي (GeoInspector Telemetry Insights)

بناءً على نتائج تسجيل الجلسات عبر **GeoInspector** وتفكيك ملفات التايم لاين الخاصة بـ GEOlayers، تم استنباط المبادئ التقنية التالية:

### 1.1 معمارية التدافع الطبقي بدلاً من الدمج (Tile-per-Layer Architecture)
- **خطأ النهج التقليدي:** محاولة دمج مئات البلاطات في Canvas واحد وتصديره كصورة Base64 ضخمة. هذا يسبب بطئاً شديداً، استهلاكاً هائلاً للذاكرة، وتجمداً في واجهة After Effects.
- **نهج GEOlayers المعياري:** استيراد كل بلاطة (256x256) كعنصر مستقل (Footage Item) داخل مشهد After Effects، وتوزيع البلاطات في شبكة متراصة في التايم لاين.
- **كفاءة After Effects:** محرك After Effects مجهز للتعامل مع آلاف الطبقات الثابتة (Static Image Layers) بسرعة فائقة من خلال كروت الشاشة الحديثة، بشرط عدم إعادة تشكيل المحتوى برمجياً في كل فريم.

### 1.2 نظام التحكم بـ Null المركزي (MapPivot Parenting)
- لا تمنح كل طبقة بلاطة حركة مستقلة.
- جميع البلاطات التي تشكل الخريطة يتم ربطها (Parenting) بطبقة `Null` واحدة تسمى `MapPivot`.
- إحداثيات موقع كل بلاطة تسجل كإزاحة نسبية (Relative Offset) مقارنة بمركز `MapPivot`.
- عند تحريك الخريطة أو تغيير الـ Zoom، يتم تحريك أو تكبير الـ `MapPivot` فقط، فتتبعه آلاف البلاطات تلقائياً بدون أي تكلفة معالجة إضافية.

### 1.3 هيكلية التراكيب المزدوجة (Dual-Comp Architecture)
1. **الكومبوزيشن الحاوية (`OpenGeo Map`):**
   - تمثل المخرج النهائي الذي يراه المستخدم والمحرك الرئيسي للتصدير (Render Target).
   - تحتوي على طبقة `Map Background` في الأسفل، وطبقة التحكم `OpenGeo Map Anchor` للمستخدم.
2. **الكومبوزيشن الفرعية (`OpenGeo World Mapcomp`):**
   - تعمل كـ Pre-comp يحتوي على شبكة البلاطات وطبقة `MapPivot`.
   - يتم ضبط أبعاد هذا الـ Pre-comp ديناميكياً ليتسع فقط للبلاطات النشطة بدون استهلاك مساحات فارغة.

### 1.4 إدارة حالة الانشغال (Busy Buffer State)
- أثناء عمليات تنزيل البلاطات المعقدة أو إعادة بناء الشبكة، يقوم النظام بتحويل التركيز أو إظهار شاشة موحدة مؤقتة (`GEOlayers is busy...`) بحجم 512x512 للتحكم في تدفق الأحداث وتجنب التعارض أثناء التعديل.

---

## 2. معمارية الكادر الموحد وتراكم الاستكشاف (Explorer-Bound Framing Architecture)

تقوم هذه المعمارية المبتكرة على مبدأ المطابقة المطلقة (1:1 Parity) بين واجهة التصفح واستكشاف الخريطة في الإضافة، وبين المخرج النهائي في After Effects.

### 2.1 إطار نسبة الأبعاد (Comp Aspect-Ratio Overlay)
- تعرض الواجهة إطاراً بؤرياً بنسبة أبعاد التصدير (مثل 16:9 أو 9:16 أو أبعاد مخصصة).
- يحدد هذا الإطار المنطقة الحرجـة التي ستظهر داخل كاميرا After Effects.
- البلاطات التي تقع داخل هذا الإطار وحوله هي فقط التي يتم حسابها وتنزيلها.

### 2.2 جامع البلاطات المكتشفة (`TileAccumulator`)
- أثناء قيام المستخدم بالتجول في الخريطة داخل لوحة الإضافة (سواءً بالتكبير، التصغير، أو السحب):
  - يقوم المحرك بطلب البلاطات المرئية.
  - بدلاً من التخلي عن البلاطات القديمة، يضيف المحرك كل مفتاح بلاطة فريد (`z/x/y`) إلى جامع الجلسة `TileAccumulator`.
- عند ضغط زر التصدير ("New Comp" / "Sync")، يرسل المحرك **جميع البلاطات المكتشفة طوال جلسة التجول**، مما يضمن أن كامل المساحة التي استكشفها المستخدم أصبحت جاهزة في After Effects.

### 2.3 الكاميرا الموحدة (Unified Camera Source of Truth)
- تُحفظ إحداثيات الكاميرا في كائن واحد `CameraState`:
  $$\text{CameraState} = \{ \text{lat}, \text{lon}, \text{zoom}, \text{viewportWidth}, \text{viewportHeight} \}$$
- نفس قيم الكاميرا المستخدمة في واجهة التجول تُنقل حرفياً لـ After Effects لضبط سلايدرات التحكم في طبقة `Map Controller`.

---

## 3. الأساسيات الرياضية ونظم الإحداثيات (Mathematical Foundations)

تعتمد جميع العمليات الرياضية في المحرك على إسقاط **Web Mercator (EPSG:3857)** المعياري.

### 3.1 معادلات تحويل خطوط الطول والعرض إلى بلاطات (Geo to Tile)

لأي نقطة جغرافية بخط عرض $\phi$ (Latitude) وخط طول $\lambda$ (Longitude) ومستوى تقريب $z$ (Zoom):

1. **حساب رقم البلاطة الأفقية ($X$):**
   $$X = \lfloor \frac{\lambda + 180}{360} \cdot 2^z \rfloor$$

2. **حساب رقم البلاطة الرأسية ($Y$):**
   $$Y = \lfloor (1 - \frac{\ln(\tan(\phi \cdot \frac{\pi}{180}) + \sec(\phi \cdot \frac{\pi}{180}))}{\pi}) \cdot \frac{1}{2} \cdot 2^z \rfloor$$

### 3.2 معادلات التحويل العكسي (Tile to Geo)

1. **حساب خط الطول $\lambda$ لزاوية البلاطة $X$:**
   $$\lambda = \frac{X}{2^z} \cdot 360 - 180$$

2. **حساب خط العرض $\phi$ لزاوية البلاطة $Y$:**
   $$n = \pi - \frac{2\pi \cdot Y}{2^z}$$
   $$\phi = \frac{180}{\pi} \cdot \arctan(\sinh(n))$$

### 3.3 معادلات الفضاء البيكسلي العالمي (World Pixel Space)

المسافة الإجمالية لعالم الخرائط بالبيكسل عند مستوى تقريب $z$ وبلاطة بحجم $S = 256$:
$$\text{WorldSize} = S \cdot 2^z$$

إحداثيات المركز الجغرافي للـ Camera بالبيكسل العالمي ($P_{x}, P_{y}$):
$$P_{x} = \frac{\lambda + 180}{360} \cdot S \cdot 2^z$$
$$P_{y} = \left(1 - \frac{\ln\left(\tan\left(\frac{\pi}{4} + \frac{\phi \cdot \pi}{360}\right)\right)}{\pi}\right) \cdot \frac{1}{2} \cdot S \cdot 2^z$$

### 3.4 حساب مواقع البلاطات النسبية داخل After Effects

لكل بلاطة ذات دليل $(T_x, T_y)$، موضعها البيكسلي العالمي لزاويتها العلوية اليسرى هو:
$$W_{x} = T_x \cdot S$$
$$W_{y} = T_y \cdot S$$

الموضع النسبي للطبقة داخل الكومبوزيشن بالنسبة لمركز الـ `MapPivot` ($Rel_{x}, Rel_{y}$):
$$Rel_{x} = W_{x} - P_{x}$$
$$Rel_{y} = W_{y} - P_{y}$$

عند ضبط نقطة الارتكاز (Anchor Point) للطبقة في After Effects على $[0, 0]$ وإسناد الإحداثيات النسبية أعلاه، **تلتصق جميع البلاطات ببعضها بدقة البيكسل المطلقة وبدون أي فراغات بصرياً (Zero Pixel Gap).**

---

## 4. البنية البرمجية المحصلة للمحرك (`OpenGeoEngine.js`)

تتم صياغة كود المحرك بلغة JavaScript ناتجة عن تجميع تراكيب TypeScript لضمان التوافق المطلق مع CEF داخل بيئة CEP.

### 4.1 واجهة ومكونات وحدة `GeoMath`
```javascript
var GeoMath = {
  TILE_SIZE: 256,
  lon2tile: function(lon, zoom) { ... },
  lat2tile: function(lat, zoom) { ... },
  tile2lon: function(x, z) { ... },
  tile2lat: function(y, z) { ... },
  lonToWorldPixel: function(lon, zoom) { ... },
  latToWorldPixel: function(lat, zoom) { ... }
};
```

### 4.2 واجهة ومكونات وحدة `Camera`
```javascript
function Camera(init) {
  this._state = {
    lat: init.lat || 0,
    lon: init.lon || 0,
    zoom: init.zoom || 2,
    viewportWidth: init.viewportWidth || 1920,
    viewportHeight: init.viewportHeight || 1080
  };
}
Camera.prototype.getState = function() { return this._state; };
Camera.prototype.setPosition = function(lat, lon) { ... };
Camera.prototype.setZoom = function(zoom) { ... };
Camera.prototype.setViewport = function(w, h) { ... };
```

### 4.3 واجهة ومكونات وحدة `TileGrid`
```javascript
function TileGrid(urlTemplate) {
  this._url = urlTemplate || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
}
TileGrid.prototype.getVisibleTiles = function(cam) {
  // حساب حدود البلاطات مع إضافة هامش أمان (Padding) قدره 1 بلاطة
  // إرجاع مصفوفة من الكائنات تحتوي على (x, y, z, key, pixelX, pixelY, url)
};
```

### 4.4 واجهة ومكونات وحدة `TileDownloader`
```javascript
function TileDownloader(cacheDir, maxConcurrent) {
  this._cacheDir = cacheDir;
  this._max = maxConcurrent || 6;
  this._active = 0;
  this._queue = [];
}
TileDownloader.prototype.downloadBatch = function(tiles, onProgress) { ... };
TileDownloader.prototype.downloadSingle = function(tile) { ... };
TileDownloader.prototype._httpGet = function(url) { ... };
TileDownloader.prototype._write = function(filePath, base64Data) { ... };
TileDownloader.prototype._exists = function(filePath) { ... };
```

---

## 5. إدارة الأمن الشبكي والتحقق من الصور (Network & Format Protection Matrix)

لمنع حدوث الأخطاء التاريخية في استيراد الصور داخل After Effects، تم تطبيق مصفوفة التحقق التالية:

```text
               تنزيل الاستجابة (XHR ArrayBuffer)
                                │
                                ▼
                 فحص حجم البيانات (< 500 بايت؟)
                       ├── نعم ──► إلغاء التخزين + إرجاع خطأ
                       └── لا
                                │
                                ▼
                قراءة البايتات السحرية (Magic Bytes)
                 Header Bytes Check [0..3]
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
   (0x89 0x50)                   (0xFF 0xD8)
   الصيغة: PNG                  الصيغة: JPEG
   الامتداد: .png               الامتداد: .jpg
        │                             │
        └──────────────┬──────────────┘
                       ▼
            حفظ الملف عبر cep.fs.writeFile
                       │
                       ▼
            استيراد آمن داخل After Effects 
            (بدون خطأ PNGIO Support)
```

### 5.1 مصفوفة الأخطاء وآلية المعالجة الآلية (Error Recovery Matrix)

| نوع الخطأ | السبب الهندسي | حل المحرك الآلي |
|---|---|---|
| `AEGP Plugin PNGIO Support` | استيراد صورة JPEG باسم `.png` | التحقق من Magic Bytes وإسناد امتداد `.jpg` تلقائياً |
| `Unable to call 'add' parameter 1` | تمرير عنصر `null` لـ `layers.add` | التغليف بـ `try-catch` وتخطي العناصر التالفة |
| `HTTP 403 / 429` | حظر السيرفر لطلبات البلاطات | التحويل التلقائي لـ ESRI World Imagery واستخدام XHR معزول |
| `Corrupt Cache` | حفظ صفحة HTML نصية كصورة | فحص الحجم المينيمالي (> 500 بايت) وحذف الملفات التالفة تلقائياً |

---

## 6. جسر After Effects المدمج (`host/index.jsx`)

تم دمج سكريبت البناء الهندسي كاملاً داخل `host/index.jsx` لتجنب مشاكل `#include` و `$.evalFile` النسبية.

### 6.1 الخوارزمية الهيكلية لبناء الكومبوزيشن (`opengeoBuildComposition`)

```javascript
function opengeoBuildComposition(jsonData) {
  hLog('opengeoBuildComposition called');
  try {
    var data = (typeof jsonData === 'string') ? eval('(' + jsonData + ')') : jsonData;
    var tiles = data.tiles;
    var camera = data.camera;

    if (!tiles || tiles.length === 0) return 'error: No tiles provided';
    if (!app.project) { app.newProject(); }

    app.beginUndoGroup("OpenGeo: Build Map");

    var compWidth = (camera && camera.viewportWidth) || 1920;
    var compHeight = (camera && camera.viewportHeight) || 1080;
    var fps = 30;
    var duration = 3600;
    var tileSize = 256;

    // 1. حساب الحدود الإجمالية للبلاطات المكتشفة
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (t.pixelX < minX) minX = t.pixelX;
      if (t.pixelX + tileSize > maxX) maxX = t.pixelX + tileSize;
      if (t.pixelY < minY) minY = t.pixelY;
      if (t.pixelY + tileSize > maxY) maxY = t.pixelY + tileSize;
    }
    var preCompWidth = Math.max(256, Math.ceil(maxX - minX));
    var preCompHeight = Math.max(256, Math.ceil(maxY - minY));

    // 2. إنشاء أو تحديث OpenGeo World Mapcomp
    var mapComp = findOrCreateComp("OpenGeo World Mapcomp", preCompWidth, preCompHeight, duration, fps);

    // 3. إنشاء أو العثور على Null MapPivot
    var mapPivot = findOrCreateNull(mapComp, "MapPivot", preCompWidth / 2, preCompHeight / 2);

    // 4. استيراد ورص البلاطات
    var importedCount = 0;
    for (var j = 0; j < tiles.length; j++) {
      var tile = tiles[j];
      var cleanPath = String(tile.filePath).replace(/\\/g, '/');
      var tileFile = new File(cleanPath);
      if (!tileFile.exists) continue;

      var footageItem = null;
      try {
        var importOpt = new ImportOptions(tileFile);
        footageItem = app.project.importFile(importOpt);
      } catch (ex) { continue; }

      if (!footageItem) continue;

      var tileLayer = mapComp.layers.add(footageItem);
      tileLayer.name = "tile_" + tile.z + "_" + tile.x + "_" + tile.y;
      tileLayer.property("Anchor Point").setValue([0, 0]);

      var posX = tile.pixelX - minX;
      var posY = tile.pixelY - minY;
      tileLayer.property("Position").setValue([posX, posY]);
      tileLayer.parent = mapPivot;

      importedCount++;
    }

    // 5. إنشاء الكومبوزيشن الحاوية OpenGeo Map
    var containingComp = findOrCreateComp("OpenGeo Map", compWidth, compHeight, duration, fps);
    setupContainingCompStructure(containingComp, mapComp, compWidth, compHeight);

    containingComp.openInViewer();
    app.endUndoGroup();

    return '{"success":true,"tilesImported":' + importedCount + ',"tilesTotal":' + tiles.length + ',"compName":"OpenGeo Map"}';
  } catch (e) {
    try { app.endUndoGroup(); } catch(ex) {}
    return 'error: ' + e.toString();
  }
}
```

---

## 7. استراتيجية المزامنة مع الـ Keyframes والتايم لاين

لتحقيق أقصى قدر من الأداء أثناء الحركة والتنقل بين الكي فريمات، نستخدم ثلاثة أنماط مزامنة:

### 7.1 المزامنة الاستكشافية (UI Session Trajectory Accumulation)
- يقوم المحرك بحفظ كل البلاطات المكتشفة في الكائنات `TileAccumulator`.
- عند التصدير، يتم ضخ كل هذه البلاطات إلى الكومبوزيشن مرة واحدة.
- النتيجة: مسار الحركة بأكمله يغطي المساحات التي استكشفها المستخدم مسبقاً.

### 7.2 التعبيرات الزمنية المربوطة بالكنترول (Expression-Driven Timeline Engine)
يتم إسناد التعبير التالي على خصائص الطبقات لربط الحركة بسلايدرات `Map Controller`:

```javascript
// Expression for MapPivot / Map Tile positioning based on Controller Sliders
var ctrl = comp("OpenGeo Map").layer("Map Controller");
var lat = ctrl.effect("Latitude")(1).value;
var lon = ctrl.effect("Longitude")(1).value;
var zoom = ctrl.effect("Zoom")(1).value;

// Dynamic offset calculation inside AE timeline
[value[0], value[1]];
```

### 7.3 مسح المسار الزمني وتنزيله مسبقاً (Timeline Trajectory Baking)
1. يقرأ المحرك الكي فريمات الخاصة بـ `Latitude`, `Longitude`, `Zoom` من التايم لاين بين `inPoint` و `outPoint`.
2. يتم تقسيم الفاصل الزمني إلى عينات (بواقع عينة كل 5 فريمات).
3. يتم إدراج جميع البلاطات المطلوبة للمسار بالكامل وتنزيلها للذاكرة المحلية قبل عملية التصدير (Render) لتجنب أي انقطاع شبكي.

---

## 8. خطة التنفيذ وتتبع المهام (Step-by-Step Task Roadmap)

### المرحلة الأولى: تماثل واجهة التصفح والكادر (Comp Ratio Overlay & Accumulator)
- [ ] **المهمة 1.1:** إضافة عنصر الإطار البؤري الشفاف (Framing Box) في `client/index.html` وتنسيقه في `css/style.css` بنسبة أبعاد 16:9 وتحديثه بناءً على أبعاد الكومبوزيشن.
- [ ] **المهمة 1.2:** إضافة كائن `TileAccumulator` داخل `OpenGeoEngine.js` لتجميع البلاطات المكتشفة طوال الجلسة.
- [ ] **المهمة 1.3:** ربط زر "New Comp" ليرسل القائمة التراكمية للبلاطات بدلاً من الشاشة الحالية فقط.

### المرحلة الثانية: ربط الكي فريمات والتعبيرات (Expressions & Controls)
- [ ] **المهمة 2.1:** إضافة سلايدرات `Latitude`, `Longitude`, `Zoom` على طبقة `Map Controller` في ExtendScript.
- [ ] **المهمة 2.2:** إسناد التعبيرات (Expressions) التلقائية على `MapPivot` لترتبط بسلايدرات الكنترول.
- [ ] **المهمة 2.3:** تفعيل خيار المزامنة الحية (Live Sync Engine) للتحديث المستمر عند تغيير الكي فريمات.

### المرحلة الثالثة: أداة التنزيل المسبق للمسار (Trajectory Baking Tool)
- [ ] **المهمة 3.1:** إضافة زر **"Bake Timeline Map"** في شريط الأدوات العادي لـ OpenGeo.
- [ ] **المهمة 3.2:** برمجة أداة المسح الزمني لقراءة الكي فريمات وحساب جميع البلاطات بين `inPoint` و `outPoint`.
- [ ] **المهمة 3.3:** تنزيل ورص كامل البلاطات المطلوبة للأنيميشن في التايم لاين.

### المرحلة الرابعة: التحسين البصري واختبار الأداء (Optimization & QA)
- [ ] **المهمة 4.1:** مراجعة محاذاة البلاطات عند مستويات التقريب المختلفة (Zoom 2 إلى Zoom 18).
- [ ] **المهمة 4.2:** إجراء اختبارات الإجهاد (Stress Test) بتنزيل ومزامنة 200+ بلاطة وتأكيد ثبات واجهة After Effects.
- [ ] **المهمة 4.3:** توثيق الدليل التشغيلي للمستخدم وإنجاز ملف `walkthrough.md`.

---

## 9. خطة التحقق والاختبار الدقيق (Verification & QA Matrix)

### 9.1 اختبار صحة الصور والامتدادات (Format Validation Test)
- **الهدف:** التأكد من عدم وجود أي خطأ `PNGIO Support` إطلاقاً.
- **الإجراء:** تنزيل 50 بلاطة من مصدر ESRI (JPEG) ومصدر OSM (PNG) وتأكيد حفظ كل نوع بالامتداد الخاص به (`.jpg` / `.png`).

### 9.2 اختبار التجميع في الكومبوزيشن (Composition Construction Test)
- **الهدف:** التأكد من عدم وجود خطأ `Unable to call add`.
- **الإجراء:** تشغيل دالة `opengeoBuildComposition` مع مصفوفة تحتوي على مسارات صحيحة ومسارات غير موجودة، وتأكيد تخطي المسارات المفقودة بدون توقف السكريبت.

### 9.3 اختبار المحاذاة وعدم وجود الفراغات (Zero Gap Test)
- **الهدف:** تأكيد التراص المالي للبلاطات.
- **الإجراء:** التكبير لنسبة 500% داخل After Effects على الحدود الفاصلة بين أربع بلاطات متجاورة، وتأكيد التماس التام بدون ظهور خطوط خلفية.

---

## 10. الخلاصة والرؤية المستقبليّة

بهذه البنية الهندسية المتكاملة، يتحول **OpenGeo Engine** من مجرد أداة بسيطة لتصدير الخرائط إلى محرك خرائط احترافي مستقل ومكافئ تكنولوجياً لـ GEOlayers، يعتمد على:
1. **السرعة المطلقة** من خلال البلاطات المستقلة والـ Null Parenting.
2. **الأمان الشبكي** عبر فحص Magic Bytes وتحديد الامتدادات التلقائي.
3. **الدقة البصرية** عبر الكادر الموحد وتراكم البلاطات المكتشفة.
4. **التوافق التام مع الأنيميشن** عبر الـ Expressions ومسح مسارات الكي فريمات.
