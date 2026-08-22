# OpenGeo — تقرير التدقيق المعماري العميق النهائي

> **نوع الوثيقة:** تدقيق ساكن معماري وتقني شامل للمنطق البرمجي  
> **تاريخ خط الأساس:** 13 أغسطس 2026  
> **نطاق التدقيق:** `client/js/**`، و`host/**`، وسكربتات البناء والاختبار، وعقود البيانات التشغيلية  
> **خارج النطاق:** إعادة كتابة المنتج، والحكم البصري النهائي داخل After Effects، والملفات التوثيقية السابقة بوصفها مصدر حقيقة  
> **حالة التقرير:** نهائي بالنسبة إلى خط الأساس الحالي؛ نتائجه لا تعني اعتمادًا رسميًا من ISO أو OWASP أو Adobe

---

## 1. الملخص التنفيذي

OpenGeo منتج فعلي ذو منطق غني، وليس مجرد واجهة ترسل أوامر بسيطة إلى After Effects. فهو يدير معاينة خرائط صورية ومتجهية، وتحويلًا بين كاميرا اللوحة وكاميرا AE، وتخطيط البلاطات، وتنزيلها وتخزينها، وبناء MegaTiles، ورسم حدود دول محلية عالية الدقة، وحفظ هوية مستند الخريطة وحالته داخل الكومبوزيشن.

الحكم المعماري النهائي هو: **المنتج قابل للاستخدام، لكنه غير جاهز بعد لإصدار موثوق واسع النطاق**. الأساس تحسن بوضوح: توجد بوابة مركزية لـ ExtendScript، وعزل نسبي للأصول بحسب المستند، ورموز generation لمنع بعض النتائج القديمة، وإغلاق صحيح لمجموعات Undo، وحزمة بيانات محلية دقيقة. لكن الاستقرار ما يزال معرضًا لعيوب مؤكدة في استعادة الحالة، ومعالجة الأحداث غير المتزامنة، ودورة حياة cache المعاينة، وذرّية Finalize، إضافة إلى خطأ حرج في مسار التعبئة يجعل أداة ZXP تحزم `dist` القديم بدل `release/stage` الذي تم بناؤه واختباره.

### النتيجة المختصرة

| المحور | التقييم | الحكم |
|---|---:|---|
| صحة الوظائف الأساسية | 6.5/10 | جيدة في المسارات المجربة، مع عيوب مؤكدة في حالات الاستعادة والتزامن |
| المعمارية وSoC/SRP | 5/10 | فصل جزئي جيد، لكن `App` وطبقتي البلاطات ما زالتا محور تعقيد وتكرار |
| سلامة CEP ↔ ExtendScript | 6.5/10 | الجسر المركزي جيد؛ الذرّية والتحقق داخل Host غير مكتملين |
| التزامن وتدفق الأحداث | 4.5/10 | generation tokens مفيدة، لكن EventBus لا يدير الوعود وعمليات الشبكة متداخلة |
| الأداء والذاكرة | 4.5/10 | مخاطر تجميد مؤكدة مع بيانات 10m وGeoJSON وI/O المتزامن |
| أمن حدود الثقة | 6/10 | لا توجد ثغرة مباشرة مثبتة، لكن Node-enabled CEP وملفات الإدخال يوسّعان سطح المخاطر |
| الاختبارات وقابلية الإصدار | 4/10 | 46/46 ناجحة، لكنها غالبًا اختبارات نصية، ومسار ZXP نفسه غير متسق |
| قابلية الصيانة | 5/10 | أسماء ومكوّنات جيدة جزئيًا، يقابلها كود ميت ومصادر حقيقة متعددة |

**التقييم الكلي المرجّح: 5.2/10 — يحتاج مرحلة تثبيت إلزامية قبل أي توسع وظيفي جديد.**

### قرار الإصدار

- **إيقاف إصدار ZXP حاليًا** إلى أن يُصحح OG-AUD-001 ويثبت أن الحزمة النهائية هي نفسها التي اجتازت الاختبارات.
- **إيقاف توسيع Finalize** إلى أن تصبح عملية الاستبدال ذرّية وتتحقق من اكتمال الاستيراد.
- يمكن مواصلة الاختبار الداخلي للمعاينة والرسم المحلي، بشرط اعتبار العيوب P0/P1 أدناه معروفة وغير مغلقة.

---

## 2. المنهجية وحدود اليقين

استُخدمت منهجية مركبة بدل الاكتفاء بعدّ الأسطر أو البحث عن “code smells”:

1. **ISO/IEC 25010:2023** كإطار لتقييم الملاءمة الوظيفية، والكفاءة، والموثوقية، والأمن، وقابلية الصيانة والتوافق.
2. **SoC وSRP وSOLID** لتحديد حدود المسؤولية والتبعيات واتجاهاتها.
3. **تحليل تدفق البيانات والأحداث**: مصدر الحدث، المستهلك، حالة التشغيل، generation/cancellation، وتأثير النتائج القديمة.
4. **تحليل حدود الثقة وفق STRIDE بصورة مكيّفة**: واجهة المستخدم، الشبكة، Node/fs، ملف payload، `evalScript`، وDOM الخاص بـ After Effects.
5. **FMEA مبسط**: الشدة S، واحتمال الحدوث O، وصعوبة الاكتشاف D من 1 إلى 5، ودرجة المخاطر `RPN = S × O × D`.
6. **تحليل DRY والكود الميت ومصادر الحقيقة**: الاستدعاءات الفعلية، التحميل من `index.html`، ومحتوى حزمة الإصدار.
7. **Test Pyramid وRelease Gates**: مقارنة ما تقوله الاختبارات بما تنفذه فعليًا.

### درجات اليقين

- **مؤكد:** استدعاء أو مسار كود يمكن إثباته مباشرة من المصدر أو فحص آلي.
- **مرتفع:** تسلسل فشل واضح يحتاج AE/CEP لإعادة الإنتاج النهائي.
- **متوسط:** خطر معماري أو تشغيلي يعتمد على حجم المشروع أو توقيت الشبكة.

### قاعدة الأولوية

| الأولوية | المعنى |
|---|---|
| P0 | يمنع الإصدار أو قد يفقد/يستبدل نتيجة صحيحة أو يوزع كودًا قديمًا |
| P1 | عيب استقرار/تجميد/تزامن مرجح ويجب إصلاحه في دورة التثبيت الحالية |
| P2 | دين معماري أو قابلية صيانة واختبار يؤدي إلى عيوب لاحقة |
| P3 | تحسين جودة أو قابلية تشغيل بعد تثبيت الأساس |

---

## 3. خط الأساس القابل للقياس

### 3.1 حجم المنطق

- 59 ملف JavaScript/ExtendScript/Scripts منطقيًا.
- نحو 8,652 سطرًا في ملفات المنطق المشمولة.
- أكبر نقاط التركيز: `app.js` (نحو 694 سطرًا فعليًا)، `scripts/test.js` (نحو 615)، `OpenGeoEngine.js` (نحو 432)، `GeoDataRepository.js` (نحو 321)، `MegaTileStitcher.js` (نحو 326)، `FinalizeController.js` (نحو 266).
- 94 موضع emit للأحداث مقابل 25 موضع اشتراك تقريبي، و43 مستمع DOM مباشر.
- 34 موضع I/O متزامن في منطق العميل.
- 26 كتلة `catch` صامتة تقريبًا بين العميل والـHost.

### 3.2 أحجام بيانات التشغيل

