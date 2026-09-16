# تقرير التدقيق الذري لإضافة OpenGeo

**تاريخ التدقيق:** 12 أغسطس 2026  
**النطاق:** `OpenGeo/` كاملًا، مع التركيز على نسخة المصدر التي يشغّلها ملف CEP، وبناء الحزمة، ومسارات After Effects.  
**نوع التدقيق:** ساكن + تحقق قابل للتكرار من أدوات البناء. لم تُشغّل الإضافة داخل After Effects في هذا التدقيق؛ لذلك تظل حالات AE/CEP التشغيلية في قائمة الاختبارات الإلزامية قبل الإصدار.

## الخلاصة التنفيذية

الإضافة تحتوي على وظائف واسعة ومكونات مفصولة نسبيًا، وتنجح في فحص JavaScript النحوي الأساسي. لكن **لا تصلح الحزمة الحالية للتوزيع**. المشكلة الأهم ليست عطل واجهة وحسب: سلسلة الإصدار تبني وتتحقق من مجلد، ثم تنشئ ZXP من مجلد مختلف وقديم. وبذلك لا يوجد ضمان أن ما اختُبر هو ما يوزّع للمستخدم.

**قرار الإصدار:** `NO-GO` حتى إنجاز عناصر P0 أدناه وإجراء اختبار يدوي داخل After Effects على حزمة ZXP الناتجة نفسها.

| التصنيف | العدد | المعنى |
|---|---:|---|
| P0 — حاجب إصدار | 3 | يمنع حزمة صحيحة أو يجعل وظيفة رئيسية غير موثوقة |
| P1 — حرج | 5 | تعطل وظائف معلنة أو تفتح سطح مخاطر عاليًا |
| P2 — مهم | 6 | جودة/موثوقية/قابلية صيانة متضررة |
| P3 — تحسين | 4 | دين تقني أو تجربة مستخدم |

## النطاق والمنهجية

تم فحص مصدر اللوحة `client/`، مضيف ExtendScript في `host/`، تعريف CEP، scripts البناء والحزم، ونسخ المخرجات (`dist/` و`release/stage/`). الإجراءات القابلة لإعادة التنفيذ:

```powershell
npm test
npm run build
npm run verify:package
Get-ChildItem client/js -Recurse -Filter *.js | % { node --check $_.FullName }
```

النتيجة الفعلية في بيئة التدقيق:

- `npm test`: نجح (3/3)، لكنه فحص مصغر ولا يختبر تكامل الإضافة.
- `npm run build`: نجح وأنشأ `release/stage/`.
- `npm run verify:package`: **فشل** بثمانية روابط Script ذات query string.
- فحص `node --check`: نجح لجميع ملفات المصدر الـ 37 تحت `client/js`.
- ليس المجلد مستودع Git (`git status` أعاد "not a git repository")؛ لا يوجد خط أساس تغييرات أو تاريخ يمكن الاعتماد عليه في هذا الموضع.

> ملاحظة: `node --check` لا يثبت توافق CEF أو ExtendScript ولا يختبر الشبكة أو After Effects.

## خريطة النظام الفعلية

```text
client/index.html
  ├─ JavaScript globals (الخريطة، التنزيل، الواجهة، AE bridge)
  ├─ CSInterface.js ── evalScript ──► host/index.jsx
  │                                      └─ host/modules/*.jsx ──► After Effects
  ├─ Tile providers / Nominatim / Overpass
  └─ OpenGeo.Engine (ملفات محلية وNode.js)

scripts/build.js ──► release/stage/ ──► scripts/verify-package.js
scripts/zxp.js   ──► dist/          ──► OpenGeo.zxp
```

المساران الأخيران منفصلان، وهذه هي علة الحزم المركزية.

## النتائج التفصيلية

### P0-01 — سلسلة البناء والحزم تختبر ناتجًا وتوزع ناتجًا آخر

**الدليل:** `scripts/build.js` ينسخ إلى `release/stage`؛ و`verify-package.js` يتحقق من `release/stage`. أما `scripts/zxp.js` فيعرّف `DIST = <root>/dist` ويضغطه. توجد فروق فعلية بين `dist` والمصدر: على سبيل المثال `dist/client/js/main.js` ليس مطابقًا لـ `client/js/app.js`، و`dist/CSXS/manifest.xml` يحتوي وسائط CEF إضافية لا توجد في المصدر الحالي.

