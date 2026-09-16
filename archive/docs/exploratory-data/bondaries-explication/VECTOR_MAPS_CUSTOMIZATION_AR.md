# 🗺️ دليل المطورين الشامل: رسم الخرائط الفيكتورية، معالجة الحدود البرية، وتخصيص الخرائط الإقليمية (المغرب وفلسطين)

## 📌 مقدمة
يقدم هذا المستند دليلاً هندسياً وتقنياً مبسطاً وشاملاً للمطورين يشرح كيفية العمل مع الخرائط الفيكتورية (Vector Maps)، كيفية معالجة وتصفية الحدود البرية والبحرية، وآليات التعديل والتخصيص الجغرافي للخرائط الإقليمية مثل **خريطة المغرب والصحراء الغربية** و**خريطة فلسطين** في تطبيقات الويب الحديثة بأسلوب عالمي وبأعلى أداء رسومي (60fps).

---

## 📐 1. أساسيات وكيفية رسم الخرائط الفيكتورية (Vector Map Rendering)

### أ. الإسقاط الجغرافي وهيكل البيانات
تعتمد الخرائط التفاعلية الحديثة على نظام الإسقاط **Web Mercator (EPSG:3857)** لتمرير الإحداثيات الجغرافية كخطوط طول وعرض **EPSG:4326 (WGS84)** وتحويلها إلى نقاط بكسل على الشاشة.

تُجهز بيانات الخرائط الفيكتورية بصيغة **GeoJSON** أو **TopoJSON**:
- **`FeatureCollection`**: الحاوية الرئيسية لجميع العناصر المكانية.
- **`Feature`**: الكائن الممثل لدولة أو خط حدودي، ويحتوي على:
  - `geometry`: الشكل الهندسي (`Polygon`, `MultiPolygon`, `LineString`).
  - `properties`: البيانات الوصفية (مثل `ISO_A3`, `NAME_AR`, `ADM0_A3`).

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": 1,
      "properties": {
        "ISO_A3": "MAR",
        "NAME_AR": "المغرب",
        "ADMIN": "Morocco"
      },
      "geometry": {
        "type": "MultiPolygon",
        "coordinates": [ ... ]
      }
    }
  ]
}
```

---

### ب. خط معالجة العرض في المتصفح (WebGL Pipeline)
عند استخدام **MapLibre GL JS** أو **React Map GL**، يتم معالجة البيانات بالشكل التالي:

```
┌─────────────────────────┐
│     GeoJSON / TopoJSON   │ (بيانات متجهة)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│    Source (GeoJSON)     │ (تحميل البيانات في الذاكرة)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ MapLibre WebGL Engine   │ (تحويل الإحداثيات عبر GPU Shaders)
└────────────┬────────────┘
             │
 ┌───────────┴───────────┐
 ▼                       ▼
Fill Layer              Line Layer
(التعبئة والظلال)         (الحدود والخطوط)
```

### ج. كود عملي لرسم طبقة المضلعات والحدود في React
```tsx
import { Source, Layer } from 'react-map-gl/maplibre';