| الأصل | الحجم التقريبي | الملاحظة |
|---|---:|---|
| `world_vector_layers_10m.json` | 19.2 MB | يقرأ ويحلل تزامنيًا عند zoom ≥ 4.2 |
| `ne_50m_admin_0_countries.json` | 4.46 MB | مصدر بناء موجود داخل حزمة العميل ولا يُقرأ مباشرة في runtime |
| `vectors/country-outlines-10m.json` | 3.87 MB | مصدر الرسم المحلي عالي الدقة داخل AE |
| `world_vector_layers_50m.json` | 3.49 MB | معاينة العالم منخفضة التكلفة نسبيًا |
| `vectors/land-borders-10m.json` | 2.93 MB | ناتج بناء غير مستخدم في runtime الحالي |
| `world_mercator_boundaries.json` | 2.02 MB | fallback للمعاينة، مع تكرار بيانات مقصود جزئيًا |

### 3.3 نتائج الفحوص

- `npm test`: **46 ناجح / 46**.
- فحص syntax: **50 ملف عميل/Host نجحت**.
- `npm audit`: **0 ثغرات معلنة** ضمن 10 dependencies وقت الفحص.
- بيئة npm الحالية نفسها تضبط `strict-ssl=false` و`NODE_TLS_REJECT_UNAUTHORIZED=0` خارج المشروع؛ لذلك نتيجة audit لا تثبت سلامة قناة TLS في بيئة التطوير.
- مجلد `release/stage`: 69 ملفًا وحوالي 38.5 MB، حديث.
- مجلد `dist`: 17 ملفًا وحوالي 98 KB، قديم ويحتوي معمارية سابقة.

> نجاح الفحوص الحالية يثبت سلامة syntax ومجموعة محدودة من العقود، ولا يثبت صحة التشغيل غير المتزامن أو التكامل الحقيقي مع AE.

---

## 4. صورة النظام الحالية

### 4.1 المكوّنات الفعلية

```text
المستخدم
  │ pointer/wheel/search/settings/finalize
  ▼
App + UI Components
  │
  ├── MapSession ── MapState ── Viewport
  ├── EventBus ── overlays / tiles / sync / status
  ├── TileManager ── MemoryCache + TileDownloader ── HTTP providers
  ├── VectorPreviewLayer ── GeoDataRepository ── local JSON
  ├── SyncManager / FinalizeController ── OpenGeo.Engine
  └── AEBridge ── payload temp file ── opengeoDispatch
                                      │
                                      ▼
                           ExtendScript Host Modules
                           comp / camera / metadata /
                           trajectory / vector / pins
                                      │
                                      ▼
                         After Effects Project & Filesystem
```

### 4.2 مسارات البيانات الحرجة

#### المعاينة داخل اللوحة

`InputHandler → Viewport → viewport:changed → TileManager.update → TileDownloader → tiles:loaded → MemoryCache → tiles:renderReady → MapRenderer`

#### Live Sync إلى AE

`viewport:changed → AESyncEngine debounce 200ms → AEBridge camera.update → Host controller effects`

#### مزامنة معاينة البلاطات إلى AE

`viewport:changed/tiles:renderReady → SyncManager debounce 700ms → OpenGeo.Engine → temp payload → composition.build → Host imports`

#### Finalize

`FinalizeController.validate → trajectory.scan → TilePlanner → download → MegaTileStitcher → composition.build → metadata.set`

#### رسم حدود بلد

`Nominatim search → local identity resolver → GeoDataRepository country package → VectorMapManager → temp JSON → vector.import → AE shape/text layers`

### 4.3 حدود الثقة

1. استجابة مزود البلاطات الخارجي إلى ذاكرة CEP وfilesystem.
2. استجابة Nominatim إلى UI وهوية البلد المحلية.
3. GeoJSON يختاره المستخدم إلى parser/render loop.
4. بيانات Node/CEP إلى ملف payload مؤقت.
5. ملف payload إلى ExtendScript الذي يعمل على main thread الخاص بـ AE.
6. نتيجة Host النصية إلى envelope الجسر ثم حالة العميل.

---

## 5. ما بُني جيدًا ويجب الحفاظ عليه

1. **AEBridge مركزي:** لا توجد تجاوزات مباشرة معلومة لـ `_evalScript` خارج الجسر، والطلب مزدوج الترميز ويحمل `requestId` مطابقًا للرد.
2. **ملفات payload للبيانات الكبيرة:** تقلل أخطاء escaping وطول evalScript، و`JobManager` ينظف الملف في `finally`.
3. **إغلاق UndoGroup:** الدالة `withUndoGroup` تستخدم `finally`، وتغطي بناء الكومبوزيشن والرسم المتجهي والإبر والـkeyframes.
4. **هوية مستند الخريطة:** `documentId` يدخل أسماء الكومبوزيشن وتعليقات الأصول، ما يسمح بتعايش خرائط متعددة أفضل من التنظيف العالمي.
5. **فصل preview عن final:** المنطق الحالي يحاول إبقاء Finalize وعدم حذفه عند تحريك المعاينة.
6. **generation tokens:** `MapSession` وFinalize وSync يمنعون عددًا من late UI commits، والإلغاء في Finalize صامت للمستخدم بعد إصلاح سابق.
7. **مزودات آمنة نسبيًا:** Custom XYZ يقبل HTTPS فقط ويتحقق من `{z}/{x}/{y}`؛ cache signature لا يكشف المفتاح.
8. **دعم antimeridian في طبقة البلاطات:** يوجد فصل بين مفتاح البلاطة البعيدة ومفتاح موضع الرسم، ما يمنع اختفاء النسخ الملفوفة.
9. **حدود محلية عالية الدقة:** الرسم من زر البحث يعتمد package محلي 10m، مع حدود تعقيد في العميل وهوية MAR/ESH منفصلة في ناتج البناء.
10. **بوابة إصدار أولية:** يوجد build وpackage-link verification وsyntax check، وهي أساس مناسب للتطوير بدل استبدالها بالكامل.

---

## 6. سجل النتائج الحرجة والمهمة

### OG-AUD-001 — أداة ZXP تحزم نسخة قديمة غير التي اجتازت الاختبارات

- **الأولوية:** P0
- **اليقين:** مؤكد
- **RPN:** 125 = 5×5×5
- **الدليل:** `scripts/build.js` يكتب إلى `release/stage`، بينما `scripts/zxp.js` يقرأ من `dist`. مجلد `dist` يحتوي `ViewportController.js` و`main.js` القديمين و17 ملفًا فقط؛ `release/stage` يحتوي 69 ملفًا حديثًا. كذلك يشغّل `package:zxp` مزامنة الإصدار **بعد** `verify:release` الذي أنشأ stage، لذلك حتى manifest المصدر المعدّل قد لا يكون هو manifest الموجود داخل artifact المبني.
- **سيناريو الفشل:** `npm run package:zxp` يشغل verify على stage ثم يوقّع `dist`، فيحصل المستخدم على منتج مختلف عن المنتج المختبر.
- **الأثر:** أخطاء قديمة، غياب البيانات والخصائص الحديثة، وإعطاء ثقة زائفة في release gate.
- **التوصية:** مصدر إخراج واحد immutable؛ اجعل ZXP يوقع `release/stage` أو غيّر build إلى destination واحد، ثم تحقق hash/manifest قبل التوقيع.

### OG-AUD-002 — استعادة metadata تستدعي API غير موجود

- **الأولوية:** P0
- **اليقين:** مؤكد
- **RPN:** 80 = 5×4×4
- **الدليل:** `client/js/app.js:445-458` يستدعي `this.viewport.setTileSize(state.tileSize)`، بينما `Viewport` لا يعرّف هذه الدالة؛ الموجود setter للخاصية أو تحديث عبر `MapSession`.
- **سيناريو الفشل:** يختار المستخدم كومبوزيشن محفوظًا بـtile size صالح؛ ينجح `loadFromComp` ثم يحدث `TypeError` أثناء hydration.
- **الأثر:** استعادة ناقصة، احتمال بقاء أعلام suppression، ورفض Promise غير ملتقط.
- **التوصية:** عقد hydration واحد واختبار integration ينفذ callback الحقيقي بحالة 256 و512.

