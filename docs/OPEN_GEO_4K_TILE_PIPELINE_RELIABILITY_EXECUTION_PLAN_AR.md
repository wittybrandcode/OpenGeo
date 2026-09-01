# خطة موثوقية مسار البلاطات ودعم 4K ونظام تتبع التنفيذ

**المنتج:** OpenGeo for Adobe After Effects  
**الإصدار المستهدف:** v1.0  
**إصدار الوثيقة:** 1.1<br>
**تاريخ الإنشاء:** 22 أغسطس 2026  
**آخر مراجعة:** 1 سبتمبر 2026<br>
**الحالة:** T-1 مكتملة؛ جاهزة لتنفيذ T0 ولا يبدأ تعديل إنتاجي قبل بناء اختبارات الفشل<br>
**النطاق:** Preview داخل اللوحة، Live Sync، Path Preview، Finalize، MegaTile، وكامل عقد الإدخال إلى After Effects  
**خارج النطاق:** إنشاء ZXP، التوقيع، إعادة تصميم الواجهة، وتغيير مصادر الخرائط أو السياسة الكارتوغرافية  
**خط الأساس الآلي الحالي:** `npm test` — ‏140/140 ناجحة في 1 سبتمبر 2026 على commit `bc285bd`<br>
**الانحدار السابق للتنفيذ:** BASE-001 مغلق؛ ثُبت أن `revision = 0` Host sentinel وليس عضواً في الساعة الدائرية<br>
**خط الأساس المعتمد لـT0:** ‏140/140 ناجحة، والاختبار المعزول `npm run test:ae-sync-camera` ناجح

---

## 1. القرار التنفيذي

تهدف هذه الخطة إلى ضمان أن كل كادر يصل إلى After Effects يملك تغطية بلاطات مثبتة وكاملة، بصرف النظر عن دقة الـComposition أو جودة Finalize أو ضعف الشبكة أو فشل فك صورة منفردة.

العقد غير القابل للتفاوض ليس تساوي أعداد فقط، بل تساوي هويات وتغطية مثبتة:

```text
Coverage samples reference only planned placementKeys
        AND Set(planned downloadKeys) = Set(completed-or-valid-cached downloadKeys)
        AND Set(planned placementKeys) = Set(expanded placementKeys)
        AND Set(expected stitch cells) = Set(decoded stitch cells)
        AND Set(stitched asset IDs) = Set(prepared AE asset IDs)
        AND Set(prepared AE asset IDs) = Set(committed AE asset IDs)
        AND duplicate/unexpected identities = 0
```

إذا لم يتحقق التطابق في أي مرحلة:

1. لا تُفعّل المراجعة الجديدة.
2. تبقى آخر مراجعة سليمة ظاهرة داخل AE.
3. يُلغى الناتج الجزئي ويُنظّف بأمان.
4. تُسجّل أرقام المرحلة والفشل بصورة قابلة للتشخيص.
5. لا تظهر رسالة نجاح زائفة.

تُقارن المجموعات بعد فرز canonical، وتُرفض الهوية المكررة أو غير المتوقعة حتى عندما تتساوى الأعداد. كل `CoverageSample` يحتفظ بقائمة `requiredPlacementKeys` الخاصة به، ولذلك لا يمكن لاتحاد المسار أن يبدو كاملاً بينما تفقد عينة زمنية بعينها بلاطة لازمة.

لا تغيّر هذه الخطة عقد **Live Sync** الحالي: تبقى خدمة خلفية إلزامية دائماً، ولا يضاف زر لتفعيلها أو تعطيلها.

---

## 2. ملخص التشخيص الذي تبنى عليه الخطة

| المعرّف | الخلل | الخطورة | الأثر المحتمل |
|---|---|---:|---|
| TILE-001 | Live Sync وPath Preview يصفّيان النتائج الفاشلة ثم يتابعان بالبلاطات الناجحة فقط | P0 | فراغات داخل الكادر مع نتيجة تبدو ناجحة |
| TILE-002 | تحقق Finalize يقبل `decodedCount < expectedCount` ما دام العدد أكبر من صفر | P0 | MegaTile ناقصة داخل Final نهائي |
| TILE-003 | فشل قراءة ملف قبل إرساله إلى Worker يُبتلع، ثم يُعاد تعريف العدد المتوقع بعدد الملفات المقروءة فقط | P0 | فقد بلاطات غير مرئي لنظام التحقق |
| TILE-004 | ملف MegaTile في الكاش يُقبل اعتماداً على الحجم `> 1000` بايت فقط | P0 | إعادة استخدام صورة جزئية أو تالفة |
| TILE-005 | `wrappedX` مستخدم لهوية التنزيل ولهوية الموضع معاً داخل `TilePlanner` | P0 | انهيار مواضع العالم المتكررة في 4K وZoom منخفض |
| TILE-006 | بلاطة Preview الفاشلة لا تُعاد جدولتها ما دامت خانتها مرئية | P1 | بقاء خانة ناقصة حتى تغيير المشهد |
| TILE-007 | 4K Ultra يمكن أن يولّد آلاف البلاطات لكل عينة زمنية بلا تقدير تكلفة واضح قبل البدء | P1 | ضغط شبكة وذاكرة وقرص وزمن Finalize طويل |
| TILE-008 | سجل العمليات لا يحتوي أعداد plan/download/decode/stitch/import التفصيلية | P1 | صعوبة تحديد موضع الفشل من جهاز المستخدم |
| TILE-009 | الاختبارات الحالية لا تحقن فقداً فعلياً بين التنزيل والـWorker والكاش وAE | P1 | قد تنجح suite التقليدية كاملة مع بقاء فجوات سلوكية حرجة |

### 2.1 مانع ما قبل التنفيذ المغلق في 1 سبتمبر 2026

| المعرّف | الخلل | التصنيف | القرار |
|---|---|---|---|
| BASE-001 | كان اختبار رفض stale AE camera poll يفشل حسب موضع revision clock من المجال الدائري | Release gate مستقل عن البلاطات | ✅ مغلق في `bc285bd`: الصفر Host sentinel؛ isolated PASS و140/140 |

### 2.2 ما ليس سبباً أساسياً مثبتاً

- لم يظهر تلف في بنية عينة آخر 5000 ملف JPEG في الكاش الحالي.
- أحدث ملفات MegaTile المفحوصة تحمل أبعاد 512/1024/2048 الصحيحة.
- الخلايا الشفافة في أحدث الملفات منتظمة عند حواف التغطية، وقد تكون فراغات مقصودة خارج المسح.
- بروتوكول الاستيراد الذري في Host يرفض اختلاف عدد الأصول التي استلمها؛ المشكلة الأساسية أن العميل قد يحذف بلاطات من الـmanifest قبل وصوله إلى Host.

---

## 3. قواعد الحالة ونظام التتبع

### 3.1 رموز الحالة

| الرمز | الحالة | قاعدة الاستخدام |
|---|---|---|
| ⬜ | لم يبدأ | لا يوجد تعديل تنفيذي أو اختبار جديد |
| 🟦 | قيد التنفيذ | بدأ تعديل محدود وله مالك ونطاق واضحان |
| 🟨 | بانتظار اختبار AE | اكتمل الكود والاختبار الآلي وبقي اعتماد يدوي |
| ✅ | مكتمل ومعتمد | الكود والمراجعة والاختبارات الآلية واليدوية المطلوبة ناجحة |
| ⛔ | محجوب | يوجد مانع موثق لا يمكن تجاوزه داخل النطاق الحالي |
| ↩️ | متراجع عنه | أُعيدت المرحلة إلى خط الأساس مع توثيق السبب |

### 3.2 قاعدة حساب التقدم

- وزن الخطة الكامل: **100 نقطة**.
- T-1 بوابة إلزامية وزنها صفر؛ لا تعطي تقدماً لكنها تمنع بدء كود الإنتاج.
- الأوزان في لوحة المتابعة أوزان مراحل، وليست أوزان مهام منفردة.
- لا تُحتسب نقاط المرحلة إلا بعد وصول المرحلة كلها إلى ✅.
- المرحلة 🟨 لا تدخل في نسبة الإنجاز المعتمد، لكنها تدخل في نسبة «المنفذ برمجياً».
- يُتابع تقدم المهام بعدّ checkboxes بصورة مستقلة، ولا يحل محل اعتماد المرحلة.
- يُحدّث تاريخ آخر تحقق والدليل عند كل انتقال حالة.