**الأثر:** قد تمرر CI/المطور اختبارات خضراء ثم يوزع كودًا قديمًا، بإعدادات أمان مختلفة، أو غير متسق مع المصدر. لا يمكن الوثوق بمحتوى ZXP.

**المعالجة:** اعتماد مجلد إخراج واحد فقط (يفضل `dist/`)؛ بناء نظيف إليه؛ تحقق منه؛ ثم ضغط المجلد ذاته. يحظر `scripts/zxp.js` التشغيل إن لم توجد علامة build/manifest متطابقان.

**التحقق بعد الإصلاح:** احسب hash لكل ملفات ZXP بعد فكّه وقارنه بـ `dist/`، ثم اختبر ZXP لا النسخة المثبتة يدويًا فقط.

### P0-02 — ترتيب `package:zxp` يجعل مزامنة الإصدارات غير داخلة في ناتج البناء

**الدليل:** ترتيب السكربت هو `test → build → sync:versions → verify:package → zxp`. البناء ينسخ `CSXS/manifest.xml` قبل أن يعدله `sync:versions`. ثم يتحقق من stage القديم، وبعد ذلك يضغط `dist` غير المُبنى أصلًا.

**الأثر:** عند زيادة الإصدار، قد تكون `package.json` وmanifest المصدر مختلفين عن manifest الحزمة. لا توجد هوية إصدار موثوقة لدعم المستخدمين أو للترقية.

**المعالجة:** اجعل ترتيب الإصدار: `clean → sync versions (كل الملفات) → build → verify dist → package dist → verify archive`. أضف اختبارًا يفشل إن اختلفت النسخ في `package.json` و`CSXS/manifest.xml` و`CSXS/extension.properties` و`OpenGeoConfig.version` (مع سياسة صريحة إن كان الأخير إصدارًا داخليًا مختلفًا).

### P0-03 — `verify:package` يفشل دائمًا مع الروابط القانونية التي تحمل query string

**الدليل:** `client/index.html` يحوي 8 scripts مثل `js/map/TileGrid.js?v=4` و`js/app.js?v=2`. `scripts/verify-package.js` يحاول البحث عن الاسم كاملًا مع `?v=…` كاسم ملف، ولذلك أعاد 8 أخطاء "Broken script link" بعد build ناجح. المتصفح يتعامل مع query كجزء URL لا كجزء من مسار الملف، لذلك هذا خلل في المتحقق لا دليل على ملف مفقود.

**الأثر:** بوابة الإصدار مكسورة؛ قد يتجاهل الفريق فشلًا حقيقيًا لاحقًا ظنًا أنه ضجيج معروف.

**المعالجة:** حلّل URL بـ `new URL(src, base)` أو اقطع `?` و`#` قبل فحص الملف، وارفض فقط المسارات الخارجة من `client/`. أضف اختبارًا لملف موجود مع query وملف مفقود مع query.

### P1-01 — مفاتيح مزودي الخرائط لا تصل إلى مسارات Preview وFinalize

**الدليل:** `ProviderManager.getURL()` يحقن المفتاح المخزن في `opengeo_providers` للمعاينة. لكن `SyncManager` يمرر `src.url` الخام إلى `OpenGeo.Engine.setUrlTemplate()`؛ و`FinalizeController.scanTimeline()` يقرأ `this.app.prefs.apiKey`، بينما المفاتيح مخزنة في `ProviderManager.userSettings.keys`. لذلك يظل `{key}` بلا قيمة في التصدير والمعالجة النهائية لمزودي Mapbox وMapTiler وStadia.

**الأثر:** تظهر المعاينة محليًا في بعض الحالات بينما يفشل إنشاء Composition أو Finalize بخطأ HTTP/بلاطات ناقصة؛ سلوك صعب التشخيص للمستخدم.

**المعالجة:** واجهة واحدة لبناء URL في `ProviderManager`، تستخدمها المعاينة وEngine وTilePlanner. لا تمرر template خامًا. افحص `requiresKey` قبل بدء كل عملية وأظهر رسالة قابلة للتنفيذ بلا إرسال طلب شبكة.

### P1-02 — إعداد Google ظاهر للمستخدم لكنه غير مدعوم وظيفيًا