export const CountryMapLayers = ({ geojsonData }) => {
  return (
    <Source id="countries-data" type="geojson" data={geojsonData} promoteId="ISO_A3">
      {/* 1. طبقة تعبئة المساحات (Fill Layer) */}
      <Layer
        id="countries-fill"
        type="fill"
        paint={{
          'fill-color': '#1e293b',
          'fill-opacity': 0.8,
        }}
      />

      {/* 2. طبقة خطوط الحدود (Line Layer) */}
      <Layer
        id="countries-stroke"
        type="line"
        paint={{
          'line-color': '#38bdf8',
          'line-width': 1.5,
          'line-opacity': 0.9,
        }}
      />
    </Source>
  );
};
```

---

## 🏞️ 2. كيفية اعتماد الحدود البرية فقط (Land Boundaries Only)

### أ. المشكلة: تداخل الحدود البحرية والسواحل
تتضمن بيانات Natural Earth أو البيانات الجغرافية العامة نوعين من الحدود:
1. **الحدود البرية (Land Boundaries):** الخطوط الفاصلة بين الدول على اليابسة.
2. **الحدود البحرية والمائية (Maritime Boundaries & Coastlines):** خطوط المياه الإقليمية والمناطق الاقتصادية الخالصة (EEZ).

إذا قمنا برسم حدود المضلعات (Polygons Outline) بدون تصفية، ستظهر خطوط حول السواحل البحرية وفي منتصف المحيطات، مما يسبب تشوهاً بصرياً.

---

### ب. الحل التقني: فصل وطباعة الحدود البرية
تعتمد استراتيجية اعتماد الحدود البرية فقط على خيارين:

#### 1. استخدام ملف GeoJSON مخصص للحدود البرية (Boundary Lines)
يتم استخدام ملف مخصص يحتوي فقط على الخطوط المحددة كـ `International boundary (land)` مثل `ne_10m_admin_0_boundary_lines_land.geojson`.

```typescript
// تصفية الخطوط الجغرافية لإبقاء الحدود البرية فقط
export const filterLandBoundariesOnly = (geojson: FeatureCollection): FeatureCollection => {
  const filteredFeatures = geojson.features.filter((feature: any) => {
    const props = feature.properties;
    
    // استبعاد الحدود البحرية وخطوط الساحل
    if (props.featurecla === 'Maritime boundary' || props.type === 'Maritime') {
      return false;
    }

    // الإبقاء على الحدود البرية الدولية والمناطق المتنازع عليها البرية
    return (
      props.featurecla === 'International boundary (land)' ||
      props.featurecla === 'Disputed' ||
      props.type === 'Land'
    );
  });

  return {
    type: 'FeatureCollection',
    features: filteredFeatures,
  };
};
```

#### 2. تقنية المحاذاة الدقيقة لمنع الفراغات بين الدول (Coordinates Snapping)
عند رصف مضلعات الدول البرية المتقاربة، ينشأ أحياناً فراغ ميكروسكوبي (Sliver Polygons) بسبب دقة الفواصل العشرية. يتم محاذاة الإحداثيات المشتركة عبر خوارزمية الشبكة (Grid Snapping):

```typescript
export class CountryGeometryFixer {
  public static snapSharedCoordinates(collection: FeatureCollection, tolerance: number = 0.0001): FeatureCollection {
    const coordMap = new Map<string, [number, number]>();

    const snapValue = (val: number) => Math.round(val / tolerance) * tolerance;

    // تمرير كل النقاط ومحاذاتها لأقرب نقطة في الشبكة
    collection.features.forEach((feature: any) => {
      // تعديل إحداثيات النقاط حياً
    });

    return collection;
  }
}
```

---

## 🇲🇦 3. تخصيص وتعديل خريطة المغرب والصحراء الغربية

### أ. الوضع الجغرافي والتقني
في قاعدة بيانات Natural Earth القياسية:
- كود المغرب: `MAR`.
- كود الصحراء الغربية: `SAH` أو `ESH`.
- الخط الفاصل الجغرافي المتعارف عليه في خرائط الأمم المتحدة يقع عند خط العرض **`27° 40' N`** (أي بالقيمة العشرية `27.666666666666668`).

حسب متطلبات التطبيق والمستخدمين، يمكن تطبيق أحد الخيارين الموضحين أدناه.

---

### ب. الخيار الأول: التحديث بحدود خط العرض (UN Border Split)
يقوم هذا الخيار بقص مضلع المغرب عند خط العرض `27.666666666666668` ودمج الجزء الجنوبي مع الصحراء الغربية باستخدام مكتبة `@turf/bbox-clip` و `@turf/union`:

```typescript
import bboxClip from '@turf/bbox-clip';
import union from '@turf/union';
import { featureCollection } from '@turf/helpers';

export const applyMoroccoUnBorderFix = (data: FeatureCollection): FeatureCollection => {
  const marIndex = data.features.findIndex((f: any) => getCountryCode(f.properties) === 'MAR');
  const eshIndex = data.features.findIndex((f: any) => 
    getCountryCode(f.properties) === 'SAH' || getCountryCode(f.properties) === 'ESH'
  );

  if (marIndex > -1 && eshIndex > -1) {
    const mar = data.features[marIndex];
    const esh = data.features[eshIndex];

    // خط العرض 27° 40' N
    const splitLat = 27.666666666666668;

    // 1. قص الجزء الشمالي للمغرب (أعلى خط العرض)
    const newMar = bboxClip(mar as any, [-180, splitLat, 180, 90]);
    newMar.properties = mar.properties;

    // 2. قص الجزء الجنوبي للمغرب (أسفل خط العرض)
    const westernEsh = bboxClip(mar as any, [-180, -90, 180, splitLat]);

    // 3. دمج الجزء الجنوبي مع الصحراء الغربية
    let newEsh = union(featureCollection([westernEsh as any, esh as any]) as any) as any;
    
    if (newEsh) {
      newEsh.properties = esh.properties;
      data.features[marIndex] = newMar as any;
      data.features[eshIndex] = newEsh as any;
      console.log('تم تطبيق التعديل الجغرافي للمغرب والصحراء الغربية نجاح');
    }
  }

  return data;
};
```

---

### ج. الخيار الثاني: الخريطة الموحدة للمغرب (Unified Morocco Map)
إذا كان الهدف هو إظهار خريطة المغرب موحدة بدون أي خطوط فاصلة، يتم دمج مضلع `MAR` مع مضلع `ESH` كلياً في عنصر مكان واحد:

```typescript
export const unifyMoroccoMap = (data: FeatureCollection): FeatureCollection => {
  const marFeature = data.features.find((f: any) => getCountryCode(f.properties) === 'MAR');
  const eshFeature = data.features.find((f: any) => 
    getCountryCode(f.properties) === 'SAH' || getCountryCode(f.properties) === 'ESH'
  );

  if (marFeature && eshFeature) {
    // دمج الهندستين الجغرافيتين في مضلع واحد موحد
    const unifiedPoly = union(featureCollection([marFeature as any, eshFeature as any]) as any);

    if (unifiedPoly) {
      unifiedPoly.properties = {
        ...marFeature.properties,
        ISO_A3: 'MAR',
        ADM0_A3: 'MAR',
        NAME_AR: 'المغرب',
        NAME_EN: 'Morocco',
        LABEL_X: -7.0926, // إحداثيات مركز الخريطة الموحدة
        LABEL_Y: 31.7917,
      };

      // حذف العنصرين القديمين وإضافة المضلع الموحد الجديد
      data.features = data.features.filter((f: any) => {
        const code = getCountryCode(f.properties);
        return code !== 'MAR' && code !== 'SAH' && code !== 'ESH';
      });

      data.features.push(unifiedPoly as any);
    }
  }

  return data;
};
```

---

## 🇵🇸 4. تخصيص وتعديل خريطة فلسطين (Palestine Map)

### أ. الوضع الجغرافي والرموز الجغرافية
في مصادر البيانات الجغرافية العالمية (مثل Natural Earth):
- الكود الموحد الدولي لفلسطين: **`PSE`** أو **`PS`** أو **`PLE`**.
- تظهر فلسطين أحياناً مقسمة إلى أجزاء: الضفة الغربية (West Bank - `WBG` / `WEA`) وغزة (Gaza Strip - `GZA`).
- يهدف التخصيص إلى توحيد هذه العناصر في مضلع جغرافي واحد يحمل اسم **فلسطين** (`NAME_AR: 'فلسطين'`).

---

### ب. خطة التنفيذ لتوحيد خريطة فلسطين

```typescript
export const unifyPalestineMap = (data: FeatureCollection): FeatureCollection => {
  // 1. تحديد العناصر الممثلة للضفة الغربية وغزة وفلسطين
  const palestineFeatures = data.features.filter((f: any) => {
    const code = getCountryCode(f.properties);
    const name = (f.properties.NAME || f.properties.ADMIN || '').toLowerCase();
    
    return (
      code === 'PSE' || 
      code === 'PLE' || 
      code === 'WBG' || 
      code === 'GZA' ||
      name.includes('palestine') ||
      name.includes('west bank') ||
      name.includes('gaza')
    );
  });

  if (palestineFeatures.length > 0) {
    // 2. دمج جميع المضلعات الخاصة بفلسطين في MultiPolygon موحد
    let unifiedPalestine = palestineFeatures[0];

    for (let i = 1; i < palestineFeatures.length; i++) {
      const merged = union(featureCollection([unifiedPalestine as any, palestineFeatures[i] as any]) as any);
      if (merged) {
        unifiedPalestine = merged as any;
      }
    }

    // 3. ضبط الخصائص العربية والمكانية الموحدة
    unifiedPalestine.properties = {
      ...unifiedPalestine.properties,
      ISO_A3: 'PSE',
      ADM0_A3: 'PSE',
      NAME: 'Palestine',
      NAME_EN: 'Palestine',
      NAME_AR: 'فلسطين',
      LABEL_X: 35.2137, // القدس الشريف كموقع مركزي للافتة
      LABEL_Y: 31.7683,
    };

    // 4. إزالة العناصر المشتتة وإضافة العنصر الموحد
    const palestineCodes = ['PSE', 'PLE', 'WBG', 'GZA'];
    data.features = data.features.filter((f: any) => !palestineCodes.includes(getCountryCode(f.properties)));
    data.features.push(unifiedPalestine as any);

    console.log('تم توحيد وتخصيص خريطة فلسطين بنجاح');
  }

  return data;
};
```

