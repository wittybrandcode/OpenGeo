# التقرير الهندسي المكمّل: التحليل العميق للكود المصدري وخطة التنفيذ النهائية لإزالة فواصل البلاطات (Tile Seams) في OpenGeo

يُرفق هذا التقرير **كمكمّل مباشر للتقرير المعماري الأول (`ARCHITECTURAL_ELEVATION_ROADMAP.md`)** بعد إتمام الفحص الكامل لـ **12 ملفاً مصدرياً** من طرفي الإضافة (Client JavaScript / Workers و ExtendScript Host)، بما في ذلك ملفا **`FinalizeController.js`** و **`FinalizeTimelineScanner.js`**.

كشف الفحص الدقيق للأسطر البرمجية عن **4 ثغرات هندسية خفية في الكود الحالي** كانت تتسبب في بقاء الخطوط الفاصلة (Tile Seams) حتى مع وجود `gutterPixels = 1`، وكانت ستمنع عمل `includeBaseCoverage: true` بشكل صحيح لو تم تفعيله بمجرد تغيير القيمة المنطقية من `false` إلى `true`.

## أولاً: جدول الملفات الـ 12 التي شملها الفحص والتدقيق

| **الملف** | **المسار في المشروع** | **الدور الهندسي** | **حالة التعديل المطلوبة** | 
| **TilePlanner.js** | `client/js/engine/TilePlanner.js` | تخطيط البلاطات عبر الإطارات الزمنية وبناء هرم التغطية الأساسي | **تعديل حرج** (إصلاح شرط `baseTiles` وترتيب المصفوفة) | 
| **MegaTileStitcher.js** | `client/js/engine/MegaTileStitcher.js` | التجميع الهرمي (Quadtree) وبثق الحواف الخارجية `1px` | **تعديل حرج** (منع الخلايا الفارغة `rgba(0,0,0,0)` داخل الـ MegaTile) | 
| **stitcherWorker.js** | `client/js/engine/stitcherWorker.js` | وركر التجميع الخلفي عبر `OffscreenCanvas` | **تعديل حرج** (إضافة بثق داخلي `1px` حول كل خلية مرسومة) | 
| **CoveragePlanner.js** | `client/js/tiles/CoveragePlanner.js` | حساب حدود الإحداثيات وهوامش الأفق والميلان (`gutterTiles`) | سليم (لا يتطلب تعديلاً) | 
| **SyncManager.js** | `client/js/core/SyncManager.js` | مزامنة المعاينة اللحظية ومعاينة المسار (`Trajectory Preview`) | **تعديل مباشر** (السطران `204` و `316`) | 
| **FinalizeController.js** | `client/js/core/FinalizeController.js` | إدارة عملية الـ Finalize الذرية والتحقق من الميزانية والتطابق | **تعديل مباشر** (السطر `370` + التحقق من سلامة الـ Transaction) | 
| **FinalizeTimelineScanner.js** | `client/js/core/FinalizeTimelineScanner.js` | مسح المسار الزمني إطاراً بإطار (`sampleStep = 1`) | **تعديل مباشر** (السطر `51`) | 
| **helpers.jsx** | `host/modules/helpers.jsx` | حساب هندسة البلاطة (`opengeoResolveTileGeometry`) وثوابت العالم | **تعديل حرج** (تعويض البلاطات الخام + دالة `opengeoEnsureMapBed`) | 
| **compositionTiles.jsx** | `host/modules/compositionTiles.jsx` | استيراد البلاطات وإسناد `Anchor Point` و `Scale` و `BlendingMode` | **تعديل حرج** (فرز `sourceZoom` + `ALPHA_ADD` + `anchorOffset`) | 
| **compBuilder.jsx** | `host/modules/compBuilder.jsx` | بناء كومبوزيشن الخريطة الداخلي `mapComp` والخارجي | **تعديل مباشر** (إضافة أرضية `OpenGeo Map Bed` بعد الاستيراد) | 
| **compositionTransaction.jsx** | `host/modules/compositionTransaction.jsx` | الاستبدال الذري للطبقات (`Prepare / Commit / Rollback`) | **تعديل حرج** (حماية ترتيب `OpenGeo Map Bed` ونمط الدمج) | 
| **compositionRig.jsx** | `host/modules/compositionRig.jsx` | ربط الكاميرا ثلاثية الأبعاد وكائن `MapPivot` | سليم (لا يتطلب تعديلاً) | 