```text
نسبة الإنجاز المعتمد = مجموع أوزان المراحل ✅ ÷ 100
نسبة التنفيذ البرمجي = مجموع أوزان المراحل ✅ و🟨 ÷ 100
نسبة إنجاز المهام = checkboxes المكتملة ÷ إجمالي checkboxes التنفيذية
```

### 3.3 لوحة التقدم الرئيسية

| المرحلة | الاسم | المهام | الوزن | الحالة | الاعتماد | الناتج الحاسم |
|---|---|---:|---:|---|---|---|
| T-1 | استعادة خط أساس أخضر | 6 | 0 | ✅ | — | 140/140 واختبار معزول موثق |
| T0 | اختبارات إعادة إنتاج أعطال مسار البلاطات | 11 | 8 | ⬜ | T-1 | اختبارات تفشل على السلوك القديم |
| T1 | عقد الهوية: Download مقابل Placement | 9 | 15 | ⬜ | T0 | تنزيل واحد مع مواضع عرض كاملة |
| T2 | بوابة اكتمال التنزيل لكل العمليات | 11 | 18 | ⬜ | T0, T1 | لا commit لأي plan ناقصة |
| T3 | استرداد بلاطات Preview وإدارة retries | 6 | 8 | ⬜ | T2؛ تنفذ بعد T5 | إعادة محاولة مضبوطة بلا حلقة لا نهائية |
| T4 | سلامة MegaTile والـWorker والكاش | 13 | 20 | ⬜ | T0, T2 | لا صورة جزئية ولا cache trust أعمى |
| T5 | تشديد Finalize والمعاملة الذرية | 8 | 10 | ⬜ | T2, T4 | Finalize كامل أو لا تغيير |
| T6 | ميزانية 4K والجودة والأداء | 11 | 8 | ⬜ | T1, T2, T4 | تقدير مسبق وحماية من الأحمال غير المعقولة |
| T7 | الرصد التشغيلي والتشخيص | 9 | 5 | ⬜ | T2, T4 | سجل رقمي يحدد نقطة الفشل |
| T8 | بوابات الجودة واعتماد After Effects | 14 | 8 | ⬜ | T1–T7 | قبول نهائي يمنع رجوع العيب |
| **الإجمالي** |  | **98** | **100** | **0% معتمد / 0% برمجي** |  |  |

### 3.4 ملخص الحالة الحالي

| المؤشر | القيمة الحالية |
|---|---:|
| بوابات ما قبل التنفيذ المكتملة | 1/1 |
| المراحل الموزونة المكتملة ✅ | 0/9 |
| المراحل المنفذة برمجياً ✅ + 🟨 | 0/9 |
| المهام التنفيذية المكتملة | 6/98 |
| شروط Definition of Done المكتملة | 0/18 |
| النقاط المعتمدة | 0/100 |
| اختبارات الخط الأساسي | 140/140 ناجحة على `bc285bd` |
| اختبارات regression الجديدة | 0 |
| اختبارات AE الجديدة المعتمدة | 0 |
| الموانع | لا يوجد؛ T0 متاحة |

---

## 4. البنية المستهدفة لمسار البلاطات

```text
CoveragePlanner
  ├─ CoverageSample[]
  │    └─ requiredPlacementKeys[]
  └─ unique PlacementPlan[]
       ├─ placementKey = tileMatrix/sourceTileSize/z/unwrappedX/y
       └─ downloadKey  = providerSignature/tileMatrix/sourceTileSize/z/wrappedX/y
                 │
                 ▼
        DownloadCoordinator
       unique DownloadRequest[]
                 │
        complete-result gate
                 │
                 ▼
        PlacementExpander
  DownloadAsset + PlacementPlan[]
                 │
                 ▼
         MegaTileAssembler
 manifest + exact expected cells
                 │
       decode/hash/dimension gate
                 │
                 ▼
       AE staged import + commit
                 │
       exact import/promotion gate
                 ▼
          visible revision
```

### 4.1 أنواع البيانات المستهدفة

```js
CoverageSample {
  sampleId,
  time,
  camera,
  requiredPlacementKeys
}

PlacementPlan {
  placementKey,
  downloadKey,
  tileMatrix,
  sourceTileSize,
  z,
  x,          // unwrapped world placement
  wrappedX,   // network/cache coordinate
  y,
  url
}

DownloadResult {
  downloadKey,
  status,     // complete | cached | failed | cancelled
  filePath,
  attempts,
  errorCode,
  responseBytes
}

CoverageResult {
  samples,
  plannedPlacements,
  uniqueDownloads,
  completedDownloads,
  failedDownloads,
  expandedPlacements,
  missingDownloadKeys,
  missingPlacementKeys,
  unexpectedDownloadKeys,
  duplicatePlacementKeys,
  uncoveredSampleIds
}

StitchManifest {
  schemaVersion,
  providerSignature,
  operationId,
  outputPath,
  width,
  height,
  sourceTileSize,
  expectedCells,
  decodedCells,
  coverageMask,
  childIdentities,
  outputSha256
}
```

### 4.2 قواعد canonical identity والمقارنة

1. `providerSignature` بصمة غير سرية تشمل تعريف المزود وقالب المصدر المنقح، ولا تحتوي URL محلولاً أو API key.
2. `tileMatrix` معرف صريح لنظام Web Mercator/XYZ وإصداره، لمنع تصادم مصادر تستخدم إحداثيات متشابهة بعقود مختلفة.
3. `downloadKey` يعرّف مورداً شبكياً/محلياً واحداً ويمكنه خدمة عدة مواضع.
4. `placementKey` يعرّف خلية عرض واحدة باستخدام `unwrappedX`، ولا يُستبدل بـ`wrappedX`.
5. `CoverageSample.requiredPlacementKeys` يثبت اكتمال كل عينة زمنية، لا اكتمال اتحاد المسار فقط.
6. تُبنى المفاتيح بواسطة دوال مركزية؛ يمنع تركيبها كسلاسل ad-hoc خارج `TileAddress`.
7. الاسم القديم `tile.key` يصبح alias انتقالياً للقراءة فقط ثم يحذف؛ يمنع استعماله في dedup أو coverage gate جديدة.

---

## 5. خطة التنفيذ التفصيلية

## T-1 — استعادة خط الأساس الأخضر

**الهدف:** منع خلط انحدار سابق في مزامنة الكاميرا مع نتائج إصلاح مسار البلاطات.

**الوزن:** 0 نقاط — بوابة إلزامية<br>
**الحالة:** ✅ مكتمل ومعتمد<br>
**الاعتماد:** لا يوجد

### المهام

- [x] **T-1-01:** تشغيل full suite وتثبيت BASE-001 وتسجيل الأمر والنتيجة.
- [x] **T-1-02:** إعادة إنتاج BASE-001 منفرداً وعزله عن ترتيب الاختبارات والحالة المشتركة.
- [x] **T-1-03:** تحديد هل الفشل عيب إنتاج أم اختباراً قديماً لا يطابق العقد الحالي.
- [x] **T-1-04:** إصلاح السبب بأصغر تغيير مستقل، أو تسجيل استثناء مؤقت بمالك وتاريخ انتهاء ومبرر عدم علاقته بالبلاطات.
- [x] **T-1-05:** تشغيل `npm test` والوصول إلى 140/140 قبل فتح تعديل إنتاجي في T0–T7.
- [x] **T-1-06:** إنشاء baseline artifact يتضمن commit SHA وNode/CEP contract وتاريخ التشغيل.

### معيار القبول

- `npm test` ناجح بالكامل، أو استثناء BASE-001 مكتوب ينتهي قبل بوابة T8.
- لا يُعدل مسار البلاطات ضمن commit إصلاح BASE-001.
- يوجد دليل قابل لإعادة التشغيل، لا نتيجة مكتوبة يدوياً فقط.

