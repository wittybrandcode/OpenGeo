# OpenGeo — الخطة الرئيسية للإصلاح والتطوير ونظام تتبع التنفيذ

> **مرجع الخطة:** `OPEN_GEO_DEEP_ARCHITECTURAL_AUDIT_FINAL_AR.md`  
> **تاريخ الإنشاء:** 13 أغسطس 2026  
> **نوع الخطة:** إصلاح تدريجي دون إعادة كتابة شاملة  
> **قاعدة التحكم:** لا تُعلّم أي مهمة `✅ منفذة` قبل تحقق أدلة القبول المسجلة فيها

---

## 1. الهدف والنتيجة المطلوبة

تهدف هذه الخطة إلى نقل OpenGeo من منتج يعمل في السيناريوهات المجربة لكنه يحتوي مخاطر إصدار وتزامن وذرّية، إلى منتج يمكن اختباره وتشغيله ثم بناء نسخته النهائية بثقة. الترتيب الحالي يركز أولًا على منطق الإضافة والعيوب السلوكية؛ أما ZXP فيبقى مؤجلًا بقرار صريح حتى بدء مرحلة التوزيع النهائي.

لا تسمح الخطة بإعادة كتابة Big Bang. كل مرحلة يجب أن تترك الإضافة قابلة للتشغيل، ولها rollback واضح.

### قرار منتج ملزم — Live Sync

- **Live Sync خدمة أساسية تعمل تلقائيًا في الخلفية منذ تهيئة اللوحة وحتى التخلص منها.**
- لا يوجد ولا يُنشأ زر لتفعيلها أو تعطيلها، ولا تحفظ preference باسم enabled/disabled.
- زر **Record** مستقل تمامًا: لا يشغّل Live Sync، بل يحدد فقط هل تُكتب حركات الخريطة عند زمن AE الحالي كـkeyframes.
- زر **Add Key** يبقى عملية صريحة لإضافة keyframe واحد.
- يجوز إيقاف polling داخليًا فقط عند `dispose` أو أثناء suspension تقني قصير مضبوط مثل إنشاء مستند جديد؛ لا يعد ذلك وضعًا يختاره المستخدم.
- أي تصميم لاحق لـrevision/ack أو backoff يجب أن يحافظ على هذا العقد.

### تعريف الحالات

| الرمز | الحالة | القاعدة |
|---|---|---|
| ⬜ | لم يبدأ | لا توجد تغييرات معتمدة |
| 🟦 | قيد التنفيذ | توجد تغييرات محلية ولم تستوفِ DoD |
| 🟨 | ينتظر اختبار AE | اكتملت الأتمتة وبقي تحقق يدوي محدد |
| 🟥 | محظور | السبب والمالك والخطوة التالية موثقة |
| ✅ | منفذ | كل اختبارات القبول والأدلة والوثائق مكتملة |
| ⏭️ | مؤجل بقرار | قرار ADR وتاريخ المراجعة مطلوبان |

### تعريف الأولويات

- **P0:** مانع إصدار أو خطر فقد/استبدال نتيجة صحيحة.
- **P1:** استقرار وأداء وتزامن يجب إغلاقه في دورة التثبيت.
- **P2:** دين معماري/اختباري يُغلق بعد P0/P1.
- **P3:** تحسين تشغيلي وتطوير لاحق.

---

## 2. لوحة المتابعة العليا

| المرحلة | الحالة | الإنجاز | شرط الخروج |
|---|---|---:|---|
| M0 — تثبيت baseline والحماية | 🟨 | 75% | M0-02/03/04 مكتملة؛ توحيد/توقيع ZXP مؤجل بقرار المنتج |
| M1 — إصلاحات P0 السلوكية | ✅ | 100% | اختبارات آلية ناجحة واعتماد AE اليدوي مسجل |
| M2 — Finalize ذري وآمن | ✅ | 100% | اعتُمدت اختبارات fault/cancel/Undo داخل AE في 2026-08-14 |
| M3 — عزل التزامن والبلاطات | ✅ | 100% | التنفيذ والاختبارات الآلية واعتماد drag/zoom داخل AE ناجحة |
| M4 — أداء المعاينة والمدخلات | 🟨 | 95% | AE-15/16 وHost smoke ناجحة؛ رسم GeoJSON في AE منفذ آليًا وAE-39 باقٍ |
| M5 — توحيد الحالة والأحداث | ✅ | 100% | اعتمد المستخدم AE-25 وAE-26 وAE-27 في 2026-08-14 |
| M6 — تفكيك App وتوحيد النواة | 🟨 | 90% | الأتمتة مكتملة؛ اعتماد AE-28/29/30 باقٍ |
| M7 — البيانات والخرائط والبحث | ✅ | 100% | مصادر البناء منظمة؛ حزمة runtime محكومة بقائمة سماح ومثبتة آليًا |
| M8 — Build/Release/Security | 🟨 | 65% | M8-01 مغلقة؛ M8-02 آلية وAE-35 مؤجل؛ M8-03 مكتملة عدا التوقيع/ZXP والتدقيق الحي |
| M9 — التحقق داخل AE والإصدار | ⬜ | 0% | مصفوفة الاختبار ناجحة وتوقيع release candidate |

### مؤشرات المشروع

> **إحصاء التقدم في 20 أغسطس 2026 بعد إغلاق M0-03 وM0-04:** الإنجاز المتساوي عبر M0–M9 ≈ **83%**؛ والإنجاز في قلب الإضافة M0–M7 ≈ **96%**. المراحل المغلقة كليًا: **6/10** (`M1–M5` و`M7`). ‏AE-35 مؤجل بسبب عدم توفر التحكم بالشبكة، وAE-36/37/38 باقية، وتوقيع/ZXP والتدقيق الحي للاعتماديات مؤجلة بقرار المنتج/البيئة؛ لم تُسجل كاختبارات ناجحة.

| المؤشر | خط الأساس | الهدف |
|---|---:|---:|
| اختبارات ناجحة | 100 static/behavioral/contract/smoke + 82 geometry invariants + clean rebuild لـ97 ملفًا | سلوكية + contract + integration، كلها ناجحة |
| unhandled rejections المعروفة | ≥2 مسارات | 0 |
| مصادر build للإصدار | 2 (`stage`, `dist`) | 1 |
| stacks للبلاطات | 2 | 1 core + adapters |
| مصادر حالة finalization | 2 | 1 |
| partial Finalize success | ممكن | ممنوع |
| أكبر parse على مسار المعاينة | كان 19.2MB متزامنًا؛ الآن chunk ≤1,202,194 bytes وp95 parse آلي 2.54ms | profile CEP بلا long task >50ms |
| runtime dead-data المثبتة | 0 معروفة؛ أزيل نحو 30MB من intermediates/evidence/legacy data | 0 غير مبرر |
| Host payloads بلا limits | 0 في `vector.import` بعد بوابة ما قبل Undo | 0 |

---

## 3. قواعد التنفيذ غير القابلة للتفاوض

1. ابدأ كل إصلاح باختبار characterization أو regression يفشل على baseline، إلا إذا كان التغيير build-only وله فحص artifact بديل.
2. لا تغيّر هوية الخريطة، projection، أو بنية metadata في نفس commit الذي يصلح UI.
3. لا تحذف API/ملفًا ميتًا قبل `rg` + package inspection + smoke test.
4. كل تغيير Host يجب أن يختبر: success، validation failure، runtime failure، وUndo closure.
5. كل عملية async تحمل `operationId/documentId/revision` أو توثيقًا يثبت عدم الحاجة.
6. لا تُسجل API keys أو URL محلول يحتويها.
7. الحزمة الموقعة هي ناتج build المختبر نفسه، لا إعادة بناء لاحق.
8. أي مهمة تنتظر AE تنتقل إلى 🟨 ولا تُعتبر مكتملة.

---

## 4. M0 — تثبيت خط الأساس ومنع إصدار خاطئ

**الهدف:** وقف توزيع الكود القديم وإنشاء شبكة أمان تقيس السلوك الحقيقي.  
**التبعيات:** لا شيء.  
**المخاطر المغطاة:** OG-AUD-001، 017، 018، 020، 021.

### M0-01 — توحيد مجلد artifact النهائي

- **الحالة:** ⏭️ مؤجل بقرار المنتج حتى بدء إعداد النسخة النهائية — 2026-08-14
- **الأولوية:** P0
- **الملفات:** `scripts/build.js`, `scripts/zxp.js`, `scripts/verify-package.js`, `package.json`, `dist/**`, `release/**`
- **التنفيذ:**
  - اعتماد `release/stage` مصدرًا وحيدًا للتوقيع، أو اعتماد اسم جديد واحد مثل `release/artifact`.
  - منع `zxp.js` من العمل إن لم يوجد `artifact-manifest.json` ناتج verify الحالي.
  - حذف مفهوم `DIST` القديم من أداة التوقيع؛ لا تحذف المجلد القديم قبل نجاح migration.
  - ترتيب scripts: clean → data build → source build → tests → verify → manifest/hash → sign.
- **اختبار آلي:** فك ZXP أو inspect input directory، وتأكد من وجود `VectorMapManager.js`, `MapSession.js`, 10m vector assets، وعدم وجود `ViewportController.js` القديم.
- **قبول:** SHA-256 لكل ملف في input التوقيع يطابق manifest الذي اجتاز verify.
- **Rollback:** إبقاء نسخة artifact السابقة خارج مسار build باسم واضح `legacy-reference` مؤقتًا، لا تحزم.
- **الدليل عند الإكمال:** مسار ZXP + manifest hash + log ناجح.

### M0-02 — اختبار regression لاستعادة metadata

- **الحالة:** ✅ منفذ — 2026-08-14
- **الأولوية:** P0
- **يغطي:** OG-AUD-002/003/014
- **التنفيذ:** fake DOM + fake bridge يشغّلان App hydration عند `sync:compChanged` بقيم 256 و512 ومصدرين مختلفين.
- **قبول:** لا throw/rejection؛ session/viewport/settings/tile source متطابقة؛ suppression flags تعود إلى false.
- **الدليل:** اختبار executable لقيمتي 256 و512 ولمصدر مستعاد، من دون `Viewport.setTileSize`؛ ضمن `npm test` ‏50/50.

### M0-03 — تحويل الاختبارات النصية الحرجة إلى executable behavior

- **الحالة:** ✅ منفذ — 20 أغسطس 2026
- **الأولوية:** P1
- **التنفيذ:** إنشاء بنية `tests/unit`, `tests/integration`, `tests/contracts`, `tests/data`; الاحتفاظ بالـstatic guards فقط لما يناسبها.
- **المجموعة الأولى الإلزامية:** EventBus async، cache eviction، provider race، partial host import result، finalize cancellation، lifecycle dispose.
- **قبول:** كل اختبار يفشل على نسخة baseline غير المصححة ويذكر OG-AUD ID.
- **الدليل:** تغطية سلوكية لـEventBus async وLRU re-download وmetadata hydration وtyped partial Host import وFinalize cancellation وmount/dispose/remount. أُغلق provider same-id race بتثبيت signature/template/tileSize وإلغاء الأجيال القديمة cancel-first، مع اختبار منسّق يثبت preview واحدًا أخيرًا واختبار repeated viewport ‏4→2→1. النتيجة `npm test` ‏107/107.