## ثانياً: الثغرات الهندسية الأربع المكتشفة في الكود المصدري

### 1. ثغرة الخلايا الشفافة الداخلية (`rgba(0,0,0,0)`) في الـ MegaTiles الجزئية (`MegaTileStitcher.js`)

* **الموقع في الكود:** السطور `190` و `211` و `232` في `MegaTileStitcher.js`.

* **المشكلة الفعلية:**
  يقوم الكود الحالي بتجميع البلاطات في قالب `8×8` (`2048px`) بمجرد أن يتحقق الشرط `z3Group.children.length > 16` (مثلاً عند وجود `18` بلاطة فقط من أصل `64`)، وفي قالب `4×4` عند `> 4`، وفي قالب `2×2` عند `> 1`.
  هذا يعني أن الخلايا غير الموجودة داخل القالب تبقى **شفافة تماماً (`rgba(0,0,0,0)`) في قلب صورة الـ PNG**، بينما دالة `_extrudeCanvasGutter` تبثق فقط **الحافة الخارجية القصوى للكانفاس** (`x=0, y=0, x=size, y=size`) ولا تبثق حواف البلاطات التي تنتهي في منتصف الكانفاس بجوار خلية فارغة!

* **الأثر البصري:** عندما يقوم محرك After Effects بتصيير هذه الطبقة بفلتر `LayerSamplingQuality.BILINEAR`، فإنه يدمج البكسل الأخير للبلاطة المرسومة مع البكسل الشفاف `rgba(0,0,0,0)` المجاور له داخل نفس ملف الـ PNG وبـ `gutter = 0`، مما ينتج خطاً فاصلاً داكناً داخل الـ MegaTile نفسه يستحيل إزالته بأي إعداد في After Effects.

* **الحل الجذري:**

  1. تعديل شروط التجميع الهرمي إلى اكتمال الشجرة الرباعية الصارم (**Strict Quadtree Completeness**): `=== 64` لقالب `8×8`، و `=== 16` لقالب `4×4`، و `=== 4` لقالب `2×2`، وتمرير البلاطات المتبقية إلى `_stitchBaseTile` لتأخذ حافة مبثوقة خاصة بها. بهذا تصبح كل صورة PNG مستوردة إلى After Effects مصمتة بنسبة **100% بدون أي بكسل شفاف بداخلها**.

  2. إضافة رسم تمهيدي مبثوق بمقدار `1px` حول كل خلية داخل `stitcherWorker.js` و `MegaTileStitcher.js` قبل رسم الخلية الأصلية كحماية إضافية.

### 2. ثغرة الشرط المعطوب لبناء طبقة الأساس في `TilePlanner.js`

* **الموقع في الكود:** السطر `133` في `TilePlanner.js`:

  ```
  if (includeBaseCoverage === true && effectiveZoom !== minDownloadZoom)
  
  ```

* **المشكلة الفعلية:**
  عندما تكون حركة الكاميرا أفقية (Panning) بزووم ثابت، أو عند الإطارات التي تبلغ فيها الكاميرا أدنى زووم في المشهد، يكون `effectiveZoom === minDownloadZoom` دائماً. وبالتالي فإن تفعيل `includeBaseCoverage: true` وحده **لن يولّد أي بلاطات أساس (`baseTiles = []`)** في هذه الحالات!
  كذلك فإن السطر `143` (`tiles.concat(transitionTiles).concat(baseTiles)`) يضع `baseTiles` في نهاية المصفوفة بدلاً من بدايتها.