### دليل التنفيذ

| التاريخ | Commit | الأمر | النتيجة | الاستثناء/الملاحظات |
|---|---|---|---|---|
| 1 سبتمبر 2026 | `a246a5f` | `npm test` | 139/140؛ BASE-001 فشل | يمنع baseline خضراء |
| 1 سبتمبر 2026 | working tree قبل الإصلاح | `npm run test:ae-sync-camera` | FAIL حتمي عند revision clock بعد نصف المجال | أثبت أن الفشل مستقل عن ترتيب suite |
| 1 سبتمبر 2026 | `bc285bd` | `npm run test:ae-sync-camera` | PASS | لا استثناءات |
| 1 سبتمبر 2026 | `bc285bd` | `npm test` | 140/140؛ exit 0 | baseline خضراء؛ T0 متاحة |

### Baseline artifact المعتمد

```text
stageId: T-1
commitSha: bc285bd
node: v22.18.0
extension: 1.0.0
hostContract: AEFT 18.4–24.99
cepContract: CSXS 11.0
isolatedCommand: npm run test:ae-sync-camera
isolatedResult: PASS
fullCommand: npm test
fullResult: 140 passed / 0 failed
tilePipelineFilesChanged: 0
waivers: none
```

## T0 — تثبيت خط الأساس واختبارات إعادة إنتاج الفشل

**الهدف:** تحويل كل خلل مكتشف إلى اختبار سلوكي يفشل قبل الإصلاح.

**الوزن:** 8 نقاط  
**الحالة:** ⬜ لم يبدأ<br>
**الاعتماد:** T-1

### المهام

- [ ] **T0-01:** إضافة fixture لخطة تنزيل جزئية: 30 مخططة، 29 ناجحة، وواحدة فاشلة.
- [ ] **T0-02:** إضافة fixture لفشل قراءة ملف واحد قبل إرساله إلى Worker.
- [ ] **T0-03:** إضافة fixture لفشل فك خلية واحدة من 64 داخل MegaTile.
- [ ] **T0-04:** إضافة ملف cache أكبر من 1000 بايت لكنه ناقص/غير مطابق للـmanifest.
- [ ] **T0-05:** إضافة حالة 4K منخفضة التكبير تحتاج عنوان تنزيل واحداً في موضعين أو أكثر.
- [ ] **T0-06:** تسجيل نتائج الاختبارات القديمة والجديدة قبل أي تعديل إنتاجي.
- [ ] **T0-07:** إضافة fixture لاتحاد مسار يبدو كاملاً بينما تفقد عينة زمنية واحدة placement لازمة.
- [ ] **T0-08:** إضافة fixture لعدادات تشغيلية ناقصة أو متناقضة تثبت TILE-008.
- [ ] **T0-09:** إضافة اختبار ميزانية 4K يثبت عدم وجود preflight كافٍ قبل الشبكة.
- [ ] **T0-10:** إضافة Host fixture يعيد expected/imported متساويين عددياً مع asset ID خاطئ.
- [ ] **T0-11:** حفظ golden manifests ونتائج failure oracle تحت `scripts/fixtures/tile-pipeline/`.

### الاختبارات المطلوبة

| ID | السيناريو | النتيجة المطلوبة قبل الإصلاح |
|---|---|---|
| FI-01 | فشل 1/30 في Live Sync | الاختبار يثبت أن المسار القديم كان يحاول الاستمرار |
| FI-02 | فشل 1/30 في Path Preview | الاختبار يثبت ضياع البلاطة قبل التجميع |
| FI-03 | Worker يستلم 63/64 | الاختبار يثبت تغير `expectedCount` خطأً |
| FI-04 | Cached MegaTile ناقصة | الاختبار يثبت قبولها بالحجم فقط |
| FI-05 | موضعان بنفس `wrappedX` | الاختبار يثبت انهيار أحد موضعي العرض |
| FI-06 | Preview tile تفشل وتظل مرئية | الاختبار يثبت عدم إعادة جدولتها |
| FI-07 | عينة مسار تفقد placement لكن الاتحاد كامل | الاختبار يثبت أن مقارنة الاتحاد أو العدد وحدها تخفي العيب |
| FI-08 | نتائج متساوية العدد بهوية مكررة/غير متوقعة | الاختبار يثبت ضرورة exact-set gate |
| FI-09 | 4K Ultra يتجاوز soft budget | الاختبار يثبت بدء الشبكة دون preflight واضح |
| FI-10 | Host يعيد asset ID غير متوقع | الاختبار يثبت أن expected/imported count وحده لا يكفي |

### معيار القبول

- توجد اختبارات سلوكية قابلة للتكرار لكل TILE-001…009.
- تفشل الاختبارات الجديدة للأسباب المتوقعة، لا بسبب خطأ في fixture.
- تبقى اختبارات الخط الأساسي خضراء بعد كل fixture؛ الاختبارات الجديدة وحدها هي التي تفشل قبل الإصلاح.
- لكل اختبار failure oracle يحدد code والمرحلة والهويات الناقصة المتوقعة.

### دليل التنفيذ

| التاريخ | الدليل | النتيجة | الملاحظات |
|---|---|---|---|
| — | — | — | — |

---

## T1 — فصل هوية التنزيل عن هوية الموضع

**الهدف:** منع فقد مواضع العالم المتكررة، خصوصاً في 4K وZoom منخفض، مع عدم تنزيل المورد نفسه أكثر من مرة.

**الوزن:** 15 نقطة  
**الحالة:** ⬜ لم يبدأ  
**الاعتماد:** T-1, T0

### المهام

- [ ] **T1-01:** تعريف `downloadKey` من `providerSignature/tileMatrix/sourceTileSize/z/wrappedX/y`.
- [ ] **T1-02:** تعريف `placementKey` من `tileMatrix/sourceTileSize/z/unwrappedX/y`.
- [ ] **T1-03:** تعديل `TilePlanner` ليزيل تكرار طلبات الشبكة دون إزالة مواضع العرض.
- [ ] **T1-04:** إضافة مرحلة `PlacementExpander` تربط الأصل المحلي بكل مواضعه.
- [ ] **T1-05:** التأكد من أن `MegaTileStitcher` يجمع حسب `x` غير الملفوف للتموضع.
- [ ] **T1-06:** توحيد العقد بين Preview وPath Preview وFinalize.
- [ ] **T1-07:** منع استخدام `tile.key` الغامض في أي قرار لا يحدد نوع الهوية صراحة.
- [ ] **T1-08:** إنشاء `CoverageSample` لكل إطار/عينة مع `requiredPlacementKeys` قابلة للتحقق.
- [ ] **T1-09:** إضافة migration adapter مؤقت للعقود القديمة مع تحذير اختبار إذا استُخدم `tile.key` في مسار جديد.

### الملفات المتوقعة

- `client/js/tiles/TileAddress.js`
- `client/js/engine/TilePlanner.js`
- `client/js/engine/DownloadSession.js`
- `client/js/core/SyncManager.js`
- `client/js/core/FinalizeController.js`
- `client/js/engine/MegaTileStitcher.js`

### معايير القبول

- طلب شبكة واحد يمكن أن يغذي N مواضع عرض.
- كل عينة زمنية تثبت تغطيتها منفردة، لا من اتحاد البلاطات فقط.
- لا تظهر جوانب سوداء بسبب انهيار `wrappedX` عند Zoom 2–4.
- عبور خط 180° لا يضاعف التنزيل ولا يرسم المسار في الجهة الخاطئة.
- لا يتغير تموضع الحالات العادية التي لا تعبر العالم.

---

## T2 — بوابة اكتمال التنزيل

**الهدف:** جعل كل مسار fail-closed؛ لا يصل إلى التجميع إلا plan مثبتة الاكتمال.

**الوزن:** 18 نقطة  
**الحالة:** ⬜ لم يبدأ  
**الاعتماد:** T0, T1

### المهام

