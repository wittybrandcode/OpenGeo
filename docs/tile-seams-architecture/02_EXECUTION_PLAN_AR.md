# الخطة الهندسية التنفيذية: المعمارية الثنائية للقضاء التام على فواصل البلاطات

> **المشروع:** OpenGeo CEP Extension for Adobe After Effects  
> **التاريخ:** 27 سبتمبر 2026  
> **الحالة:** خطة التنفيذ المعتمدة (Approved Phased Execution Plan)  
> **المجلد المخصص:** `docs/tile-seams-architecture/`  
> **الملف التشخيصي التأسيسي:** [`01_ROOT_CAUSE_RESEARCH_AR.md`](file:///c:/Program%20Files%20%28x86%29/Common%20Files/Adobe/CEP/extensions/OpenGeo/docs/tile-seams-architecture/01_ROOT_CAUSE_RESEARCH_AR.md)  

---

## 1. المبادئ الهندسية الصارمة والسياسات غير القابلة للتفاوض

1. **سياسة التلاصق الرياضي المطلق (`0 overlap, 0 gap`):**
   - حظر تام لأي زيادة أو تمديد قسري في مقاييس الطبقات (`subpixelBleed = 0`).
   - مقياس وموقع كل طبقة يجب أن يطابق بدقة $100\%$ المعادلة الرياضية الصحيحة:
     $$\text{exactScale} = \left(\frac{\text{worldTileSize}}{\text{tileActualSize}}\right) \times 100$$
2. **حظر كامل للحلول الترقيعية والمهاد اللونية المصمتة (No Heuristic Color Beds):**
   - إلغاء فكرة وضع طبقات صلبة ذات ألوان تقديرية وراء البلاطات، لأن أي تسرب لوني يظهر كتشوه بصري شاذ.
3. **مبدأ الانتقال النظيف والتنظيف النهائي (Migration & Deprecation Rule):**
   - بمجرد نجاح وتثبيت المعمارية الجديدة في بيئة العمل واجتياز الفحص البصري في After Effects، سيتم **حذف وإلغاء جميع الترقيعات والتعليمات البرمجية القديمة نهائياً** للحفاظ على نظافة واستقرار المشروع.

---

## 2. الركيزتان المعماريتان للحل المنهجي الجذري (The Golden Formula)

```
+───────────────────────────────────────────────────────────────────────────────────────────+
│                       المعادلة الذهبية المعتمدة للقضاء التام على الفواصل                      │
+───────────────────────────────────────────────────────────────────────────────────────────+
│                                                                                           │
│   [الركيزة الأولى: في بيئة المتصفح والـ Client]                                           │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │                  مجمع البلاطات الموحد (MegaTile Canvas Stitcher)                  │   │
│   │  • دمج البلاطات المتجاورة في الـ OffscreenCanvas قبل التصدير.                      │   │
│   │  • تصدير كادر الرؤية كصورة مجمعة واحدة متماسكة بكسلياً (صفر فواصل داخلية = 0 Seams).  │   │
│   └───────────────────────────────────────────────────────────────────────────────────┘   │
│                                            │                                              │
│                                            ▼                                              │
│   [الركيزة الثانية: في بيئة After Effects والـ Host]                                      │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │            الدمج الرياضي الدقيق (3D Alpha Add + True Collapse Transformation)          │   │
│   │  • طبقات البلاطات 3D ثلاثية الأبعاد (tileLayer.threeDLayer = true).                │   │
│   │  • مقياس رياضي دقيق 100% بدون أي تمدد اصطناعي (exactScale = (world / actual) * 100).  │   │
│   │  • نمط الدمج الرسمي لمعالجة حواف الطبقات (tileLayer.blendingMode = ALPHA_ADD).        │   │
│   │  • تفعيل التماسك ثلاثي الأبعاد المنهار (mapLayer.collapseTransformation = true).     │   │
│   │  • ربط كامل ومباشر بين كاميرا AE والمسامير المكانية ثلاثية الأبعاد والطبقات المتجهية. │   │
│   └───────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                           │
+───────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 3. مراحل الخطة التنفيذية (Phased Execution Steps)

### المرحلة 1: تدقيق وتأمين مجمع البلاطات في الـ Client (`MegaTileStitcher`)
* ✅ تم التحقق بنجاح من ثبات `stitcherWorker.js` والدمج السليم بدون أي تعليق أو تسريب.

### المرحلة 2: التعديل الجراحي لكود المضيف (Host ExtendScript)
* ✅ [`host/modules/compositionRig.jsx`](file:///c:/Program%20Files%20%28x86%29/Common%20Files/Adobe/CEP/extensions/OpenGeo/host/modules/compositionRig.jsx): تثبيت `mapLayer.collapseTransformation = true;` و `mapLayer.threeDLayer = true;`.
* ✅ [`host/modules/compositionTiles.jsx`](file:///c:/Program%20Files%20%28x86%29/Common%20Files/Adobe/CEP/extensions/OpenGeo/host/modules/compositionTiles.jsx): تفعيل `threeDLayer = true;` وتعيين `blendingMode = BlendingMode.ALPHA_ADD;` مع `exactScale` (0 bleed).
* ✅ [`host/modules/compositionTransaction.jsx`](file:///c:/Program%20Files%20%28x86%29/Common%20Files/Adobe/CEP/extensions/OpenGeo/host/modules/compositionTransaction.jsx): تفعيل `threeDLayer = true;` وتعيين `blendingMode = BlendingMode.ALPHA_ADD;` مع `exactScale` في مسار الـ Finalize Staging.
* ✅ [`host/modules/metadataSync.jsx`](file:///c:/Program%20Files%20%28x86%29/Common%20Files/Adobe/CEP/extensions/OpenGeo/host/modules/metadataSync.jsx): تحديث الترميم التلقائي (Auto-Heal) لضمان تحويل أي تركيبات سابقة تلقائياً إلى `threeDLayer = true` و `ALPHA_ADD` و `collapseTransformation = true`.

### المرحلة 3: تحديث حزمة الاختبارات الشاملة
* ✅ تحديث [`scripts/tests/map/pitch-3d.test.js`](file:///c:/Program%20Files%20%28x86%29/Common%20Files/Adobe/CEP/extensions/OpenGeo/scripts/tests/map/pitch-3d.test.js) للتحقق من `threeDLayer = true` على البلاطات وتركيب الخريطة.
* ✅ تحديث [`scripts/tests/tile-pipeline/tile-blending.test.js`](file:///c:/Program%20Files%20%28x86%29/Common%20Files/Adobe/CEP/extensions/OpenGeo/scripts/tests/tile-pipeline/tile-blending.test.js) للتحقق من `BlendingMode.ALPHA_ADD`.
* ✅ تشغيل واجتياز جميع حزم الاختبارات الـ 15 بنجاح تام (100% Green).

---

## 4. مصفوفة تتبع المهام وحالة التنفيذ

| المهمة البرمجية | الملف المرتبط | الحالة الراهنة | النتيجة المحققة |
|:---|:---|:---|:---|
| **تأمين Worker دمج البلاطات وتصحيح `dx`** | `client/js/engine/stitcherWorker.js` | ✅ مكتمل ومتحقق | تشغيل دمج الكانفاس 2D بنجاح وسرعة قصوى |
| **تطبيق ALPHA_ADD و 3D في استيراد AE** | `host/modules/compositionTiles.jsx` | ✅ مكتمل ومتحقق | رص البلاطات بالمليمتر وإلغاء الفواصل بالكامل دون توهج |
| **تطبيق ALPHA_ADD و 3D في مسار Staging** | `host/modules/compositionTransaction.jsx` | ✅ مكتمل ومتحقق | ثبات التلاصق في المعاملات وتحديثات الـ Finalize |
| **تفعيل استمرارية الرندرة والـ 3D الكامل** | `host/modules/compositionRig.jsx` | ✅ مكتمل ومتحقق | `collapseTransformation = true` وتكامل تام مع الكاميرا والمسامير |
| **ترميم التركيبات السابقة تلقائياً** | `host/modules/metadataSync.jsx` | ✅ مكتمل ومتحقق | ترقية تلقائية لأي طبقة خريطة إلى ALPHA_ADD و 3D المنهار |
| **تحديث اختبارات المنظور والدمج** | `pitch-3d.test.js` & `tile-blending.test.js` | ✅ مكتمل ومتحقق | اجتياز 15/15 حزمة اختبارات رئيسية بنجاح 100% |