* **الحل الجذري:**
  حساب مستوى زووم التغطية الأساسية دائماً كـ `baseCoverageZoom = Math.max(0, Math.min(minDownloadZoom, effectiveZoom - 2))` بحيث يتم توليد طبقة MegaTile مستمرة بزووم أقل بدرجتين (`z - 2`) تحت جميع الإطارات طالما `effectiveZoom > 0`، ووضع `baseTiles` في مقدمة المصفوفة.
  *(ملاحظة هندسية: عند مستوى `effectiveZoom - 2`، كل بلاطة واحدة تغطي* $4 \times 4 = 16$ *بلاطة من المستوى الأعلى، أي أن التكلفة الإضافية لا تتجاوز `~6.25%` من عدد البلاطات).*

### 3. ثغرة انقلاب ترتيب الطبقات (`Z-Order`) ودفن المعاينة تحت `OpenGeo Map Bed`

* **الموقع في الكود:** `compositionTiles.jsx` (السطر `26`) و `compositionTransaction.jsx` (السطر `110-116`).

* **المشكلة الفعلية:**

  1. في After Effects، دالة `mapComp.layers.add(footageItem)` تضيف كل طبقة جديدة في **أعلى الكومبوزيشن (`Index 1`)**. في `compositionTiles.jsx` لم يكن يتم فرز البلاطات تصاعدياً حسب `sourceZoom` قبل إضافتها، مما قد يضع طبقة التغطية المنخفضة فوق طبقة التفاصيل العالية.

  2. في `compositionTransaction.jsx` داخل الدالة `opengeoCommitPreviewRevision` (السطر `112`): يتم استدعاء `stageLayer.moveToEnd()` عند `replaceFinal !== true`، مما يدفع طبقات المعاينة إلى قاع الكومبوزيشن **تحت طبقة الأرضية `OpenGeo Map Bed`** فيحجبها بالكامل!

* **الحل الجذري:**

  1. فرز مصفوفة البلاطات تصاعدياً حسب `sourceZoom` في كل من `compositionTiles.jsx` و `compositionTransaction.jsx` قبل حلقة `layers.add`.

  2. التأكد من استدعاء ` existingBed.moveToEnd()` دائماً بعد أي عملية ترقية لطبقات المعاينة (`opengeoCommitPreviewRevision`) أو التثبيت النهائي (`opengeoCommitCompositionRevision`) لضمان بقاء `OpenGeo Map Bed` في آخر طبقة سفلية دائماً.

### 4. ثغرة تخطي البلاطة المنفردة في `SyncManager.js` وتعطيل `includeBaseCoverage`

* **الموقع في الكود:**

  * `SyncManager.js` السطر `204`: الشرط `if (!tiles || tiles.length < 2) return tiles || [];` يتخطى `MegaTileStitcher` إذا كان الناتج بلاطة واحدة فقط، فتذهب إلى After Effects بـ `gutterPixels: 0`.

  * `SyncManager.js` السطر `316`، و `FinalizeController.js` السطر `370`، و `FinalizeTimelineScanner.js` السطر `51`: الخيار `includeBaseCoverage` مضبوط على `false`.

## ثالثاً: فحص التوافق والأمان مع `FinalizeController.js` و `FinalizeTimelineScanner.js`

بعد مراجعة الكود الكامل لملفي `FinalizeController.js` و `FinalizeTimelineScanner.js`، تم التحقق من النقاط الحرجة التالية لضمان عدم حدوث أي تعارض (Regression) أثناء عملية الـ Finalize:

1. **التحقق من الهويات الفريدة (`_validateStitchedAssetIds` — السطر `500` في `FinalizeController.js`):**

   * يتحقق `FinalizeController` من عدم تكرار `placementKey` عبر `new Set(assetIds)`.

   * بما أن `MegaTileStitcher._megaAsset` يبني المفتاح بالصيغة `megatile/${canvasSize}/${group.z}/${group.x}/${group.y}`، فإن وجود `canvasSize` (`256` أو `512` أو `1024` أو `2048`) يمنع أي تصادم في الهوية بين بلاطات المستويات المختلفة (`baseCoverageZoom` مقابل `effectiveZoom`).

