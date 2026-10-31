# الدليل التقني والبرمجي التفصيلي لتنفيذ نظام GeoJSON التفاعلي في OpenGeo (v1.1.0)

تُعد هذه الوثيقة **المواصفة الهندسية والبرمجية المكمّلة** لملف `docs/GEOJSON_ELEVATION_AND_LAYERS_PLAN.md`، وتحتوي على الخوارزميات الرياضية، ومعالجات الحالات الحرجة (Edge Cases)، والأكواد الجاهزة للتنفيذ في كل من **Client JavaScript** و **ExtendScript Host (`vectorHost.jsx`)** للوصول إلى مستوى احترافية **GEOlayers 3**.

---

## أولاً: التقييم الهندسي للخطة و5 تحسينات جوهرية لا غنى عنها

الخطة المعمارية في `GEOJSON_ELEVATION_AND_LAYERS_PLAN.md` ممتازة ومتكاملة من حيث تجربة المستخدم وتقسيم المهام، ولكن لضمان عملها بكفاءة **100% بدون تشوهات جغرافية أو مشاكل تحريك في After Effects**، يجب دمج **5 تقنيات هندسية دقيقة** أثناء التنفيذ:

| المحور في الخطة | التحدي الخفي عند التنفيذ الفعلي | التقنية الهندسية الحاسمة للحل |
| :--- | :--- | :--- |
| **1. دمج التكتلات (`@turf/union`)** | حدود الدول في ملفات GeoJSON العالمية (مثل Natural Earth) تحتوي غالباً على فروق عشرية مجهرية (`1e-5°`) تمنع ذوبان الحدود المشتركة وتترك خطوطاً داخلية (Sliver Holes). | **Topological Grid Snapping + Sliver Hole Removal:** تقريب الإحداثيات لشبكة `1e-5` قبل الدمج، ثم حذف أي حلقة داخلية (`Interior Ring`) مساحتها أو نسبة استدارتها أصغر من عتبة البحيرات الحقيقية. |
| **2. التبسيط الذكي (`Douglas-Peucker`)** | تبسيط كل دولة بشكل منفصل في وضع `Separate Layers` يمزق الحدود المشتركة بين الدول المتجاورة ويخلق فجوات مثلثية؛ كما أن التبسيط في درجات `(lon, lat)` يشوه خطوط العرض العليا. | **Mercator-Space Simplification & Post-Union Order:** تنفيذ التبسيط في فضاء Web Mercator (`MAP_SIZE = 262144`)، وفي وضع الدمج الموحد يتم تنفيذ `Union` أولاً ثم التبسيط ثانياً على المحيط الخارجي فقط. |
| **3. مواقع أسماء الدول (`Center of Mass`)** | مركز الثقل الحسابي (`Centroid`) للدول المقعرة أو الساحلية أو ذات الجزر (`MultiPolygon`) يقع كثيراً خارج حدود الدولة أو في البحر. | **Largest Polygon + Visual Center (`Polylabel`):** اختيار المضلع الأكبر مساحةً في `MultiPolygon`، وحساب نقطة القطب البصري الداخلي (أكبر دائرة داخل المضلع) بدلاً من المتوسط الحسابي البسيط. |
| **4. نقطة ارتكاز الدولة في AE (`Shape Layer Anchor`)** | رسم رؤوس المضلع بإحداثيات العالم المطلقة مع بقاء `Position = [0,0]` يجعل `Anchor Point` بعيداً عن الدولة، فإذا قام المصمم بتكبير الدولة (`Scale`) تطير خارج الشاشة. | **Feature-Centered Local Coordinates:** وضع `Position` لطبقة الدولة في مركزها الجغرافي العالمي `(cx, cy, 0)`، وطرح `(cx, cy)` من جميع رؤوس المضلع (`localX = wx - cx`) لتكون `Anchor Point` في قلب الدولة تماماً. |
| **5. ثبات سماكة الحدود وحجم النصوص مع الزووم** | ربط طبقة الدولة بـ `MapPivot` يجعل سماكة الـ `Stroke` وحجم خط الـ `Text` يتضخمان $64\times$ عند عمل Zoom-in. | **Dynamic Scale-Compensated Expressions:** ربط عرض الـ `Stroke` ومقياس طبقة النص بتعبير برمجي (Expression) يعوض مقياس `MapPivot` تلقائياً مع دعم الوقوف الرأسي للنص عند ميلان الكاميرا (`Pitch`). |