**الدليل:** HTML و`app.js` يحفظان `provider-key-google`، لكن `OpenGeoConfig.tileSources` لا يحتوي مزود Google، ولا توجد option له، ولا تستخدمه `ProviderManager` ضمن إعداداته الافتراضية.

**الأثر:** واجهة تعد بوظيفة غير موجودة، وتجمع مفتاحًا حساسًا بلا فائدة.

**المعالجة:** إمّا إزالة الحقل بالكامل، أو إضافة مزود قانوني مدعوم بعقد واضح، تحقق المفتاح، النسب/الترخيص، واختبارات Preview/Export/Finalize. لا تستخدم واجهة Google Tile غير المصرح بها.

### P1-03 — حفظ حدود البحث السحابية غير متاح حتى تهيئة VectorMapManager

**الدليل:** `SearchPanel` لا ينفذ الحفظ إلا إذا كان `window.app.cloudBoundaryService` موجودًا. لا ينشئ `App` هذه الخدمة؛ الإنشاء مؤجل داخل `VectorMapManager` عند حدث رسم متجه. لذا الضغط على زر الحفظ قبل استعمال رسم Vector قد لا يفعل شيئًا ولا يبلغ المستخدم.

**الأثر:** ميزة "Download & Save Locally" صامتة الفشل حسب ترتيب استخدام المستخدم للواجهة.

**المعالجة:** أنشئ `CloudBoundaryService` في composition root (`App`) أو اجعل `SearchPanel` يطلب dependency صراحةً؛ أظهر حالة فشل واضحة؛ غطِّ التسلسل "بحث → حفظ" دون أي إجراء سابق.

### P1-04 — إدخال بيانات شبكة غير موثوقة عبر `innerHTML`

**الدليل:** `SearchPanel.js` يعيّن `nameDiv.innerHTML = item.display_name`؛ والقيمة تأتي من Nominatim. كما يستخدم `BoundaryManagerUI.js` قوالب `innerHTML` لنتائج الشبكة. لوحة CEP تعمل مع `--enable-nodejs`، ما يضخم أثر أي XSS من عرض HTML غير موثوق.

**الأثر:** تنفيذ JavaScript في سياق اللوحة، مع احتمال الوصول إلى Node/الملفات ضمن إعداد CEP الحالي.

**المعالجة:** استبدل النص الخارجي بـ `textContent`، وأنشئ عناصر الأيقونات محليًا أو استخدم DOM API. امنع إدخال HTML في كل مسار شبكة/ملف GeoJSON. أضف اختبار payload مثل `<img src=x onerror=...>` وتأكد أنه يعرض كنص فقط.

### P1-05 — امتيازات CEP واسعة وغير متسقة بين المصدر و`dist`

**الدليل:** manifest المصدر يطلب `--enable-nodejs`. Manifest القديم في `dist` يضيف `--mixed-context` و`--allow-file-access-from-files`. لا توجد سياسة أمنية أو سبب موثق لكل صلاحية، بينما اللوحة تستخدم `window.require('fs')` وتتعامل مع URL مخصص.

**الأثر:** سطح هجوم ملفات/سياقات أوسع من اللازم، وسلوك أمني مختلف حسب المجلد الذي يستخدمه العميل.

**المعالجة:** وحّد manifest الناتج، واحذف أي flag لا تثبت الحاجة إليه. اعزل جميع عمليات filesystem في adapter محدود، وامنَع المسارات غير المصرح بها وschema غير `https:` لمزود XYZ. راجع الامتيازات بعد إزالة `innerHTML` غير الآمن.

### P2-01 — إعداد النسق لا يُحفظ

**الدليل:** `SettingsPanel` يرسل `settings:themeChanged` ويغير class فقط. `App.init()` يقرأ `localStorage.getItem('opengeo_theme')`، لكن لا يوجد `setItem` لهذا المفتاح.

**الأثر:** يعود النسق إلى Dark عند إعادة فتح الإضافة.

**المعالجة:** listener مركزي يحفظ نسقًا مدققًا (`dark|light`) ويعيده عند الإقلاع؛ اختبار إعادة إنشاء App.

### P2-02 — `BoundaryManagerUI.js` كود ميت في المسار الحالي