- [ ] **T2-01:** إرجاع نتيجة تنزيل موحدة تحتوي المخطط والناجح والمخزن والفاشل والملغى.
- [ ] **T2-02:** إضافة `assertCompleteCoverage(plan, results)` بمقارنة هويات التنزيل وهويات التموضع.
- [ ] **T2-03:** تطبيق البوابة على Live Sync قبل `_packPreviewTiles`.
- [ ] **T2-04:** تطبيق البوابة على Path Preview قبل `_packPreviewTiles`.
- [ ] **T2-05:** جعل Finalize يستخدم العقد نفسه بدلاً من منطق بحث متفرق.
- [ ] **T2-06:** عند الفشل، الاحتفاظ بالـPreview/Final revision السابقة دون أي Host mutation.
- [ ] **T2-07:** إنتاج خطأ typed يضم العدد والمفاتيح المفقودة دون تسريب URL أو API key.
- [ ] **T2-08:** منع رسالة النجاح إن كان `failedDownloads > 0` أو `missingPlacements > 0`.
- [ ] **T2-09:** رفض duplicate/unexpected identities حتى مع تساوي الأعداد.
- [ ] **T2-10:** فحص كل `CoverageSample.requiredPlacementKeys` وإخراج `uncoveredSampleIds`.
- [ ] **T2-11:** جعل البوابة pure function بلا DOM أو filesystem أو AE، واختبارها property-based.

### سياسة النتيجة

| العملية | عند نقص بلاطة | ما يبقى مرئياً | الرسالة |
|---|---|---|---|
| Panel Preview | إعادة محاولة محدودة ثم fallback بصري مؤقت | البلاطات السابقة/Parent fallback | تحذير غير معطل |
| Live Sync | إلغاء الجيل الجديد | آخر Preview سليمة | تعذر تحديث بعض البلاطات |
| Path Preview | تخطي الجيل الناقص | آخر Path Preview سليمة | Path Preview غير مكتملة |
| Finalize | إيقاف قبل prepare | آخر Final سليمة | Finalize تتطلب تغطية كاملة |

### معايير القبول

- فشل 1 من 100 يعني صفر استدعاءات `composition.build` لذلك الجيل.
- لا تُحذف المعاينة القديمة عند فشل الجديدة.
- `completed + cached === uniqueDownloads` شرط إلزامي.
- `expandedPlacements === plannedPlacements` شرط إلزامي مستقل.
- تطابق المجموعات canonical شرط إلزامي؛ لا يُستدل على الصحة من العدد فقط.
- `uncoveredSampleIds.length === 0` شرط مستقل لمسارات الحركة.

---

## T3 — استرداد بلاطات Panel Preview

**الهدف:** ألا تبقى بلاطة مرئية في حالة Error بصورة دائمة بعد فشل عابر.

**الوزن:** 8 نقاط  
**الحالة:** ⬜ لم يبدأ  
**الاعتماد التقني:** T2<br>
**ترتيب الإصدار:** بعد إغلاق T4 وT5 لأن منع الناتج النهائي الجزئي أعلى أولوية من تحسين retry المرئي

### المهام

- [ ] **T3-01:** إضافة حالات `idle/queued/loading/loaded/retry-wait/error-final` لكل بلاطة.
- [ ] **T3-02:** إعادة جدولة البلاطة المرئية بعد backoff إذا لم تُلغَ أو يتغير المزود.
- [ ] **T3-03:** اعتماد backoff مع jitter وحد أقصى واضح للمحاولات.
- [ ] **T3-04:** إبقاء Parent fallback أو آخر bitmap صالح أثناء الانتظار.
- [ ] **T3-05:** منع `tiles:allLoaded` من التعبير عن اكتمال ناجح إذا كانت النتيجة settled مع أخطاء.
- [ ] **T3-06:** إلغاء retry timers في `cancelTile/reset/dispose`.

### السياسة الافتراضية المقترحة

```text
Panel Preview: 3 محاولات إجمالية
الفواصل: 300ms → 900ms → 2200ms مع jitter
لا إعادة لا نهائية
إعادة فتح الميزانية عند تغير الشبكة أو مغادرة البلاطة ثم عودتها
```

### معايير القبول

- فشل عابر واحد يتعافى دون تحريك الخريطة.
- فشل دائم لا يسبب loop أو تسريب timers.
- تبديل المزود يلغي كل محاولات المزود القديم.
- الواجهة تبقى قابلة للسحب والتكبير أثناء الانتظار.

---

## T4 — سلامة MegaTile والـWorker والكاش

**الهدف:** جعل MegaTile ناتجاً موثقاً لا يُكتب ولا يُعاد استخدامه إلا إذا كان كاملاً ومطابقاً.

**الوزن:** 20 نقطة  
**الحالة:** ⬜ لم يبدأ  
**الاعتماد:** T0, T2

### قرار استراتيجية التخزين

| نوع الأصل | العمر | إعادة الاستخدام | قاعدة الثقة |
|---|---|---|---|
| Child download tile | كاش مزود مستقل | نعم | namespace المزود + ترويسة صورة صحيحة + حدود الحجم، ثم decode عند الاستعمال |
| Preview MegaTile | مشتقة قابلة لإعادة الاستخدام | نعم، لتوقيع children مطابق فقط | canonical manifest + أبعاد + bytes + SHA-256 + exact cells |
| Finalize MegaTile | داخل Revision فريدة | لا بين العمليات | تُبنى وتتحقق لهذه Revision ثم تُعتمد؛ وجود ملف سابق في المسار نفسه يعد تعارضاً لا cache hit |

لا يُستخدم `operationId` ضمن مفتاح كاش قابل لإعادة الاستخدام؛ يستخدم فقط للملكية والتشخيص. أما `cacheSignature` فيُبنى من نسخة schema والمزود وحجم المصدر وقائمة child identities مرتبة وبصماتها.

### المهام

- [ ] **T4-01:** تمرير `originalExpectedCount` و`expectedCells` إلى Worker قبل قراءة الملفات.
- [ ] **T4-02:** تحويل فشل قراءة أي child إلى نتيجة فشل صريحة، لا `continue` صامتة.
- [ ] **T4-03:** رفض Worker للناتج إذا `decodedCount !== originalExpectedCount`.
- [ ] **T4-04:** عدم كتابة PNG جزئية، أو حذفها فور اكتشاف عدم التطابق.
- [ ] **T4-05:** اعتماد كتابة ذرية: ملف مؤقت ثم rename بعد اكتمال التحقق.
- [ ] **T4-06:** إنشاء sidecar manifest لكل MegaTile.
- [ ] **T4-07:** التحقق من أبعاد PNG وhash والـcoverage mask قبل cache hit.
- [ ] **T4-08:** إعادة البناء إذا غاب الـmanifest أو خالف الملف، وعدم الثقة بالحجم وحده.
- [ ] **T4-09:** توحيد قواعد Worker وfallback القديم بحيث يعطيان النتيجة نفسها.
- [ ] **T4-10:** ضمان cleanup للملف المؤقت والـmanifest عند الإلغاء أو supersede.
- [ ] **T4-11:** فصل مسار Preview cache القابل للتحقق عن Finalize revision artifacts غير القابلة لإعادة الاستخدام.
- [ ] **T4-12:** نشر زوج PNG/manifest ذرياً عبر أسماء مؤقتة فريدة، والتحقق بعد rename قبل إتاحته للقارئ.
- [ ] **T4-13:** منع مسارين متوازيين من الكتابة إلى مفتاح مشتق واحد باستخدام single-flight أو lock file محدود العمر.

### عقد manifest الإلزامي

- `schemaVersion`
- `providerSignature`
- `operationId` للملكية والتشخيص، أو `cacheSignature` لإعادة الاستخدام، وفق نوع الأصل
- `tileMatrix`, `sourceTileSize`, `stitchAlgorithmVersion`
- `width`, `height`, `sourceTileSize`
- `expectedCells[]`
- `decodedCells[]`
- `coverageMask[]`
- `childIdentities[]`
- `outputBytes`
- `outputSha256`

### canonical manifest والنشر الذري