### OG-AUD-003 — EventBus لا يلتقط رفض المستمعات async

- **الأولوية:** P0
- **اليقين:** مؤكد
- **RPN:** 80 = 5×4×4
- **الدليل:** `EventBus.emit` يستدعي `callback(data)` داخل try/catch متزامن فقط. مستمع `sync:compChanged` async، ومستمع رسم الحدود يرجع Promise ويعيد رمي الخطأ.
- **سيناريو الفشل:** فشل metadata أو `vector.import` ينتج unhandled rejection بدل قناة خطأ منضبطة.
- **الأثر:** أخطاء Console، حالة UI غير متوقعة، وسلوك يعتمد على إصدار Chromium.
- **التوصية:** فصل `emit` المتزامن عن `emitAsync` أو مراقبة thenables وإرسالها إلى error boundary؛ منع rethrow من event handlers دون await.

### OG-AUD-004 — Finalize غير ذري ويحذف الأصول الجيدة قبل إثبات البديل

- **الأولوية:** P0
- **اليقين:** مرتفع
- **RPN:** 100 = 5×4×5
- **الدليل:** `FinalizeController.stitchTiles:230-238` يحذف MegaTiles القديمة قبل stitch. `compBuilder.jsx:51-58` يزيل final layers/assets قبل الاستيراد. `compositionTiles.jsx` يتجاوز الملفات المفقودة وفشل import، ثم `compositionResult.jsx` يرجع success مهما كان `importedCount`.
- **سيناريو الفشل:** فشل stitch/import أو timeout بعد التنظيف؛ تختفي النتيجة النهائية السابقة أو تُستبدل بخريطة جزئية.
- **الأثر:** فساد بصري وربما فقد نتيجة عمل سليمة.
- **التوصية:** stage → validate → commit → cleanup. لا تحذف القديم قبل اكتمال كل الملفات والاستيراد، وrollback عند الفشل.

### OG-AUD-005 — ذاكرة `_loaded` تمنع إعادة تنزيل البلاطة بعد LRU eviction

- **الأولوية:** P0
- **اليقين:** مؤكد
- **RPN:** 80 = 4×5×4
- **الدليل:** `TileDownloader.addTile` يرفض المفتاح الموجود في `_loaded` دائمًا، بينما `MemoryCache` يطرد الأقدم عند الحد. `TileManager.clearCache()` لا يعيد ضبط downloader.
- **سيناريو الفشل:** بعد تصفح أكثر من 300 بلاطة، تُطرد بلاطة من الذاكرة؛ عند الرجوع إليها يفشل cache lookup ويرفض downloader إعادة جلبها.
- **الأثر:** فراغ أو fallback دائم حتى تغيير المصدر/إعادة الضبط.
- **التوصية:** المصدر الحقيقي لحالة loaded هو cache، أو احذف `_loaded`، أو أرسل eviction callback يحذف المفتاح منه.

### OG-AUD-006 — محرك مشترك ذو namespace وإلغاء قابلين للتغيير أثناء الطلب

- **الأولوية:** P0
- **اليقين:** مرتفع
- **RPN:** 80 = 5×4×4
- **الدليل:** `SyncManager` و`FinalizeController` يشتركان في `app._geoEngine`. downloader يحمل `_cacheNamespace` و`_cancelled` عالميين؛ `_fetch` يحسب file path بعد اكتمال HTTP بالـnamespace الحالي.
- **سيناريو الفشل:** يبدأ طلب ESRI، ثم يغيّر المستخدم المزود أو يبدأ مسار آخر؛ يُكتب محتوى المزود الأول تحت namespace المزود الثاني، أو يلغي مسار تنزيلات مسار آخر.
- **الأثر:** تسمم cache ونتائج متقاطعة يصعب اكتشافها.
- **التوصية:** Engine/DownloadSession immutable لكل عملية يحمل provider snapshot وAbort scope خاصًا، ويمرر namespace داخل task نفسه.

### OG-AUD-007 — نتيجة Host تقبل استيرادًا جزئيًا بوصفه نجاحًا

- **الأولوية:** P0
- **اليقين:** مؤكد
- **RPN:** 100 = 5×4×5
- **الدليل:** `opengeoImportCompositionTiles` يستخدم `continue` عند ملف مفقود/فشل import؛ `opengeoSerializeCompositionResult` يضع `success:true` دائمًا؛ `FinalizeController.buildComposition` يهمل محتوى النتيجة.
- **الأثر:** نجاح كاذب، metadata finalized صحيحة ظاهريًا مع خريطة ناقصة.
- **التوصية:** `success = importedCount === tilesTotal` للـfinal، قائمة failures، والتحقق في العميل قبل setFinalized.

### OG-AUD-008 — MegaTile الجزئي يُملأ بلون داكن معتم

- **الأولوية:** P1
- **اليقين:** مرتفع
- **RPN:** 64 = 4×4×4
- **الدليل:** worker وfallback يملآن canvas كاملًا بـ`#0f172a`. غياب child أو فشل decode لا يفشل العملية.
- **سيناريو الفشل:** MegaTile غير مكتمل يعلو base tiles أو يغطي مساحة غير محملة بصندوق داكن.
- **الأثر:** black boxes داخل الرندر النهائي.
- **التوصية:** شفافية للمناطق الناقصة أو منع إنشاء block غير مكتمل، مع manifest coverage واختبار alpha.

### OG-AUD-009 — تحميل ورسم 10m المتزامن قد يجمد واجهة CEP

- **الأولوية:** P1
- **اليقين:** مرتفع
- **RPN:** 64 = 4×4×4
- **الدليل:** `VectorPreviewLayer.load` يستدعي repository الذي يستخدم `readFileSync + JSON.parse` لملف 19.2 MB. عند zoom 4.2 يتم ذلك أثناء render. `_isVisible` يوسع X بمقدار mapSize كامل، فيعطل culling الأفقي عمليًا.
- **الأثر:** توقف قصير أو طويل، استهلاك ذاكرة كبير، وتدهور مستمر أثناء السحب.
- **التوصية:** spatial index/tiled vector chunks، parse تدريجي أو Worker، culling صحيح مع نسخ world wrap محددة، وميزانية frame.

### OG-AUD-010 — GeoJSON بلا حدود موارد وتأكيد النجاح غير صحيح

- **الأولوية:** P1
- **اليقين:** مؤكد
- **RPN:** 64 = 4×4×4
- **الدليل:** لا حد لحجم الملف أو عدد features/points/depth. `GeoJSONLayer` يلتقط parse error داخليًا، بينما `app.js:315-318` يعرض toast نجاح لأن `emit` نفسه لم يرمِ.
- **الأثر:** تجميد/نفاد ذاكرة، ورسالة نجاح لملف غير صالح.
- **التوصية:** validator يعيد Result صريحًا قبل event، limits، coordinate/depth checks، وإلغاء/worker للملفات الكبيرة.

### OG-AUD-011 — Host vector.import لا يطبق حدود الثقة نفسها

- **الأولوية:** P1
- **اليقين:** مؤكد
- **RPN:** 60 = 5×3×4
- **الدليل:** `vectorHost.jsx:169-225` يقرأ الملف كاملًا بلا size limit، ثم يثق في layers/features/rings/points والأعداد. حد 100,000 نقطة موجود فقط في العميل.
- **الأثر:** ملف كبير/فاسد قد يحجز main thread لـAE أو ينشئ آلاف الخصائص.
- **التوصية:** تحقق دفاعي داخل Host: file size، schema، max layers/features/rings/points، finite coordinates، string lengths، ورفض قبل UndoGroup الثقيل.