**الدليل:** الملف موجود تحت `client/js/ui/` لكنه ليس script في `index.html` ولا توجد إشارة لإنشائه. أما `stitcherWorker.js` فهو مستثنى من هذا الحكم لأنه محمّل ديناميكيًا بـ `new Worker(...)`.

**الأثر:** صيانة ميزة غير قابلة للوصول، وإصلاحات أمنية قد تنسى مسارًا قد يصبح فعالًا لاحقًا.

**المعالجة:** احذفه بعد التحقق أنه غير مطلوب، أو اربطه عبر نقطة دخول صريحة واختبره. لا تترك كودًا غير مستخدم مع شبكة و`innerHTML` في حزمة الإنتاج.

### P2-03 — اختبارات المشروع لا تختبر العقد الفعلية

**الدليل:** `scripts/test.js` يحتوي 3 assertions فقط: escape محلي مكرر، JSON invalid محلي، وبحث نصي في config. لا يستورد `AEBridge` أو `ProviderManager`، لا يختبر HTML assets، ولا يدير mock لـ `CSInterface` أو `XMLHttpRequest` أو filesystem أو ExtendScript.

**الأثر:** أخطاء P0/P1 الحالية تمر كلها رغم أن `npm test` أخضر.

**المعالجة:** استبدال smoke script بمجموعة وحدات وتكامل مع mocks؛ فصل منطق URL/التخطيط/serialization في modules قابلة للاختبار؛ اجعل `npm test` يفشل عند عدم تحقق build integrity.

### P2-04 — سجل أخطاء صامت في مسار ثابت وغير مضمون

**الدليل:** handler العام في `client/js/app.js` يستدعي `fs.appendFileSync('C:/Temp/opengeo_error.log', ...)` داخل `catch` فارغ.

**الأثر:** قد يحجب التوقف UI، يفشل لعدم وجود `C:\Temp` أو صلاحيات، ويصعّب دعم المستخدمين؛ والكتابة synchronous على مسار عالمي غير مهيأ.

**المعالجة:** logger مركزي مع directory يختاره التطبيق/المستخدم، إنشاء آمن للمجلد، تدوير محدود، وتعطيل الكتابة في production إن لم يوافق المستخدم. لا تبتلع الخطأ كليًا؛ اعرض reference ID.

### P2-05 — التصدير التلقائي والتحديثات لا تملك دورة حياة/إلغاء كاملة

**الدليل:** `AESyncEngine` ينشئ `setInterval` كل 500ms، و`App._setupResize` ينشئ `ResizeObserver` وlistener window، و`SyncManager` يؤجل export. لا توجد `dispose()` أو مسارات توقف عند إغلاق اللوحة/تبديل comp. هناك token لتجاوز نتيجة export المتأخرة، لكنه لا يلغي التنزيل الجاري.

**الأثر:** polling وتسريبات listeners، استهلاك شبكة/CPU، وطلبات قد تواصل بعد تغير الحالة.

**المعالجة:** lifecycle موحد (`start/dispose`)، `AbortController`/إلغاء XHR حيث ممكن، إغلاق worker، ومسح timers/listeners/observer؛ اختبار فتح/إغلاق متكرر.

### P2-06 — مخاطر حدود المزوّد والترخيص وحِمل الشبكة غير مضبوطة

**الدليل:** توجد مصادر عامة مثل OpenStreetMap وNominatim وESRI، بينما التنزيل/Finalize قد يطلب عددًا كبيرًا من البلاطات، وNominatim لا يفرض rate limit أو `User-Agent` معرفًا. لا توجد شاشة موافقة أو سياسة attribution/terms ضمن مسار Finalize.

**الأثر:** رفض طلبات، حظر IP، أو مخالفة شروط الاستخدام، خصوصًا في الرندر/التصدير الكبير.

**المعالجة:** حدود مزود لكل provider، rate limiter وbackoff، إظهار attribution دائمًا، provider policy قابلة للتهيئة، ومنع Finalize حين يتجاوز الطلب حدود المصدر العام.

### P3-01 — نسخ متعددة غير موثقة من المنتج

**الدليل:** توجد `client/`, `dist/`, `release/stage/`, `build/` وملفات docs سابقة. `dist` يحمل بنية مختلفة (`main.js` وcore قديمة) عن المصدر.

**الأثر:** التعديل في ملف غير فعّال، الرجوع غير المقصود لنسخة قديمة، وصعوبة تحليل الأعطال.