### M0-04 — قرار ADR لمسار TypeScript/Rollup

- **الحالة:** ✅ منفذ — 20 أغسطس 2026
- **الأولوية:** P1
- **القرار المطلوب:**
  - A: JavaScript globals رسميًا الآن؛ حذف configs الميتة.
  - B: migration مرحلي إلى modules/TypeScript مع bundler فعلي.
- **الترشيح:** A لدورة التثبيت، ثم ADR جديد لـB بعد M6.
- **قبول:** لا config يشير إلى source أو dependency غير موجودة.
- **القرار والدليل:** اعتمد الخيار A في `ADR-001_BUILD_ARCHITECTURE_AR.md`. حُذف `rollup.config.js` و`tsconfig.json` اللذان كانا يشيران إلى `engine/src` غير موجود وplugin غير مثبت، وأزيلت المراجع الخاصة للمسارين الوهميين من build. حارس آلي يثبت أن HTML يحمل `OpenGeoEngine.js` الفعلي وأن package لا يعيد toolchain غير معتمد؛ `npm test` ‏107/107 و`build` و`verify:package` ناجحة.

### بوابة خروج M0

- [ ] ZXP لا يقرأ `dist` القديم.
- [ ] artifact manifest موقّع/مقارن.
- [ ] اختبارات regression للـP0 موجودة وحمراء قبل الإصلاح.
- [x] قرار build architecture موثق.

---

## 5. M1 — إصلاحات P0 السلوكية المباشرة

**الهدف:** إزالة crashes وunhandled rejections وفراغات cache دون إعادة هيكلة كبيرة.  
**التبعيات:** M0.  
**المخاطر:** OG-AUD-002، 003، 005، وجزء من 029.

### M1-01 — عقد واحد لتطبيق tile size

- **الحالة:** ✅ منفذ برمجيًا — 2026-08-14
- **الأولوية:** P0
- **التنفيذ:** إضافة/اعتماد command واحد في MapSession ثم تجعل Viewport يقرأ `mapState.tileSize`; إزالة `viewport.setTileSize` الوهمي.
- **اختبارات:** hydration 256/512، تغيير UI، إعادة فتح comp، وحساب uiZoom قبل/بعد.
- **قبول:** لا mutation مزدوجة ولا method غير موجودة.
- **الدليل:** استُخرج `_hydrateCompositionState`، وأصبحت الكتابة عبر `MapSession.setTileSize` فقط؛ اختبار 256/512 ناجح.

### M1-02 — EventBus واعٍ بالـasync

- **الحالة:** ✅ منفذ برمجيًا — 2026-08-14
- **الأولوية:** P0
- **التنفيذ المعتمد لهذه المرحلة:** `emit` يراقب أي thenable ويحوّل رفضه إلى error boundary مركزي قابل للحقن؛ المستمع `once` يعيد Promise إلى الناقل. يبقى `emitAsync/allSettled` قرارًا لاحقًا للأحداث التي تحتاج انتظارًا ترتيبيًا.
- **ممنوع:** catch فارغ أو Promise تُطلق بلا `.catch`.
- **اختبارات:** sync throw، async reject، once async، unsubscribe أثناء emit، listener يضيف listener.
- **قبول:** `unhandledrejection` = صفر في السيناريوهات.
- **الدليل:** اختبار مستمع async يرفض ويتحقق من وصول event/error إلى error boundary؛ `npm test` ‏50/50.

### M1-03 — إصلاح علاقة LRU وdownloader

- **الحالة:** ✅ منفذ برمجيًا — 2026-08-14
- **الأولوية:** P0
- **التنفيذ المفضل:** إزالة `_loaded` كمصدر دائم؛ dedup للـpending فقط، والcache يحدد الوجود.
- **بديل:** MemoryCache يطلق eviction ويزيل المفتاح من downloader.
- **اختبارات:** cache limit=2، حمل A/B/C، ارجع A، يجب أن يبدأ HTTP جديد ويظهر bitmap.
- **قبول:** clearCache وeviction وsource change كلها قابلة لإعادة التنزيل.
- **الدليل:** أزيلت `_loaded` الدائمة وأصبح dedup مقتصرًا على `_pending`؛ اختبار LRU بحد عنصر واحد يثبت إعادة الطلب بعد eviction.

### M1-04 — إكمال dispose لمستمعات DOM

- **الحالة:** ✅ منفذ — 2026-08-14
- **الأولوية:** P2
- **التنفيذ:** أضيف سجل موحد لمستمعات DOM في `App` و`SearchPanel`؛ يفك `dispose()` مستمعات toolbar/modals/window/search ويُنظف نتائج البحث المؤقتة.
- **اختبار:** mount → dispose → mount ينتج مستمع `input/keydown/click` واحدًا فقط؛ ناجح ضمن 52/52.

### M1-05 — تثبيت Live Sync كخدمة خلفية دائمة

- **الحالة:** ✅ منفذ ومعتمد يدويًا داخل AE — 2026-08-14
- **الأولوية:** P1 / قرار منتج
- **الملفات:** `AESyncEngine.js`, `EventContracts.js`, `app.js`, اختبارات lifecycle.
- **التنفيذ:** إزالة `sync:toggle` و`setLiveSync(enabled)`؛ اعتماد `start()` idempotent و`dispose()`؛ إبقاء Record state منفصلًا.
- **اختبارات:** تبدأ مرة واحدة عند `App.init`، لا اشتراك toggle، لا زر Live Sync، dispose يوقف المؤقت، Record=false لا يوقف المزامنة.
- **قبول:** لا مسار مستخدم أو event أو preference يستطيع تعطيل Live Sync.
- **الدليل:** `sync:toggle` و`setLiveSync` = صفر مراجع runtime؛ `start()` idempotent و`dispose()` يوقف المؤقت؛ 52/52 اختبارًا وفحص syntax ناجحان؛ أكد المستخدم نجاح اختبار Live Sync/Record/استعادة الـComposition داخل AE.

### بوابة خروج M1

- [x] restore regression أخضر.
- [x] لا unhandled Promise في رسم الحدود أو comp hydration.
- [x] eviction revisit أخضر.
- [x] lifecycle test أخضر.
- [x] Live Sync يبدأ تلقائيًا ولا يملك زرًا أو toggle event.
- [x] smoke يدوي: فتح/تبديل comp، 256↔512، رسم بلد.

---

## 6. M2 — جعل Finalize معاملة ذرّية

**الهدف:** النتيجة النهائية السابقة تبقى سليمة ما لم يكتمل البديل بالكامل.  
**التبعيات:** M1.  
**المخاطر:** OG-AUD-004، 007، 008، 012، 025، 028.

### M2-01 — تعريف بروتوكول Prepare/Commit/Rollback

- **الحالة:** ✅ منفذ ومعتمد داخل AE — 2026-08-14
- **الأولوية:** P0
- **العقد:**
  1. Client ينشئ `operationId` وsnapshot.
  2. ينزّل ويخيط إلى directory مراجعة: `MegaTiles/<documentId>/<operationId>/`.
  3. Host `composition.prepare` يستورد إلى layers/assets staging بعلامات revision ولا يحذف active revision.
  4. يتحقق imported = expected ويفحص controller/expressions.
  5. Host `composition.commit` يبدّل active revision داخل UndoGroup واحد.
  6. بعد نجاح commit فقط، ينظف client/host revisions القديمة.
- **قبول:** crash/failure في أي خطوة قبل commit يترك final السابق مرئيًا وقابلًا للاستخدام.
- **التنفيذ:** أضيفت أوامر `composition.prepare/commit/rollback/getRevision`. يستورد Prepare طبقات مخفية إلى revision مستقل، ويتحقق Commit قبل تبديل الرؤية، ولا يبدأ تنظيف القديم إلا بعد نجاح تفعيل الجديد. كل revision له مجلد `MegaTiles/<documentId>/<operationId>/`.
- **الدليل:** Finalize لم يعد يستدعي `composition.build`؛ ترتيب activation قبل cleanup محمي باختبار regression؛ أكد المستخدم نجاح سيناريوهات AE، والاختبارات الحالية 66/66 ناجحة.

### M2-02 — نتيجة typed وكاملة للاستيراد

- **الحالة:** ✅ منفذ ومعتمد داخل AE — 2026-08-14
- **الأولوية:** P0
- **Result:** `{ok, operationId, documentId, expected, imported, reused, failed:[{key,code}], warnings}`.
- **قواعد:** final يفشل إذا `failed.length>0`; preview يمكن أن يقبل partial وفق policy مستقلة.
- **اختبار:** ملف مفقود، صورة فاسدة، import exception، layer collision.
- **التنفيذ:** Prepare وCommit يعيدان `ok/operationId/documentId/expected/imported/reused/failed/warnings/phase/commitState`. Client يرفض أي mismatch أو failure قبل Commit.
- **الدليل الآلي:** اختبار expected=3/imported=2 يرفض النتيجة ولا يسمح بالـcommit.

### M2-03 — MegaTile coverage contract

- **الحالة:** ✅ منفذ ومعتمد داخل AE — 2026-08-14
- **الأولوية:** P1
- **التنفيذ:** missing cells شفافة أو block لا يُنشأ؛ worker يعيد decoded/expected counts وcoverage mask.
- **اختبار:** 3/4 children، corrupt child، zero child، worker/fallback pixel equivalence.
- **قبول:** لا pixel معتم مصطنع في منطقة غير متوفرة.
- **التنفيذ:** أزيل الملء الداكن من worker وfallback؛ الخلايا غير المفكوكة شفافة. تسجل كل عملية `decodedCount/expectedCount/coverageMask` ويرفض block بلا أي child صالح.

### M2-04 — ملكية AE بالmetadata لا بالاسم

- **الحالة:** ✅ منفذ ومعتمد داخل AE — 2026-08-14
- **الأولوية:** P1
- **التنفيذ:** comments مثل `opengeo:v2;document=<id>;role=<role>;revision=<id>` لكل comp/layer/asset.
- **migration:** تعرف legacy name prefix للقراءة فقط؛ لا تحذف legacy تلقائيًا دون تحقق ownership.
- **قبول:** layer مستخدم اسمه `final_custom` لا يُحذف؛ rename للكومبوزيشن لا يكسر resolve.
- **التنفيذ:** controller/pivot/map-comp/tile layers/footage تحمل `opengeo:v2;document=...;role=...;revision=...`. تنظيف الطبقات يتطلب ملكية document من comment أو asset legacy موثوق، وليس prefix الاسم وحده. Resolver يدعم الاسم القديم وmetadata الجديدة أثناء migration.