### OG-AUD-012 — timeout في AEBridge لا يلغي mutation داخل AE

- **الأولوية:** P1
- **اليقين:** مؤكد كقيد معماري
- **RPN:** 60 = 5×3×4
- **الدليل:** timeout يرفض Promise في العميل فقط؛ `evalScript` يعمل على main thread في Host ولا يملك cancellation protocol.
- **سيناريو الفشل:** يظن العميل أن build فشل/ألغي، ثم يكمل Host التعديل متأخرًا.
- **التوصية:** operationId وحالة commit داخل Host، أو تقسيم العملية إلى أوامر صغيرة قابلة للفحص؛ لا تصف cancellation بأنه “لم يطبق أي تغيير” بعد بدء commit.

### OG-AUD-013 — coupling غير صحيح بين overlays واستخراج البلاطات إلى AE

- **الأولوية:** P1
- **اليقين:** مؤكد
- **RPN:** 36 = 3×4×3
- **الدليل:** `overlay:changed` يطلب `queueAutoExport` رغم أن marker/GeoJSON لا يدخلان payload الخاص بـcomposition tiles. كما أن `tiles:renderReady` يعيد جدولة export بعد كل tile.
- **الأثر:** تنزيلات وعمليات AE زائدة، وتأخير debounce باستمرار تحت شبكة بطيئة.
- **التوصية:** events دلالية (`preview.invalidate`, `camera.commitRequested`, `overlay.renderOnly`)؛ export يتبع camera revision لا اكتمال canvas.

### OG-AUD-014 — مصادر حقيقة متعددة للحالة

- **الأولوية:** P1
- **اليقين:** مؤكد
- **RPN:** 48 = 4×4×3
- **الدليل:** `MapSession` يعلن نفسه authoritative، لكن الوحدات تقرأ/تكتب `mapState` مباشرة؛ `MapState.isFinalized` مكرر وغير مستخدم؛ `session.documentId` يعدل مباشرة في hydration.
- **الأثر:** إشعارات مفقودة، state drift، واختبارات أصعب.
- **التوصية:** كل mutation عبر commands في MapSession، وViewport projection read model فقط، وإزالة الحقول المكررة.

### OG-AUD-015 — `App` يجمع composition root وcontroller وDOM وbusiness orchestration

- **الأولوية:** P1
- **اليقين:** مؤكد
- **RPN:** 36 = 3×4×3
- **الدليل:** نحو 694 سطرًا، ينشئ كل الخدمات، يسجل DOM، يدير metadata، comp creation، preview mode، providers، pins/keyframes والرندر.
- **الأثر:** God Object، تغييرات متشابكة، وتسرب UI إلى منطق العمليات.
- **التوصية:** إبقاء `AppBootstrap` للتركيب فقط؛ استخراج `CompositionController`, `PreviewController`, `ToolbarController`, `StateHydrator`, `OperationPresenter`.

### OG-AUD-016 — تكرار منظومتين للبلاطات والإسقاط والنقل

- **الأولوية:** P1
- **اليقين:** مؤكد
- **RPN:** 36 = 3×4×3
- **الدليل:** المعاينة تستخدم `TileGrid/TileDownloader/TileManager`؛ Sync/Finalize يستخدمان `OpenGeoEngine.js` وفيه Camera/TileGrid/TileDownloader/cache آخر. جزء النقل مفوض أحيانًا إلى `TileTransport` مع fallback مكرر.
- **الأثر:** اختلاف semantics، إصلاح عيب في مسار وترك الآخر، ومضاعفة الاختبارات.
- **التوصية:** نواة مشتركة pure للتخطيط والهوية، وDownloadSession واحدة، مع adapters للذاكرة/القرص/AE.

### OG-AUD-017 — اختبار 46/46 يعطي ثقة أعلى مما يثبت

- **الأولوية:** P1
- **اليقين:** مؤكد
- **RPN:** 60 = 4×3×5
- **الدليل:** `scripts/test.js` يحتوي نحو 196 استخدامًا لـ`includes/match/readFileSync` مقابل استخدامين تقريبًا لـVM، ولا توجد اختبارات async معلنة أو بيئة DOM/AE fake متكاملة. لذلك لم يكتشف OG-AUD-002/003/005/007.
- **الأثر:** regressions تمر مع بوابة خضراء.
- **التوصية:** هرم اختبارات: unit executable، integration مع fake CEP/AE bridge، contract tests، geometry golden tests، وAE manual acceptance.

### OG-AUD-018 — Rollup/TypeScript ومسار `dist` إرث متعارض

- **الأولوية:** P1
- **اليقين:** مؤكد
- **RPN:** 36 = 3×4×3
- **الدليل:** `rollup.config.js` و`tsconfig.json` يشيران إلى `client/js/engine/src` غير الموجود؛ plugin غير مثبت؛ runtime لا يحمل bundle؛ `dist` قديم لكنه يُستخدم في zxp.
- **الأثر:** مسار بناء وهمي وقرارات خاطئة للمطور.
- **التوصية:** قرار ADR: إما إحياء TypeScript/bundling رسميًا أو حذف المسار بالكامل؛ لا تبقِ نظامي بناء.

### OG-AUD-019 — كود وبيانات ميتة أو انتقالية داخل المنتج

- **الأولوية:** P2
- **اليقين:** مؤكد جزئيًا
- **RPN:** 24 = 2×4×3
- **الأدلة:**
  - `CloudBoundaryService.js` محمّل في HTML وغير instantiated في runtime.
  - `GeoDataRepository.has/save/loadLocalBoundary` و`query` بلا مستهلك runtime حالي.
  - aliases في ProviderManager بلا مستهلك: `getDefinition`, `validateSelection`, `resolveTemplate`, `getURL`.
  - `TileDownloader._decodeImage`, `MapState.getDownloadZoom/getBaseTileZoom`, `SyncManager.queueAutoExportFromAE`, و`App.exportTimer` بلا استعمال فعلي.
  - `vectors/land-borders-10m.json` نحو 2.93 MB بلا مرجع runtime.
- **الأثر:** حجم وتكلفة فهم واختبارات زائفة.
- **التوصية:** deprecation inventory ثم حذف أو تبرير كل عنصر؛ لا حذف آلي قبل اختبار الحزمة.

### OG-AUD-020 — إصدارات ومخططات بيانات غير موحدة

- **الأولوية:** P2
- **اليقين:** مؤكد
- **RPN:** 27 = 3×3×3
- **الدليل:** package/manifest = 1.0.0، config/preferences schema = 1.1.2، و`MetadataManager` يكتب 2.0.0؛ `sync-versions.js` يزامن package مع manifest فقط ولا يغطي بقية العقود.
- **الأثر:** reset preferences غير متوقع، صعوبة migration، وغياب traceability للأصول.
- **التوصية:** فصل `appVersion`, `settingsSchemaVersion`, `metadataSchemaVersion`, `dataBundleVersion`، مع migrations لا reset شامل.

### OG-AUD-021 — بوابة الإصدار لا تعيد بناء جميع مشتقات البيانات

- **الأولوية:** P1
- **اليقين:** مؤكد
- **RPN:** 48 = 4×3×4
- **الدليل:** verify يعيد `build-land-border-data` فقط، لكنه لا يشغل `vector:data` للـ50m/10m، ولا يقارن manifest/hashes لكل المصادر والمخرجات.
- **الأثر:** إصدار بيانات preview قديمة لا تطابق source.
- **التوصية:** data pipeline reproducible مع source manifest وhashes ومقارنة clean rebuild.