- ترميز JSON هو UTF-8، والمفاتيح مرتبة، والأرقام integers حيث يلزم، ولا توجد مسارات مؤقتة أو URLs أو أسرار ضمن مادة التوقيع.
- يُحسب `outputSha256` بعد اكتمال PNG، وتُقرأ أبعاد PNG من الملف الناتج لا من القيم المطلوبة فقط.
- ترتيب النشر: كتابة PNG مؤقتة ← fsync/close ← hash/dimension validation ← كتابة manifest مؤقتة ← rename PNG ← rename manifest كإشارة الجاهزية الأخيرة.
- عند startup أو cleanup، تزال الملفات المؤقتة القديمة والـlock اليتيم بعد TTL موثق، ولا تحذف أي Revision committed.

### معايير القبول

- 63/64 خلية تُرفض في Worker وفي fallback.
- ملف ناقص أكبر من 1000 بايت لا يُعتبر cache hit.
- إعادة تشغيل نفس العملية لا تستطيع إحياء ناتج جزئي سابق.
- لا توجد PNG مؤقتة أو manifests يتيمة بعد cancel.
- Finalize لا تسجل cache hit على MegaTile من Revision أخرى.
- عمليتان متوازيتان لنفس Preview signature تنتجان أصلاً واحداً صالحاً أو تنتظر إحداهما الأخرى، ولا تتسابقان على الملف.

---

## T5 — تشديد Finalize والمعاملة الذرية

**الهدف:** Finalize إما كاملة ومثبتة أو لا تغيّر شيئاً داخل المشروع.

**الوزن:** 10 نقاط  
**الحالة:** ⬜ لم يبدأ  
**الاعتماد:** T2, T4

### المهام

- [ ] **T5-01:** استبدال تحقق التغطية بشرط المطابقة الصارمة `decodedCount === expectedCount`.
- [ ] **T5-02:** فحص manifest لكل MegaTile قبل `composition.prepare`.
- [ ] **T5-03:** تضمين `plannedPlacements/stitchedAssets` في payload للتحقق من الاتساق.
- [ ] **T5-04:** إبقاء final-active القديم حتى نجاح prepare وcommit بالكامل.
- [ ] **T5-05:** rollback وحذف revision directory عند كل فشل قبل commit.
- [ ] **T5-06:** منع cleanup للمراجعة السابقة قبل تأكيد `commitState: committed`.
- [ ] **T5-07:** تمرير asset IDs canonical إلى Host ومقارنة exact sets في prepare وcommit، لا الأعداد فقط.
- [ ] **T5-08:** جعل rollback idempotent ومقيداً بـ`documentId/revisionId` مع نتيجة typed قابلة للمصالحة.

### معايير القبول

- لا توجد حالة ينجح فيها Finalize مع خلية مفقودة.
- فشل التحميل أو الفك أو الكتابة أو import يبقي Final السابق كما هو.
- مجموعة asset IDs المعدة والمثبتة تطابق manifest تماماً، بلا مكرر أو أصل غير متوقع.
- Undo واحد منطقي لمرحلة commit ولا توجد طبقات staging مرئية.

---

## T6 — ميزانية 4K والجودة والأداء

**الهدف:** حماية المستخدم من تكلفة غير متوقعة دون تخفيض الجودة بصمت.

**الوزن:** 8 نقاط  
**الحالة:** ⬜ لم يبدأ  
**الاعتماد:** T1, T2, T4

### المهام

- [ ] **T6-01:** حساب `coverage samples`, `planned placements`, `unique downloads`, `cache hits/misses` و`stitch groups` قبل بدء Finalize.
- [ ] **T6-02:** عرض تقدير واضح عند حمل كبير: cache misses، نطاق الحجم المتوقع، الذاكرة القصوى، والجودة المختارة.
- [ ] **T6-03:** إبقاء اختيار المستخدم؛ لا downgrade صامت من Ultra إلى High أو Normal.
- [ ] **T6-04:** إزالة `selected` الافتراضي عن Ultra واعتماد Normal للجلسات الجديدة وخصوصاً 4K، مع حفظ أي اختيار صريح للمستخدم دون تغييره.
- [ ] **T6-05:** وضع حدود منفصلة للتحميل والمواضع وMegaTiles بدلاً من حد واحد غامض.
- [ ] **T6-06:** قياس ذاكرة 2048px و4096px MegaTiles، خصوصاً مع مصادر 512px.
- [ ] **T6-07:** إضافة backpressure للتجميع لمنع تراكم ArrayBuffers وImageBitmaps.
- [ ] **T6-08:** الاستجابة لـHTTP 429/503 بتخفيض concurrency مؤقتاً واحترام retry policy.
- [ ] **T6-09:** جعل `config/performance-budgets.json` مصدر الحقيقة الوحيد للحدود والتحذيرات، ومنع الأرقام المكررة داخل Controllers.
- [ ] **T6-10:** معايرة تقدير bytes من median/p90 لملفات كاش المزود نفسه، مع fallback محافظ عندما لا توجد عينة.
- [ ] **T6-11:** تسجيل p50/p95 للزمن والذاكرة وevent-loop delay لمصفوفة 256px/512px قبل اعتماد الحدود.

### ميزانية أولية للمراجعة

| النمط | كثافة تقريبية لكل كادر 4K من مصدر 256px | السياسة |
|---|---:|---|
| Draft Live Sync | 25–40 بلاطة | تلقائي وخلفي |
| Finalize Normal | نحو 180–230 بلاطة | الموصى به لـ4K |
| Finalize High | نحو 700–900 بلاطة | تحذير عند مسار طويل |
| Finalize Ultra | نحو 2200–2500 بلاطة | تأكيد تكلفة قبل البدء |

الأرقام أمثلة تفسيرية فقط، وليست منطق قرار. تختلف حسب حجم بلاطة المصدر وZoom وخط العرض والـgutter ونسبة الأبعاد وتداخل عينات الحركة؛ تعرض الواجهة الأرقام الحقيقية المحسوبة للخطة الحالية.

### حدود تشغيل أولية قابلة للمعايرة

| البعد | Soft gate | Hard gate | السلوك |
|---|---:|---:|---|
| Unique download cache misses | 2500 | 20000 | تحذير/تأكيد ثم رفض فوق hard gate |
| Stitched AE assets | 1000 | 5000 | تحذير ثم رفض قبل `prepare` |
| Estimated network bytes | 512 MiB | 2 GiB | تحذير ثم رفض أو طلب خفض النطاق/الجودة |
| Live decoded RGBA bytes | 192 MiB | 256 MiB | backpressure؛ لا تجاوز صامت |
| 4096px stitch jobs | 1 active | 1 active | single-flight دائماً |

تثبت القيم النهائية بعد benchmark على بيئة CEP/AE المستهدفة، وتُسجل في `performance-budgets.json` مع `schemaVersion` وسبب كل حد. لا يبدأ أي request شبكي قبل اجتياز preflight وموافقة المستخدم عندما تتجاوز الخطة soft gate.

### معايير القبول

- لا تبدأ عملية تتجاوز الحدود من دون رسالة مفهومة قبل الشبكة.
- لا يحدث تجميد للوحة أثناء تجميع MegaTiles كبيرة.
- لا يزيد عدد ArrayBuffers الحية بلا حد.
- 4K Normal يغطي الكادر كاملاً في Zoom 2–12.
- الأرقام التي تعرضها الواجهة تطابق counters الفعلية بعد العملية ضمن فرق موثق لا يتجاوز cache races المشروعة.
- p95 وpeak memory لا يتجاوزان الحدود المعتمدة على جهاز الاختبار المرجعي.

---

## T7 — الرصد التشغيلي والتشخيص

**الهدف:** جعل تقرير مستخدم واحد كافياً لتحديد المرحلة المعيبة من دون الحاجة الدائمة إلى DevTools.

**الوزن:** 5 نقاط  
**الحالة:** ⬜ لم يبدأ  
**الاعتماد:** T2, T4

### المهام