2. **التحقق الصارم من عدد الطبقات (`_assertTypedImportResult` — السطر `650` في `FinalizeController.js`):**

   * يتحقق `FinalizeController` من أن `result.imported === expected` وأن `stagingLayers.length === expected` عند الـ Commit.

   * طبقة `OpenGeo Map Bed` تحمل الوسم `role=map-bed` (وليس `final-staging` أو `final-active`)، ويتم إنشاؤها في مرحلة الـ Commit (`opengeoCommitCompositionRevision`)، لذلك لا تؤثر إطلاقاً على عدّاد `stagingLayers.length` ولا تكسر شرط التطابق الذري.

3. **ميزانية التحميل (`evaluateFinalizeBudget` — السطر `572` في `FinalizeController.js`):**

   * تفعيل `includeBaseCoverage: true` مع مستوى `effectiveZoom - 2` يضيف فقط `~6.25%` إلى عدد البلاطات، وهو هامش ضئيل جداً يظل ضمن حدود `softLimit` (`2500`) و `hardLimit` (`20000` / `25000`).

4. **توليد المصغرات التلقائي (`_autoCaptureThumbnail` — السطر `740` في `FinalizeController.js`):**

   * وضع `baseTiles` في أول المصفوفة داخل `TilePlanner.js` يضمن أن `processor.renderFrameFromTiles` يرسم البلاطات المنخفضة الدقة أولاً ثم يرسم فوقها البلاطات عالية الدقة بالترتيب الصحيح.

## رابعاً: التعديلات البرمجية التفصيلية الجاهزة للتطبيق (Patch Specification)

### 1. ملف `client/js/engine/TilePlanner.js`

استبدل السطور `130–143` بالكود التالي:

```
        // Continuous Base Pyramid Coverage (GEOlayers-style underlay):
        // Always include a continuous (effectiveZoom - 2) base layer beneath
        // active tiles so subpixel antialiased edges never expose empty background.
        let baseTiles = [];
        const baseCoverageZoom = Math.max(0, Math.min(minDownloadZoom, effectiveZoom - 2));
        if (includeBaseCoverage === true && effectiveZoom > 0 && baseCoverageZoom < effectiveZoom) {
          baseTiles = CoveragePlanner.planComposition(frame, {
            width: fetchWidth,
            height: fetchHeight,
            downloadZoom: baseCoverageZoom,
            tileSize: 256,
            gutterTiles: Math.max(1, gutterTiles || 1),
            alignMegaTiles: false
          }).map(bt => Object.assign({}, bt, { isBaseCoverage: true }));
        }

        // Order baseTiles first, then transitionTiles, then highest-detail active tiles
        const allVisibleTiles = baseTiles.concat(transitionTiles).concat(tiles);

```

### 2. ملف `client/js/engine/MegaTileStitcher.js`

* **أولاً (السطور `190` و `211` و `232`):** تحويل شروط التجميع إلى اكتمال الشجرة الرباعية الصارم لمنع الخلايا الشفافة داخل الكانفاس:

```
        // السطر 190:
        if (z3Group.children.length === 64) {

```

```
            // السطر 211:
            if (z2Group.children.length === 16) {

```

```
                // السطر 232:
                if (z1Group.children.length === 4) {

```

* **ثانياً (السطر `363–366` في المسار الاحتياطي للـ Main Thread):** بثق حافة كل خلية قبل رسمها:

```
            const dx = ((child.x - startX) * sourceTileSize) + spec.gutterPixels;
            const dy = ((child.y - startY) * sourceTileSize) + spec.gutterPixels;
            ctx.drawImage(img, dx - 1, dy - 1, sourceTileSize + 2, sourceTileSize + 2);
            ctx.drawImage(img, dx, dy, sourceTileSize, sourceTileSize);

```

