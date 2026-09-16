# خطة إصلاح OpenGeo الكاملة

**مرجع:** `OPEN_GEO_ATOMIC_AUDIT_2026-08-12_AR.md`  
**هدف الخطة:** تحويل OpenGeo إلى إضافة CEP قابلة للبناء والتوزيع والاختبار بثقة، من دون خلط بين إصلاح المنتج وإخفاء أعراض أدوات البناء.

## مبادئ التنفيذ

1. لا إصلاحات وظيفية قبل توحيد artifact الإصدار؛ وإلا سنختبر نسخة لا تصل للمستخدم.
2. `client/`, `host/`, و`CSXS/` هي المصادر الوحيدة؛ `dist/` ناتج مولد فقط.
3. كل تغيير سلوكي يسبقه/يرافقه اختبار يلتقط العطل الأصلي.
4. لا نضيف مزود خرائط أو امتياز CEP إلا بعقد استخدام واختبار Preview وExport وFinalize.
5. لا نعتبر الاختبار الأخضر كافيًا حتى ينجح smoke test داخل After Effects على ZXP المفكوك.

## المسار الحرج

```text
P0: Artifact واحد + تحقق صحيح
  ↓
P1: URL/مفاتيح providers + أمن مدخلات الشبكة
  ↓
P2: دورة الحياة والاختبارات والتشغيل الموثوق
  ↓
P3: تنظيف المعمارية والتوافق والتوثيق
  ↓
Release candidate: اختبار ZXP في After Effects
```

## المرحلة 0 — تثبيت خط الأساس وحماية العمل

**الهدف:** منع فقدان حالة المستخدم والقدرة على إثبات الفرق قبل/بعد.

1. انقل المشروع إلى مستودع Git أو أنشئ نسخة snapshot خارج مجلد CEP المثبت.
2. سجّل hash لمجلدات المصدر الحالية ولا تعدّل `dist/` يدويًا.
3. أضف `docs/TEST_MATRIX.md` وقائمة إصدارات After Effects/Windows المستهدفة.
4. عرّف متغيرات بيئة للاختبار فقط لمفاتيح providers؛ لا تحفظ مفاتيح حقيقية في المستودع أو fixtures.

**معيار القبول:** يمكن استعادة baseline، وكل output قابل للحذف وإعادة التوليد دون لمس المصدر.

## المرحلة 1 — إصلاح pipeline الإصدار (P0)

### 1.1 اختيار artifact واحد

اجعل `dist/` مخرج البناء الوحيد. يعدّل `scripts/build.js` ليقوم بالآتي:

1. يحذف `dist/` فقط بعد التحقق من أنه `<root>/dist`.
2. ينسخ `client/`, `host/`, `CSXS/` إلى `dist/`.
3. يكتب `dist/build-manifest.json` يحوي النسخة، timestamp، قائمة الملفات وSHA-256.
4. لا يستخدم `release/stage` في أي خطوة إنتاج؛ إن احتاجت أرشفة قديمة فتنقل خارج pipeline.

### 1.2 ترتيب أوامر npm

اعتمد ترتيبًا صريحًا:

```text
sync:versions → clean → build → test:unit → verify:package → package:zxp → verify:zxp
```

ويجب أن يشغّل `package:zxp` build بنفسه أو يطلب marker حديثًا؛ لا يعتمد على `dist` قديم.

### 1.3 توحيد الإصدارات

مصدر النسخة هو `package.json`. يحدث `sync:versions` كلًا من:

- `CSXS/manifest.xml`: Bundle وExtension version.
- `CSXS/extension.properties`.
- `client/js/config.js`، أو استبداله بمتغير build مولد إن قررنا جعل رقم UI منفصلًا.

أضف assertion يفشل عند عدم تطابق القيم قبل البناء وبعده.

### 1.4 إصلاح verifier والأرشيف

- حلّل `src` و`href` كـ URL، واحذف query/hash عند اختبار الوجود.
- افحص `MainPath`, `ScriptPath`, الأيقونة، Worker URL، وكل ملفات HTML/CSS/JS المحلية.
- حدّد قائمة allowlist لمحتوى `dist`، واحظر `node_modules`, `.debug`, `temp`, `docs`, source maps غير المقصودة.
- بعد ZXP، فكّه في مجلد مؤقت وقارن manifest hashes مع `dist`.

**اختبارات الإلزام:**

- رابط `foo.js?v=4` موجود ينجح.
- رابط `foo.js?v=4` غير موجود يفشل.
- ZXP بعد build يحتوي نفس `manifest.xml` و`app.js` الموجودين في `dist`.
- تغيير نسخة واحد ينعكس في جميع ملفات النسخ وحزمة ZXP.