### M2-05 — دلالة cancellation صادقة

- **الحالة:** ✅ منفذ ومعتمد داخل AE — 2026-08-14
- **الأولوية:** P1
- **التنفيذ:** حالات `cancelled-before-commit`, `commit-in-progress`, `committed`, `reconciliation-required`.
- **قبول:** لا رسالة “No changes were applied” إن بدأ Host mutation بالفعل.
- **التنفيذ:** `cancelled-before-commit` يلغي التشغيل ويحافظ على active Final؛ عند `commit-in-progress` يختفي زر الإلغاء ويرفض الإلغاء الآمن. إذا تأخر رد CEP، يستعلم client عن `composition.getRevision` قبل rollback؛ وعند تعذر التأكد يحفظ assets ويعلن `reconciliation-required` بدل حذفها.

### M2-06 — إزالة الفروع غير القابلة للوصول

- **الحالة:** ✅ منفذ آليًا — 2026-08-14
- **الأولوية:** P2
- **التنفيذ:** policy نجاح واحدة للdownload؛ إما 100% للfinal أو coverage proof واضح. إزالة successRate dead branches.
- **الدليل:** أزيلت فروع 95%/100% المتناقضة؛ Finalize يتطلب تطابق مجموعة tile keys بالكامل، مع إزالة التكرار قبل القياس.

### بوابة خروج M2

- [x] fault injection في download/stitch/prepare/commit ينجح.
- [x] final السابق محفوظ عند كل فشل قبل commit.
- [x] importedCount mismatch يفشل آليًا.
- [x] Undo خطوة واحدة للcommit، ولا Undo nesting.
- [x] cleanup لا يسبق activation/commit وفق فحص بنيوي آلي.

---

## 7. M3 — عزل عمليات التنزيل والتزامن

**الهدف:** لا تشارك عمليتان mutable downloader state أو provider namespace.  
**التبعيات:** M1؛ يمكن بدء تصميمها بالتوازي مع M2 دون دمج متزامن.  
**المخاطر:** OG-AUD-006، 012، 013، 026، 027، 032.

### M3-01 — OperationSnapshot immutable

- **الحالة:** ✅ منفذ برمجيًا — 2026-08-14
- **الأولوية:** P0
- **الحقول المنفذة:** operationId، kind/generation، documentId، compId، sourceKey، resolvedTemplate، providerSignature، camera، dimensions، tileSize/maxZoom، quality، finalization state.
- **القبول:** الكائن والحقول المركبة مجمدة؛ Sync/trajectory/Finalize تقارن هويته قبل نشر النتيجة أو استدعاء AE؛ تبديل المصدر يجعل snapshot قديمة فورًا.
- **الدليل:** اختبار immutability وprovider switch ناجح ضمن 52/52.

### M3-02 — DownloadSession scoped

- **الحالة:** ✅ منفذ برمجيًا — 2026-08-14
- **الأولوية:** P0
- **التنفيذ:** أزيل المحرك المشترك `app._geoEngine`. كل sync/finalize/trajectory يمتلك `DownloadSession` ومحركًا وnamespace/template ثابتين؛ الإلغاء محصور في مالك الجلسة، مع بقاء transport مشتركًا فقط.
- **اختبارات:** مزود A→B أثناء 20 طلبًا، cancel Finalize مع Sync جارٍ، عمليتا preview متتاليتان.
- **قبول:** لا ملف A تحت signature B، ولا cancellation cross-talk.
- **الدليل:** اختبار محركين A/B يثبت اختلاف template/namespace وأن إلغاء A لا يلغي B؛ 52/52 ناجحة.

### M3-03 — فصل render invalidation عن AE sync

- **الحالة:** ✅ منفذ برمجيًا — 2026-08-14
- **الأولوية:** P1
- **التنفيذ:** حذف `queueAutoExport` من `overlay:changed` و`tiles:renderReady`; camera revision وحدها تحرك AE tile preview.
- **اختبار:** إضافة marker/GeoJSON لا تستدعي composition.build؛ اكتمال 12 tile لا يؤخر camera commit.
- **الدليل:** أزيل `queueAutoExport()` من مستمعي `tiles:renderReady` و`overlay:changed` وبقي في intent تغيير الكاميرا فقط؛ يحميه اختبار regression بنيوي ضمن 66/66.

### M3-04 — Live Sync revision/ack بدل نافذة الزمن

- **الحالة:** ✅ منفذ برمجيًا — 2026-08-14
- **الأولوية:** P1
- **التنفيذ:** camera.update يحمل revision؛ Host state يعيد applied revision؛ تجاهل echo المطابق فقط.
- **قيد المنتج:** يغير هذا آلية منع الحلقة فقط؛ Live Sync يبقى دائمًا ولا يضاف له toggle.
- **اختبارات:** panel move ثم AE move خلال 100ms؛ out-of-order poll؛ failed write؛ timeline scrub.
- **قبول:** لا rollback jump ولا إسقاط تعديل AE شرعي.
- **الدليل:** revision أحادي متزايد من العميل، و`OpenGeo Sync Revision` محفوظ في controller، و`appliedRevision` معاد من المضيف. اختبار سلوكي يثبت تجاهل الصدى المطابق، قبول حركة AE المختلفة ذات revision نفسها، ورفض poll أقدم.
- **تصحيح الاستقرار 2026-08-14:** أضيف watermark منذ لحظة local intent وقبل debounce، فلا يستطيع poll سابق إعادة الكاميرا. لا يقر Host revision إلا إذا طُبقت القيم الثلاث فعليًا؛ عند keyframes خارج CTI و`Record` مغلقًا يعيد `skipped-keyframed-outside-cti` والكاميرا الفعلية، فتبقى معاينة اللوحة محلية بلا snap-back حتى تتغير كاميرا timeline فعلًا.

### M3-05 — تحسين polling

- **الحالة:** ✅ منفذ برمجيًا — 2026-08-14
- **الأولوية:** P2
- **التنفيذ:** cache comp/controller identity، backoff بعد الأخطاء، health state، قياس duration.
- **قبول:** لا overlap؛ بعد 3 أخطاء تظهر حالة degraded غير مزعجة؛ recovery تلقائي.
- **الدليل:** استُبدل `setInterval` بجدولة self-scheduling لا تبدأ التالية قبل انتهاء السابقة، مع backoff أسي 500–5000ms، وحالتي `healthy/degraded` ومدة آخر poll. اختبار failure×3→recovery وsingle-flight ناجح.

### M3-06 — thresholds بالبكسل

- **الحالة:** ✅ منفذ برمجيًا — 2026-08-14
- **الأولوية:** P2
- **التنفيذ:** استبدال 0.0001° بتحويل world pixel عند zoom/latitude الحاليين؛ Mercator midpoint في fitBounds.
- **اختبار:** high latitude، zoom 2/19، antimeridian، comp portrait/landscape.
- **الدليل:** `MercatorProjection.cameraPixelDistance/camerasEquivalent` أصبحتا المصدر الموحد للعتبات، و`TilePlanner` يقيس أقل من source pixel واحد، و`fitBounds` يحسب midpoint في فضاء Mercator. اختبارات high latitude وzoom 2/19 وantimeridian وportrait ناجحة، مع regression لإطار البداية `(0,0)`.

### بوابة خروج M3

- [x] لا composition export من render completion أو overlay invalidation.
- [x] revision/ack يلغي نافذة suppression الزمنية.
- [x] polling single-flight مع degraded/backoff/recovery.
- [x] العتبات محسوبة بالبكسل وfitBounds إسقاطي.
- [x] `npm test` ينجح: 66/66.
- [x] اعتماد AE-02/AE-03/AE-21: أكد المستخدم سلاسة drag/zoom بعد إصلاح watermark والإقرار، وعدم وجود feedback jump أو تكدس polling Undo.

---

## 8. M4 — أداء المعاينة وحدود موارد الإدخال

**الهدف:** منع تجمد UI وAE مع datasets وملفات المستخدم.  
**التبعيات:** M1؛ لا تعتمد على M6.  
**المخاطر:** OG-AUD-009، 010، 011، 030.

### M4-01 — حزمة vector preview مفهرسة

- **الحالة:** ✅
- **الأولوية:** P1
- **التنفيذ المقترح:**
  - build يقسم البيانات إلى spatial cells أو quadtree chunks.
  - index صغير يحمل bbox/offset/hash.
  - تحميل 50m أولًا، و10m chunks المرئية فقط.
  - parse/decode في Worker إن دعم CEP، مع fallback chunked.
- **قبول:** لا قراءة 19.2MB تزامنيًا من render؛ p95 frame ضمن الميزانية.

### M4-02 — تصحيح culling وworld wrap

- **الحالة:** ✅
- **الأولوية:** P1
- **التنفيذ:** visibility في فضاء viewport؛ اختبر bounds مقابل النطاق المحلي ونسختي wrap المحتملتين فقط، لا `±mapSize` على النطاق.
- **اختبار:** Europe zoom 6 لا يمر على كل features؛ antimeridian يرسم النسخة الصحيحة.

### M4-03 — سياسة ذاكرة datasets

- **الحالة:** ✅
- **الأولوية:** P1
- **التنفيذ:** cache budget، unload 10m بعد فترة/تبديل، ومقاييس heap.
- **قبول:** حد أعلى موثق؛ 50m+10m switching لا ينمو بلا حد.

### M4-04 — بوابة GeoJSON

- **الحالة:** 🟨 — validation/Preview معتمدان، ورسم AE منفذ آليًا؛ AE-39 باقٍ
- **الأولوية:** P1
- **التنفيذ:** file size قبل FileReader، parser/validator يعيد `Result`, limits قابلة للضبط، finite coordinates/depth، progress/cancel.
- **قبول:** ملف invalid يعرض error فقط؛ oversized يرفض قبل parse؛ ملف صالح يظهر في Preview ويُرسم داخل Map composition كـShape Layers مرتبطة بالخريطة.

### M4-05 — دفاع Host لـvector.import

- **الحالة:** ✅
- **الأولوية:** P1
- **limits الأولية:** ملف ≤ 25MB، layers ≤ 20، features ≤ 500، points ≤ 100k، string ≤ 512، finite numbers فقط؛ تُضبط بعد profiling.
- **قاعدة:** validation قبل `withUndoGroup` أو قبل أي mutation داخله.
- **اختبار:** تجاوز كل حد منفردًا، NaN/Infinity equivalent، ring ناقص، path غير موجود.

### M4-06 — نقل I/O الثقيل خارج UI frame