### 3. ملف `client/js/engine/stitcherWorker.js`

في السطور `40–44`، أضف رسم الحافة المبثوقة الداخلية لكل خلية قبل الرسم الدقيق:

```
          const dx = ((child.x - startX) * sourceTileSize) + edge;
          const dy = ((child.y - startY) * sourceTileSize) + edge;

          // Seal internal cell borders in case of sparse cell neighbors
          ctx.drawImage(bitmap, dx - 1, dy - 1, sourceTileSize + 2, sourceTileSize + 2);
          ctx.drawImage(bitmap, dx, dy, sourceTileSize, sourceTileSize);

```

### 4. ملفات التخطيط والمزامنة (`SyncManager.js` و `FinalizeController.js` و `FinalizeTimelineScanner.js`)

* في **`client/js/core/SyncManager.js`**:

  * السطر `204`:

    ```
    if (!tiles || tiles.length < 1) return tiles || [];
    
    ```

  * السطر `316`:

    ```
    includeBaseCoverage: true
    
    ```

* في **`client/js/core/FinalizeController.js`** (السطر `370`):

  ```
      includeBaseCoverage: true,
  
  ```

* في **`client/js/core/FinalizeTimelineScanner.js`** (السطر `51`):

  ```
      includeBaseCoverage: true,
  
  ```

### 5. ملف `host/modules/helpers.jsx`

* استبدل الدالة `opengeoResolveTileGeometry` (السطور `81–93`) بالكود التالي، وأضف دالتي `opengeoResolveProviderBedColor` و `opengeoEnsureMapBed`:

```
function opengeoResolveTileGeometry(tile, footageItem, worldTileSize) {
  var sourcePixels = Number(footageItem && footageItem.width) || TILE_REF_SIZE;
  var requestedContent = Number(tile && tile.contentPixelSize);
  var contentPixels = requestedContent > 0 && requestedContent <= sourcePixels ? requestedContent : sourcePixels;
  var requestedGutter = parseInt(tile && tile.gutterPixels, 10);
  var gutterPixels = requestedGutter >= 0 && contentPixels + (requestedGutter * 2) <= sourcePixels ? requestedGutter : 0;

  // Extruded MegaTiles (gutterPixels >= 1) keep strict 1:1 cartographic scale.
  // Raw 0-gutter fallback tiles get a 0.5-texel micro-overlap centered by a -0.25px anchor offset.
  var fallbackOverlapTexels = (gutterPixels === 0) ? 0.5 : 0;
  var effectiveAnchor = (gutterPixels > 0) ? gutterPixels : -0.25;
  var exactScale = (worldTileSize / contentPixels) * ((contentPixels + fallbackOverlapTexels) / contentPixels) * 100;

  return {
    contentPixels: contentPixels,
    gutterPixels: gutterPixels,
    anchorOffset: effectiveAnchor,
    exactScale: exactScale
  };
}

function opengeoResolveProviderBedColor(sourceKey) {
  var s = String(sourceKey || '').toLowerCase();
  if (s.indexOf('dark') !== -1 || s.indexOf('night') !== -1) return [0.09, 0.11, 0.14];
  if (s.indexOf('sat') !== -1 || s.indexOf('imagery') !== -1 || s.indexOf('aerial') !== -1) return [0.07, 0.13, 0.18];
  return [0.88, 0.87, 0.84];
}

function opengeoEnsureMapBed(mapComp, mapPivot, documentId, revision, sourceKey) {
  if (!mapComp || !opengeoIsValidObject(mapComp) || !mapPivot) return null;
  try {
    var bedName = 'OpenGeo Map Bed';
    var bedLayer = findLayerByName(mapComp, bedName);
    var bedColor = opengeoResolveProviderBedColor(sourceKey);
    if (!bedLayer && mapComp.layers && typeof mapComp.layers.addSolid === 'function') {
      bedLayer = mapComp.layers.addSolid(bedColor, bedName, 2048, 2048, 1, mapComp.duration);
    }
    if (!bedLayer) return null;
    bedLayer.threeDLayer = true;
    bedLayer.enabled = true;
    bedLayer.guideLayer = false;
    bedLayer.comment = opengeoOwnershipComment(documentId || 'legacy', 'map-bed', revision || 'active');
    bedLayer.property('Anchor Point').setValue([0, 0, 0]);
    bedLayer.parent = mapPivot;
    bedLayer.property('Position').setValue([-MAP_SIZE, -MAP_SIZE, 0]);
    var bedScale = ((MAP_SIZE * 3) / 2048) * 100;
    bedLayer.property('Scale').setValue([bedScale, bedScale, 100]);
    if (typeof bedLayer.moveToEnd === 'function') bedLayer.moveToEnd();
    return bedLayer;
  } catch (bedErr) {
    return null;
  }
}

```