- [ ] **T7-01:** إضافة أحداث structured لكل مرحلة من pipeline.
- [ ] **T7-02:** تسجيل الأعداد لا URLs ولا API keys.
- [ ] **T7-03:** تسجيل أكواد HTTP/timeout/decode/read/write/cache-validation بصورة مجمعة.
- [ ] **T7-04:** إضافة `operationId`, `documentId`, `providerSignature`, `compFormat`, `quality`.
- [ ] **T7-05:** إضافة ملخص مرئي مختصر عند الفشل وزر نسخ تفاصيل الدعم إن كان ضمن واجهة v1.
- [ ] **T7-06:** إبقاء سياسة تدوير السجل وحجمه الحالية.
- [ ] **T7-07:** اعتماد قاموس error codes ثابت يحدد phase وretryability وuser action.
- [ ] **T7-08:** إضافة اختبار redaction يمنع URL query/credentials/local usernames من ملف الدعم.
- [ ] **T7-09:** ربط كل أحداث العملية بـ`operationId` واحد مع `phaseSequence` تصاعدي لكشف الأحداث المتأخرة.

### الحقول الدنيا لكل عملية

```text
plannedPlacements
uniqueDownloads
cacheHits
cacheMisses
downloaded
failed
cancelled
retryAttempts
expandedPlacements
missingDownloadKeysCount
missingPlacementKeysCount
unexpectedIdentityCount
uncoveredSampleCount
stitchGroups
expectedCells
decodedCells
cacheRejected
aePrepared
aeCommitted
durationMsByPhase
```

### معايير القبول

- يمكن تحديد المرحلة المسؤولة عن أي فراغ من سجل واحد.
- لا يحتوي السجل مفتاح مزود أو URL محلولاً.
- نجاح العملية يعني صفراً في `failed` و`missing` و`unexpected`، وكل مطابقات الهوية صحيحة.
- يمكن ربط السجل بعملية واحدة من التخطيط حتى AE commit دون الاعتماد على ترتيب `console.log`.

---

## T8 — بوابات الجودة واعتماد After Effects

**الهدف:** إثبات السلوك الصحيح آلياً ثم بصرياً داخل AE قبل إغلاق الخلل.

**الوزن:** 8 نقاط  
**الحالة:** ⬜ لم يبدأ  
**الاعتماد:** T1–T7

### T8-A — الاختبارات الآلية الإلزامية

- [ ] **T8-A01:** تشغيل كل اختبارات fault injection الجديدة بنجاح.
- [ ] **T8-A02:** اختبار property-based لهويات wrap/placement حول خط 180°.
- [ ] **T8-A03:** اختبار مصفوفة أبعاد 1920×1080 و3840×2160 و1080×1920 و1080×1080.
- [ ] **T8-A04:** اختبار Zoom 2، 3، 4، 6، 10، 14 مع Normal/High/Ultra.
- [ ] **T8-A05:** اختبار إلغاء العملية في download/read/decode/write/prepare.
- [ ] **T8-A06:** اختبار cache corruption وmanifest mismatch.
- [ ] **T8-A07:** `npm test` كاملاً بلا regression.
- [ ] **T8-A08:** تشغيل build وsecurity وcompatibility/performance audits المرتبطة.
- [ ] **T8-A09:** تشغيل مصفوفة 256px و512px؛ لا يكفي مزود واحد أو حجم مصدر واحد.
- [ ] **T8-A10:** اختبار exact-set oracle مع missing/duplicate/unexpected IDs متساوية العدد.
- [ ] **T8-A11:** اختبار atomic PNG/manifest publication وsingle-flight تحت عمليتين متوازيتين.
- [ ] **T8-A12:** اختبار عدم إعادة استخدام Finalize MegaTile من Revision سابقة.
- [ ] **T8-A13:** اختبار أن preflight يمنع أول network request عند hard gate أو إلغاء المستخدم.
- [ ] **T8-A14:** اختبار أن سجلات الدعم خالية من URL query وAPI keys وأسماء مستخدمي المسارات المحلية.

### T8-B — مصفوفة AE اليدوية

| ID | السيناريو | خطوات الاختبار المختصرة | معيار النجاح | الحالة |
|---|---|---|---|---|
| AE-TILE-01 | 4K عند Zoom 2 | New Comp 4K، خريطة عالمية، انتظر Live Sync | لا سواد يمين/يسار ولا عالم مفقود | ⬜ |
| AE-TILE-02 | 4K عند Zoom 4 | سحب عبر خط 180° ثم الاستقرار | جميع المواضع صحيحة بلا قفز أو فجوات | ⬜ |
| AE-TILE-03 | 4K Normal ثابت | Finalize لمشهد ثابت | الكادر كامل عند 100% | ⬜ |
| AE-TILE-04 | 4K High ثابت | Finalize للمشهد نفسه | كامل، والزمن/العدد مسجلان | ⬜ |
| AE-TILE-05 | 4K Ultra ثابت | قبول تقدير التكلفة ثم Finalize | كامل أو فشل صريح بلا تغيير جزئي | ⬜ |
| AE-TILE-06 | مسار Keyframes | ثلاث مناطق بعيدة مع Zoom مختلف | تغطية كل نقطة ومسار الحركة | ⬜ |
| AE-TILE-07 | Live Sync تحت حركة | Pan/Zoom لخمس ثوانٍ | آخر جيل كامل فقط وواجهة سلسة | ⬜ |
| AE-TILE-08 | تبديل Composition | عملية جارية ثم فتح خريطة أخرى | لا أصل ولا Preview يعبران بين الخرائط | ⬜ |
| AE-TILE-09 | 4K عمودي | 2160×3840 أو المقاس العمودي المعتمد | لا نقص أعلى/أسفل أو الجوانب | ⬜ |
| AE-TILE-10 | إعادة فتح المشروع | حفظ وإغلاق وفتح | Final ومصادره كاملة بلا rebuild خاطئ | ⬜ |
| AE-TILE-11 | فشل شبكة فعلي | يُنفذ لاحقاً عند توفر التحكم بالشبكة | آخر Preview/Final سليم يبقى ظاهراً | ⬜ مؤجل بيئياً |
| AE-TILE-12 | مصادر 512px | Mapbox/MapTiler بمفتاح صالح | تموضع صحيح وذاكرة ضمن الميزانية | ⬜ |
| AE-TILE-13 | Cancel أثناء stitch | إلغاء Ultra أثناء التجميع ثم إعادة المحاولة | لا ملفات مؤقتة/طبقات staging، والمحاولة الجديدة سليمة | ⬜ |
| AE-TILE-14 | Cache corruption | إتلاف Preview MegaTile تجريبية ثم فتح المشهد | رفض الكاش وإعادة البناء بلا فراغ أو نجاح زائف | ⬜ |
| AE-TILE-15 | مقارنة pixel coverage | التقاط frame مرجعي عند 100% ومقارنته بقناع التغطية | صفر خلايا سوداء داخل crop المتوقع | ⬜ |

### معيار إغلاق T8

- كل اختبارات T8-A ناجحة.
- AE-TILE-01…10 وAE-TILE-12…15 ناجحة.
- AE-TILE-11 يجوز أن يبقى مؤجلاً فقط إذا غطته fault injection آلياً، ويظل مسجلاً كدين اختبار بيئي.
- لا توجد فجوة مرئية داخل safe frame عند فحص 100%.
- لا توجد رسالة نجاح مع أي عداد ناقص.

---

## 6. مصفوفة التتبع من العيب إلى دليل الإغلاق

| العيب | اختبار الفشل | مرحلة الإصلاح | الاختبار الآلي الحاسم | قبول AE/الدليل |
|---|---|---|---|---|
| TILE-001 | FI-01, FI-02 | T2 | T8-A01, T8-A10 | AE-TILE-07؛ لا commit جزئية |
| TILE-002 | FI-03 | T4, T5 | T8-A01 | AE-TILE-03…05؛ exact cells |
| TILE-003 | FI-02, FI-03 | T4 | T8-A05 | AE-TILE-13؛ cleanup كامل بعد cancel/read failure |
| TILE-004 | FI-04 | T4 | T8-A06, T8-A11, T8-A12 | AE-TILE-10, AE-TILE-14 |
| TILE-005 | FI-05, FI-07, FI-08 | T1, T2 | T8-A02, T8-A10 | AE-TILE-01, AE-TILE-02 |
| TILE-006 | FI-06 | T3 | T8-A01 | AE-TILE-07؛ recovery بلا حركة إضافية |
| TILE-007 | FI-09 | T6 | T8-A03, T8-A04, T8-A09, T8-A13 | AE-TILE-03…06, 09, 12 |
| TILE-008 | FI-08 | T7 | T8-A10, T8-A14 | سجل عملية واحد يطابق counters الفعلية |
| TILE-009 | FI-01…10 | T0, T8 | T8-A01…14 | سجل regression كامل على commit المرشح |
| BASE-001 | اختبار الكاميرا الحالي | T-1 | `npm test` 140/140 | لا يلزم AE للبداية؛ يغلق نهائياً قبل T8 |