- **الحالة:** ✅
- **الأولوية:** P2
- **التنفيذ:** async fs لـpayload/data/megatile reads حيث يسمح CEP؛ batching وyield للـfallback.
- **قبول:** لا task فوق 50ms في profiles المستهدفة دون progress واضح.

### سجل تنفيذ M4 — 2026-08-14

- [x] إنشاء `scripts/build-vector-preview-index.js` وحزمة تشغيل 10m من **89 chunk** مفهرس بـbbox/hash وهوية SHA-256 للمصدر.
- [x] استبدال قراءة ملف 10m الأحادي (نحو 20MB) بتحميل 50m تدريجيًا ثم index وchunks المرئية فقط عبر `loadDatasetAsync`.
- [x] اعتماد ترتيب Morton وحد مكاني للحزم؛ أقصى chunk **1,202,194 bytes**، وأقصى نافذة عينة **306,695 نقطة / 20 chunk** دون سقف الذاكرة **400,000 نقطة**.
- [x] تحديد تزامن تحميل chunks بعمليتين، وإسقاط الطلبات المنتظرة التي خرجت من الكادر، وإبقاء 50m كـfallback حتى وصول 10m.
- [x] إصلاح culling وworld wrap واستخدام protection set واحد لليابسة والحدود والسواحل منعًا للطرد المتبادل.
- [x] إضافة unload مؤجل لـ10m، ومقاييس cache/queue/points، ومنع path traversal في مستودع البيانات.
- [x] إضافة `GeoJSONValidator`: حد 10MB قبل FileReader، 5,000 feature، 100,000 نقطة، عمق 12، نص 512، إحداثيات finite/range وحلقات مغلقة، مع Result typed واستبدال transactional.
- [x] إضافة progress وإلغاء القراءة السابقة عند اختيار ملف أحدث، وإلغاء القراءة عند `dispose`.
- [x] إضافة دفاع Host قبل `withUndoGroup`: ملف 25MB، 20 طبقة، 500 feature، 100,000 نقطة، 500 label، نص 512، عمق 12، وحلقات/نقاط finite صالحة.
- [x] نقل كتابة country payload وقراءة/كتابة MegaTile في مسارات Node إلى I/O غير متزامن، وجمع render invalidations في `requestAnimationFrame` واحد.
- [x] إضافة `npm run benchmark:preview`: p50 **1.28ms**، p95 **2.25ms**، max **9.53ms** على بيئة التطوير الحالية.
- [x] نجاح `npm test` ‏**73/73**، وفحوص syntax، و`npm run build`، و`npm run verify:package`.
- [x] **AE-15:** تبديل 50m↔10m والتحريك/التكبير واعتماد عدم التجمد/النمو غير المحدود من المستخدم.
- [x] **AE-16:** GeoJSON صالح، JSON فاسد، ملف >10MB، وبقاء آخر overlay صالح بعد الرفض — ناجح.
- [x] ربط GeoJSON الصالح بـ`vector.import` عبر ملف job مؤقت، وتحويل Polygon/Line/Point وMulti*/GeometryCollection إلى Web‑Mercator مع antimeridian unwrap وملكية مستقلة حسب اسم الملف؛ اختبارا السلوك ناجحان ضمن 109/109.
- [ ] **AE-39:** اعتماد ظهور Shape Layers وحركتها مع MapPivot والاستبدال عند إعادة رفع الملف نفسه.
- [x] **Host negative smoke:** رفض payload غير الصالح بلا layer mutation أو Undo step — ناجح.

**قرار fallback:** لم يُستخدم Worker لتحليل JSON لأن CEF/CEP لا يضمن نقله في كل الإصدارات. البديل المعتمد هو chunks صغيرة، تزامن 2، وyield بين عمليات التحليل؛ وهو قابل للقياس ويعمل أيضًا على CEP الأقدم.

---

## 9. M5 — توحيد الحالة وعقود الأحداث والجسر

**الهدف:** سلوك قابل للاستدلال بمصدر حقيقة واحد وبروتوكولات صريحة.  
**التبعيات:** M1–M3.  
**المخاطر:** OG-AUD-003، 012، 014، 020، 028، 030.

### M5-01 — MapSession هو write boundary الوحيد

- **الحالة:** ✅ منفذ ومعتمد — 2026-08-14
- **الأولوية:** P1
- **التنفيذ:** commands: `hydrateDocument`, `setCamera`, `setComposition`, `setProvider`, `setTileSize`, `setFinalized`; منع direct writes.
- **إزالة:** `MapState.isFinalized` وdirect `session.documentId=`.
- **اختبارات:** كل command revision + snapshot + notification واحدة.
- **الدليل:** `MapSession` يملك revision وعمليات الكتابة، و`Viewport` يكتب عبره في runtime؛ اختبار transaction/rollback/notification وسباق تبديل الـComposition أخضران ضمن `npm test` ‏82/82.

### M5-02 — StateHydrator transaction

- **الحالة:** ✅ منفذ ومعتمد — 2026-08-14
- **الأولوية:** P1
- **التنفيذ:** normalize/migrate/validate metadata ثم commit state دفعة واحدة؛ rollback snapshot عند الفشل.
- **قبول:** لا حالة نصف مستعادة، ولا events side effects أثناء hydration قبل commit.
- **الدليل:** التحقق يرفض camera/dimensions/tileSize/document/finalization الفاسدة قبل commit، والاستعادة الصحيحة تنشر notification واحدة فقط.

### M5-03 — Event Catalog كامل

- **الحالة:** ✅ منفذ — 2026-08-14
- **الأولوية:** P1
- **التنفيذ:** كل event مسمى في catalog بعقد runtime، owner، sync/async policy، allowed publishers/subscribers.
- **أحداث جديدة:** camera intent، render invalidation، operation progress/result، error report.
- **قبول:** literal event names خارج catalog = build failure، باستثناء adapter موثق.
- **الدليل:** `npm run audit:events` يغطي 126 استعمالًا حرفيًا بواسطة 27 عقدًا مركزيًا، ويُفشل التدقيق عند اسم غير معروف.

### M5-04 — Bridge Protocol v2

- **الحالة:** ✅ منفذ ومعتمد — 2026-08-14
- **الأولوية:** P1
- **التنفيذ:** typed handlers تعيد objects لا strings؛ إزالة heuristic legacy parser تدريجيًا؛ schema version وerror codes ثابتة.
- **قبول:** contract tests لكل command success/failure/malformed/timeout/late response.
- **الدليل:** envelope `2.0.0` وtyped handler table ورموز الأخطاء الثابتة مطبقة؛ اختبارات success/failure/malformed/timeout/late-response ناجحة، وبقي smoke للـHost الحقيقي.

### M5-05 — Version migrations

- **الحالة:** ✅ منفذ — 2026-08-14
- **الأولوية:** P2
- **الإصدارات المنفصلة:** app, settings schema, metadata schema, bridge protocol, vector data bundle, cartography policy.
- **قبول:** ترقية N-2→N لا تمسح prefs؛ downgrade behavior موثق.
- **الدليل:** إصدارات app/settings/metadata/bridge/vector/cartography مستقلة، واختبار N-2→N يحفظ provider وtileSize والكاميرا وdocumentId.

### M5-06 — OperationLogger

- **الحالة:** ✅ منفذ ومعتمد — 2026-08-14
- **الأولوية:** P2
- **التنفيذ:** logs JSON lines تحت CEP USER_DATA، rotation، redaction، operationId، phase/duration/errorCode؛ console للتطوير فقط.
- **قبول:** لا key/token؛ support bundle يمكن جمعه دون بيانات حساسة.
- **الدليل:** JSONL محدود إلى 1MB مع 3 ملفات كحد أقصى، rotation وredaction وoperationId/duration/errorCode؛ اختبار الملفات المؤقتة ناجح.

### سجل تنفيذ M5 — 2026-08-14

- **المنفذ:** write boundary موحد، hydration ذرية، catalog للأحداث، Bridge v2، migrations مستقلة، وOperationLogger محدود ومنقح.
- **التحقق:** `npm test` ‏82/82؛ `npm run audit:events` ‏126/126 ضمن 27 عقدًا؛ `npm run build` و`npm run verify:package` ناجحان.
- **تصحيح AE-25:** عند التبديل بين 1:1 و16:9 كان حفظ metadata المؤجل يستطيع الكتابة إلى الـComposition الجديدة، وكانت نتيجة تحميل قديمة قادرة على الوصول متأخرة، كما لم يكن DOM يعيد قياس framing box بعد hydration. ثُبتت هوية comp/document عند الجدولة، وأضيف load revision، وأصبح `CompItem.width/height` مصدر الحقيقة الذي يصلح metadata القديمة تلقائيًا، ويُحدّث الإطار فور commit.
- **اعتماد AE:** أكد المستخدم نجاح AE-25 وAE-26 وAE-27 في 2026-08-14؛ M5 مغلقة 100%. لا يُشغّل بناء ZXP في هذه المرحلة وفق قرار المنتج.

---

## 10. M6 — تفكيك App وتوحيد نواة البلاطات

**الهدف:** رفع قابلية الصيانة دون تغيير السلوك.  
**التبعيات:** اختبارات M0–M5 مستقرة.  
**المخاطر:** OG-AUD-015، 016، 019، 028، 029.

### M6-01 — AppBootstrap صغير

- **الحالة:** 🟨 — التنفيذ الآلي مكتمل، واختبار AE-28 باقٍ
- **الأولوية:** P1
- **الاستخراج التدريجي:**
  1. `ToolbarController` — DOM intents فقط.
  2. `PreviewController` — raster/vector render mode.
  3. `CompositionController` — new comp/active comp/hydration.
  4. `OperationPresenter` — toast/status/modal/progress.
  5. `ApplicationLifecycle` — disposables.
- **قبول:** App يركب dependencies ويبدأ/يتلف فقط؛ لا business workflow داخله.
- **الدليل:** انخفض `client/js/app.js` من 672 إلى 259 سطرًا. استُخرجت `ToolbarController` و`PreviewController` و`CompositionController` و`OperationPresenter` و`ApplicationLifecycle`، وأضيف `ApplicationCoordinator` لتنسيق الأحداث العابرة للمكونات. يثبت اختبار آلي ملكية كل مسؤولية و`dispose` العكسي idempotent.

### M6-02 — TileCore مشتركة

- **الحالة:** 🟨 — golden coverage آلي ناجح، واختبار AE-29 باقٍ
- **الأولوية:** P1
- **المكوّنات:** `Projection`, `TileAddress`, `CoveragePlanner`, `Transport`, `DownloadSession`, `CachePolicy`.
- **Adapters:** PanelMemoryBitmapCache، DiskFileCache، AEManifestMapper.
- **migration:** حول preview أولًا أو export أولًا خلف tests، لا الاثنين في commit واحد.
- **قبول:** حساب نفس tile coverage من المسارين يعطي golden set واحدًا.
- **الدليل:** `TileAddress` و`CoveragePlanner` و`CachePolicy` و`TileTransport` و`DownloadSession` أصبحت النواة المشتركة؛ `TileGrid` وEngine مجرد adapters. اختبار golden يقارن preview/export/finalize في كادر عادي وعبر antimeridian.