**معيار قبول المرحلة:** لا يشير أي script إلى `release/stage` أو `build/` كartifact إنتاج، و`npm run package:zxp` green end-to-end.

## المرحلة 2 — توحيد providers والمفاتيح (P1)

### 2.1 عقد Provider واحد

أنشئ API داخليًا واضحًا في `ProviderManager`:

```js
getProvider(id)
validateProvider(id)
buildTileUrl({ id, x, y, z })
getResolvedTemplate(id)
```

يحمل Provider: `id`, `urlTemplate`, `requiresKey`, `tileSize`, zoom limits, attribution, policy. يحل API المفتاح من مخزن واحد فقط، ولا يقبل `apiKey` المتشظي من `prefs` أو `TileManager`.

### 2.2 إعادة توصيل المسارات الثلاثة

- Preview: `TileManager` يطلب `buildTileUrl`.
- Auto export: `SyncManager` يستخدم `getResolvedTemplate` لا `src.url` الخام.
- Finalize: `TilePlanner` يبني كل URL عبر manager، ولا يقرأ `prefs.apiKey`.

### 2.3 المعالجة الآمنة للمفاتيح

- عند `requiresKey` ومفتاح فارغ: أوقف العملية قبل الشبكة برسالة "أضف مفتاح X من Settings".
- لا تضع المفتاح في status، log، `build-manifest` أو error message.
- صرّح للمستخدم أن `localStorage` ليس vault؛ إن كانت متطلبات الأمان عالية استخدم تخزين نظام التشغيل عبر host/native helper مستقبلاً.

### 2.4 Google وCustom XYZ

- احذف Google UI ومسار التخزين في هذه الدورة، ما لم تتوافر متطلبات المنتج والتفويض وAPI المعتمد.
- Custom XYZ: تحقق URL بـ `https:` فقط (مع allowlist اختيارية)، يقتصر على placeholders `{z}`, `{x}`, `{y}`, وتظهر رسالة تحذير للخصوصية/التكلفة.

**اختبارات الإلزام:** ESRI بلا مفتاح؛ Mapbox/MapTiler بمفتاح mock؛ كل من Preview/Auto export/Finalize؛ مفتاح ناقص؛ template مخصص غير صالح؛ عدم تسرب المفتاح إلى logs.

**معيار القبول:** لا توجد قراءة لـ `prefs.apiKey` ولا تمرير لـ `src.url` الخام في مسارات تنزيل الإنتاج.

## المرحلة 3 — الأمن ومدخلات البيانات (P1)

1. استبدل كل عرض نص شبكة بـ `textContent`، خصوصًا `SearchPanel` و`BoundaryManagerUI`.
2. اجعل أي HTML ثابت (الأيقونات فقط) يتولد محليًا، لا من استجابة الشبكة.
3. راجع تحميل GeoJSON: تحقق من الحجم والنوع والبنية والحدود العددية قبل الرسم أو التخزين.
4. أبقِ `--enable-nodejs` فقط إذا ظل مطلوبًا، واحذف `--mixed-context` و`--allow-file-access-from-files` من artifact النهائي ما لم يُثبت الاستخدام. استخدم manifest واحدًا مولدًا.
5. ضع adapter للملفات بقائمة عمليات ومسارات مسموحة؛ لا تكتب log في `C:/Temp` مباشرة.

**اختبارات الإلزام:** payload XSS من Nominatim وGeoJSON؛ URL مخصص `file:`/`javascript:`؛ مسار log غير قابل للكتابة؛ بدء الإضافة مع Node غير متاح.

**معيار القبول:** لا يظهر `innerHTML =` مع بيانات خارجية في المراجعة، ولا توجد امتيازات CEP زائدة في `dist/CSXS/manifest.xml`.

## المرحلة 4 — إصلاحات الوظائف وتجربة المستخدم (P1/P2)

1. أنشئ `CloudBoundaryService` في `App` أو مرره صراحة إلى `SearchPanel`; لا تجعل زر الحفظ يعتمد على تنفيذ Vector Map سابق.
2. أظهر loading/failure/success لحفظ boundary، مع retry محدود وإلغاء.
3. احفظ `opengeo_theme` في listener `settings:themeChanged` وتحقق القيمة عند التحميل.
4. اعرض فقط الحقول المدعومة فعليًا في Settings؛ أصلح/أزل Google.
5. وحّد رسائل النصوص بـ UTF-8؛ افصل strings عن منطق التنزيل والـ JSX لتسهيل التعريب.
6. حدّد سياسة attribution ظاهرة دائمًا وprovider terms قبل Finalize.

**معيار القبول:** "بحث → حفظ boundary" يعمل في جلسة نظيفة، النسق يستمر بعد إعادة فتح اللوحة، ولا تظهر ميزة غير قابلة للاستخدام.