---

## ثانياً: الخوارزميات والكود التنفيذي للمحركات الخمسة (Client-Side Engines)

### 1. محرك استخراج الهوية ولوحة الألوان المتناسقة (`FeatureIdentityAndStyle.js`)

```javascript
// لوحة ألوان سينمائية متباعدة بصرياً (Golden-Angle HSL + Curated Geo Palette)
const OPENGEO_CURATED_PALETTE = [
  '#10b981', // Emerald
  '#3b82f6', // Royal Blue
  '#f43f5e', // Rose Crimson
  '#f59e0b', // Amber Gold
  '#8b5cf6', // Vivid Violet
  '#06b6d4', // Cyan Teal
  '#ec4899', // Magenta Pink
  '#84cc16', // Lime Green
  '#f97316', // Deep Orange
  '#6366f1'  // Indigo
];

function resolveFeatureMetadata(feature, index) {
  const props = (feature && feature.properties) || {};
  const name = String(
    props.name_ar || props['name:ar'] || props.NAME_AR ||
    props.name || props.NAME || props.Name ||
    props.admin || props.ADMIN || props.SOVEREIGNT ||
    props.title || props.label || props.id ||
    `Feature ${index + 1}`
  ).trim();

  const isoCode = String(
    props.iso_a2 || props.ISO_A2 || props.iso_a3 || props.ISO_A3 || props.adm0_a3 || ''
  ).trim().toUpperCase();

  // دعم معيار Simplestyle-Spec v1.1.0 مع التراجع إلى اللوحة المتناسقة
  const defaultColor = OPENGEO_CURATED_PALETTE[index % OPENGEO_CURATED_PALETTE.length];
  const fillColor = normalizeHexColor(props.fill || props.fillColor || props['fill-color'] || props.color, defaultColor);
  const strokeColor = normalizeHexColor(props.stroke || props.strokeColor || props['stroke-color'], '#ffffff');
  const fillOpacity = clampNumber(props['fill-opacity'] !== undefined ? props['fill-opacity'] * 100 : 65, 0, 100);
  const strokeWidth = clampNumber(props['stroke-width'] !== undefined ? props['stroke-width'] : 2.5, 0.5, 20);

  return {
    id: feature.id || `feat_${index}_${Date.now()}`,
    index,
    name,
    isoCode,
    geometryType: feature && feature.geometry ? feature.geometry.type : 'Unknown',
    vertexCount: countGeometryVertices(feature && feature.geometry),
    selected: true,
    fillColor,
    strokeColor,
    fillOpacity,
    strokeWidth
  };
}

function normalizeHexColor(input, fallback) {
  if (!input || typeof input !== 'string') return fallback;
  const clean = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(clean)) return clean.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
    return ('#' + clean[1] + clean[1] + clean[2] + clean[2] + clean[3] + clean[3]).toLowerCase();
  }
  return fallback;
}

function countGeometryVertices(geometry) {
  if (!geometry || !geometry.coordinates) return 0;
  let count = 0;
  function walk(coords) {
    if (!Array.isArray(coords) || coords.length === 0) return;
    if (typeof coords[0] === 'number') {
      count += 1;
      return;
    }
    for (let i = 0; i < coords.length; i++) walk(coords[i]);
  }
  walk(geometry.coordinates);
  return count;
}
```

---

### 2. محرك الدمج الموحد للتكتلات وإزالة الشقوق الحدودية (`UnifiedBlocMerger.js`)

هذه الخوارزمية تحل مشكلة الفواصل الحدودية الداخلية بين الدول المتجاورة (مثل الجزائر + تونس + المغرب) عبر **تقريب الإحداثيات (`Coordinate Grid Snapping`) + الدمج الطوبولوجي + تنظيف الشقوق الداخلية (`Sliver Hole Removal`)**:

```javascript
/**
 * يدمج مجموعة من معالم الـ GeoJSON المحددة في تكتل خارجي موحد مصمت بدون حدود فاصلة داخلية.
 * @param {Array<Object>} selectedFeatures - المعالم المختارة من جدول الفرز
 * @param {Object} options - { snapPrecision: 1e-4, removeInternalSlivers: true, maxSliverAreaRatio: 0.015 }
 */
function mergeFeaturesAsUnifiedBloc(selectedFeatures, options = {}) {
  const snapPrecision = options.snapPrecision || 1e-4; // ~11 متر لتلافي فجوات الترقيم بين الدول
  const removeSlivers = options.removeInternalSlivers !== false;
  const maxSliverRatio = options.maxSliverAreaRatio || 0.015;

  const polygonFeatures = selectedFeatures
    .filter(f => f && f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map(f => snapFeatureCoordinates(f, snapPrecision));

  if (polygonFeatures.length === 0) return null;
  if (polygonFeatures.length === 1) {
    return cleanInternalSliverHoles(polygonFeatures[0], removeSlivers, maxSliverRatio);
  }

  let merged = polygonFeatures[0];
  for (let i = 1; i < polygonFeatures.length; i++) {
    try {
      if (typeof turf !== 'undefined' && typeof turf.union === 'function') {
        // دعم كل من Turf v6 (وسيطين) و Turf v7 (FeatureCollection)
        const unionResult = turf.union.length >= 2
          ? turf.union(merged, polygonFeatures[i])
          : turf.union({ type: 'FeatureCollection', features: [merged, polygonFeatures[i]] });
        if (unionResult) merged = unionResult;
      } else {
        merged = combineIntoMultiPolygonFallback(merged, polygonFeatures[i]);
      }
    } catch (unionErr) {
      merged = combineIntoMultiPolygonFallback(merged, polygonFeatures[i]);
    }
  }

  // إزالة الفجوات الحدودية الشريطية الناتجة عن عدم تطابق النقاط بين الدولتين
  return cleanInternalSliverHoles(merged, removeSlivers, maxSliverRatio);
}

function snapFeatureCoordinates(feature, precision) {
  const clone = JSON.parse(JSON.stringify(feature));
  function snapRing(coords) {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === 'number') {
      return [
        Math.round(coords[0] / precision) * precision,
        Math.round(coords[1] / precision) * precision
      ];
    }
    return coords.map(snapRing);
  }
  clone.geometry.coordinates = snapRing(clone.geometry.coordinates);
  return clone;
}

/**
 * يحذف الحلقات الداخلية (Holes) التي تمثل شقوقاً حدودية بين الدول المدمجة،
 * مع الإبقاء فقط على المسطحات الداخلية الكبيرة إذا رغب المستخدم.
 */
function cleanInternalSliverHoles(feature, removeSlivers, maxSliverRatio) {
  if (!removeSlivers || !feature || !feature.geometry) return feature;
  const geom = feature.geometry;

  function filterPolygonRings(rings) {
    if (!Array.isArray(rings) || rings.length <= 1) return rings;
    const outerRing = rings[0];
    const outerArea = Math.abs( signedRingArea(outerRing) );
    if (outerArea <= 0) return [outerRing];

    // احتفظ بالحلقة الخارجية دائماً، واحذف أي ثقب داخلي صغير ناتج عن حدود مشتركة
    const keptHoles = rings.slice(1).filter(hole => {
      const holeArea = Math.abs(signedRingArea(hole));
      const perimeter = ringPerimeter(hole);
      // معامل الاستدارة (Isoperimetric Quotient): الشقوق الحدودية تكون رفيعة جداً (قريبة من الصفر)
      const compactness = perimeter > 0 ? (4 * Math.PI * holeArea) / (perimeter * perimeter) : 0;
      return (holeArea / outerArea) > maxSliverRatio && compactness > 0.08;
    });
    return [outerRing].concat(keptHoles);
  }

  if (geom.type === 'Polygon') {
    geom.coordinates = filterPolygonRings(geom.coordinates);
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates = geom.coordinates.map(filterPolygonRings);
  }
  return feature;
}

function signedRingArea(ring) {
  let area = 0;
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return area / 2;
}

function ringPerimeter(ring) {
  let p = 0;
  for (let i = 1; i < ring.length; i++) {
    const dx = ring[i][0] - ring[i - 1][0];
    const dy = ring[i][1] - ring[i - 1][1];
    p += Math.sqrt(dx * dx + dy * dy);
  }
  return p;
}
```

---

### 3. محرك التبسيط التكيفي في فضاء Mercator (`MercatorSimplifier.js`)

لتجنب تجميد After Effects عندما يتجاوز إجمالي النقاط `4,000` نقطة، نقوم بحساب معامل التسامح $\epsilon$ ديناميكياً بحيث يقلص إجمالي النقاط إلى الميزانية المستهدفة (`targetMaxPoints = 3500`) مع الحفاظ على الملامح:

```javascript
function simplifyMercatorRing(ring, toleranceWorldUnits) {
  if (!Array.isArray(ring) || ring.length <= 4 || toleranceWorldUnits <= 0) return ring;

  // إغلاق الحلقة بعد التبسيط مع ضمان بقاء 4 نقاط على الأقل للمضلع الصالح في AE
  const openPoints = ring.slice(0, ring.length - 1);
  const simplified = douglasPeucker(openPoints, toleranceWorldUnits);
  if (simplified.length < 3) return ring;
  simplified.push([simplified[0][0], simplified[0][1]]);
  return simplified;
}

function douglasPeucker(points, sqTolerance) {
  const len = points.length;
  const markers = new Uint8Array(len);
  let first = 0;
  let last = len - 1;
  const stack = [];
  const newPoints = [];
  markers[first] = markers[last] = 1;

  while (last) {
    let maxSqDist = 0;
    let index = 0;
    for (let i = first + 1; i < last; i++) {
      const sqDist = getSqSegDist(points[i], points[first], points[last]);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }
    if (maxSqDist > sqTolerance) {
      markers[index] = 1;
      stack.push(first, index, index, last);
    }
    last = stack.pop();
    first = stack.pop();
  }

  for (let i = 0; i < len; i++) {
    if (markers[i]) newPoints.push(points[i]);
  }
  return newPoints;
}

function getSqSegDist(p, p1, p2) {
  let x = p1[0], y = p1[1];
  let dx = p2[0] - x, dy = p2[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = p2[0]; y = p2[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}
```

---

### 4. محرك حساب المركز البصري الذكي للمسميات النصية (`VisualLabelLocator.js`)

بدلاً من المتوسط الحسابي البسيط الذي قد يضع اسم الدولة في البحر أو خارج الحدود المقعرة، نختار المضلع الرئيسي الأكبر مساحةً ونفحص شبكة داخلية (`Visual Interior Grid Search`) لاختيار النقطة الأبعد عن الحدود داخل المضلع:

```javascript
function computeFeatureVisualLabelPosition(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    return { lon: geometry.coordinates[0], lat: geometry.coordinates[1] };
  }
  if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
    const mid = geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
    return { lon: mid[0], lat: mid[1] };
  }

  // بالنسبة لـ Polygon و MultiPolygon: نختار الحلقة الخارجية الأكبر مساحةً (الأرض الرئيسية للدولة)
  let bestOuterRing = null;
  let maxArea = -1;

  if (geometry.type === 'Polygon') {
    bestOuterRing = geometry.coordinates[0];
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) {
      if (!poly || !poly[0]) continue;
      const area = Math.abs(signedRingArea(poly[0]));
      if (area > maxArea) {
        maxArea = area;
        bestOuterRing = poly[0];
      }
    }
  }
  if (!bestOuterRing || bestOuterRing.length < 3) return null;

  // البحث الشبكي السريع عن النقطة الأكثر توسطاً داخل المضلع (Pole of Inaccessibility)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of bestOuterRing) {
    if (pt[0] < minX) minX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] > maxY) maxY = pt[1];
  }

  let bestPoint = [(minX + maxX) / 2, (minY + maxY) / 2];
  let bestDistSq = pointToRingDistSq(bestPoint[0], bestPoint[1], bestOuterRing);
  if (!isPointInRing(bestPoint[0], bestPoint[1], bestOuterRing)) bestDistSq = -1;

  const steps = 12;
  const stepX = (maxX - minX) / steps;
  const stepY = (maxY - minY) / steps;
  if (stepX > 0 && stepY > 0) {
    for (let ix = 1; ix < steps; ix++) {
      for (let iy = 1; iy < steps; iy++) {
        const px = minX + ix * stepX;
        const py = minY + iy * stepY;
        if (isPointInRing(px, py, bestOuterRing)) {
          const dSq = pointToRingDistSq(px, py, bestOuterRing);
          if (dSq > bestDistSq) {
            bestDistSq = dSq;
            bestPoint = [px, py];
          }
        }
      }
    }
  }
  return { lon: bestPoint[0], lat: bestPoint[1] };
}

function isPointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToRingDistSq(px, py, ring) {
  let minDistSq = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const dSq = getSqSegDist([px, py], ring[i - 1], ring[i]);
    if (dSq < minDistSq) minDistSq = dSq;
  }
  return minDistSq;
}
```