### M6-03 — إزالة legacy/dead code

- **الحالة:** 🟨 — تنظيف runtime مكتمل، وsmoke ‏AE-28 باقٍ
- **الأولوية:** P2
- **قائمة العمل:** CloudBoundaryService، repo boundary cache القديم، provider aliases، `_decodeImage`، stubs/fields غير المستعملة، data artifacts غير المستخدمة.
- **قبول:** package size ينخفض، tests/build/manual smoke أخضر، لا references.
- **الدليل:** حُذف `CloudBoundaryService` بعد إثبات غياب أي runtime consumer، وحُذفت provider aliases و`_decodeImage` وحقول/دوال App غير المستعملة. `rg` بلا مراجع تشغيل، و`build`/`verify:package` ناجحان. قرار فصل ملفات source/runtime الكبيرة يُنفذ في M7-05 كي لا تُحذف مخرجات بناء موثقة بلا سياسة بيانات.

### M6-04 — Provider registry immutable

- **الحالة:** 🟨 — التنفيذ والاختبار الآلي مكتملان، واختبار AE-30 باقٍ
- **الأولوية:** P2
- **التنفيذ:** لا تعديل global config؛ registry instance + user overrides. UI يولّد key inputs من provider schema ويغطي Stadia.
- **قبول:** كل provider ظاهر إما صالح بلا key أو له حقل key صالح.
- **الدليل:** registry وdefinitions مجمدة ولا تعدّل `OpenGeoConfig`؛ selector وحقول المفاتيح مولدة من schema وتشمل Mapbox/MapTiler/Stadia، مع رفض واضح لاختيار مزود محمي بلا مفتاح.

### سجل تنفيذ M6 — 2026-08-14

- **تصحيح احترام Camera keyframes في Finalize:** كان تمرير `trajectory[last]` إلى commit يسمح لـrebuild غير المتزامن بكتابة الموقع الأخير فوق مفتاح موجود عند CTI. أُزيلت camera من معاملات prepare/commit، وأصبح `opengeoSynchronizeControllerCamera` يحفظ Latitude/Longitude/Zoom كلها إذا كان أي منها متحركًا؛ وحدها أوامر الكاميرا الصريحة تملك animation. regression ديناميكي يغطي animated/static controllers؛ التحقق الحالي `npm test` ‏89/89 والبناء وتدقيق الأحداث والحزمة ناجحة. الاعتماد اليدوي: AE-33.
- **تصحيح over-fetch في النواة المشتركة:** كشف القياس أن `CoveragePlanner` كان يحول 6 بلاطات مرئية في مثال Draft إلى 256 طلبًا بسبب scale غير كسري ومحاذاة `8×8` قبل التنزيل. أصبح scale يساوي `2^(downloadZoom-cameraZoom)` دون clamp، والهامش بلاطة واحدة، والمحاذاة opt-in فقط بعد تحديد التغطية. أزيل Base Zoom الضمني من trajectory/finalize وحُصر Host scan في المجال المتحرك بين أول وآخر keyframe داخل Work Area. أضيفت ثلاثة regressions كمية؛ التحقق الحالي `npm test` ‏88/88، والبناء وتدقيق الأحداث والحزمة ناجحة. الاعتماد اليدوي: AE-32.
- **تصحيح لاحق لأداء Add Key/Preview:** أُلغي التنافس بين تحديث Live Sync المؤجل وأمر المفتاح الصريح، وأزيل `queueAutoExport` المكرر من مسار `Add Key`. أصبح كل من viewport preview وtrajectory preview يمر عبر MegaTile packing ببصمة manifest كاملة وcache معزول حسب النطاق، بينما ينفذ Host تبديل Preview ذريًا عبر طبقات staging مخفية والتحقق من اكتمال الاستيراد قبل الإظهار. التحقق الآلي الحالي `npm test` ‏85/85 و`audit:events` ‏115 استعمالًا/27 عقدًا، والبناء والتحقق من الحزمة ناجحان. الاعتماد اليدوي الجديد: AE-31.
- **التحقق الآلي:** `npm test` ‏84/84، `npm run audit:events` يغطي 113 استعمالًا ضمن 27 عقدًا، وفحص syntax لجميع ملفات العميل ناجح.
- **البناء:** `npm run build` و`npm run verify:package` ناجحان؛ لم يُشغّل ZXP وفق قرار المنتج.
- **الأداء:** `npm run benchmark:preview`: ‏89 chunks، ‏p50 = 1.36ms، ‏p95 = 2.54ms، ‏max = 9.37ms.
- **المتبقي للإغلاق:** AE-28 وAE-29 وAE-30 فقط.

---

## 11. M7 — بيانات الخرائط والبحث والهوية الجغرافية

**الهدف:** جودة هندسية وقابلية تدقيق للحدود والتسميات دون heuristics متناثرة.  
**التبعيات:** M4/M5.  
**المخاطر:** OG-AUD-021، 022، 023، 032.

### M7-01 — GeographyIdentityResolver

- **الحالة:** ✅ منفذ — 2026-08-14
- **الأولوية:** P1
- **المدخلات:** raw Nominatim result، query، local country index.
- **المخرجات:** `{drawingIso3, displayLabel, sourceAttribution, confidence, ruleId}`.
- **القواعد:** structured fields وOSM IDs أولًا؛ aliases اللغوية registry؛ regex العام fallback منخفض الثقة.
- **اختبارات:** Western Sahara، Morocco، مدن حدودية، عناوين تحوي الاسم في hierarchy، العربية/الفرنسية/الإنجليزية، نتيجة UNKNOWN.
- **الدليل:** أضيف `GeographyIdentityResolver` بعقد ثابت يعيد `drawingIso3/displayLabel/sourceAttribution/confidence/ruleId`، وسجل aliases محلي مستقل، وأولوية OSM relation ثم الحقول المنظمة ثم fallback منخفض الثقة. أصبحت `SearchPanel` مستهلكًا للقرار ولا تحتوي heuristic جغرافيًا. يغطي الاختبار MAR/ESH والعربية/الفرنسية/الإنجليزية ومدينة حدودية وUNKNOWN وعدم تعديل بيانات Nominatim الخام. `npm test` ‏89/89، و`audit:events` ‏115/27، و`build` و`verify:package` ناجحة.

### M7-02 — CartographyPolicy versioned

- **الحالة:** ✅ منفذ — 2026-08-14
- **الأولوية:** P1
- **التنفيذ:** profile file يصف source versions، rule IDs، MAR/ESH separation profile، التاريخ، provenance/license، ومبرر product behavior.
- **قاعدة:** builder يقرأ policy بدل ثابت مدفون؛ runtime يسجل data/policy versions في metadata.
- **قرار المنتج:** المرجع الافتراضي للنزاعات المستقبلية هو مرجع أممي مراجع ومثبت، مع السماح باستثناء صريح مُصدّر يقرره مالك المنتج. هندستا `MAR` و`ESH` الحاليتان مقفلتان ولا تتغيران بسبب أي profile آخر. فلسطين مسجلة كمراجعة مستقبلية بلا أثر runtime.
- **الدليل:** `CARTOGRAPHY_POLICY.json` هو مصدر السياسة؛ يقرأه builder ويتحقق من provenance/license/SHA-256 ومعرفات القواعد، ثم يرفض أي تغير في بصمتي MAR/ESH. تُولد نسخة runtime ويضيف `CartographyPolicy` ختم policy/data/profile إلى metadata مع migration متوافق. ADR-006 يوثق القرار والرجوع. إعادة بناء 258 محيطًا ناجحة، و`npm test` ‏91/91.

### M7-03 — اختبارات هندسة ذهبية

- **الحالة:** ✅ منفذ — 2026-08-14
- **الأولوية:** P1
- **التحقق:** geometry validity، ring closure، self-intersection حسب السياسة، no unexpected overlap، expected shared boundary، bbox/area tolerance، islands، label-inside-polygon، stable hashes.
- **fixtures إلزامية:** DZA، MAR، ESH، ISL، دول جزرية ومتعددة polygons، antimeridian country.
- **الدليل:** أضيف baseline مراجع في `scripts/geometry-fixtures/country-outlines-golden.json` ومدقق مستقل `scripts/verify-vector-geometry.js` ينفذ 82 invariant على DZA/MAR/ESH/ISL/IDN/FJI: عقد الإغلاق الضمني، صلاحية الإحداثيات والحواف، المساحة وbbox، بصمة SHA-256، self-intersection، موضع label، تداخل حلقات الجزر، وسلامة قطع antimeridian دون segment يعبر عرض العالم. تفحص علاقة MAR/ESH عدم وجود تقاطع صحيح أو احتواء متبادل، وطول الحد المشترك الدقيق `3275.6399732918944` وإحداثي الفصل المعتمد؛ بقيت بصمتا الخريطتين كما هما. سُجل شذوذ المصدر الصغير `IDN-OVERLAP-001` كاستثناء مقفول لا يسمح بزيادته أو تغيره دون مراجعة مصدر. أضيف `npm run verify:geometry`، وربط المدقق بـ`land-borders:data` وبـ`npm test`؛ النتيجة 92/92. لا يحتاج هذا البند اختبار AE يدويًا.

### M7-04 — بناء بيانات قابل لإعادة الإنتاج

- **الحالة:** ✅ منفذ — 2026-08-14
- **الأولوية:** P1
- **التنفيذ:** source manifest مع URL/filename/license/SHA-256/tool versions؛ clean generation لكل 50m/10m/outlines/index؛ compare hashes.
- **قبول:** clean rebuild على نفس الأدوات ينتج hashes نفسها أو diff مبرر.
- **الدليل:** رُقي `SOURCES_MANIFEST.json` إلى schema 2.0.0 وأصبح يحصي جميع مدخلات 50m/10m وملف topology والسياسة، مع filename/role/resolution/origin/URL أو locator محلي/license/bytes/SHA-256، ويسجل Node 22.18.0 وnpm lockfile v3 وTurf 7.4.0. أصبحت المولدات الثلاثة تقبل `--data-dir` معزولًا. ينشئ `verify-vector-data-reproducibility.js` مجلدًا مؤقتًا آمنًا، ويعيد توليد 50m و10m و89 preview chunks وoutlines/index/manifest/policy، ثم يشغل 82 فحصًا هندسيًا ويقارن كل مخرج byte-for-byte مع runtime المعتمد ومع `vector-data-reproducibility-manifest.json`. النتيجة المثبتة: 97 ملفًا، 51,411,525 بايت، aggregate SHA-256 ‏`462d9b89a2d073dfe945ce82512379f926e366d22a67affe46135f3a2c0b2b3d`. يتوفر `npm run verify:data`، وأُدخل في release verification؛ `npm test` ‏93/93. لا يحتاج هذا البند اختبار AE يدويًا. إعادة تسجيل baseline تتم فقط بأمر `record:data-baseline` بعد مراجعة diff مقصودة.