**المعالجة:** المصدر الوحيد هو `client/` و`host/`؛ كل الباقي output أو archive في مجلد واضح مستثنى من التحكم اليدوي. أضف `.gitignore` وREADME لمسارات الحقيقة.

### P3-02 — ترميز نصوص العرض غير منضبط في بعض المخرجات

**الدليل:** تظهر في ملفات المصدر/النصوص عبارات على هيئة mojibake مثل `â€”` وفي رسالة عربية داخل `FinalizeController` معروضة على هيئة `Ø...` عند القراءة الحالية.

**الأثر:** احتمال نصوص مشوهة في UI/console أو اختلاف الترميز بين أدوات Windows وCEF.

**المعالجة:** اعتماد UTF-8 دون BOM أو بسياسة موحدة، فحص lint يمنع replacement characters/mojibake، ومراجعة النصوص العربية والإنجليزية من داخل CEF الفعلي.

### P3-03 — البناء غير حتمي ولا ينظف مخرجات التوزيع الحقيقية

**الدليل:** `build` و`clean` يشغّلان script واحدًا ينظف `release/stage` فقط. لا ينظف `dist` ولا ينسخ إليه، ولا يثبت ترتيب الملفات أو يحفظ metadata build.

**الأثر:** بقايا الملفات القديمة في `dist` يمكن أن تدخل الحزمة.

**المعالجة:** أوامر مستقلة `clean`, `build`, `verify`, وتوليد manifest للملفات مع SHA-256 وتاريخ/commit (إن وجد).

### P3-04 — غياب سياسة توافق واختبار حقيقي لـ CEP/After Effects

**الدليل:** manifest يعلن `AEFT [15.0,99.9]` و`CSXS 9.0`، لكن لا توجد مصفوفة اختبار أو قيود لميزات حديثة مثل `ResizeObserver`, `fetch`, `Worker`, `OffscreenCanvas`، ولا اختبار JSX في AE.

**الأثر:** احتمال تعطل صامت في إصدارات AE المدعومة اسميًا.

**المعالجة:** حدد أقل إصدار مدعوم على أساس اختبار، وفر feature detection/fallback، وأنشئ smoke test يدوي/آلي لكل نسخة مضيف مستهدفة.

## عناصر تم التحقق منها ولم تكن عطلًا مثبتًا

- ملفات scripts المشار إليها في `index.html` موجودة بعد حذف query string؛ لذلك نتيجة verifier الحالية **false positive** وليست ملفات مفقودة.
- `stitcherWorker.js` ليس كودًا ميتًا: يستدعيه `MegaTileStitcher` عبر `new Worker('js/engine/stitcherWorker.js?v=4')`.
- أسماء واجهات `opengeo*` المستدعاة من العميل لها تعريفات مقابلة داخل `host/modules/*.jsx` في الفحص النصي؛ لا يثبت ذلك صحة التنفيذ داخل AE.
- لا يوجد استخدام مباشر لـ `eval()` في المصدر الأولي الذي تم فحصه؛ لكن XSS أخطر هنا بسبب امتياز Node المفعّل.

## معايير قبول الإصلاح

1. `npm run package:zxp` ينشئ ZXP من `dist/` المبني في نفس التنفيذ، وكل checks تمر.
2. فك ZXP يعيد SHA-256 مطابقًا لمحتوى `dist/` (عدا metadata المتوقع).
3. Preview وCreate Comp وFinalize تعمل مع ESRI، ومع مزود يتطلب مفتاحًا صالحًا، والمفتاح لا يظهر في logs.
4. حقل Google إما يعمل بعقد قانوني مختبر أو لا يظهر في UI.
5. نتائج Nominatim وGeoJSON غير الموثوق تعرض كنص، ولا ينفذ HTML/JS منها.
6. اختبار AE يدوي موثق على كل إصدار مستهدف، يتضمن فتح/غلق اللوحة، مشروع غير محفوظ، شبكة منقطعة، وFinalize لمشهد متحرك.

## مخرجات التدقيق

- هذا التقرير: `docs/OPEN_GEO_ATOMIC_AUDIT_2026-08-12_AR.md`
- خطة الإصلاح المرتبة: `docs/OPEN_GEO_REPAIR_PLAN_2026-08-12_AR.md`