---

### ج. دالة توحيد جلب كود الدولة (Standard Country Code Extraction)
لضمان مطابقة الكود عبر مختلف خواص GeoJSON، نستخدم دالة موحدة تستوعب جميع التسميات الممكنة:

```typescript
export const getCountryCode = (props: any): string => {
  if (!props) return 'UNKNOWN';

  const candidates = [
    props.ISO_A3, props.iso_a3,
    props.ADM0_A3, props.adm0_a3,
    props.GU_A3, props.gu_a3,
    props.SU_A3, props.su_a3,
    props.ISO3166, props.iso3166,
    props['ISO3166-1-Alpha-3'],
  ];

  for (const code of candidates) {
    if (code && code !== '-99') {
      return String(code).toUpperCase();
    }
  }

  return (props.NAME || props.name || 'UNKNOWN').toUpperCase();
};
```

---

## 🚀 5. الأداء، التخزين المؤقت، وأفضل الممارسات للمطورين

1. **التخزين المؤقت عبر IndexedDB (`CacheService`):**
   - معالجة وملفات GeoJSON قد تتجاوز حجم 10MB.
   - يتم تخزين ناتج المعالجة بعد التعديل في IndexedDB لضمان تحميل الخريطة خلال أقل من **50ms** عند الزيارات التالية.

2. **التطوير مع Web Workers (`WorkerService`):**
   - يتم إجراء عمليات `Turf.js` الثقيلة (مثل `union` و `bboxClip`) في خيط خلفي (Web Worker) حتى لا تتسبب في تجمد واجهة المستخدم (UI Freeze).

3. **تسريع التلوين والتفاعل (MapLibre Feature State):**
   - يفضل إعطاء كل دولة معرّف عددي فريد `feature.id = index + 1` لاستخدام `setFeatureState` في التلوين المباشر بواسطة بطاقة الرسوميات (GPU) بدلاً من إعادة تصيير البيانات بالكامل.

---

## 📊 جدول ملخص الخصائص والأكواد المفتاحية

| المنطقة / الدولة | الكود القياسي (ISO_A3) | الخاصية العربية (`NAME_AR`) | التقنية المستخدمة للتعديل |
| :--- | :--- | :--- | :--- |
| **المغرب** | `MAR` | `المغرب` | Turf `bboxClip` أو `union` لتوحيد المضلعات |
| **الصحراء الغربية** | `ESH` / `SAH` | `الصحراء الغربية` | Turf `bboxClip` و `union` مع الشريط الحدودي |
| **فلسطين** | `PSE` | `فلسطين` | Turf `union` لدمج الضفة وغزة وتوحيد `LABEL_X/Y` |
| **الحدود البرية** | - | - | تصفية `featurecla === 'International boundary (land)'` |

---

## 📝 الخلاصة
إن رسم الخرائط الفيكتورية وتخصيص حدود الدول يعتمد على **دقة معالجة البيانات المكانية (GeoJSON Data Processing)** قبل نقلها إلى خيط العرض (WebGL Render Pass). باستخدام خوارزميات `@turf/union` و `@turf/bbox-clip` والتخزين المؤقت، يتم الحصول على خرائط دقيقة وسريعة تلبي التطلعات الجغرافية والسياسية بدقة متناهية.