*(مع إضافة `opengeoResolveTileGeometry` و `opengeoEnsureMapBed` إلى كائن التصدير `$._opengeo.helpers` في نهاية الملف).*

### 6. ملف `host/modules/compositionTiles.jsx`

حدث `opengeoImportCompositionTiles` لفرز البلاطات تصاعدياً حسب `sourceZoom`، واستخدام `anchorOffset`، وتعيين `BlendingMode.ALPHA_ADD` (أو `NORMAL` عند وجود `zoomTransitions`):

```
  var sortedTiles = (tiles instanceof Array) ? tiles.slice(0) : [];
  if (sortedTiles.length > 1) {
    sortedTiles.sort(function(a, b) {
      var za = (a && a.sourceZoom !== undefined ? a.sourceZoom : (a ? a.z : 0)) || 0;
      var zb = (b && b.sourceZoom !== undefined ? b.sourceZoom : (b ? b.z : 0)) || 0;
      if (za !== zb) return za - zb;
      return (Number(b && b.contentPixelSize) || 0) - (Number(a && a.contentPixelSize) || 0);
    });
  }

```

وعند ضبط نقطة الارتكاز ونمط الدمج (السطور `60–76`):

```
    var anchorVal = (tileGeometry.anchorOffset !== undefined) ? tileGeometry.anchorOffset : tileGeometry.gutterPixels;
    tileLayer.property('Anchor Point').setValue([anchorVal, anchorVal, 0]);
    tileLayer.parent = mapPivot;
    tileLayer.property('Position').setValue([tile.x * worldTileSize, tile.y * worldTileSize, 0]);
    tileLayer.property('Scale').setValue([tileGeometry.exactScale, tileGeometry.exactScale, 100]);
    try {
      tileLayer.quality = LayerQuality.BEST;
      tileLayer.samplingQuality = LayerSamplingQuality.BILINEAR;
    } catch (qualityError) {
      /* quality fallback */
    }
    try {
      tileLayer.blendingMode = (data.zoomTransitions && data.zoomTransitions.length > 0)
        ? BlendingMode.NORMAL
        : BlendingMode.ALPHA_ADD;
    } catch (blendError) {
      try { tileLayer.blendingMode = BlendingMode.NORMAL; } catch (_ignore) {}
    }

```

### 7. ملفا `host/modules/compBuilder.jsx` و `host/modules/compositionTransaction.jsx`

* في **`compBuilder.jsx`** بعد السطر `93` مباشرة:

  ```
    opengeoEnsureMapBed(mapComp, mapPivot, documentId, data.operationId || data.previewGeneration || 'active', data.source);
  
  ```