### OG-AUD-022 — هوية نتيجة البحث تعتمد على regex نصي هش

- **الأولوية:** P1
- **اليقين:** مرتفع
- **RPN:** 36 = 3×4×3
- **الدليل:** `_resolveLocalDrawingCountryCode` يدمج `display_name` وحقول مناطق ثم يطابق Western Sahara. قد يغير هوية نتيجة أخرى لأن العبارة وردت في hierarchy؛ العرض المحلي يحذف aliases بنمط لغات محدود.
- **الأثر:** رسم بلد غير المقصود أو تسمية غير صحيحة.
- **التوصية:** `GeographyIdentityResolver` مستقل، يعتمد structured fields/OSM type/id + registry محلي واختبارات متعددة اللغات والحواف؛ احتفظ بنص المزود كattribution منفصل.

### OG-AUD-023 — ملف تعريف MAR/ESH مبني بسياسة هندسية hard-coded بلا حوكمة كافية

- **الأولوية:** P1
- **اليقين:** مؤكد
- **RPN:** 48 = 4×3×4
- **الدليل:** `build-land-border-data.js` يقص MAR ويعيد بناء ESH بخط عرض ثابت ثم ينشر profile. توجد اختبارات bbox/area لكن لا topology validity أو golden visual/hash أو policy profile selectable.
- **الأثر:** تغيير مصدر البيانات أو union قد يغير الخريطة بصمت؛ مسألة خرائط حساسة تصبح مخفية في implementation.
- **التوصية:** CartographyPolicy versioned، provenance/license/hash، fixtures ذهبية، واختبارات فصل وعدم تداخل وتغطية وتسمية. يجب فصل حقيقة البيانات عن نص البحث والسياسة التحريرية.

### OG-AUD-024 — Trajectory sampling محدود بطريقة تفشل للمشاريع الطويلة

- **الأولوية:** P1
- **اليقين:** مؤكد
- **RPN:** 48 = 4×3×4
- **الدليل:** Host يرفض أكثر من 5000 sample، وFinalize يطلب كل frame دائمًا. عند 30fps يتجاوز Work Area قرابة 166 ثانية حتى لو الكاميرا ثابتة.
- **الأثر:** Finalize غير متاح لمشاريع طويلة.
- **التوصية:** استخراج keyframe segments، adaptive subdivision وفق حد حركة بالبكسل/تغير zoom، وتغطية endpoints؛ limit بحسب tile plan لا عدد frames الخام.

### OG-AUD-025 — ownership داخل AE يعتمد جزئيًا على الأسماء

- **الأولوية:** P1
- **اليقين:** مؤكد
- **RPN:** 48 = 4×3×4
- **الدليل:** العثور على comp بالاسم، وتنظيف layers بالبادئات `preview_`, `final_`, `tile_`. composition الموجودة تحدث width/height فقط لا duration/fps.
- **الأثر:** collision مع أسماء المستخدم، حذف layer غير مملوك، أو خصائص comp قديمة.
- **التوصية:** comment/schema ownership لكل comp/layer/footage؛ documentId + role + revision، ومطابقة metadata لا الاسم، وتحديث جميع خصائص العقد صراحة.

### OG-AUD-026 — suppression الزمني في Live Sync قد يسقط تعديل AE صحيحًا

- **الأولوية:** P1
- **اليقين:** مرتفع
- **RPN:** 36 = 3×4×3
- **الدليل:** `_shouldIgnoreAeCamera` يعيد true طوال نافذة 1.2 ثانية حتى عندما لا تطابق كاميرا AE الكتابة المحلية.
- **الأثر:** تحريك AE قريبًا من حركة اللوحة لا يظهر في اللوحة، أو إحساس zoom بالرجوع/التأخير.
- **التوصية:** revision/ack لكل camera write، وعدم قمع إلا echo المطابق، مع ترتيب واضح `panelRevision`/`hostRevision`.

### OG-AUD-027 — Polling داخل AE قد يصبح مكلفًا وغير مرئي عند الفشل

- **الأولوية:** P2
- **اليقين:** متوسط
- **RPN:** 27 = 3×3×3
- **الدليل:** كل 500ms يطلب `camera.getActive`؛ resolve قد يفحص المشروع للعثور على controller؛ كل الأخطاء في `_pollAfterEffects` تُبتلع.
- **الأثر:** حمل في مشاريع كبيرة وانقطاع sync بلا تشخيص.
- **التوصية:** cache لهوية comp مع validation خفيف، exponential backoff، health state وعداد أخطاء دون spam.

### OG-AUD-028 — API options وأفرع غير فعالة تربك العقد

- **الأولوية:** P2
- **اليقين:** مؤكد
- **RPN:** 18 = 2×3×3
- **الدليل:** `useAeState` غير مستخدم؛ `createIfNeeded` لا ينشئ شيئًا ويُستخدم في catch فقط؛ `maxDownloadZoom` محسوب وغير مستخدم؛ فروع successRate في Finalize غير قابلة للوصول بعد throw عند أي failed tile.
- **الأثر:** intent مضلل وصعوبة مراجعة.
- **التوصية:** إزالة الخيارات أو تنفيذها بعقد واختبارات؛ تبسيط شروط النجاح.

### OG-AUD-029 — lifecycle لمستمعات DOM غير مكتمل

- **الأولوية:** P2
- **اليقين:** مؤكد
- **RPN:** 18 = 2×3×3
- **الدليل:** SearchPanel يضيف input/keydown/close closures ولا يزيلها في dispose. أجزاء من `_setupUI` في App تستخدم anonymous listeners لا تُزال.
- **الأثر:** تكرار handlers إن أعيد إنشاء App داخل الجلسة، وتسرب مراجع.
- **التوصية:** DisposableBag موحد أو event delegation، واختبار mount/unmount مرتين.

### OG-AUD-030 — I/O متزامن ومعالجة أخطاء صامتة تضعف الأداء والتشخيص

- **الأولوية:** P2
- **اليقين:** مؤكد
- **RPN:** 27 = 3×3×3
- **الدليل:** 34 موضع fs متزامن، منها قراءة MegaTile buffers وJSON وكتابة payload؛ نحو 26 catch صامتة؛ `window.onerror` يكتب إلى `C:/Temp` غير المحمول ولا يضمن stack.
- **الأثر:** pauses وتلف صامت وصعوبة دعم المستخدم.
- **التوصية:** async fs للعمليات الكبيرة، ErrorBoundary/OperationLogger منظم، redaction، وملف log تحت USER_DATA مع rotation.

### OG-AUD-031 — إعداد مزود Stamen/Stadia غير قابل للاكتمال من UI الحالي

- **الأولوية:** P2
- **اليقين:** مؤكد
- **RPN:** 18 = 2×3×3
- **الدليل:** config يعلن `requiresKey` لـ`stamenTerrain`، لكن settings الافتراضية/الواجهة تدير مفاتيح Mapbox/MapTiler فقط.
- **الأثر:** خيار ظاهر لكنه يفشل دائمًا برسالة missing key.
- **التوصية:** schema ديناميكي لحقول المزود أو إخفاؤه حتى تتوفر واجهة المفتاح.

### OG-AUD-032 — تهيئة الكادر وبعض حسابات التخطيط تقريبية

- **الأولوية:** P2
- **اليقين:** متوسط
- **RPN:** 18 = 2×3×3
- **الدليل:** `Viewport.fitBounds` يعتمد متوسط latitude حسابيًا بدل midpoint في Mercator؛ TilePlanner يصف 0.0001° بأنها أقل من pixel رغم اختلافها الكبير حسب zoom/latitude.
- **الأثر:** framing غير دقيق عند العروض العليا، أو إعادة استخدام tile set بعد حركة مرئية.
- **التوصية:** كل thresholds بوحدات world pixels، واختبارات high-latitude/antimeridian/aspect ratio.

