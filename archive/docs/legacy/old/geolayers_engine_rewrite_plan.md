# خطة إعادة بناء محرك OpenGeo — استنساخ محرك GEOlayers 3
## (تقرير هندسة عكسية شامل + خطة تنفيذ تفصيلية)

---

## القسم الأول: نتائج التحليل الاستخباراتي (GeoInspector Report)

### 1.1 الهيكل العام للمشروع في أفترافكتس

من خلال تحليل ملف [GeoInspector_Session_1786055923024.json](file:///C:/Users/User/Documents/GeoInspector_Session_1786055923024.json)، اكتشفنا أن GEOlayers تبني هيكلاً من طبقتين (Two-Tier Architecture):

| الكومبوزيشن | الحجم | الوظيفة |
|---|---|---|
| `containing World Mapcomp` | 1920×1080 | الكومبوزيشن الخارجي (الحاوي). يحتوي على طبقتين فقط: `World Mapcomp Anchor` (Null) + `World Mapcomp` (Pre-comp) |
| `World Mapcomp` | 1920×1080 | الكومبوزيشن الداخلي (خريطة العالم). يحتوي على كل البلاطات والـ MapPivot والقوالب |

#### الطبقة الأولى: `World Mapcomp Anchor` (في الكومبوزيشن الحاوي)
- **النوع:** Null Object
- **الوظيفة:** مرساة (Anchor) تربط الكومبوزيشن الداخلي بالخارجي
- **Expression على Position:**
```javascript
//GEOlayers 3 expression
if(hasParent){
    [parent.source.width/2, parent.source.height/2, value[2]]
}else{
    value
}
```
- **Expression على Scale:** تقرأ Scale من `MapPivot` داخل الكومبوزيشن الداخلي
```javascript
//GEOlayers 3 expression
if(hasParent){
    parent.source.layer("MapPivot").transform.scale.valueAtTime(time-parent.startTime)
}else{
    value
}
```
- **Expression على Anchor Point:** تقرأ Anchor Point من `MapPivot` أيضاً
```javascript
//GEOlayers 3 expression
if(hasParent){
    parent.source.layer("MapPivot").transform.anchorPoint.valueAtTime(time-parent.startTime)
}else{
    value
}
```

#### الطبقة الثانية: `World Mapcomp` (Pre-comp layer في الكومبوزيشن الحاوي)
- **النوع:** طبقة كومبوزيشن (Pre-composition reference)
- **بدون أي Expressions** — الـ Position ثابت (960, 540) والـ Scale ثابت (100%)
- **5 Effects (Controllers):**
  - `Latitude` — Angle Control
  - `Longitude` — Angle Control
  - `Zoom` — Slider Control (مثال القيمة: `5.063`)
  - `Bearing` — Angle Control
  - `Pitch` — Angle Control

---

### 1.2 طبقة MapPivot — قلب المحرك الرياضي

داخل كومبوزيشن `World Mapcomp`، يوجد `Null Object` يسمى `MapPivot` (Index 18) وهو الطبقة **الوحيدة** التي تحمل أكواداً رياضية. كل الطبقات الأخرى (البلاطات) مربوطة به عبر Parenting.

#### المتغيرات الثابتة (Constants) داخل الـ Expression:
```javascript
var mapSize = 262144;                    // حجم العالم الافتراضي بالبكسل
var globalInterpolationTileSize = 512;   // حجم البلاطة المرجعي
var globalMaxZoom = 23;                  // أقصى زوم مسموح
var containingCompName = "containing World Mapcomp";
var mapcompLayerName = "World Mapcomp";
```

#### Expression الخاص بـ Scale (على MapPivot):
```javascript
var controlLayer = comp(containingCompName).layer(mapcompLayerName);
var diffTime = controlLayer.startTime;
var myTime = time + diffTime;
var ZoomEff = controlLayer.effect("Zoom").param(1);

var scaleVal = 100 * Math.pow(2, Math.max(0, Math.min(globalMaxZoom, ZoomEff.valueAtTime(myTime)))) / mapSize * globalInterpolationTileSize;
[scaleVal, scaleVal, scaleVal]
```
**التحليل:** هذه المعادلة تحول مستوى الزوم (مثلاً 5.06) إلى نسبة Scale فعلية. عند zoom=5:
- `2^5 = 32` → `100 * 32 / 262144 * 512 = 6.25%` (يطابق القيمة المقاسة `6.53%`)

#### Expression الخاص بـ Anchor Point (على MapPivot):
هذا هو الكود الأعقد والأطول ويحتوي على:
- **دوال تحويل الإحداثيات الجغرافية (Mercator Projection):**
  - `LatToPixelY(latitude)` — تحويل خط العرض لبكسل Y
  - `LonToPixelX(longitude)` — تحويل خط الطول لبكسل X
- **دوال الاستيفاء (Interpolation):**
  - `getInterpolationKeyframes()` — تقرأ الـ keyframes وتحدد بينها
  - `transformLinear()` — استيفاء خطي
- **دالة التحويل النهائية:**
  - `transformPositionToAnchorPoint()` — تحول Position في العالم الحقيقي إلى Anchor Point في الكومبوزيشن
- **نظام التعويض الحركي (Zoom + Pan Compensation):**
  - يوجد منطق معقد يتعامل مع الحالة التي يتم فيها تغيير الزوم + تحريك الخريطة في نفس الوقت (interpolationStyleTransitionArea)

#### Effects على MapPivot:
| Effect | النوع | الوظيفة |
|---|---|---|
| `mapcompdata` | Slider | بيانات metadata |
| `styleinterface` | Slider | واجهة الأنماط |
| `viewpointhelper1` | Point Control | مساعد نقطة الرؤية |
| `viewpointhelper2` | Point Control | مساعد نقطة الرؤية |

---

### 1.3 نظام البلاطات متعدد المستويات (Multi-LOD Tile System)

> هذا هو الاكتشاف الأهم الذي يفسر كيف تحقق GEOlayers جودة عالية بعدد طبقات قليل!

GEOlayers **لا تستخدم مستوى زوم واحد!** بل تبني **هرماً من البلاطات** بمستويات زوم مختلفة، تماماً مثل الأقمار الصناعية التي تلتقط صوراً بدقات مختلفة:

#### تحليل البلاطات المستخرجة من التقرير:

| مستوى الزوم | حجم الملف | حجم الـ Scale في AE | عدد البلاطات | أمثلة الملفات |
|---|---|---|---|---|
| **Zoom 5** | 512×512 | **1600%** | 20 بلاطة | `bing1_512_5_30120.png` |
| **Zoom 5** | 1024×1024 | **1600%** | 6 بلاطات | `bing1_1024_5_3010.png` |
| **Zoom 4** | 512×512 | **3200%** | 10 بلاطات | `bing1_512_4_1213.png` |
| **Zoom 4** | 1024×1024 | **3200%** | 5 بلاطات | `bing1_1024_4_123.png` |
| **Zoom 3** | 1024×1024 | **6400%** | 4 بلاطات | `bing1_1024_3_30.png` |

**المجموع الكلي: 45 طبقة بلاطة فقط!** (من أصل 61 طبقة — الباقي هو templates + labels + MapPivot)

#### معادلة الـ Scale:
```
Scale = 100 * globalInterpolationTileSize / (2^zoom × tileSize) × mapSize
     = 100 × 512 / (2^zoom × tileSize) × 262144 / 262144
```
بشكل مبسط:
- **Zoom 5, Size 512:** `Scale = mapSize / (2^5 × 512) × 100 = 262144 / 16384 × 100 = 1600%`
- **Zoom 4, Size 512:** `Scale = 262144 / (2^4 × 512) × 100 = 262144 / 8192 × 100 = 3200%`
- **Zoom 3, Size 1024:** `Scale = 262144 / (2^3 × 1024) × 100 = 262144 / 8192 × 100 = 3200%`
  (لكن بما أن الصورة 1024 فحجمها الفعلي مضاعف = يغطي مساحة أكبر)

#### معادلة الـ Position:
```
Position.X = tileX × tileSize_in_worldspace
Position.Y = tileY × tileSize_in_worldspace
```
حيث `tileSize_in_worldspace = 2^(18 - zoom) × 512` للبلاطة 512px
أو ببساطة: `position = quadkey_to_xy(quadkey) × worldTileSpacing`

#### نظام تسمية البلاطات (QuadKey):
GEOlayers تستخدم نظام **QuadKey** (المعتمد من Bing Maps) بدلاً من X/Y/Z:
- `tile_512_5_30120` → حجم 512، زوم 5، QuadKey = `30120`
- `tile_1024_4_123` → حجم 1024، زوم 4، QuadKey = `123`

QuadKey يقسم العالم إلى 4 مربعات (0,1,2,3) ويكرر التقسيم مع كل زوم.

#### مسار تخزين البلاطات:
```
C:\Users\User\AppData\Roaming\aescripts\GEOlayers3\tiles\
├── bing1_512_5_30120.png
├── bing1_1024_5_3010.png
├── bing1_512_4_1213.png
├── bing1_1024_4_123.png
├── bing1_1024_3_30.png
└── ...
```
**نمط التسمية:** `{sourceId}_{tileSize}_{zoom}_{quadkey}.png`

---

### 1.4 ترتيب الطبقات (Layer Ordering)

الترتيب من الأعلى للأسفل (من Index 1 إلى 61):
1. **Templates & Labels** (Index 1-17) — قوالب النصوص والنقاط (مخفية `isVisible: false`)
2. **MapPivot** (Index 18) — قلب المحرك (Null + Expressions)
3. **بلاطات الزوم العالي (Zoom 5)** (Index 19-38) — الأكثر تفصيلاً، في الأعلى
4. **بلاطات الزوم المتوسط (Zoom 4)** (Index 39-54) — تفصيل متوسط
5. **بلاطات الزوم المنخفض (Zoom 3)** (Index 55-61) — تغطية واسعة، في الأسفل

> **السبب:** عندما يكون الزوم عالياً، ترى البلاطات عالية الدقة. عندما تبتعد الكاميرا، البلاطات الكبيرة (الأقل دقة) تملأ المساحة الفارغة حول الحواف بدلاً من إظهار فراغ أسود!

---

## القسم الثاني: خطة التنفيذ التفصيلية لـ OpenGeo

### المرحلة 1: بناء نظام MegaTile Stitcher

#### 1.1 تعديل [TileStitcher.js](file:///C:/Program%20Files%20(x86)/Common%20Files/Adobe/CEP/extensions/OpenGeo/client/js/engine/TileStitcher.js)
- إنشاء دالة `stitchToMegaTile(tiles256[], targetSize)` تقبل مصفوفة بلاطات 256px وتُنتج Canvas بحجم `targetSize` (512 أو 1024).
- دمج البلاطات في شبكة 2×2 (لإنتاج 512) أو 4×4 (لإنتاج 1024).
- حفظ الناتج كصورة PNG في مجلد الكاش.

#### 1.2 إنشاء مجلد كاش محلي
- مسار الكاش: `%APPDATA%/OpenGeo/tiles/`
- نمط التسمية: `{sourceId}_{tileSize}_{zoom}_{quadkey}.png`
- إنشاء دالة `QuadKeyEncoder` لتحويل X/Y/Z إلى QuadKey string.

#### 1.3 تحديث [TileDownloader](file:///C:/Program%20Files%20(x86)/Common%20Files/Adobe/CEP/extensions/OpenGeo/client/js/engine/OpenGeoEngine.js)
- تحميل بلاطات 256px من الخادم كالمعتاد.
- تجميع كل 4 بلاطات (2×2) في مجموعة واحدة → إرسالها لـ Stitcher → حفظ ملف 512px.
- إذا كانت الجودة "Ultra": تجميع 16 بلاطة (4×4) → ملف 1024px.

---

### المرحلة 2: بناء نظام Multi-LOD (هرم البلاطات)

#### 2.1 خوارزمية تحديد مستويات الزوم المطلوبة
عند Finalize، نقوم بـ:
1. حساب أقصى زوم مطلوب (Zoom الأساسي + Quality Offset).
2. إنشاء بلاطات لهذا المستوى (التفصيل العالي — تغطي منطقة الكاميرا).
3. إنشاء بلاطات لمستوى أقل بـ 1 (تغطي منطقة أوسع حول الكاميرا).
4. إنشاء بلاطات لمستوى أقل بـ 2 (تغطي المنطقة الأوسع — تملأ الفراغات).

#### 2.2 حساب الـ Scale في أفترافكتس
```
globalInterpolationTileSize = 512;
mapSize = 262144;

scalePercent = mapSize / (2^zoom × tileActualSize) × 100
```
أمثلة:
- بلاطة 512px في Zoom 5: `262144 / (32 × 512) × 100 = 1600%`
- بلاطة 1024px في Zoom 4: `262144 / (16 × 1024) × 100 = 1600%` (نفس الحجم المرئي!)
- بلاطة 512px في Zoom 4: `262144 / (16 × 512) × 100 = 3200%`

#### 2.3 حساب الـ Position في أفترافكتس
```
worldTileSize = mapSize / (2^zoom)
position.X = tileX × worldTileSize
position.Y = tileY × worldTileSize
```
مثال: Zoom 5، بلاطة X=20, Y=18:
- `worldTileSize = 262144 / 32 = 8192`
- `position = [20 × 8192, 18 × 8192] = [163840, 147456]` ✅ (يطابق القيمة المقاسة!)

---

### المرحلة 3: بناء MapPivot وتوليد الكومبوزيشن

#### 3.1 تعديل [host/index.jsx](file:///C:/Program%20Files%20(x86)/Common%20Files/Adobe/CEP/extensions/OpenGeo/host/index.jsx)
1. إنشاء كومبوزيشن داخلي (Mapcomp) بحجم الكومبوزيشن المختار.
2. إنشاء `Null Object` يسمى `MapPivot` داخله.
3. إضافة Effects على MapPivot: `mapcompdata`, `styleinterface`, `viewpointhelper1`, `viewpointhelper2`.
4. كتابة Expression الـ Scale (معادلة `2^zoom / mapSize × tileSize × 100`).
5. كتابة Expression الـ Anchor Point (معادلات Mercator + Interpolation الكاملة).

#### 3.2 إنشاء الكومبوزيشن الحاوي (Containing Comp)
1. إنشاء كومبوزيشن خارجي (`containing [Name] Mapcomp`).
2. إضافة الكومبوزيشن الداخلي كطبقة Pre-comp.
3. إضافة `World Mapcomp Anchor` (Null) مع Expressions الربط.
4. وضع Controllers (Latitude, Longitude, Zoom, Bearing, Pitch) على طبقة الـ Pre-comp.

#### 3.3 إدراج البلاطات
- لكل ملف MegaTile محفوظ:
  1. استيراد الملف إلى المشروع (`app.project.importFile()`).
  2. إضافته كطبقة في الكومبوزيشن الداخلي.
  3. تعيين Position ثابت (القيمة المحسوبة رياضياً).
  4. تعيين Scale ثابت (حسب الزوم وحجم البلاطة).
  5. تعيين Anchor Point = `[0, 0, 0]`.
  6. ربط الطبقة بـ MapPivot: `layer.parent = mapPivotLayer`.
- **ترتيب الإدراج:** بلاطات الزوم الأعلى أولاً (فوق) → الزوم الأقل أخيراً (تحت).

---

### المرحلة 4: تحديث [app.js](file:///C:/Program%20Files%20(x86)/Common%20Files/Adobe/CEP/extensions/OpenGeo/client/js/app.js) — دالة `_finalize()`

#### 4.1 تدفق العمل الجديد لـ Finalize:
```
1. جمع الـ Keyframes (lat, lon, zoom) لكل فريم ← frames[]
2. تحديد أقصى زوم (downloadZoom) ومنطقة التغطية الجغرافية
3. حساب البلاطات المطلوبة لكل مستوى LOD:
   - LOD 0 (High Detail): downloadZoom → بلاطات داخل viewport
   - LOD 1 (Medium): downloadZoom - 1 → بلاطات حول viewport
   - LOD 2 (Low): downloadZoom - 2 → تغطية واسعة
4. تحميل جميع البلاطات 256px من الخادم
5. دمجها في MegaTiles (512 أو 1024) عبر TileStitcher
6. حفظ الملفات في مجلد الكاش المحلي
7. إرسال أمر لـ host/index.jsx لبناء الكومبوزيشن:
   - بيانات البلاطات (مسار، زوم، موقع، حجم Scale)
   - بيانات الـ Keyframes (lat, lon, zoom لكل فريم)
   - متغيرات MapPivot (mapSize, tileSize, maxZoom)
```

---

## القسم الثالث: المقارنة قبل وبعد

| المعيار | OpenGeo الحالي | OpenGeo بعد التطوير (مثل GEOlayers) |
|---|---|---|
| عدد الطبقات لكومبوزيشن 1080p بزوم 5 | ~400+ طبقة (256px لكل واحدة) | ~45 طبقة (512/1024px مدمجة) |
| Expressions | كود رياضي على **كل** طبقة | كود على طبقة **واحدة** فقط (MapPivot) |
| سرعة الريندر | بطيئة (مئات التقييمات/فريم) | سريعة جداً (تقييم واحد + Parenting C++) |
| التغطية عند الزوم Out | فراغات سوداء حول الحواف | تغطية كاملة بفضل Multi-LOD |
| مسار الكاش | مؤقت في الذاكرة | ملفات دائمة على القرص (إعادة استخدام) |

---

## القسم الرابع: الملفات المتأثرة

| الملف | نوع التعديل | الأولوية |
|---|---|---|
| [TileStitcher.js](file:///C:/Program%20Files%20(x86)/Common%20Files/Adobe/CEP/extensions/OpenGeo/client/js/engine/TileStitcher.js) | تعديل جذري — إضافة MegaTile stitching | عالية |
| [app.js](file:///C:/Program%20Files%20(x86)/Common%20Files/Adobe/CEP/extensions/OpenGeo/client/js/app.js) | تعديل `_finalize()` بالكامل | عالية |
| [host/index.jsx](file:///C:/Program%20Files%20(x86)/Common%20Files/Adobe/CEP/extensions/OpenGeo/host/index.jsx) | إعادة كتابة `buildComposition()` | عالية |
| [TileGrid.js](file:///C:/Program%20Files%20(x86)/Common%20Files/Adobe/CEP/extensions/OpenGeo/client/js/map/TileGrid.js) | إضافة حساب Multi-LOD tiles | متوسطة |
| [OpenGeoEngine.js](file:///C:/Program%20Files%20(x86)/Common%20Files/Adobe/CEP/extensions/OpenGeo/client/js/engine/OpenGeoEngine.js) | تحديث TileDownloader | متوسطة |
| [NEW] `QuadKeyEncoder.js` | إنشاء جديد — تحويل XYZ ↔ QuadKey | متوسطة |

---

## 🛑 User Review Required

> [!IMPORTANT]
> هذه الخطة تمثل إعادة هيكلة جذرية لقلب المحرك. التنفيذ الكامل سيستغرق عدة مراحل متتالية. هل توافق على البدء بالمرحلة الأولى (MegaTile Stitcher + QuadKey)؟