### M7-05 — فصل source assets عن runtime assets

- **الحالة:** ✅ منفذ — 2026-08-14
- **الأولوية:** P2
- **التنفيذ:** مصادر البناء لا تُحزم إلا إذا احتاجها runtime؛ runtime outputs تحت مسار واضح؛ manifest يذكر الغرض لكل ملف.
- **قبول:** لا `ne_50m_admin_0_countries.json` أو `land-borders-10m.json` في ZXP إن لم يستهلكهما runtime.
- **الدليل:** نُظمت مصادر Natural Earth تحت `scripts/vector-data-sources/natural-earth/{50m,10m}`، وحُذفت نسختان 10m متطابقتان byte-for-byte بعد التحقق من SHA-256، وأصبح catalog يحصي 9 مصادر فريدة. أضيف `RUNTIME_DATA_MANIFEST.json` بعقد default-deny يحدد 8 مجموعات ومالك/غرض/أصل كل ملف؛ ويتحقق `runtime-data-contract.js` من أن كل ملف يطابق مجموعة واحدة فقط ومن غياب قائمة الممنوعات. يولد `build-vector-runtime-data.js` البيانات في مجلد مؤقت ثم ينشر 94 مخرج runtime فقط، بينما يصنف monolith ‏10m كـbuild intermediate وملفي borders/manifest كـbuild evidence. أزيلت ستة artifacts غير مستهلكة من `client/assets/data`، وأسقط `borderIds` الداخلي من فهرس البلدان التشغيلي. أصبحت الحزمة تحتوي 96 ملف بيانات مملوكًا بحجم 28,181,295 بايت، ولا تحتوي أيًا من الملفات الستة الممنوعة؛ ويطبّق `build.js` القائمة البيضاء نفسها ويتحقق منها `verify-package.js`. البصمة النظيفة الحالية: 97 مخرج بناء، 51,395,972 بايت، aggregate SHA-256 ‏`8e14c2f0eb2651c60cd9117ad2fdd8e36e2c000271e2467dff770e14c6f0f1d2`. نجحت `verify:runtime-data` و`verify:data` و94/94 اختبارًا و`audit:events` ‏115/27 و`build` و`verify:package` و`verify:release`. لا يحتاج هذا البند اختبار AE يدويًا.

---

## 12. M8 — الأمن والبناء والإصدار القابل للتدقيق

**الهدف:** بوابة إصدار production-grade مناسبة لـCEP.  
**التبعيات:** M0، وإغلاق P0/P1 المطلوبة للإصدار.  
**المخاطر:** OG-AUD-001، 011، 012، 017، 018، 020، 021، 030، 031.

### M8-01 — CSP وNode-enabled threat hardening

- **الحالة:** ✅ منفذ ومعتمد داخل CEP — 2026-08-14
- **الأولوية:** P1
- **التنفيذ:** CSP يمنع remote scripts/eval غير اللازم، inventory لكل `innerHTML`, URL sink, file path, Node API؛ static assets فقط.
- **قبول:** لا user/network text يصل إلى HTML sink؛ no remote code execution surface معروف.
- **الدليل:** أضيف CSP صريح يقصر scripts على `'self'` بلا `unsafe-eval` أو remote code، ويمنع object/frame/base/form مع السماح المحدود لـHTTPS network وblob/file images وworker محلي. أزيل آخر `innerHTML` من كود الطرف الأول؛ أيقونات البحث تُنشأ بعقد DOM لا يفسر markup، وتُمرر روابط attribution عبر `SecurityPolicy.normalizeHttpsUrl` الذي يرفض HTTP وcredentials والمخططات التنفيذية. أضيف `security-audit.js` إلى `audit:security` وبوابة `verify:release`: يفحص CSP، وremote scripts/styles، وHTML/executable sinks، ويحصر Node built-ins في `buffer/crypto/fs/os/path/process`؛ `buffer/process` مخصصان لـNodeRuntime بعد DevTools Reload. بقي `--enable-nodejs` لأنه مطلوب للكاش/jobs/stitching، لكن أي capability جديدة تفشل الإصدار افتراضيًا. النتيجة: الاختبارات وبوابات الأمن والتوافق والإصدار ناجحة؛ وأكد المستخدم نجاح AE-34 بلا شاشة فارغة أو CSP errors أو تعطل للشبكة/worker/البيانات المحلية.

### M8-02 — سياسات الشبكة والأسرار

- **الحالة:** 🟨 منفذ آليًا؛ AE-35 مؤجل لغياب التحكم بالشبكة — 2026-08-14
- **الأولوية:** P2
- **التنفيذ:** timeout/max bytes/redirect policy؛ redaction؛ توثيق plaintext local key risk أو استخدام secure storage إن توفر.
- **بيئة التطوير:** إعادة `npm strict-ssl=true` وإزالة `NODE_TLS_REJECT_UNAUTHORIZED=0` من البيئة قبل supply-chain operations.
- **الدليل:** أضيف `NetworkPolicy` موحد يفرض HTTPS بلا URL credentials، ويتحقق من بقاء الوجهة النهائية بعد redirect على HTTPS، ويقيد المهلة إلى 1–120 ثانية والحجم إلى 1KB–64MB. أصبحت البلاطات بحد 16MB/15s مع abort مبكر، والبحث بحد 1MB/10s وخمس نتائج؛ أزيل XHR fallback الموازي من Engine وأصبح مالكا XHR الوحيدان مثبتين آليًا: `TileTransport` و`SearchPanel`. توسع redaction ليشمل `key/keys/signature` في الحقول وquery، وأضيف تحذير مرئي بأن مفاتيح provider مخزنة كتفضيلات CEP محلية وليست credential vault، ووثقت السياسة في `SECURITY_AND_NETWORK_POLICY_AR.md`. صُححت بيئة التطوير فعليًا إلى `strict-ssl=true` وأزيل `NODE_TLS_REJECT_UNAUTHORIZED` من User scope، ولا يوجد Machine override. الدليل: 98/98 اختبارًا، و`audit:security` يغطي 56 ملفًا و27 Node import، و`audit:events` ‏116/27، و`verify:release` ناجحة. المتبقي AE-35 لاختبار timeout/recovery في CEF الحقيقي.

### M8-03 — Release gate كاملة

- **الحالة:** 🟨 الخطوات 1–9 والتحقق من الناتج منفذة؛ 10–11 مؤجلتان مع ZXP — 2026-08-14
- **الأولوية:** P0
- **الخطوات:**
  1. clean workspace artifact dirs.
  2. versions sync/migration check.
  3. deterministic data build.
  4. lint + syntax.
  5. unit/integration/contract/data tests.
  6. build single stage.
  7. package link/data/forbidden-file checks.
  8. SBOM/dependency audit.
  9. artifact manifest/hash.
  10. sign exact stage.
  11. inspect signed package.
- **قبول:** أي فرق بين tested manifest وsigned contents يفشل الإصدار.
- **الدليل:** أضيف `supply-chain-audit.js` الذي يفشل عند runtime npm dependency أو registry غير HTTPS أو غياب SHA-512 integrity/license أو install script غير مراجع، ويولد SBOM حتمية بصيغة CycloneDX 1.5. الحزمة الحالية لها 10 مكونات build-only و0 npm runtime dependency. أضيف `artifact-manifest.js` الذي يتحقق أولًا من تطابق إصدارات `package.json` وBundle وPanel و`extension.properties`، ثم يسجل bytes وSHA-256 لكل ملف وبصمة تجميعية، ويفشل عند أي mutation لاحق. أصبحت `verify:release` ترتب: data rebuild، 107 اختبارات، security/compatibility/performance audits، supply-chain audit/SBOM، clean build، package inspection، syntax، كتابة manifest ثم إعادة التحقق منها. الناتج الحالي: 175 ملفًا، 29,048,354 بايت، aggregate ‏`1ed4ad20148cde7eb63d8902793b3ac3d7e896cf285deaeafccb8e752e23c530`؛ تدخل بصمتا تقرير التوافق وسياسة الأداء في هوية artifact. ميزانية Vector الحالية p95=2.68ms وأقصى نافذة 306,695 نقطة/20 chunk. لم يُشغّل ZXP أو التوقيع، ولم يُدعَ تدقيق CVE حي بسبب تأجيل العمل المعتمد على الشبكة.

### M8-04 — مصفوفة التوافق الفعلية

- **الحالة:** 🟨 العقد والمدقق والـmanifest منفذة؛ AE-36/AE-37 لاعتماد Host باقية — 2026-08-14
- **الأولوية:** P2
- **التنفيذ:** لا تبقَ manifest على AE 15–99.9 بلا إثبات. اختر minimum supported فعليًا وCEP/Chromium features المستخدمة.
- **قبول:** اختبار minimum/latest وقرار موثق لإسقاط الإصدارات غير القابلة للدعم.
- **الدليل:** استُبدل نطاق `AEFT [15.0,99.9]` بـ`[18.4,24.99]`، ورفع `CSXS` من 9.0 إلى 11.0 وفق جدول Adobe الذي يجعل AE 18.4 أول After Effects مع CEP 11. يثبت `compatibility-policy.json` baseline ‏Chromium 88/Node 15.9/V8 8.7، ويثبت الفحص المحلي AE 23.6 و24.6.2 مع CEPHtmlEngine 11.5.3. يفشل `audit:compatibility` إذا اختلف manifest، أو غاب `--enable-nodejs`، أو اختفت بدائل ResizeObserver/Worker/OffscreenCanvas/XHR، أو خرج JSX عن صياغة ExtendScript القديمة، أو ظهرت Node capability غير مصرح بها. القرار والمصفوفة في `COMPATIBILITY_MATRIX_AR.md`، والنتيجة الآلية الحالية 107/107 و`verify:release` ناجحة. لا يُدعى اعتماد التشغيل الكامل قبل AE-36 وAE-37.

### M8-05 — سياسة التوقيع والشهادات

- **الحالة:** ⬜
- **الأولوية:** P1
- **التنفيذ:** self-signed للتطوير فقط؛ production يتطلب cert path عبر secret environment، لا password في CLI logs، وتاريخ/issuer موثق.
- **قبول:** أداة release تفشل إن حاول production self-sign.

---

## 13. M9 — اختبارات قبول After Effects والإصدار

**الهدف:** إثبات أن العقود النظرية تعمل في host الحقيقي.  
**التبعيات:** جميع P0 وكل P1 المحددة للنسخة.  