---

## 7. تقييم وحدة بوحدة

| الوحدة | نقاط القوة | الانتهاك/الخطر | الحكم |
|---|---|---|---|
| `App` | composition root واضح وdispose جزئي | God Object، DOM/business/state متداخلة | إعادة تقسيم مطلوبة |
| `MapSession` | generations وsnapshot وإشعارات | mutations مباشرة ومصادر حقيقة مكررة | اتجاه صحيح غير مكتمل |
| `MapState/Viewport` | فصل compZoom عن uiZoom وتحويلات واضحة | API hydration غير موحد وحسابات تقريبية | جيد بعد ضبط العقود |
| `EventBus` | بسيط، snapshot للمستمعين، unsubscribe | لا async policy، وعقود قليلة diagnostic-only | خطر مركزي |
| `TileManager/Cache` | LRU وworld-wrap render slots وfallback | `_loaded` لا يتزامن مع eviction | عيب وظيفي مؤكد |
| `OpenGeo.Engine` | API موحد نسبيًا للتنزيل والcache disk | محرك mutable مشترك وتكرار stack | يحتاج Session isolation |
| `SyncManager` | debounce وgeneration checks وpayload manifest | coupling مع render، options ميتة، shared engine | متوسط |
| `FinalizeController` | مراحل واضحة وحدود tile count وإلغاء | غير ذري وsnapshot ناقص وحذف مبكر | غير آمن للإصدار |
| `MegaTileStitcher` | Worker + fallback وتنظيف worker | opaque missing cells وsync fs | يحتاج coverage contract |
| `AEBridge` | gateway واحدة، escaping، envelope/requestId | timeout بلا host cancellation، legacy parsing | أساس جيد يحتاج protocol v2 |
| Host composition | وحدات منفصلة وUndo finally | partial success والتنظيف بالاسم وعدم transaction | خطر P0 |
| Host vector | shape paths/labels وتعليقات ملكية | لا limits داخل trust boundary | خطر DoS تشغيلي |
| `GeoDataRepository` | adapters وcountry index محلي | cache غير محدود ومسؤوليات legacy | يحتاج فصل stores |
| `VectorPreviewLayer` | offline preview وطبقات قابلة للتفعيل | 19MB sync parse/culling غير صحيح | سبب تجميد محتمل |
| `VectorMapManager` | entry point واحد وcomplexity guard | rethrow عبر EventBus وsync write | جيد بعد التحصين |
| `SearchPanel` | debounce/generation/abort وDOM آمن نصيًا | لا timeout، هوية regex، disposal ناقص | يحتاج resolver مستقل |
| `ProviderManager` | HTTPS validation وsecret-free signature | mutates global config، plaintext storage، key schema ناقص | مقبول داخليًا |
| Build/data scripts | مخرجات محلية وmanifest جزئي | نظامان للبناء وبيانات غير reproducible كلها | مانع إصدار |
| Tests | تغطية أسماء عقود كثيرة وسرعة عالية | static assertions أكثر من behavior | غير كافية كبوابة وحيدة |

---

## 8. تحليل الأحداث والتزامن بالتفصيل

### 8.1 خصائص يجب أن تصبح Invariants

1. لا يحق لنتيجة عملية قديمة تعديل UI أو AE أو cache namespace جديد.
2. كل حدث async إما awaited من ناشره أو مراقب مركزيًا؛ لا Promise مهملة.
3. تغيير المزود ينشئ revision جديدة ويلغي جلسة المزود السابق فقط.
4. render events لا تطلق side effects إلى AE.
5. Finalize واحد فقط يملك commit lease للمستند.
6. comp/document/provider/camera/quality كلها snapshot واحد عند بدء العملية.
7. cancellation قبل commit يعني صفر تغييرات؛ cancellation أثناء commit يجب أن يعلن “commit state unknown/pending reconciliation”.

### 8.2 الحلقات الحالية

- Panel viewport يرسل camera إلى AE.
- AE polling قد يعيد camera إلى panel.
- suppression الزمني يمنع الحلقة لكنه قد يخفي تغييرًا شرعيًا.
- tile readiness يعيد جدولة export؛ وبذلك زمن الشبكة يدخل في منطق مزامنة الكاميرا.

### 8.3 التصميم المستهدف

استخدم `CameraRevision {documentId, origin, revision, lat, lng, compZoom}`. يحتفظ كل طرف بآخر revision منه ومن الطرف الآخر. echo مطابق يُهمل، أما revision جديد مخالف فيُطبق فورًا. لا تستخدم time windows بوصفها هوية حدث.

---

## 9. سلامة الجسر وUndoGroups

### 9.1 ما هو سليم

- ترميز args إلى JSON ثم إدخالها كسلسلة JSON آمن من حقن علامات الاقتباس المعتاد.
- dispatcher يحصر الأوامر في switch معروف.
- response envelope يحتوي requestId.
- `withUndoGroup` يغلق المجموعة في `finally` ولا يظهر nesting عشوائي في العميل.
- metadata/camera live updates ليستا داخل UndoGroup، ما يمنع تكدس Undo كل 200–500ms، وهو قرار مناسب إذا كان موثقًا.

### 9.2 ما يجب تغييره

- استبدال `opengeoBridgeParseLegacyResult` بعقود endpoint typed؛ string `success/error:` ليس بروتوكولًا مستدامًا.
- validation داخل Host لكل command لا في العميل فقط.
- فصل prepare/commit لبناء composition.
- كل result يحمل `operationId`, `documentId`, `revision`, `counts`, `warnings`, `durationMs`.
- لا تُستخدم UndoGroup كبديل transaction؛ Undo يتيح للمستخدم التراجع لكنه لا يعالج ملفات حذفت من القرص قبل commit.

---

## 10. تقرير الكود الميت والتكرار

### 10.1 مرشح للحذف بعد إثبات عدم الاستعمال

| العنصر | السبب | الإجراء |
|---|---|---|
| `dist/**` القديم | ليس ناتج build الحالي لكنه يُحزم خطأ | أوقف استخدامه ثم احذفه بعد migration |
| Rollup/TS configs | يشيران إلى source غير موجود وplugin غير مثبت | قرار keep-or-delete موثق |
| `CloudBoundaryService.js` | محمل بلا instance | حذفه أو إعادة تعريف ميزة فعلية |
| `land-borders-10m.json` | لا runtime refs | إزالته من package إن لم توجد ميزة قادمة موثقة |
| Provider aliases الأربعة | لا callers | حذف بعد deprecation check |
| repo local-boundary cache APIs | بقايا مسار cloud | استخراجها لحزمة اختيارية أو حذفها |
| `_decodeImage` | لا استدعاء | حذف واختبار التنزيل |
| `App.exportTimer` | SyncManager يملك timer | حذف |
| `queueAutoExportFromAE` | stub فارغ | حذف emitters/العقد بدل إبقائه |
| `MapState.isFinalized` | session هو المستخدم | حذف |
| `getDownloadZoom/getBaseTileZoom` | بلا callers | حذف أو اعتماد أحدهما رسميًا |
| `maxDownloadZoom` | computed unused | حذف أو استخدامه في strategy واضحة |

### 10.2 التكرار البنيوي

- Projection/TileGrid/Downloader موجودة بنسختين.
- إدارة cancellation/retries/cache paths موزعة.
- serialization يدوي في عدة Host modules بدل serializer واحد.
- state normalization موزع بين MapState/MapSession/Metadata/App/AESync.
- رسائل status/modal/toast موزعة في business code بدل presenter.

---