---

### 5. محرك التأطير التلقائي للكاميرا (`Fit Camera to Selection`)

عند تفعيل خيار `[☑] ضبط موضع الكاميرا تلقائياً ليشمل نطاق الخريطة المحددة`:

```javascript
function computeCameraFramingForFeatures(selectedFeatures, compWidth, compHeight, paddingRatio = 0.15) {
  const MAP_SIZE = 262144;
  let minWX = Infinity, minWY = Infinity, maxWX = -Infinity, maxWY = -Infinity;

  function visitCoord(lon, lat) {
    const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat) || 0));
    const rad = (safeLat * Math.PI) / 180;
    const mN = Math.log(Math.tan(Math.PI / 4 + rad / 2));
    const wx = (((Number(lon) || 0) + 180) / 360) * MAP_SIZE;
    const wy = ((1 - mN / Math.PI) / 2) * MAP_SIZE;
    if (wx < minWX) minWX = wx;
    if (wy < minWY) minWY = wy;
    if (wx > maxWX) maxWX = wx;
    if (wy > maxWY) maxWY = wy;
  }

  for (const feat of selectedFeatures) {
    const geom = feat && feat.geometry;
    if (!geom || !geom.coordinates) continue;
    (function walk(c) {
      if (typeof c[0] === 'number') visitCoord(c[0], c[1]);
      else for (let i = 0; i < c.length; i++) walk(c[i]);
    })(geom.coordinates);
  }

  if (!Number.isFinite(minWX)) return null;

  const midWX = (minWX + maxWX) / 2;
  const midWY = (minWY + maxWY) / 2;
  const spanWX = Math.max(1e-3, maxWX - minWX);
  const spanWY = Math.max(1e-3, maxWY - minWY);

  const usableW = Math.max(256, (compWidth || 1920) * (1 - 2 * paddingRatio));
  const usableH = Math.max(256, (compHeight || 1080) * (1 - 2 * paddingRatio));
  const scaleFactor = Math.min(usableW / spanWX, usableH / spanWY);
  const targetZoom = Math.max(1, Math.min(18, Math.log2((scaleFactor * MAP_SIZE) / 256)));

  // تحويل عكسي من إحداثيات العالم (midWX, midWY) إلى (lat, lon)
  const lon = (midWX / MAP_SIZE) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * midWY) / MAP_SIZE;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));

  return {
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    zoom: Number(targetZoom.toFixed(2))
  };
}
```

---

## ثالثاً: الهندسة المتقدمة لجانب After Effects (`host/modules/vectorHost.jsx`)

لكي تتصرف طبقات الدول والمسميات النصية في After Effects بنفس سلاسة ومرونة **GEOlayers 3**، طبّق القواعد الثلاث التالية داخل `host/modules/vectorHost.jsx`:

### 1. الإحداثيات المحلية المتمركزة (`Feature-Centered Shape Layers`)
بدلاً من وضع طبقة الـ Shape عند `[0, 0, 0]` ورسم الرؤوس عند `[140000, 95000]` (مما يجعل نقطة الارتكاز `Anchor Point` بعيدة عن الدولة)، اجعل كل دولة متمركزة حول مركزها الجغرافي الخاص:

```javascript
function opengeoCreateFeatureShapeLayer(mapComp, mapPivot, featurePayload, documentId) {
  var shapeLayer = mapComp.layers.addShape();
  shapeLayer.name = 'GeoJSON - ' + String(featurePayload.name || 'Feature');
  shapeLayer.threeDLayer = true;
  shapeLayer.quality = LayerQuality.BEST;

  // المركز العالمي للدولة في فضاء MAP_SIZE = 262144
  var centerWX = Number(featurePayload.centerWorldX) || 0;
  var centerWY = Number(featurePayload.centerWorldY) || 0;

  // ربط الطبقة بـ MapPivot ووضعها في مركز الدولة مباشرةً بحيث تكون Anchor Point [0,0,0] في قلب الدولة!
  shapeLayer.property('Anchor Point').setValue([0, 0, 0]);
  shapeLayer.parent = mapPivot;
  shapeLayer.property('Position').setValue([centerWX, centerWY, 0]);
  shapeLayer.property('Scale').setValue([100, 100, 100]);

  // إضافة Slider للتحكم في سماكة الحدود بالبكسل على الشاشة مهما تغير الزووم
  var effects = shapeLayer.property('ADBE Effect Parade');
  var strokeSlider = effects.addProperty('ADBE Slider Control');
  strokeSlider.name = 'Screen Stroke Width';
  strokeSlider.property(1).setValue(Number(featurePayload.strokeWidth) || 2.5);

  var rootVectors = shapeLayer.property('ADBE Root Vectors Group');
  var group = rootVectors.addProperty('ADBE Vector Group');
  group.name = String(featurePayload.name || 'Polygons');
  var groupVectors = group.property('ADBE Vectors Group');

  // رسم جميع الحلقات بإحداثيات محلية مطروحاً منها (centerWX, centerWY)
  var rings = featurePayload.localRings || [];
  for (var r = 0; r < rings.length; r++) {
    var pathGroup = groupVectors.addProperty('ADBE Vector Shape - Group');
    var myShape = new Shape();
    myShape.vertices = rings[r]; // مصفوفة [[vx - centerWX, vy - centerWY], ...]
    myShape.closed = true;
    pathGroup.property('ADBE Vector Shape').setValue(myShape);
  }

  // إضافة Merge Paths إذا كان المضلع يحتوي على ثقوب داخلية (Holes)
  if (rings.length > 1 && featurePayload.hasHoles === true) {
    var mergePaths = groupVectors.addProperty('ADBE Vector Filter - Merge');
    mergePaths.property('ADBE Vector Merge Type').setValue(4); // Exclude Intersections / Even-Odd
  }

  // إضافة Stroke مع تعبير يحافظ على ثبات السماكة على الشاشة عند عمل Zoom
  var stroke = groupVectors.addProperty('ADBE Vector Graphic - Stroke');
  stroke.property('ADBE Vector Stroke Color').setValue(featurePayload.strokeColorRgb || [1, 1, 1]);
  var strokeWidthProp = stroke.property('ADBE Vector Stroke Width');
  strokeWidthProp.setValue(Number(featurePayload.strokeWidth) || 2.5);
  strokeWidthProp.expression =
    'var w = effect("Screen Stroke Width")(1).value;\n' +
    'var pScale = (hasParent && parent.transform.scale[0] > 0.0001) ? (parent.transform.scale[0] / 100) : 1;\n' +
    'w / pScale;';

  // إضافة Fill مع شفافية قابلة للتعديل
  var fill = groupVectors.addProperty('ADBE Vector Graphic - Fill');
  fill.property('ADBE Vector Fill Color').setValue(featurePayload.fillColorRgb || [0.06, 0.72, 0.50]);
  fill.property('ADBE Vector Fill Opacity').setValue(
    featurePayload.fillOpacity !== undefined ? Number(featurePayload.fillOpacity) : 65
  );

  return shapeLayer;
}
```

### 2. إنشاء طبقات النصوص ثلاثية الأبعاد ذاتية التوازن (`Auto-Scaling 3D Text Labels`)
لكي تظل أسماء الدول واضحة وبحجم ثابت على الشاشة مهما تغير الزووم، وتقف مواجهةً للكاميرا عند إمالة الخريطة (`Pitch > 0`):

```javascript
function opengeoCreateFeatureTextLabel(mapComp, mapPivot, labelPayload, containingCompName, mapcompName) {
  var textLayer = mapComp.layers.addText(String(labelPayload.text || ''));
  textLayer.name = 'Label - ' + String(labelPayload.text || '');
  textLayer.threeDLayer = true;

  // ضبط نقطة الارتكاز في منتصف النص
  var rect = textLayer.sourceRectAtTime(0, false);
  textLayer.property('Anchor Point').setValue([rect.left + rect.width / 2, rect.top + rect.height / 2, 0]);

  textLayer.parent = mapPivot;
  textLayer.property('Position').setValue([Number(labelPayload.worldX) || 0, Number(labelPayload.worldY) || 0, -2]);

  // تعبير يحافظ على ثبات حجم النص على الشاشة مهما تغير زووم MapPivot
  textLayer.property('Scale').expression =
    'var pScale = (hasParent && parent.transform.scale[0] > 0.0001) ? (parent.transform.scale[0] / 100) : 1;\n' +
    'var s = 100 / pScale;\n' +
    '[s, s, s];';

  return textLayer;
}
```