### 13.1 مصفوفة الاختبارات اليدوية الإلزامية

| ID | السيناريو | النتيجة المطلوبة | الحالة |
|---|---|---|---|
| AE-00 | فتح اللوحة دون ضغط أي زر مزامنة | Live Sync يبدأ في الخلفية، ولا يظهر زر enable/disable | ✅ 2026-08-14 |
| AE-01 | إنشاء خريطة جديدة 16:9 و9:16 | كادر panel = AE، لا سواد جانبي | ⬜ |
| AE-02 | drag/zoom خمس ثوانٍ | آخر camera فقط، لا jump back | ✅ 2026-08-14 |
| AE-03 | panel move ثم AE move خلال 100ms | تعديل AE يصل ولا يُقمع | ✅ 2026-08-14 |
| AE-04 | 256↔512 ثم إعادة فتح comp | استعادة كاملة بلا Console error | ✅ 2026-08-14 |
| AE-05 | تبديل compين لكل منهما metadata | لا state bleed | ✅ 2026-08-14 |
| AE-06 | تبديل ESRI→OSM أثناء requests | لا بلاطات مختلطة | ⬜ |
| AE-07 | cache eviction ثم العودة | البلاطات تعود تلقائيًا | ⬜ |
| AE-08 | Finalize ناجح | imported=expected وfinalized metadata صحيح | ✅ 2026-08-14 |
| AE-09 | إلغاء قبل commit | final السابق سليم ولا mutation | ✅ 2026-08-14 |
| AE-10 | إلغاء أثناء commit | حالة دقيقة ثم reconciliation | ✅ 2026-08-14 |
| AE-11 | حذف/إفساد tile قبل import | Finalize يفشل ويحفظ القديم | ✅ 2026-08-14 |
| AE-12 | مشروع غير محفوظ | رفض مبكر بلا ملفات/Undo | ⬜ |
| AE-13 | Work Area طويل >5000 frames | adaptive plan ينجح أو يرفض بسبب tile budget واضح | ⬜ |
| AE-14 | Record + keyframes + scrub | preview للمسار والموقع الحالي صحيح | ✅ 2026-08-14 |
| AE-15 | Offline vector 50m/10m | لا freeze ملحوظ وطبقات صحيحة | ✅ 2026-08-14 |
| AE-16 | GeoJSON صالح/فاسد/كبير | success/error/limit رسائل صحيحة | ✅ 2026-08-14 |
| AE-17 | رسم DZA/MAR/ESH/ISL | shape/label/identity وفق fixtures | ⬜ |
| AE-18 | رسم البلد نفسه مرتين | يستبدل نفس الملكية فقط | ⬜ |
| AE-19 | layer مستخدم يبدأ بـfinal_ | لا يُحذف | ⬜ |
| AE-20 | خرائط متعددة في مشروع واحد | لا حذف متبادل للأصول | ⬜ |
| AE-21 | فحص Undo بعد sync/final/vector/key | لا تكدس live sync؛ عمليات صريحة خطوة مناسبة | ✅ 2026-08-14 |
| AE-22 | restart AE وفتح المشروع | metadata/assets/expressions سليمة | ⬜ |
| AE-23 | شبكة بطيئة/منقطعة | UI responsive، retry/cancel صادق | ⬜ |
| AE-24 | ZXP المثبت على جهاز نظيف | نفس version/hash/features المختبرة | ⬜ |
| AE-25 | تبديل compين 1:1 و16:9 ثم فتح metadata صحيحة/فاسدة | كل إطار يطابق أبعاد CompItem؛ الصحيحة تُستعاد دفعة واحدة والفاسدة لا تغيّر الحالة | ✅ 2026-08-14 |
| AE-26 | smoke لأوامر Bridge v2: إنشاء/مزامنة/Finalize/Key/Pin/Vector | كل أمر ناجح يعيد نتيجة صحيحة، ولا يظهر mismatch أو malformed أو timeout | ✅ 2026-08-14 |
| AE-27 | تنفيذ sync ناجح وفشل شبكة ثم فحص سجل العمليات | `operations.jsonl` يحوي duration/errorCode بلا مفاتيح أو tokens، والواجهة تبقى سليمة | ✅ 2026-08-14 |
| AE-28 | إعادة تحميل اللوحة ثم smoke لكل الشريط: zoom/center، نافذتا Settings/New Comp، GeoJSON، Add Key/Record/Pin/Finalize | لا زر صامت أو listener مكرر أو Console error؛ إغلاق/فتح النوافذ واستيراد الملف يعملان مرة واحدة | ⬜ |
| AE-29 | Raster عند موقع عادي ثم قرب خط 180°، drag/zoom ثم Finalize | لا سواد أو بلاطات مكررة/ناقصة؛ كادر المعاينة وAE متطابق وآخر موضع هو المطبق | ⬜ |
| AE-30 | فتح Settings وفحص Esri/OSM وMapbox/MapTiler/Stadia وCustom XYZ | كل المزوّدات ظاهرة؛ الثلاثة المحمية لها حقول؛ اختيار المحمي بلا key يعطي خطأ واضحًا ويرجع للمصدر السابق؛ Custom HTTPS صالح يعمل | ⬜ |
| AE-31 | مفتاح أول ثم تحريك الخريطة في زمن ثانٍ والضغط على `Add Key` مع مراقبة Viewer وطبقات Preview | الأمر لا ينتظر build قديمًا؛ لا يحدث viewport build مكرر؛ الجيل السابق يبقى مرئيًا حتى اكتمال الحزمة الجديدة ثم يظهر Preview كاملًا دفعة واحدة بعدد طبقات محدود | ✅ 2026-08-14 |
| AE-32 | Zoom 6 في كادر 16:9 ثم مسار بمفتاحين داخل Work Area أطول من مجال الحركة، مع مراقبة عدد الطلبات | لا محاذاة تنزيل `8×8`؛ عدد Preview قريب من المرئي + هامش بلاطة؛ لا تنزيل للمقاطع الثابتة خارج المفتاحين أو Base Zoom مكررة؛ لا سواد داخل الكادر | ✅ 2026-08-14 |
| AE-33 | مفتاحان مختلفان عند 0s و3s، تشغيل Finalize وتحريك CTI أثناء prepare/commit ثم فحص القيم والـViewer | لا تتغير أي قيمة keyframe ولا يضاف مفتاح؛ يعرض 0s الموقع الأول و3s الموقع الثاني ويظل interpolation صحيحًا بعد Finalize | ✅ 2026-08-14 |
| AE-34 | أعد تحميل لوحة OpenGeo، افتح ESRI وOffline Vector، نفذ بحثًا وارسم بلدًا ثم افتح Settings واضغط attribution | لا شاشة فارغة أو CSP Console errors؛ الصور والبحث والworker والبيانات المحلية تعمل؛ الرابط HTTPS فقط؛ لا وظيفة مكسورة | ✅ 2026-08-14 |
| AE-35 | افتح Settings وتأكد من تحذير تخزين المفاتيح، جرّب Custom XYZ يبدأ بـHTTP، ثم افصل الشبكة ونفذ بحثًا/تحميل Raster وأعدها | HTTP يُرفض قبل الحفظ؛ الواجهة تبقى مستجيبة؛ البحث يعطي timeout خلال نحو 10s والبلاطات تفشل ضمن نحو 15s؛ بعد عودة الشبكة تتعافى الطلبات بلا reload ولا يظهر URL بمفتاح في Console | ⏭️ مؤجل: لا تحكم بالشبكة في البيئة الحالية |
| AE-36 | على AE 23.6: افتح اللوحة وأنشئ خريطة ثم pan/zoom وAdd Key وFinalize وارسم بلدًا وأعد فتح اللوحة | لا parser/Bridge error؛ الحالة والأصول صحيحة وتطابق السلوك الحالي | ⬜ |
| AE-37 | على AE 24.6.2: أعد السيناريو مع Offline Vector وRecord ومسار keyframes | النتائج متكافئة وظيفيًا مع AE 23.6 ولا capability failure | ⬜ |
| AE-38 | أثناء تنزيل Preview بدّل ESRI→OSM→Custom أو غيّر تعريف Custom من دون حركة إضافية | تلغى الأجيال القديمة؛ لا تختلط البلاطات ويصل جيل المزوّد الأخير فقط | ⬜ |
| AE-39 | ارفع GeoJSON يحوي Polygon/Line/Point داخل Map composition ثم حرّك الخريطة وأعد رفع الملف | تظهر Shape Layers مرتبطة بـMapPivot وبأنواع مسار صحيحة، وإعادة الرفع تستبدل الملكية نفسها بلا تكرار | ⬜ |

### 13.2 الأداء اليدوي/المقاس

- تسجيل DevTools Performance أثناء 10 ثوانٍ drag/zoom في raster وvector.
- قياس heap قبل وبعد تبديل 50m↔10m عشر مرات.
- مشروع AE به عدد كبير من comps لقياس poll duration.
- Finalize لمسار قصير وطويل مع سجل operation durations.

### 13.3 قرار الإصدار

- لا unresolved P0.
- P1 المؤجلة تحتاج waiver مكتوبًا مع impact/workaround/target release.
- كل الاختبارات الآلية خضراء.
- كل عناصر AE matrix المطلوبة للنسخة ✅.
- ZXP signature وartifact manifest محفوظان.
- rollback package مجرب.

---

## 14. حزم العمل التفصيلية حسب المكوّن

### العميل/UI

- [ ] UI ينتج intents ولا يدير business operations.
- [ ] كل listener قابل للتخلص.
- [ ] toast لا يعلن نجاحًا دون Result.
- [ ] preview render بلا side effect إلى AE.
- [ ] operation progress مشتق من state لا emits مبعثرة.

### الحالة

- [ ] MapSession write boundary.
- [ ] hydration ذري.
- [ ] revisions لكل camera/document/provider.
- [ ] migrations لكل schema.

### البلاطات

- [ ] cache/downloader lifecycle متسق.
- [ ] DownloadSession scoped.
- [ ] provider namespace immutable.
- [ ] coverage وantimeridian golden tests.
- [ ] missing MegaTile transparency.

### Bridge/Host

- [ ] protocol v2 typed.
- [ ] Host limits لكل payload.
- [ ] prepare/commit/rollback.
- [ ] ownership metadata.
- [ ] timeout/reconciliation semantics.
- [ ] Undo tests.

### البيانات المتجهية

- [x] chunked preview data.
- [x] geometry validation.
- [x] identity resolver.
- [x] cartography policy.
- [x] provenance/licenses/hashes.

### البناء والاختبارات

- [ ] artifact واحد.
- [x] behavior tests لا static فقط.
- [x] clean reproducible data build.
- [x] package inspection.
- [ ] signed artifact provenance.

---

## 15. مصفوفة التتبع: كل نتيجة إلى مهمة