## المرحلة 5 — دورة الحياة والموثوقية (P2)

1. أضف `dispose()` لكل من `App`, `AESyncEngine`, `SyncManager`, `MegaTileStitcher`, `SearchPanel`.
2. خزّن وأزل `ResizeObserver`, `window` listeners, intervals, timeout, worker listeners.
3. أضف إلغاء طلبات التنزيل والبحث عندما تتغير viewport أو comp أو تغلق اللوحة.
4. اجعل `FinalizeController` يوقف التنفيذ عند كل مرحلة ويعيد UI لحالة قابلة لإعادة المحاولة.
5. استبدل catch الفارغ في المواضع الحرجة برسالة آمنة وtelemetry محلي اختياري.
6. أضف rate limits/backoff وحدود tile count لكل provider؛ يجب أن يطلب Finalize التأكيد أو يرفض إن تجاوز الحد.

**اختبارات الإلزام:** 20 دورة فتح/غلق، تغيير comp أثناء تنزيل، قطع شبكة، timeout، Finalize كبير، ومراقبة عدم بقاء timers/workers بعد dispose.

## المرحلة 6 — الاختبارات وقابلية الصيانة (P2/P3)

### 6.1 هيكل الاختبارات

استخدم test runner Node مناسبًا وأضف:

- وحدات: `ProviderManager`, URL builder, projections, TilePlanner, escape/serialization AE.
- تكامل DOM بمستند صغير: selectors وSettings وSearch sanitization.
- تكامل build: build/verify/archive hashes.
- عقود bridge: mocks لـ `CSInterface.evalScript` يختبر timeout/success/error وpayload escaping.
- fixtures لـ ExtendScript strings ونتائج AE JSON؛ الاختبار الحقيقي داخل AE يبقى smoke test منفصلًا.

### 6.2 جودة المصدر

- فعّل ESLint/formatting متوافقًا مع CEF المستهدف.
- أضف فحص UTF-8 ورفض mojibake الشائع.
- أضف `npm run check` يجمع lint + tests + build verifier.
- قرر مصير `BoundaryManagerUI.js`: دمج فعلي واختبار، أو حذف من المصدر والحزمة.
- احذف النسخ القديمة من `dist`, `release/stage`, `build` من التحكم اليدوي؛ واجعلها مولدة فقط.

**معيار القبول:** الاختبارات تمسك عيوب P0-03 وP1-01 وP1-03 وP1-04 قبل الدمج.

## المرحلة 7 — التحقق داخل After Effects والإصدار

نفذ على الأقل على أقدم إصدار مدعوم، وأحدث إصدار مستهدف، وعلى Windows نظيف:

| السيناريو | النتيجة المطلوبة |
|---|---|
| تثبيت ZXP/فتح panel | لا أخطاء Console، UI يعمل |
| ESRI Preview + New Comp | comp وبلاطات صحيحة |
| Provider بمفتاح | Preview/Export/Finalize ينجحون |
| مفتاح مفقود | رسالة واضحة بلا request فاشل متكرر |
| مشروع غير محفوظ + Finalize | منع آمن ورسالة واضحة |
| مسار camera متحرك | جميع البلاطات المطلوبة موجودة بلا seams ظاهرة |
| انقطاع الشبكة | إعادة محاولة محدودة وإلغاء/استعادة سليمة |
| Search/GeoJSON خبيث | نص آمن، لا تنفيذ JavaScript |
| إغلاق/إعادة فتح | لا polling أو workers متبقين |

قبل النشر: وقّع ZXP بشهادة إنتاج، فك الحزمة وتحقق من hashes، وثبّتها في بيئة جديدة. لا توزع مجلد `dist` من جلسة تطوير لم يمر بالـ pipeline.

## ترتيب التنفيذ العملي

1. المرحلة 0 + المرحلة 1 كاملة.
2. المرحلة 2 كاملة قبل محاولة إصلاح Finalize منفردًا.
3. المرحلة 3 ثم المرحلة 4.
4. المرحلة 5 و6 بالتوازي المنطقي داخل commits صغيرة بعد تثبيت API.
5. المرحلة 7 فقط على artifact موقّع من pipeline الجديد.

## Definition of Done

يُعد الإصلاح مكتملًا فقط إذا:

- لا توجد عناصر P0 أو P1 مفتوحة.
- جميع أوامر `check` و`package:zxp` تنجح من مساحة عمل نظيفة.
- الحزمة المفكوكة تطابق `dist` المولد في نفس التشغيل.
- مصفوفة After Effects أعلاه موثقة بالنتائج والإصدارات.
- تمت مراجعة أمنية أخيرة لإدخال الشبكة، مفاتيح API، ووسائط CEF.