لا يغلق أي عيب بعبارة «لم يعد يظهر». الإغلاق يحتاج اختبار فشل سابق، اختبار regression ناجح، ومرجع دليل في سجل التنفيذ.

---

## 7. ترتيب التنفيذ الإلزامي

```text
T-1 → T0 → T1 → T2 → T4 → T5
                         ├→ T3
                         ├→ T6
                         └→ T7
T3 + T5 + T6 + T7 ─────────→ T8
```

1. لا يبدأ تعديل مسار البلاطات قبل إغلاق T-1 ووجود اختبارات T0 الفاشلة للأسباب الصحيحة.
2. لا تصلح retries قبل بوابة الاكتمال؛ زيادة المحاولات وحدها لا تمنع commit جزئية.
3. لا تعدل جودة 4K قبل فصل download identity عن placement identity.
4. تُغلق سلامة Worker/cache في T4 قبل تشديد Finalize في T5 وقبل تحسين retries في T3.
5. لا يعتمد Finalize قبل exact-set Host validation وWorker/cache validation.
6. لا توسم أي مرحلة ✅ اعتماداً على `npm test` فقط إذا كانت تتطلب اختبار AE.

---

## 8. الملفات المتوقع تعديلها

| الملف | المسؤولية المطلوبة | المرحلة |
|---|---|---|
| `client/js/tiles/TileAddress.js` | فصل مفاتيح التنزيل والموضع | T1 |
| `client/js/tiles/CoverageContract.js` (جديد) | exact-set gates، CoverageSample وtyped coverage errors | T1, T2 |
| `client/js/engine/TilePlanner.js` | التخطيط دون إسقاط world placements | T1, T6 |
| `client/js/engine/DownloadSession.js` | نتيجة تنزيل موحدة وبوابة اكتمال | T2 |
| `client/js/engine/OpenGeoEngine.js` | نتائج typed، retries، وإحصاءات | T2, T6, T7 |
| `client/js/tiles/TileManager.js` | lifecycle لإعادة المحاولة | T3 |
| `client/js/tiles/TileDownloader.js` | backoff/cancellation/settled status | T3 |
| `client/js/core/SyncManager.js` | منع Preview وPath commits الجزئية | T2 |
| `client/js/engine/MegaTileStitcher.js` | manifest، تحقق، وكتابة ذرية | T4 |
| `client/js/engine/MegaTileManifest.js` (جديد) | canonical serialization والتحقق والـhash والنشر الذري | T4 |
| `client/js/engine/stitcherWorker.js` | expected count أصلي وفشل مغلق | T4 |
| `client/js/core/FinalizeController.js` | تحقق صارم وسياسة 4K | T5, T6 |
| `host/modules/compBuilder.jsx` | تحقق إضافي من manifest المستلم عند الحاجة | T5 |
| `host/modules/compositionTransaction.jsx` | تأكيد prepare/commit/rollback | T5 |
| `client/js/core/OperationLogger.js` | المقاييس المنظّمة | T7 |
| `config/performance-budgets.json` | soft/hard gates وموازنة 256/512px | T6 |
| `scripts/test.js` | تسجيل suites والحفاظ على smoke/release baseline | T-1, T0, T8 |
| `scripts/tests/tile-pipeline/` (جديد) | وحدات واختبارات property/fault/concurrency مفصولة | T0, T8 |
| `scripts/fixtures/tile-pipeline/` (جديد) | Golden manifests والصور التالفة وfailure oracles | T0, T8 |

أي ملف غير موجود في هذه القائمة يحتاج تبريراً في سجل التنفيذ قبل تعديله.

---

## 9. سجل القرارات المعمارية

| ID | القرار | السبب | الحالة |
|---|---|---|---|
| TD-01 | آخر مراجعة سليمة تبقى ظاهرة حتى اكتمال الجديدة | منع الوميض والخرائط الجزئية | معتمد |
| TD-02 | فصل `downloadKey` عن `placementKey` | المورد الشبكي ليس موضع العرض | معتمد |
| TD-03 | Preview MegaTile فقط تقبل cache hit بmanifest صالح؛ Finalize artifacts لا يعاد استخدامها بين Revisions | إزالة الغموض بين المشتقات المؤقتة والكاش الحقيقي | معتمد |
| TD-04 | لا تخفيض صامت لجودة Finalize | احترام اختيار المستخدم | معتمد |
| TD-05 | Normal هي القيمة الافتراضية للجلسات الجديدة، ولا يُخفض اختيار المستخدم الصريح | Ultra supersampling ثقيل والواجهة الحالية تختاره افتراضياً | معتمد للتنفيذ |
| TD-06 | Live Sync تبقى خدمة خفية ودائمة | عقد منتج سابق ملزم | معتمد |
| TD-07 | الفشل الجزئي لا يصل إلى Host | Host لا يستطيع معرفة ما حُذف قبل payload | معتمد |
| TD-08 | ZXP خارج هذه الخطة | التركيز على صحة الإضافة أولاً | معتمد |
| TD-09 | exact identity sets أقوى من count equality | التكرار قد يخفي أصلاً مفقوداً مع تساوي الأعداد | معتمد |
| TD-10 | كل عينة زمنية تملك required placements | اتحاد المسار قد يبدو كاملاً رغم فقد كادر معين | معتمد |
| TD-11 | `performance-budgets.json` مصدر الحقيقة الوحيد للحدود | منع drift بين الواجهة والمحركات والاختبارات | معتمد |

---

## 10. سجل المخاطر وخطط الاحتواء

| الخطر | الاحتمال | الأثر | الاحتواء | مؤشر الإنذار |
|---|---:|---:|---|---|
| زيادة زمن Preview بسبب التحقق | متوسط | متوسط | hash/manifest صغير وasync | ارتفاع p95 |
| استهلاك ذاكرة 4096px MegaTile | مرتفع مع 512px | مرتفع | backpressure ومجموعة واحدة حية | CEP memory spike |
| تغيير الهوية يكسر cache القديم | متوسط | منخفض | schema version وإعادة بناء آمنة | cache miss مرتفع أول تشغيل |
| retries تزيد ضغط المزود | متوسط | متوسط | jitter و429/503 throttling | تزايد HTTP errors |
| تشديد التحقق يظهر أخطاء كانت مخفية | مرتفع | إيجابي/مزعج مؤقتاً | رسائل واضحة وإبقاء الناتج السابق | زيادة failures مع غياب الفراغات |
| اختلاف Worker وfallback | متوسط | مرتفع | contract tests مشتركة | نتائج مختلفة لنفس fixture |
| تجاوز payload/طبقات Host | منخفض بعد MegaTile | مرتفع | budget قبل prepare | stitched assets > 5000 |
| سباق عمليتين على Preview cache | متوسط | مرتفع | single-flight/lock وatomic pair publication | hash mismatch أو manifest يتيم |
| كلفة SHA-256 على صور كبيرة | متوسط | منخفض/متوسط | hash بعد الكتابة فقط، async وقياس p95 | event-loop delay مرتفع |
| نجاح counts مع IDs خاطئة | متوسط في العقود القديمة | مرتفع | exact-set gates في العميل والـHost | unexpectedIdentityCount > 0 |
| الحدود الأولية غير مناسبة لجهاز ضعيف | متوسط | متوسط | benchmark مرجعي وsoft gate قابل للضبط | peak memory أو p95 فوق الميزانية |