| نتيجة التقرير | مهام الإغلاق | حالة التغطية |
|---|---|---|
| OG-AUD-001 | M0-01، M8-03 | 🟨 stage واحد وmanifest/SBOM قابلة للتحقق؛ توقيع ZXP مؤجل |
| OG-AUD-002 | M0-02، M1-01 | ✅ العيب المباشر مغلق |
| OG-AUD-003 | M0-03، M1-02، M5-03 | ✅ catalog وتدقيق الأسماء ورفض Promise مغلقة آليًا |
| OG-AUD-004 | M2-01، M2-02 | ✅ مغلق ومعتمد داخل AE |
| OG-AUD-005 | M0-03، M1-03 | ✅ العيب المباشر مغلق |
| OG-AUD-006 | M3-01، M3-02 | ✅ مغلق آليًا |
| OG-AUD-007 | M2-02 | ✅ مغلق ومعتمد داخل AE |
| OG-AUD-008 | M2-03 | ✅ مغلق ومعتمد داخل AE |
| OG-AUD-009 | M4-01، M4-02، M4-03 | ✅ القياس الآلي وAE-15 معتمدان |
| OG-AUD-010 | M4-04 | ✅ GeoJSON gate وAE-16 معتمدان |
| OG-AUD-011 | M4-05، M8-01 | ✅ دفاع Host وCSP/DOM/Node capability audit مكتملة ومعتمدة داخل CEP |
| OG-AUD-012 | M2-05، M3-01، M5-04 | ✅ Bridge v2 مكتمل ومعتمد داخل AE |
| OG-AUD-013 | M3-03 | ✅ مغلق آليًا |
| OG-AUD-014 | M1-01، M5-01، M5-02 | ✅ write boundary وhydration transaction معتمدان داخل AE |
| OG-AUD-015 | M6-01 | 🟨 التفكيك واختبارات الملكية مكتملة؛ AE-28 باقٍ |
| OG-AUD-016 | M6-02 | 🟨 النواة وgolden coverage مكتملان؛ AE-29 باقٍ |
| OG-AUD-017 | M0-03، M8-03، M9 | 🟨 بوابة آلية بـ107 اختبارات مكتملة؛ اعتماد الإصدار/M9 باقٍ |
| OG-AUD-018 | M0-01، M0-04، M6-03 | 🟨 dead runtime code محذوف؛ baseline/release scope باقٍ |
| OG-AUD-019 | M6-03، M7-05 | ✅ حُذفت code artifacts الميتة وفُصلت مصادر/وسائط البناء عن حزمة بيانات runtime بقائمة سماح قابلة للتحقق |
| OG-AUD-020 | M5-05، M8-03 | 🟨 migrations وعقد compatibility آلي مكتملان؛ AE-36/AE-37 باقيان |
| OG-AUD-021 | M7-04، M8-03 | 🟨 data/SBOM/artifact reproducibility مكتملة؛ التوقيع والتدقيق الحي مؤجلان |
| OG-AUD-022 | M7-01 | ✅ Resolver مركزي قابل للتفسير والاختبار، ولا heuristics جغرافية داخل UI |
| OG-AUD-023 | M7-02، M7-03، M7-04 | ✅ policy/provenance وgolden geometry وإعادة الإنتاج الكاملة منفذة |
| OG-AUD-024 | M3-06، M9/AE-13 | ✅ إصلاح الإدخال/الكادر معتمد داخل AE |
| OG-AUD-025 | M2-04 | ✅ مغلق ومعتمد داخل AE |
| OG-AUD-026 | M3-04 | ✅ مغلق ومعتمد داخل AE |
| OG-AUD-027 | M3-05، M5-06 | ✅ polling وOperationLogger معتمدان داخل AE |
| OG-AUD-028 | M2-06، M6-03 | 🟨 lifecycle/dead runtime cleanup مكتمل؛ AE-28 باقٍ |
| OG-AUD-029 | M1-04، M6-01 | 🟨 ApplicationCoordinator وcontrollers مكتملة؛ AE-28 باقٍ |
| OG-AUD-030 | M4-06، M5-06 | ✅ I/O/render وobservability معتمدة داخل AE |
| OG-AUD-031 | M6-04 | 🟨 immutable schema registry مكتمل؛ AE-30 باقٍ |
| OG-AUD-032 | M3-06 | ✅ مغلق آليًا |
| OG-AUD-033 | M0-03، M4/M6 | ✅ تعريف provider مثبت داخل snapshot، وإلغاء cancel-first ومعاينة latest-only واختبار repeated viewport مغلقة آليًا؛ AE-38 تحقق بصري إضافي |

**فحص التغطية:** 33/33 نتيجة مرتبطة بمهمة واحدة على الأقل؛ لا توجد نتيجة يتيمة.

---

## 16. ترتيب التنفيذ المقترح

```text
M0 artifact/tests
  └─► M1 direct P0 fixes
       ├─► M2 atomic Finalize
       ├─► M3 concurrency isolation
       └─► M4 performance/limits
              └─► M5 contracts/state
                     └─► M6 decomposition/core unification
                            └─► M7 data/cartography governance
                                   └─► M8 release hardening
                                          └─► M9 AE acceptance/release
```

يمكن تنفيذ M2 وM3 وM4 في فروع منفصلة بعد M1، لكن الدمج بالترتيب M3 → M2 → M4 يقلل تعارضات Finalize. لا يبدأ M6 قبل توفر tests كافية، لأن تفكيك App دون characterization سيرفع المخاطر بدل خفضها.

---

## 17. استراتيجية commits والعودة

### حجم commit

- اختبار regression مستقل إن أمكن.
- إصلاح واحد أو contract migration واحد.
- لا تجمع build path وruntime behavior وdata regeneration في commit واحد.

### نقاط العودة

1. Tag baseline قبل M0.
2. Tag بعد توحيد artifact.
3. Tag بعد إغلاق P0 المباشر.
4. Tag قبل وبعد transaction protocol.
5. Release candidate tag بعد M8.

### migrations التوافقية

- Metadata reader يدعم N وN-1 وN-2 خلال دورة انتقال.
- Bridge v1 adapter يبقى خلف feature flag حتى اكتمال جميع commands.
- Legacy AE assets تُقرأ وتُعلّم عند أول commit ناجح؛ لا حذف blind.

---

## 18. قالب تحديث التنفيذ

يُنسخ هذا القالب تحت المهمة عند بدء العمل:

```markdown
#### سجل التنفيذ

- الحالة: 🟦 قيد التنفيذ
- بدأ في: YYYY-MM-DD
- المنفذ:
- الفرع/commit:
- نتائج التقرير المغلقة:
- التغييرات:
- الاختبارات المضافة:
- نتائج الاختبارات الآلية:
- اختبار AE المطلوب:
- مخاطر/انحرافات:
- rollback المجرب:
- دليل الإغلاق:
```

وعند الإغلاق:

```markdown
- الحالة: ✅ منفذ
- اكتمل في: YYYY-MM-DD
- DoD: مكتمل
- الأدلة: [test log] [artifact manifest] [AE test IDs]
```

---

## 19. Definition of Done العامة

لا تكتمل أي مهمة إلا إذا:

- [ ] رُبطت بمعرّف التقرير.
- [ ] أضيف اختبار يفشل قبل الإصلاح حيث ينطبق.
- [ ] نجحت unit/integration/contract tests المناسبة.
- [ ] لم تضف catch صامتًا أو global mutable state جديدًا.
- [ ] وثقت حدود الإدخال والمخرجات والأخطاء.
- [ ] نجح syntax/lint/build/package verification.
- [ ] نُفذ اختبار AE المحدد إن كانت المهمة Host-facing.
- [ ] جُرب rollback أو ثبت أنه لا يحتاج migration.
- [ ] حُدثت حالة المهمة ولوحة المرحلة ومصفوفة التتبع.

---

## 20. أول Sprint تنفيذي مقترح

الترتيب العملي لأول دورة، دون خلط إعادة الهيكلة:

1. M0-02 وM0-03: regression tests للrestore/EventBus/cache/import counts.
2. M1-05: تثبيت Live Sync الدائم وإزالة toggle القديم.
3. M1-01: إصلاح hydration tile size.
4. M1-02: async EventBus/error boundary.
5. M1-03: cache eviction lifecycle.
6. M3-01/M3-02: snapshot وDownloadSession قبل تعديل Finalize.
7. M2-02 ثم M2-01: typed import result ثم transaction.
8. M2-03: شفافية/اكتمال MegaTiles.
9. تشغيل AE-00، AE-04، AE-06، AE-07، AE-08، AE-09، AE-11، AE-20، AE-21.
10. يعود M0-01 الخاص بـZXP عند بدء إعداد النسخة النهائية فقط.

**نتيجة Sprint المطلوبة:** يمكن إصدار build داخلي غير موقع بثقة، ويستحيل أن يحذف Finalize نتيجة صحيحة عند فشل البديل.

---

## 21. سجل القرارات المفتوحة

| ADR | القرار | موعده | الحالة |
|---|---|---|---|
| ADR-001 | JavaScript globals أم TypeScript modules | M0 | ✅ `ADR-001_BUILD_ARCHITECTURE_AR.md`؛ JavaScript كلاسيكي لهذه الدورة وحذف configs الوهمية |
| ADR-002 | Finalize prepare/commit protocol | بداية M2 | ⬜ |
| ADR-003 | DownloadSession ownership | بداية M3 | ⬜ |
| ADR-004 | Vector preview chunk format/index | بداية M4 | ✅ index JSON + bbox/SHA-256 + Morton chunks + concurrency=2 |
| ADR-005 | Bridge Protocol v2 schema | بداية M5 | ✅ envelope 2.0.0 + typed handlers + stable error codes |
| ADR-006 | Cartography policy/profile governance | بداية M7 | ✅ `ADR-006_CARTOGRAPHY_POLICY_GOVERNANCE_AR.md` + policy 1.0.0 |
| ADR-007 | Minimum supported AE/CEP | M8 | ✅ `COMPATIBILITY_MATRIX_AR.md` + policy قابلة للتدقيق |

---

## 22. الحكم التنفيذي

ابدأ باختبارات M0-02/M0-03 ثم أغلق M1 قبل تحسينات الواجهة أو المزودات. ZXP مؤجل ولا يوقف تطوير الإضافة داخل CEP. الخطر التشغيلي الأهم الآن هو أن Finalize قد يحذف النتيجة الصحيحة قبل إثبات البديل؛ بعد إغلاقه وعزل DownloadSession تصبح بقية الخطة refactoring منضبطًا بدل مطاردة أعطال متداخلة.

هذه الوثيقة هي tracker التنفيذي الرسمي لهذه الدورة. أي مشكلة جديدة تُمنح `OG-AUD-033` وما بعده في التقرير، ثم تربط هنا بمهمة واختبار قبول قبل بدء الإصلاح.