## 11. الأمن والخصوصية وسطح الهجوم

### 11.1 نموذج التهديد المختصر

| الحد | التهديد | الوضع الحالي | المطلوب |
|---|---|---|---|
| HTTP tiles | بيانات تالفة/كبيرة/بطيئة | HTTPS غالبًا، magic bytes وحد أدنى | max bytes، MIME، redirects policy، abort scoped |
| Custom XYZ | exfiltration/ضعف TLS | HTTPS + placeholders | host allow/deny policy اختياري، redacted logs |
| Nominatim | spoofed/malformed identity | JSON parse + textContent | timeout، schema، identity resolver |
| GeoJSON | DoS بالموارد | بلا limits | quotas + worker + validation |
| payload file | tampering/path abuse | client-generated path و50MB لبعض comp payloads | nonce/hash/schema وlimits لكل endpoint |
| vector file | Host freeze | بلا size/schema limits | Host validation إلزامي |
| CEP DOM + Node | XSS يتحول إلى fs access | لا XSS مباشر وجد في المسارات المدققة | CSP صارم، منع remote scripts، DOM sinks audit |
| API keys | disclosure محلي | plaintext localStorage، logs لا تضمها غالبًا | توثيق الحساسية، redaction، OS credential store إن أمكن |

### 11.2 ملاحظة dependency audit

لم يُبلغ npm عن ثغرات وقت الفحص. هذه نتيجة وقتية وليست ضمانًا، كما أن TLS معطل في إعداد npm/Node الخاص ببيئة التطوير الحالية ويجب إصلاحه خارج repository قبل الاعتماد على تنزيلات supply chain.

---

## 12. الأداء والسعة

### ميزانيات مقترحة

| العملية | الميزانية المستهدفة |
|---|---:|
| frame أثناء السحب/zoom | p95 ≤ 16.7ms، ولا long task > 50ms |
| تحميل انتقال 50m→10m | دون blocking > 50ms؛ progress/cancel |
| Event → preview camera push | ≤ 300ms بعد آخر input |
| AE polling | لا تداخل؛ متوسط host work < 20ms |
| GeoJSON افتراضي | ≤ 10MB، ≤ 50k features، ≤ 250k points؛ قابل للضبط |
| vector.import | حد Host مستقل، وتقدير تكلفة قبل Undo |
| Finalize | 0 partial commits؛ كل مرحلة قابلة للقياس والإلغاء قبل commit |

### ضغط الذاكرة

الاحتفاظ بـ50m و10m parsed في `VectorPreviewLayer.datasets` وبكل datasets في repository قد يجعل 22.7MB من JSON الخام أضعاف ذلك داخل object graph. يجب وجود LRU/explicit unload وقياس heap، لا الاعتماد على حجم الملف فقط.

---

## 13. جودة الاختبار والإصدار

### ما تثبته الاختبارات الحالية

- وجود عقود وأسماء معينة في المصدر.
- بعض دوال التحويل والrepository عند تنفيذها في Node/VM.
- سلامة مصادر MAR/ESH وفق bbox/area/profile الحالي.
- absence لبعض legacy endpoints وsource-map reference.

### ما لا تثبته

- استعادة metadata داخل App.
- رفض Promise داخل EventBus.
- eviction/revisit للـcache.
- تداخل provider switch مع download.
- ذرّية Finalize وفشل import الجزئي.
- تجميد 19MB parse والرندر الفعلي.
- lifecycle mount/dispose.
- ما يتم وضعه بالفعل داخل ZXP.
- behavior الحقيقي داخل إصدارات AE المدعومة.

### البوابة المستهدفة

`format/lint → unit → integration(fake CEP/AE) → data integrity → clean build → package manifest/hash → ZXP inspect → manual AE smoke → signed artifact provenance`

---

## 14. قائمة المخاطر مرتبة

| الترتيب | المعرّف | RPN | القرار |
|---:|---|---:|---|
| 1 | OG-AUD-001 | 125 | مانع إصدار |
| 2 | OG-AUD-004 | 100 | مانع Finalize production |
| 3 | OG-AUD-007 | 100 | مانع Finalize production |
| 4 | OG-AUD-002 | 80 | إصلاح فوري |
| 5 | OG-AUD-003 | 80 | إصلاح فوري |
| 6 | OG-AUD-005 | 80 | إصلاح فوري |
| 7 | OG-AUD-006 | 80 | عزل العمليات قبل التوسع |
| 8 | OG-AUD-008/009/010 | 64 | تثبيت أداء وسلامة |
| 9 | OG-AUD-011/012/017 | 60 | تحصين الجسر والاختبارات |
| 10 | OG-AUD-014/021/023/024/025 | 48 | دورة P1 |

---

## 15. معايير الخروج من مرحلة التثبيت

لا يعد المنتج مستقرًا حتى تتحقق جميع الشروط التالية:

- الحزمة الموقعة مطابقة hash لمجلد stage المختبر.
- استعادة كل metadata schemas المدعومة تعمل دون rejection.
- EventBus لا ينتج unhandled rejections.
- إعادة زيارة بلاطة مطرودة تعيد تنزيلها.
- provider switch أثناء download لا يخلط cache ولا النتائج.
- فشل بلاطة/استيراد واحد في final لا يزيل final السابق.
- لا MegaTile معتم للمناطق المفقودة.
- Host يرفض vector/GeoJSON/payload المتجاوز للحدود قبل mutation.
- اختبارات behavior جديدة تفشل على الكود القديم وتنجح بعد الإصلاح.
- مصفوفة AE اليدوية تنجح على أقل وأحدث إصدار مدعوم فعليًا، لا المجال النظري 15–99.9 فقط.

---

## 16. الخلاصة المعمارية

المشكلة الرئيسة في OpenGeo ليست نقص الخصائص؛ بل إن المنتج سبق بنيته الوقائية. توجد أجزاء قوية تستحق الحفاظ عليها، خصوصًا الجسر المركزي، وهوية المستند، والبيانات المحلية، وفصل preview/final المقصود. لكن العمليات الحرجة ما زالت تعتمد mutable shared state ونجاح جزئي وتنظيف مبكر، في حين أن الاختبارات الحالية تتحقق كثيرًا من وجود النص أكثر من تنفيذ السلوك.

الترتيب الصحيح ليس إعادة كتابة شاملة. المطلوب هو: **توحيد artifact الإصدار أولًا، إغلاق العيوب المؤكدة، جعل Finalize transaction-like، عزل عمليات التنزيل، ثم تفكيك App وتوحيد state/events/tiles تدريجيًا خلف اختبارات characterization.** الخطة التنفيذية المقابلة موجودة في `OPEN_GEO_MASTER_REMEDIATION_AND_EVOLUTION_PLAN_AR.md` وتغطي كل معرّف في هذا التقرير.

---

## 17. ملحق التقييم ملفًا بملف

هذا الملحق يسجل مصير كل ملف منطقي شمله الجرد؛ كلمة «احتفاظ» لا تعني أن الملف بلا ملاحظات، بل إن مسؤوليته الأساسية مطلوبة.