---

## 11. استراتيجية التراجع الآمن

لا يُستخدم تراجع شامل أو حذف لتعديلات المستخدم. لكل مرحلة تراجع محلي:

| المرحلة | نقطة التراجع |
|---|---|
| T-1 | عزل إصلاح BASE-001 في commit مستقل يمكن الرجوع عنه دون لمس البلاطات |
| T1 | محول توافق يعيد العقد القديم خلف واجهة الهوية الجديدة |
| T2 | تعطيل بوابة العقد الجديدة في الفرع فقط، لا قبولها في إصدار v1 |
| T3 | العودة إلى retry واحد مع الحفاظ على cleanup الجديد |
| T4 | استخدام fallback main-thread الصحيح إن تعطل Worker، لا قبول partial |
| T5 | الإبقاء على Final القديم ورفض Finalize الجديدة |
| T6 | تعطيل عرض التقدير مع بقاء الحدود الوقائية |
| T7 | تعطيل المقاييس الإضافية دون تعطيل الأخطاء الأساسية |

إذا كشف اختبار AE regression جوهرياً، تُعاد حالة المرحلة إلى ↩️ أو 🟦 وتُسجل نتيجة الاختبار؛ لا تُترك ✅.

---

## 12. بروتوكول تحديث هذه الوثيقة أثناء التنفيذ

عند إكمال أي مهمة:

1. غيّر checkbox من `[ ]` إلى `[x]`.
2. حدّث حالة المرحلة.
3. أضف سطراً إلى سجل التنفيذ الحي.
4. أرفق أمر الاختبار ونتيجته الرقمية.
5. سجّل اختبار AE إن كان مطلوباً.
6. حدّث نقاط التقدم في اللوحة الرئيسية.
7. لا تستخدم «مكتمل» إذا لم يتحقق معيار القبول كاملاً.
8. سجّل commit SHA وبيئة الاختبار ونسخة fixture؛ لقطة شاشة وحدها ليست دليلاً كافياً.
9. نفذ كل مرحلة في commit/حزمة مراجعة مستقلة، ولا تخلط إصلاحات واجهة أو خرائط متجهية خارج النطاق.

### أدوار الاعتماد

| الدور | المسؤولية | شرط الفصل |
|---|---|---|
| Implementation Owner | الكود، migration، الاختبارات الآلية وتحديث checkboxes | لا يعتمد اختباره اليدوي وحده لإغلاق T8 |
| Code Reviewer | مراجعة العقود، الأمان، الإلغاء، الذاكرة والتراجع | يراجع diff والأدلة لا النتيجة المرئية فقط |
| AE Acceptance Owner | تنفيذ مصفوفة AE وتسجيل البيئة والنتائج | لا يغير الكود أثناء جلسة القبول نفسها |
| Release Owner | قرار Go/No-Go والتحقق أن الأدلة تخص commit SHA المرشح | لا يمنح waiver بلا مالك وتاريخ انتهاء |

يجوز لشخص واحد أداء أكثر من دور في المشروع الفردي، لكن يجب أن تبقى الأدلة منفصلة: نتيجة آلية، مراجعة diff، واختبار AE موثق.

### حزمة الأدلة المطلوبة لكل مرحلة

```text
stageId
commitSha
changedFiles
commandsAndExitCodes
testCounts
fixtureVersion
aeVersion / cepVersion / os
performanceSummary
openDefectsOrWaivers
reviewDecision
```

### قالب سجل التنفيذ الحي

| التاريخ | المهمة | الحالة السابقة ← الجديدة | Commit | الملفات | الاختبارات | دليل AE | ملاحظات/دين متبقٍ |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — |

### قالب توثيق العيب

```text
Defect ID:
Operation ID:
Composition format:
Provider signature:
Camera zoom:
Finalize quality:
Planned placements:
Unique downloads:
Missing / duplicate / unexpected identities:
Uncovered sample IDs:
Completed / cached / failed:
Expected / decoded cells:
Stitched / prepared / committed asset IDs:
Cache signature / manifest schema:
Peak memory / duration by phase:
Visible symptom:
Reproduction:
Resolution:
Regression test:
```

---

## 13. Definition of Done النهائية

لا تُغلق هذه الخطة إلا إذا تحققت الشروط كلها:

- [ ] لا يمكن لـLive Sync أوPath Preview إرسال plan جزئية إلى AE.
- [ ] كل CoverageSample مكتملة، ومجموعات download/placement/stitch/AE متطابقة بلا duplicate أو unexpected IDs.
- [ ] لا يمكن لـFinalize قبول `decodedCount !== expectedCount`.
- [ ] لا يستطيع Worker تقليل العدد المتوقع بعد فشل قراءة ملف.
- [ ] لا تُعاد Preview MegaTile من الكاش دون manifest وhash وأبعاد صحيحة، ولا تعاد Finalize MegaTile بين Revisions.
- [ ] مواضع العالم المتكررة تبقى كاملة مع تنزيل المورد مرة واحدة.
- [ ] بلاطات Panel Preview الفاشلة تتعافى وفق retry policy محدودة.
- [ ] 4K Normal/High/Ultra تعرض تكلفة حقيقية قبل الحمل الكبير.
- [ ] Normal هي القيمة الافتراضية الجديدة وUltra لا تُختار تلقائياً، مع احترام الاختيار الصريح المحفوظ.
- [ ] كل فشل يحافظ على آخر مراجعة سليمة.
- [ ] السجلات تحدد موضع الفشل بالأعداد وأكواد typed.
- [ ] جميع الاختبارات الآلية القديمة والجديدة ناجحة.
- [ ] مصفوفة AE-TILE المطلوبة معتمدة.
- [ ] لا توجد فجوات داخل الكادر في 4K عند Zoom المنخفض أو عبور 180°.
- [ ] لا توجد زيادة غير محدودة في Undo أو layers أو footage أو cache artifacts.
- [ ] لا توجد أسرار أو URLs محلولة داخل السجلات أو manifests.
- [ ] BASE-001 مغلق، وكل release gates خضراء على commit المرشح نفسه.
- [ ] لا توجد ملفات PNG/manifest/lock مؤقتة يتيمة ولا سباق كتابة مثبت.

---

## 14. بوابة Go/No-Go للإغلاق

### GO

يصبح الإصلاح مرشحاً للاعتماد فقط عندما:

- كل مراحل T-1…T8 في حالة ✅، باستثناء AE-TILE-11 وفق الاستثناء البيئي المحدد.
- `npm test` وbuild وsecurity وcompatibility وperformance audits تعمل على commit SHA نفسه.
- لا توجد P0/P1 مفتوحة داخل نطاق البلاطات، ولا waiver بلا مالك وتاريخ انتهاء.
- نتائج 256px و512px و4K الأفقي/العمودي وعبور 180° مرفقة في سجل التنفيذ.
- مقارنة counters والهوية وقناع التغطية تثبت عدم وجود خلايا مفقودة داخل الكادر.

### NO-GO

يُمنع الإغلاق أو الدمج النهائي عند تحقق أي مما يلي:

- baseline حمراء أو اختبار flaky غير معزول.
- أي mismatch في download/placement/cell/asset identity.
- نجاح UI مع failed/missing/unexpected counter غير صفري.
- Finalize جزئية، Revision قديمة حُذفت قبل commit، أو rollback غير محسوم.
- تجاوز hard budget أو peak memory دون فشل صريح وآمن.
- اعتماد بصري فقط من دون fault-injection وartifact قابل لإعادة الاختبار.

---

## 15. الخطوة التنفيذية التالية

الخطوة التالية هي **T0 فقط**: بناء اختبارات fault injection التي تثبت عيوب البلاطات قبل أي تعديل إنتاجي في T1–T7. يبدأ التنفيذ بـFI-01 وFI-02 لتثبيت استمرار Live Sync وPath Preview بنتيجة جزئية، ثم FI-03 وFI-04 لمسار Worker والكاش. لا يبدأ فصل الهوية أو تغيير retries قبل أن تفشل fixtures للأسباب المتوقعة.