* في **`compositionTransaction.jsx`**:

  1. في `opengeoCommitPreviewRevision` بعد حلقة ترقية `stagingLayers` (السطر `118`):

     ```
     var existingBed = findLayerByName(mapComp, 'OpenGeo Map Bed');
     if (existingBed && typeof existingBed.moveToEnd === 'function') {
       try { existingBed.moveToEnd(); } catch (ignoreBedMove) {}
     }
     
     ```

  2. في `opengeoPrepareCompositionRevision` (السطور `271–277` و `301` و `314`):
     فرز `tiles` حسب `sourceZoom` ثم `contentPixelSize`، واستخدام `tileGeometry.anchorOffset`، وضبط `tileLayer.blendingMode` إلى `BlendingMode.ALPHA_ADD` عندما لا توجد `zoomTransitions`.

  3. في `opengeoCommitCompositionRevision` بعد تحديث `MapPivot` (السطر `500`):

     ```
     opengeoEnsureMapBed(resolved.mapComp, mapPivot, documentId, operationId, data.source);
     
     ```

## خامساً: البرومبت التنفيذي الموحّد لتوجيه الذكاء الاصطناعي المنفّذ (Master Execution Prompt)

```
# EXECUTION TASK: Apply the 4-Layer Seam Elimination Architecture in OpenGeo

You are provided with `ARCHITECTURAL_ELEVATION_ROADMAP.md` and `SUPPLEMENTARY_TILE_SEAM_REPORT_AR.md`.
Apply the exact, verified modifications across the following 9 files to permanently eliminate 3D subpixel tile seams in After Effects Classic 3D without breaking 1:1 cartographic scale or Finalize transaction invariants:

1. `client/js/engine/TilePlanner.js`:
   - Replace the broken `effectiveZoom !== minDownloadZoom` condition with `const baseCoverageZoom = Math.max(0, Math.min(minDownloadZoom, effectiveZoom - 2));` and generate `baseTiles` whenever `includeBaseCoverage === true && effectiveZoom > 0 && baseCoverageZoom < effectiveZoom`.
   - Order `allVisibleTiles` as `baseTiles.concat(transitionTiles).concat(tiles)`.

2. `client/js/engine/MegaTileStitcher.js` & `client/js/engine/stitcherWorker.js`:
   - Enforce strict quadtree completeness in `stitchHierarchical`: pack `8x8` only when `z3Group.children.length === 64`, `4x4` only when `z2Group.children.length === 16`, and `2x2` only when `z1Group.children.length === 4` so no MegaTile PNG ever contains internal `rgba(0,0,0,0)` transparent cells.
   - In both `stitcherWorker.js` and `MegaTileStitcher.js` (fallback canvas path), pre-draw each child tile expanded by 1px (`dx - 1, dy - 1, sourceTileSize + 2, sourceTileSize + 2`) before drawing the exact tile (`dx, dy, sourceTileSize, sourceTileSize`).

3. `client/js/core/SyncManager.js`, `client/js/core/FinalizeController.js`, & `client/js/core/FinalizeTimelineScanner.js`:
   - In `SyncManager._packPreviewTiles`, change `tiles.length < 2` to `tiles.length < 1` so single-tile previews also receive extruded gutters.
   - Enable `includeBaseCoverage: true` in `SyncManager.js` (line 316), `FinalizeController.js` (line 370), and `FinalizeTimelineScanner.js` (line 51).

4. `host/modules/helpers.jsx`, `host/modules/compositionTiles.jsx`, `host/modules/compBuilder.jsx`, & `host/modules/compositionTransaction.jsx`:
   - In `opengeoResolveTileGeometry`, keep exact 1:1 scale for extruded MegaTiles (`gutterPixels >= 1`) and apply a 0.5-texel micro-overlap (`anchorOffset = -0.25`) only when `gutterPixels === 0`.
   - Add `opengeoEnsureMapBed` in `helpers.jsx` and invoke it in `compBuilder.jsx` and `compositionTransaction.jsx` (`opengeoCommitCompositionRevision`), while keeping `OpenGeo Map Bed` pinned to the bottom of `mapComp` (`moveToEnd()`) in `opengeoCommitPreviewRevision`.
   - Sort tiles ascending by `sourceZoom` in `compositionTiles.jsx` and use `BlendingMode.ALPHA_ADD` when `zoomTransitions` is empty (falling back to `BlendingMode.NORMAL` during active opacity crossfade transitions).

```