| الملف | المسؤولية المفهومة | الحكم/الإجراء |
|---|---|---|
| `client/js/ae/AESyncEngine.js` | polling ومزامنة الكاميرا ثنائية الاتجاه | احتفاظ؛ استبدال suppression الزمني بـrevision/ack |
| `client/js/ae/MetadataManager.js` | حفظ/قراءة حالة الخريطة داخل comp | احتفاظ؛ schema migration وResult صريح |
| `client/js/ae/SpatialPin.js` | adapter لإنشاء pin في Host | احتفاظ؛ إدخاله في bridge contracts |
| `client/js/app.js` | تركيب النظام وUI/workflows | تفكيك تدريجي؛ يبقى bootstrap فقط |
| `client/js/config.js` | providers/defaults/version | فصل registry عن versions وعدم mutation عالمي |
| `client/js/core/AEBridge.js` | بوابة CEP→ExtendScript | احتفاظ؛ protocol v2 وoperation reconciliation |
| `client/js/core/CloudBoundaryService.js` | lookup حدود سحابي قديم | مرشح حذف؛ لا instance runtime |
| `client/js/core/FinalizeController.js` | orchestration للنتيجة النهائية | إعادة بناء transaction workflow دون Big Bang |
| `client/js/core/GeoDataRepository.js` | قراءة/adapters/index للبيانات المحلية | تقسيم stores وإزالة APIs القديمة وcache budget |
| `client/js/core/JobManager.js` | ملفات payload المؤقتة ودورة حياتها | احتفاظ؛ async I/O وmetadata/hash للعملية |
| `client/js/core/MapSession.js` | حالة المستند والعمليات | اعتماد كمصدر الكتابة الوحيد |
| `client/js/core/PreferencesStore.js` | persistence للتفضيلات | migrations بدل reset عند version change |
| `client/js/core/ProviderManager.js` | provider resolution/keys/signature | registry instance وschema ديناميكي؛ حذف aliases |
| `client/js/core/StateContracts.js` | normalize/serialize للحالة | احتفاظ وتوسيع بعقود versioned |
| `client/js/core/SyncManager.js` | preview composition export/path preview | فصل camera intent عن render readiness وعزل engine |
| `client/js/core/VectorMapManager.js` | رسم outline المحلي من البحث | احتفاظ؛ عدم rethrow عبر event وHost limits |
| `client/js/engine/MegaTileStitcher.js` | دمج hierarchical للبلاطات | احتفاظ مؤقت؛ coverage/alpha وI/O غير حاجب |
| `client/js/engine/OpenGeoEngine.js` | export/final tile stack | دمجه لاحقًا مع TileCore؛ إزالة mutable shared state |
| `client/js/engine/stitcherWorker.js` | الدمج خارج UI thread | احتفاظ؛ decoded-count وشفافية وفشل صريح |
| `client/js/engine/TilePlanner.js` | تغطية trajectory والبلاطات الفريدة | احتفاظ؛ pixel thresholds/adaptive trajectory وإزالة dead var |
| `client/js/events/EventBus.js` | pub/sub بين الوحدات | احتفاظ بعد async/error semantics واضحة |
| `client/js/events/EventContracts.js` | أسماء وفحص payload محدود | توسيع إلى catalog كامل؛ validation ليست diagnostic فقط |
| `client/js/map/MapRenderer.js` | رسم raster/overlays/frame | احتفاظ؛ budget/telemetry وفصل invalidation |
| `client/js/map/MercatorProjection.js` | تحويلات Web Mercator | نواة pure مشتركة واختبارات حواف |
| `client/js/map/TileGrid.js` | visible tiles وworld wrap للوحة | توحيدها مع نواة export |
| `client/js/map/Viewport.js` | camera UI/frame/zoom | احتفاظ كـread/projection model؛ API hydration موحد |
| `client/js/MapState.js` | القيم الهندسية الخام | إبقاؤه داخليًا لـMapSession وإزالة الحالة المكررة |
| `client/js/overlays/GeoJSONLayer.js` | parse/render GeoJSON | validator/limits/worker وResult صريح |
| `client/js/overlays/MarkerLayer.js` | markers داخل المعاينة | احتفاظ؛ render-only event |
| `client/js/overlays/VectorPreviewLayer.js` | خريطة vector محلية داخل اللوحة | chunk/index/culling/worker؛ لا full sync parse |
| `client/js/tiles/MemoryCache.js` | LRU bitmaps | احتفاظ؛ eviction contract |
| `client/js/tiles/TileDownloader.js` | تنزيل preview مع priority/retries | إصلاح `_loaded` ثم دمجه في DownloadSession |
| `client/js/tiles/TileManager.js` | إدارة tile render slots/fallback | احتفاظ؛ decouple events وcache lifecycle |
| `client/js/tiles/TileTransport.js` | XHR/abort/timeout primitive | جعله transport المشترك الوحيد |
| `client/js/ui/InputHandler.js` | pointer/wheel interactions | احتفاظ؛ intents فقط واختبارات zoom focus |
| `client/js/ui/SearchPanel.js` | Nominatim/results/actions | استخراج identity resolver، timeout، disposal |
| `client/js/ui/SettingsPanel.js` | UI إعدادات المصدر/الحجم/theme | احتفاظ؛ provider schema ديناميكي |
| `client/js/ui/Toast.js` | عرض التنبيهات | احتفاظ؛ لا business decision |
| `host/index.jsx` | نقطة تحميل وحدات Host | احتفاظ؛ include/version sanity check |
| `host/modules/bridgeDispatcher.jsx` | dispatch وlegacy response adapter | protocol v2 typed ثم إزالة heuristic adapter |
| `host/modules/compBuilder.jsx` | orchestration لبناء comps | تحويله prepare/commit/rollback |
| `host/modules/compositionAssets.jsx` | comps/assets ownership/cleanup | metadata ownership لا أسماء؛ تحديث duration/fps |
| `host/modules/compositionResult.jsx` | serialization لنتيجة البناء | typed result؛ partial ليس success |
| `host/modules/compositionRig.jsx` | controller وMapPivot expressions | احتفاظ؛ identity غير مرتبطة بالاسم واختبارات expression |
| `host/modules/compositionTiles.jsx` | import/place tile footage | failure list، validation، staging ownership |
| `host/modules/helpers.jsx` | Undo/logging/lookup/helpers | احتفاظ؛ تقليل catches الصامتة وفصل helpers |
| `host/modules/metadataSync.jsx` | metadata وactive camera state | typed JSON، schema validation، lookup cache |
| `host/modules/spatialPinHost.jsx` | shape/text pin داخل AE | احتفاظ؛ contracts وحدود strings/numbers |
| `host/modules/trajectoryScanner.jsx` | sampling وkeyframe creation | adaptive sampler وإزالة سقف frame الخام |
| `host/modules/vectorHost.jsx` | إنشاء shape/text من payload محلي | Host validation وbudget قبل mutation |
| `scripts/baseline-manifest.js` | baseline hashes | دمجه في artifact/data manifest الرسمي |
| `scripts/build.js` | نسخ source إلى stage | يصبح build artifact الوحيد ويكتب manifest |
| `scripts/build-land-border-data.js` | بناء outlines/index/policy profile | احتفاظ؛ policy/provenance/golden validation |
| `scripts/build-vector-data.js` | بناء طبقات preview 50m/10m | إخراج chunks/index deterministic |
| `scripts/sync-versions.js` | package→manifest version | تشغيله قبل build وتوسيع version contracts |
| `scripts/test.js` | smoke/static/بعض التنفيذ | تقسيمه إلى test suites؛ إبقاء guards المناسبة فقط |
| `scripts/verify-package.js` | فحص الروابط والبنية | توسيع content/hash/forbidden legacy checks |
| `scripts/verify-release.js` | orchestration لبوابة الإصدار | ترتيب جديد وبناء كل البيانات/lint/tests/SBOM |
| `scripts/zxp.js` | توقيع/تعبئة ZXP | يقرأ artifact الواحد؛ production cert policy |

---

## 18. المراجع المنهجية

- [ISO/IEC 25010:2023 — Product quality model](https://www.iso.org/standard/78176.html)
- [OWASP Threat Modeling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html)
- [Adobe CEP Resources](https://github.com/Adobe-CEP/CEP-Resources)
- [Adobe CEP 12 HTML Extension Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md)
