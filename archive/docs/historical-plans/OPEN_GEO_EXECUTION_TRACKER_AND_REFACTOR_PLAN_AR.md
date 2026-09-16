# خطة إصلاح OpenGeo ونظام تتبع التنفيذ

**الإصدار:** 1.0  
**تاريخ الإنشاء:** 12 أغسطس 2026  
**المرجع الفني:** `ARCHITECTURAL_HEALTH_AND_REFACTORING_REPORT_AR.md`  
**النطاق:** منطق المنتج فقط (`client/js/**`, `host/**`) مع الاختبارات والبناء الضروريين للتحقق. لا تشمل الخطة إعادة تصميم الواجهة أو إضافة خصائص جديدة غير لازمة للإصلاح.

> **تحديث المسار في 14 أغسطس 2026:** الخطة التفصيلية الحالية للأعمال الجديدة هي `OPEN_GEO_MASTER_REMEDIATION_AND_EVOLUTION_PLAN_AR.md`. تُحفظ هذه الوثيقة كسجل للمراحل السابقة. تقرر تأجيل ZXP حتى إعداد النسخة النهائية، والتركيز الآن على منطق الإضافة.

> **عقد Live Sync الملزم:** تعمل Live Sync تلقائيًا في الخلفية طوال حياة اللوحة ولا يوجد زر أو preference لتفعيلها أو تعطيلها. زر `Record` لا يتحكم في Live Sync؛ إنه opt-in منفصل لكتابة الحركة كـkeyframes عند زمن AE. ويبقى `Add Key` لإضافة مفتاح صريح واحد.

## 1. الهدف وقرار التنفيذ

الهدف هو تحويل OpenGeo من مجموعة مسارات مستقلة جزئيًا إلى نظام له:

1. مصدر واحد للحالة الخاصة بالخريطة والـ Composition والمزوّد.
2. جسر CEP/ExtendScript موحد وآمن بعقد استجابة واحد.
3. pipeline واحد منطقي للبلاطات والمزوّدات والتصدير، مع فصل واجهة المعاينة عن تفاصيل النقل.
4. عزل تام لموارد كل خريطة/Composition/Provider في After Effects وfilesystem.
5. اختبارات تمنع عودة العيوب المكتشفة قبل تشغيلها داخل AE.

هذه ليست خطة "rewrite". يحافظ التنفيذ على تجربة المستخدم الحالية ووظائفها المرئية، ويستبدل الطبقات الداخلية تدريجيًا خلف واجهات متوافقة حتى تثبت كل مرحلة.

## 2. لوحة التتبع الرئيسية

### دلالات الحالة

| الرمز | المعنى | قاعدة الانتقال |
|---|---|---|
| ⬜ | لم يبدأ | لا يوجد تغيير أو دليل تحقق |
| 🟦 | قيد التنفيذ | مالك محدد وتوجد تغييرات محلية قابلة للمراجعة |
| 🟨 | بانتظار قرار/اعتماد | لا يمكن إكماله بلا قرار منتج أو اختبار AE خارجي |
| ✅ | مكتمل | الكود والمراجعة والاختبارات ومعيار القبول موثقة |
| ⛔ | محجوب | سجّل السبب والخطوة اللازمة لرفعه |

### خارطة المراحل

| المرحلة | الحالة | الأولوية | التبعية | الناتج القابل للقياس |
|---|---|---|---|---|
| M0 — تثبيت خط الأساس | 🟨 اعتماد AE | P0 | — | baseline قابل للاستعادة ومصفوفة اختبار |
| M1 — عقود الحالة والاختبارات | 🟨 اعتماد AE | P0 | M0 | Session واحد وعقود قابلة للاختبار |
| M2 — بروتوكول الجسر JS↔JSX | ✅ منفذة | P0 | M1 | `bridge.invoke` وresponse موحدان |
| M3 — مزامنة AE والأحداث | ✅ مكتملة | P0 | M1, M2 | مزامنة latest-wins بلا feedback loop |
| M4 — providers والبلاطات وGeoJSON | 🟨 AE-39 | P1 | M1, M2 | URL/cache/request model موحد وGeoJSON مرسوم داخل AE |
| M5 — Preview/Finalize والـ assets | 🟨 اعتماد AE | P1 | M2, M4 | Finalize معزول وصحيح النتائج |
| M6 — المتجهات والبيانات المحلية | 🟨 اعتماد AE | P1 | M1, M2 | bbox صحيح وjobs منظفة |
| M7 — تفكيك مضيف AE | 🟨 اعتماد AE | P1 | M2, M5 | host modular وcomposition identity |
| M8 — إزالة الدين ودورة الحياة | 🟨 اعتماد AE | P2 | M3–M7 | لا zombie paths ولا تسريبات lifecycle |
| M9 — التحقق والإصدار | 🟨 اعتماد AE | P0 | M0–M8 | release candidate مثبت داخل AE |

> لا يبدأ M5 أو M7 قبل اعتماد عقد الجسر في M2. ولا تزال كل مرحلة لاحقة ملزمة بتحديث قسم التتبع أدناه عند إتمام أي task.

## سجل التنفيذ الحي

- **M4-04 / رسم GeoJSON داخل Composition — 🟨 منفذ آليًا وبانتظار AE-39 (2026-08-20):** كُشف أن مسار زر GeoJSON كان ينتهي عند `GeoJSONLayer` في Canvas ولا يستدعي Host. أصبح الملف الصالح يُعرض في المعاينة ثم يُحوّل إلى Web‑Mercator zoom 10 ويُرسل عبر job file و`vector.import` إلى الـComposition النشطة. تُفصل Polygon/Line/Point في Shape Layers مغلقة/مفتوحة صحيحة، وتُعالج GeometryCollection وMulti* وعبور خط 180°، وتستبدل إعادة رفع الاسم نفسه ملكيته السابقة. إذا لم توجد Map composition يبقى Preview مع رسالة صريحة بدل نجاح زائف. الدليل: اختبارا projection/typed layers والمعاملة المؤقتة، `npm test` ‏109/109، و`verify:release` و`artifact:verify` ناجحة. المتبقي AE-39 فقط.
- **M0-03 / سباق تبديل تعريف المزوّد وتراكم المعاينة — ✅ مغلق آليًا (2026-08-20):** لم تعد هوية العملية تعتمد اسم المزوّد وحده؛ يثبّت `OperationSnapshot` بصمة التعريف والـresolved template وحجم البلاطة، ويرفض أي نتيجة بدأت قبل تغيير URL/credentials حتى إن بقي المعرّف `customXYZ` نفسه. يوقف `ApplicationCoordinator` التنزيل والتجميع وأجيال Sync/Preview القديمة قبل mutation، ثم يطلب معاينة واحدة فقط للتعريف أو الحجم الجديد. وأثبت اختبار سلوكي متكرر أن انتقال viewport من 4 بلاطات إلى 2 ثم 1 لا يحتفظ إلا بالمجموعة الحالية. الدليل: `npm test` ‏107/107، وARC-09/10/24 مغلقة آليًا؛ يبقى AE-38 للتحقق البصري تحت ضغط شبكة حقيقية.
- **Master M8 / ميزانيات الأداء وحدود الاستهلاك — ✅ منفذة آليًا (2026-08-14):** أضيف عقد `performance-budgets.json` ومدقق fail-closed يثبت حدود cache=200، تنزيلات=4، Vector concurrency=2، ذاكرة Vector=400k نقطة، unload=15s، Preview path=2,500 بلاطة، Finalize=20,000 بلاطة، Camera revisions=32، وسجل العمليات=1MiB×3. أصبح benchmark قابلًا للاستدعاء برمجيًا ويفحص 89 chunk؛ القياس الحالي p50=1.26ms وp95=2.48ms وmax=9.16ms، وأقصى نافذة=306,695 نقطة/20 chunk ضمن 400k/24. تشغل release gate `audit:performance` وتربط بصمة policy بهوية artifact. الدليل: 109/109 و`verify:release` و`artifact:verify` ناجحة؛ التفاصيل في `PERFORMANCE_BUDGETS_AR.md`. M8 ≈80% والتقدم العام ≈83%. المتبقي يدويًا: قياسات Host وAE-35/36/37/38؛ والتوقيع/ZXP مؤجلان.
- **Master M8-04 / عقد التوافق الفعلي — 🟨 منفذ آليًا؛ اعتماد AE 23/24 باقٍ (2026-08-14):** أُلغي ادعاء التوافق غير المثبت مع AE 15–99.9، وأصبح manifest يسمح `AEFT [18.4,24.99]` ويتطلب `CSXS 11.0`. ثُبتت policy قابلة للتدقيق تربط الحد الأدنى بـCEP 11/Chromium 88/Node 15.9، مع جرد JavaScript الحديث وNode capabilities وبدائل ResizeObserver وWorker/OffscreenCanvas وXHR وسلامة صياغة ExtendScript. الفحص المحلي يثبت AE 23.6 و24.6.2 وCEPHtmlEngine 11.5.3؛ لا يُدعى smoke-test قبل AE-36/AE-37. أضيف `audit:compatibility` وتقرير حتمي تدخل بصمته في artifact، ووثّق ADR-007 في `COMPATIBILITY_MATRIX_AR.md`. الدليل الحالي: 109/109 و`verify:release` و`artifact:verify` ناجحة. التالي اعتماد AE-36/37، بينما AE-35 الشبكي مؤجل وM8-05/ZXP مؤجلة.
- **Master M8-03 / SBOM وهوية artifact وبوابة الإصدار — 🟨 منفذة عدا التوقيع/ZXP والتدقيق الحي (2026-08-14):** أضيف تدقيق حتمي لـpackage-lock وCycloneDX SBOM: ‏10 اعتماديات build-only و0 runtime npm dependencies، كلها registry HTTPS وSHA-512 integrity وبلا install scripts. أضيف manifest يتحقق من تطابق أربعة مواضع للإصدار، ويسجل SHA-256 لكل ملف ثم يرفض أي mutation. أصبحت release gate تبني وتفحص وتثبت الناتج نفسه؛ الحالي 175 ملفًا و29,058,136 بايت وبصمة `ab3f349cb4b73dba6eaf6aa8cb1b37bd7b30bbed1db60bb14a4c710b0b750cc9`. الدليل: `npm test` ‏109/109 و`verify:release` و`artifact:verify` ناجحة. التوقيع/ZXP والتدقيق الحي مؤجلة صراحة، ولم يُشغّل ZXP.
- **Master M8-02 / سياسات الشبكة والأسرار — 🟨 منفذة آليًا؛ AE-35 مؤجل بقيود البيئة (2026-08-14):** أضيف `NetworkPolicy` موحد: HTTPS بلا credentials، فحص URL النهائي بعد redirect، مهلات وأحجام محدودة، وإلغاء مبكر للاستجابات الكبيرة. البلاطات 16MB/15s والبحث 1MB/10s وخمس نتائج؛ أزيل XHR fallback الموازي من Engine. توسع redaction ليشمل `key/keys/signature`، وأضيف تحذير واضح لتخزين مفاتيح providers في CEP localStorage ووثقت الحدود. صُححت بيئة Node من `strict-ssl=false` ومتغير TLS معطل في User scope إلى `strict-ssl=true` وبلا User/Machine override. بقي AE-35 مؤجلًا دون اعتباره ناجحًا أو فاشلًا.
- **Master M8-01 / CSP وDOM وNode hardening — ✅ منفذة ومعتمدة داخل CEP (2026-08-14؛ تحديث 2026-08-21):** أضيف CSP يمنع remote/eval scripts وobject/frame/form/base injection، وأزيل آخر `innerHTML` من الطرف الأول، وأصبحت أيقونات البحث DOM-only وروابط attribution مقصورة على HTTPS بلا credentials. أضيف `audit:security` إلى release gate؛ يفحص ملفات الطرف الأول ويحصر استيرادات Node في `buffer/crypto/fs/os/path/process`؛ أضيف `buffer/process` حصراً لاستعادة globals المفقودة بعد CEF DevTools Reload من `cep_node`، وتفشل أي capability أو HTML/executable sink جديدة افتراضيًا. الدليل: `npm test` و`audit:security` و`audit:events` و`verify:runtime-data` و`verify:release` ناجحة، وأكد المستخدم نجاح AE-34 بلا أخطاء.
- **Master M7-05 / فصل مصادر البناء عن بيانات التشغيل — ✅ منفذة وإغلاق M7 (2026-08-14):** نُظمت مصادر Natural Earth الفريدة تحت `natural-earth/50m` و`natural-earth/10m` وحُذفت نسختان متطابقتان بعد تحقق SHA-256. أضيف manifest تشغيل default-deny يملك 96 ملفًا ضمن 8 مجموعات، وأصبح البناء ينشر 94 مخرجًا مولدًا فقط ويمنع monolith ‏10m وملفات evidence والبيانات القديمة غير المستهلكة من `client` و`release/stage`. حجم بيانات runtime المعتمدة 28,181,295 بايت، مقابل إبقاء 23,217,974 بايت من intermediates/evidence خارج الحزمة، مع إزالة نحو 30MB إجمالًا من artifacts السابقة. البصمة النظيفة الجديدة لـ97 مخرج بناء هي `8e14c2f0eb2651c60cd9117ad2fdd8e36e2c000271e2467dff770e14c6f0f1d2`. الدليل: `verify:runtime-data` و`verify:data` و`npm test` ‏94/94 و`audit:events` ‏115/27 و`build` و`verify:package` و`verify:release` كلها ناجحة. M7 أصبحت 100%، والتقدم العام ≈74% وقلب الإضافة M0–M7 ≈92%. لا اختبار AE مطلوب.
- **Master M7-04 / بناء البيانات القابل لإعادة الإنتاج — ✅ منفذة (2026-08-14):** أصبح catalog 2.0.0 يسجل جميع مصادر 50m/10m وtopology والسياسة مع provenance/license/URL أو locator وbytes/SHA-256، ويثبت Node 22.18.0 وTurf 7.4.0 وlockfile v3. تدعم المولدات `--data-dir`، ويعيد `verify:data` بناء الحزمة كاملة في مجلد مؤقت ثم يشغل Golden Geometry ويقارن 97 ملفًا byte-for-byte. كانت بصمة الإغلاق الأولية `462d9b89a2d073dfe945ce82512379f926e366d22a67affe46135f3a2c0b2b3d` ثم استُبدلت ببصمة M7-05 بعد الفصل المقصود. أضيف baseline للمخرجات وأدخل التحقق في release gate؛ لا اختبار AE مطلوب.
- **Master M7-03 / اختبارات الهندسة الذهبية — ✅ منفذة (2026-08-14):** أضيف مدقق هندسي مستقل مع 82 invariant وfixtures لـDZA/MAR/ESH/ISL/IDN/FJI. يحمي صلاحية الحلقات وإغلاقها الضمني وself-intersection والمساحة وbbox والبصمات وموضع labels وتعدد الجزر وحالة antimeridian. علاقة MAR/ESH مقفلة بلا تقاطع أو احتواء، وبحد مشترك طوله `3275.6399732918944` مع بقاء هندستي البلدين كما اعتمدهما المستخدم. سُجل `IDN-OVERLAP-001` كشذوذ صغير موروث من المصدر لا يجوز أن يتغير بصمت. يتوفر `npm run verify:geometry` ويعمل تلقائيًا بعد `land-borders:data` وداخل `npm test`؛ النتيجة 92/92. نسبة M7 الحالية 60%، والتالي M7-04.
- **Master M7-02 / سياسة الخرائط — ✅ منفذة (2026-08-14):** ثُبتت سياسة `opengeo-cartography-policy@1.0.0`: مرجع أممي مراجع ومثبت افتراضيًا لكل نزاع جديد، مع حق مالك المنتج في استثناء صريح مُصدّر وموثق. بقي profile ‏`western-sahara-separated-v1` مقفلاً ببصمتي هندسة مستقلتين لـMAR وESH، ويوقف builder البناء إذا تغيرت أي نقطة؛ لذلك لا تؤثر مراجعة فلسطين أو أي نزاع آخر مستقبلًا في الخريطتين الحاليتين. سُجلت فلسطين كـplanned review بلا أثر runtime. أصبحت السياسة تقرأ من ملف مصدر بدل الثوابت المدفونة، وتُسجل إصدارات policy/data/profile في metadata. الدليل: إعادة بناء 258 outline، و`npm test` ‏91/91؛ التفاصيل في `ADR-006_CARTOGRAPHY_POLICY_GOVERNANCE_AR.md`. نسبة M7 الحالية 40%، والتالي M7-03.
- **Master M7-01 / الهوية الجغرافية — ✅ منفذة (2026-08-14):** نُقلت قواعد تعيين نتائج Nominatim من `SearchPanel` إلى `GeographyIdentityResolver` مستقل، وأصبح القرار يعيد `drawingIso3` و`displayLabel` وبيانات المصدر الخام ودرجة الثقة ومعرّف القاعدة. يعتمد resolver فهرس البلدان المحلي وسجل aliases متعدد اللغات ومعرّفات OSM المعلومة، ويحافظ على إسناد المزوّد للتشخيص من دون عرضه كهوية رسم. غطت الاختبارات ESH/MAR ومدينة حدودية والعربية والفرنسية والإنجليزية وUNKNOWN وعدم تعديل النتيجة الخام. الدليل: `npm test` ‏89/89، و`audit:events` ‏115 استعمالًا/27 عقدة، و`build` و`verify:package` ناجحة. نسبة M7 الحالية 20%، والتالي M7-02.
- **اعتماد التصحيحات الأخيرة داخل AE — ✅ (2026-08-14):** أكد المستخدم نجاح AE-31 وAE-32 وAE-33؛ أُغلقت مخاطر ARC-21 وARC-22 وARC-23 الخاصة بأداء Add Key، تضخم التغطية، وحفظ Camera keyframes أثناء Finalize. لا يلزم اختبار AE إضافي لهذه البنود.
- **تصحيح حفظ Camera keyframes أثناء Preview/Finalize — 🟨 منفذ آليًا وبانتظار اعتماد AE (2026-08-14):** كُشف سباق دقيق: كان العميل يرسل آخر عينة من trajectory إلى `composition.prepare/commit`، ثم تستدعي معاملة الأصول `opengeoSynchronizeControllerCamera` عند زمن CTI وقت اكتمال العمل غير المتزامن. إذا كان CTI فوق المفتاح الأول، كانت قيم Latitude/Longitude/Zoom لذلك المفتاح تُستبدل بقيم المفتاح الأخير، فتبدو الخريطة وكأن Finalize لا يحترم المسار. فُصلت ملكية الأصول عن ملكية animation: لم يعد Finalize يرسل كاميرا نهائية إلى prepare/commit، وأصبح rebuild يعامل عناصر الكاميرا الثلاثة كمعاملة واحدة ويحفظها كلها إذا كان أي عنصر متحركًا. تبقى الكتابة على animation حصرًا في `keyframe.add` وRecord و`camera.update` المسموح. يثبت regression ديناميكي أن rebuild بقيم أخيرة مختلفة لا يغيّر أي keyframe، مع استمرار تحديث الخريطة الساكنة. الدليل: `npm test` ‏89/89، و`audit:events` ‏115 استعمالًا/27 عقدًا، و`build` و`verify:package` ناجحان. المتبقي: AE-33؛ المشاريع التي أفسد تشغيل سابق مفتاحها الأول تحتاج إعادة إدخال قيمه أو إنشاء اختبار جديد لأن القيم الأصلية غير قابلة للاستنتاج.
- **تصحيح تضخم تنزيل البلاطات — 🟨 منفذ آليًا وبانتظار اعتماد AE (2026-08-14):** ثبُت بقياس regression أن كادر `1920×1080` عند Camera Zoom 6 وDownload Zoom 4 كان يطلب 256 بلاطة بدل 6 بلاطات مرئية بسبب تثبيت نسبة source/comp عند `1` ومحاذاة التنزيل افتراضيًا إلى كتل `8×8`. صُححت النسبة لتبقى كسرية عند Draft، وأصبحت محاذاة MegaTile سياسة opt-in بعد التخطيط وليست توسعة للتنزيل، وخُفض الهامش إلى بلاطة واحدة قابلة للضبط. أُلغيت طبقة Base Zoom المكررة افتراضيًا مع إبقائها opt-in، وحُصر `trajectory.scan` في تقاطع Work Area مع المجال بين أول وآخر keyframe مع عينة واحدة للخريطة الثابتة. النتيجة الآلية لنفس المثال: 6 بلاطات بلا هامش ونحو 20 مع هامش الأمان بدل 256. الدليل: ثلاثة اختبارات regression جديدة، `npm test` ‏88/88، و`audit:events` ‏115 استعمالًا/27 عقدًا، و`build` و`verify:package` ناجحان. المتبقي: AE-32؛ ZXP لم يُشغّل.
- **تصحيح أداء Add Key ومعاينة المسار — 🟨 منفذ آليًا وبانتظار اعتماد AE (2026-08-14):** كُشف أن `Add Key` كان يطلق بناءين متعاقبين داخل AE: Preview للموضع الحالي ثم Preview كامل للمسار، بينما قد تكون عملية Live Sync سابقة ما تزال قيد التنزيل أو الاستيراد. أصبح الأمر الصريح يستبق العمل الخلفي المؤجل ويلغيه قبل كتابة المفتاح، ثم يطلب معاينة مسار واحدة فقط. تُحزم بلاطات Preview العادي والمسار إلى MegaTiles محلية ذات بصمة تشمل manifest الكامل، مع فصل cache حسب `document/scope` وتنظيف الأجيال القديمة بعد نجاح commit. أصبح Host يستورد الجيل الجديد كطبقات `preview-staging` مخفية، يتحقق من `imported === expected`، ثم يستبدل الجيل المرئي دفعة واحدة؛ لذلك لا تظهر البلاطات واحدة بعد الأخرى ولا تُمس النسخة السابقة عند فشل جزئي. الدليل: اختبار regression جديد، `npm test` ‏85/85، و`audit:events` يغطي 115 استعمالًا ضمن 27 عقدًا، و`build` و`verify:package` ناجحان. المتبقي: اختبار AE-31 أدناه؛ ZXP لم يُشغّل.
- **Master M6 / تفكيك App وتوحيد نواة البلاطات — 🟨 90%، بانتظار اعتماد AE (2026-08-14):** تقلص `app.js` من 672 إلى 259 سطرًا بعد استخراج `ToolbarController` و`PreviewController` و`CompositionController` و`OperationPresenter` و`ApplicationLifecycle` و`ApplicationCoordinator`. أصبحت `TileAddress` و`CoveragePlanner` و`CachePolicy` و`TileTransport` و`DownloadSession` نواة مشتركة لمساري Preview/Finalize، ويثبت اختبار golden تطابق التغطية العادية وعبر antimeridian. أصبح `ProviderManager` immutable، وتُولّد قائمة المزوّدات وحقول Mapbox/MapTiler/Stadia من schema، مع رفض واضح للمزوّد المحمي بلا مفتاح. حُذف `CloudBoundaryService` وprovider aliases و`_decodeImage` والحقول/الدوال غير المستعملة بعد `rg` وفحص الحزمة. الدليل: `npm test` ‏84/84، و`audit:events` ‏113/113 ضمن 27 عقدًا، وفحص syntax، و`build` و`verify:package` ناجحة؛ benchmark ‏p95=2.54ms. المتبقي: AE-28/29/30 في الخطة الرئيسية. ZXP لم يُشغّل.
- **Master M5 / الحالة والأحداث والجسر — ✅ مكتملة ومعتمدة داخل AE (2026-08-14):** أصبح `MapSession` حد الكتابة الوحيد في runtime، وتنفذ `StateHydrator` استعادة metadata كمعاملة واحدة قابلة للرفض بلا تسرب حالة. أضيف catalog مركزي لـ27 حدثًا وتدقيق بناء يغطي 126 استعمالًا، ورُقي الجسر إلى بروتوكول `2.0.0` بـtyped handlers ورموز خطأ ثابتة، وأضيفت migrations مستقلة وOperationLogger بصيغة JSONL مع rotation/redaction. كشف AE-25 سباقًا بين حفظ metadata المؤجل وتحميل Composition أخرى، مع بقاء framing box بنسبة القديمة؛ أُصلح بتثبيت comp/document identity وload revision واعتماد أبعاد `CompItem` الفعلية وتحديث الإطار فور الاستعادة. الدليل: `npm test` ‏82/82، و`audit:events` و`build` و`verify:package` ناجحة، وأكد المستخدم نجاح AE-25/26/27. ZXP مؤجل.
- **M1 / Live Sync ودورة الحياة — ✅ مكتملة ومعتمدة داخل AE (2026-08-14):** أزيل عقد `sync:toggle` والمسار العام `setLiveSync(enabled)` واعتمد lifecycle داخلي idempotent باسم `start/dispose`. لا يوجد زر للمزامنة، وتظل حالتا `Record` و`Add Key` مستقلتين. أضيف تفكيك كامل لمستمعات DOM في `App` و`SearchPanel` واختبار mount→dispose→mount. أكد المستخدم نجاح اختبار Live Sync وRecord واستعادة/تبديل الـComposition داخل AE. الدليل: `npm test` ‏52/52 وفحص syntax ناجح.
- **M3 — ✅ مكتملة ومعتمدة داخل AE (2026-08-14):** إضافة إلى `OperationSnapshot` و`DownloadSession` المعزولين، فُصل render invalidation عن AE export. استُبدلت نافذة تجاهل الكاميرا الزمنية ببروتوكول revision/ack وpolling single-flight. بعد كشف قفزات drag/zoom أضيف local-intent watermark يمنع poll السابق حتى قبل إرسال الكتابة، وأصبح Host يقر فقط القيم المطبقة فعليًا ويعيد `skipped-keyframed-outside-cti` عند حماية animation. جُمعت أحداث pan في frame واحد، وأصبح zoom تدريجيًا، والـinertia محسوبًا بالبكسل/مللي ثانية، وحفظ preferences مؤجلًا خارج المسار الحرج. الدليل: `npm test` ‏66/66 واعتماد المستخدم للسلوك داخل AE.
- **Master M4 / أداء المعاينة وحدود الإدخال — ✅ مكتملة ومعتمدة داخل AE (2026-08-14):** أزيل parse المتزامن لملف 10m الأحادي من render path، وأُنشئت حزمة مفهرسة من 89 chunk بترتيب Morton وhashes وتزامن تحميل 2 وذاكرة 400 ألف نقطة. أُصلح culling/world wrap والطرد المتبادل بين الطبقات، وأضيف frame-coalesced rendering. أصبحت GeoJSON تمر عبر validator محدود قبل الرسم، وأصبح Host يرفض vector payload غير الموثوق قبل UndoGroup، ونُقلت عمليات I/O الثقيلة المعروفة إلى Node async. الدليل: `npm test` ‏73/73؛ `benchmark:preview` ‏p95=2.25ms وmax=9.53ms وأقصى نافذة عينة=306,695 نقطة؛ `build` و`verify:package` ناجحان؛ وأكد المستخدم نجاح AE-15 وAE-16 وHost negative smoke.
- **Finalize الذري — ✅ منفذ ومعتمد داخل AE (2026-08-14):** استُبدل مسار Finalize القديم الذي كان يحذف النتيجة السابقة قبل اكتمال الاستيراد ببروتوكول `Prepare → Commit → Rollback → Reconcile`. تُخاط الملفات في مجلد revision مستقل، وتُستورد إلى AE كطبقات مخفية، ثم يُتحقق `expected === imported` قبل تبديل الرؤية داخل UndoGroup واحد؛ لا يبدأ تنظيف الـrevision السابق إلا بعد تفعيل الجديد. أصبحت الملكية مبنية على `document/role/revision` بدل الاسم، والخلايا المفقودة في MegaTiles شفافة، والإلغاء يميز `cancelled-before-commit` عن `commit-in-progress` و`reconciliation-required`. أكد المستخدم نجاح اختبارات AE المطلوبة، والدليل الآلي الحالي `npm test` ‏66/66.
- **SDB — فصل اسم الصحراء الغربية في البحث — ✅ منفّذ برمجياً (2026-08-12):** أصبحت نتيجة البحث المصنفة محلياً `ESH` تستخدم اسماً مرئياً منقّى من إسنادات `Morocco / Maroc / المغرب` التي يعيدها Nominatim، مع الإبقاء على أسماء المدن والمناطق، والإحداثيات، وبيانات المزوّد الخام من دون تعديل. لا يطبّق التنقية على نتائج `MAR` الحقيقية. رُفع cache-buster الخاص بـ`SearchPanel` إلى `v=6` وأضيف اختبار إنجليزي/عربي. الدليل: `npm test` (46/46) و`npm run verify:release` ناجحان.
- **SDB — تصحيح اكتمال الصحراء الغربية — ✅ منفّذ برمجياً (2026-08-12):** كشف الاختبار البصري أن `ESH` الافتراضي في Natural Earth وعضو `ESH` في topology يمثلان الشريط الضيق فقط. أصبح البناء يعيد تركيب كامل الإقليم جنوب `27°40′N` من التقسيمات المحلية ثم ينشر الناتج النهائي كمحيط تشغيل مستقل واحد باسم `ESH`؛ لا يستدعي الرسم في AE خريطة `MAR`. تضاعفت المساحة الإسقاطية من نحو `4.68M` للشريط الناقص إلى `13.99M` للمحيط الكامل. أضيف اختبار regression يفحص هوية المصدر والامتداد والمساحة، وليس الـbbox وحده. الدليل: `npm test` (46/46) و`npm run verify:release` ناجحان؛ يلزم إعادة تحميل لوحة CEP ثم اختبار رسم `ESH` يدوياً.
- **SDB — رسم محيط الدولة المحلي من البحث — ✅ تنفيذ برمجي (2026-08-12):** أصبح قلم نتيجة البحث هو مسار رسم AE الوحيد. يرسم `VectorMapManager` الحلقات الخارجية المحلية بلا تبسيط، بما فيها الساحل الملاصق لليابسة وبلا EEZ أو `Water Indicator` أو حدود بحرية سياسية. يعتمد `countries_clipped.topojson` كأساس طوبولوجي، ويطبّق profile `western-sahara-separated-v1`: المغرب `MAR` شمال `27°40′N` فقط، و`ESH` من هندستها المحلية المستقلة؛ لا توجد هندسة مغرب موحّدة ولا نقل نقاط من `MAR` إلى `ESH`. كما يفصل resolver المحلي هوية الرسم عن `country_code` في Nominatim، فتُرسم نتيجة Western Sahara/الصحراء الغربية بـ`ESH` حتى إن نسبت الخدمة المكان إدارياً إلى المغرب. أُزيل زر `Vector Map` العام، وأصبحت إعادة رسم البلد تستبدل طبقته وحدها. توجد بصمات SHA-256 للمصادر في `scripts/vector-data-sources/SOURCES_MANIFEST.json`، وفهرس 258 دولة ومحيط محلي لكل منها. الدليل: `npm test` (46/46) و`npm run verify:release` ناجحان؛ اختبار AE اليدوي فقط باقٍ؛ التفاصيل في `SEARCH_DRAW_LOCAL_LAND_BORDERS_PLAN_AR.md`.
- **Vector Preview المحلي — ✅ منفذ ومعتمد داخل AE (2026-08-14):** أضيف زر تبديل مستقل و`VectorPreviewLayer` يرسم boundaries محلية بلا شبكة، مع تبسيط تكيفي وتسميات محدودة. الوضع لا يغيّر provider أو Finalize، ويوقف تحميل بلاطات المعاينة ثم يعيد بناء طلبات الموقع الحالي عند العودة للصورة. التفاصيل في `VECTOR_PREVIEW_MODE_PLAN_AR.md`، وقد اعتمد المستخدم الاختبار البصري/السلوكي ضمن بوابة M4.
- **Preview/Keyframes workflow — ✅ تنفيذ برمجي (2026-08-12):** وثّق السلوك في `PREVIEW_KEYFRAME_WORKFLOW_PLAN_AR.md`. أصبح Preview متاحًا بعد Finalize كـoverlay لا يمس الـFinal، وأضيف زرا `Add Key` و`Record`. وضع التسجيل مغلق افتراضيًا ويكتب/يحدّث مفتاح CTI فقط؛ بعد استقرار الحركة يُحضَّر Preview لمسار الحركة في الخلفية بحد 2,500 بلاطة وlatest-run-wins. الدليل: `npm run verify:release` ناجح (38/38). اختبارات AE-12 إلى AE-14 باقية للاعتماد اليدوي.
- **M0-01 — ✅ منفذة (2026-08-12):** أضيف `scripts/baseline-manifest.js` و`docs/BASELINE_MANIFEST.json` لتسجيل SHA-256 للمصدر، مصدر الحقيقة، وبيئة Node/Windows. أُنشئت نسخة استرجاع خارج مجلد CEP في `C:\Users\tawfik.mostefaoui\AppData\Roaming\OpenGeo\baselines\OpenGeo-source-baseline-20260812.zip`. الدليل: `npm run baseline:verify` ناجح على 69 ملفًا.
- **M1/M3–M8 — 🟨 اعتماد AE:** اكتملت عناصر الكود والتحقق غير اليدوية: Contracts للإعدادات/الكاميرا والأحداث الحرجة، Session operation state، آخر-طلب-يفوز في AE polling، transport موحد قابل للإلغاء، عزل cache/assets/provider، hardening للمتجهات، وتقسيم host. لا تتحول إلى ✅ إلا بعد سيناريوهات AE المشار إليها داخل كل مرحلة.
- **M2 — ✅ منفذة (2026-08-12):** أضيف `opengeoDispatch` وenvelope موحد و`AEBridge.invoke`؛ رُحّلت جميع استدعاءات العميل، ونُقلت payloads الخاصة ببناء composition إلى ملفات jobs مؤقتة مع cleanup في `finally`. أضيف تحقق Host من وجود/حجم/schema ملف payload. الدليل الحالي: `npm run verify:release` (يتضمن 40/40 اختبارًا والبناء والتحقق) ناجح. يظل اختبار AE اليدوي ضمن M9، ولا يعيد فتح M2 ما لم يكشف اختلافًا في host runtime.

## 3. حواجز الجودة العامة

لا ينتقل أي تغيير إلى المرحلة التالية قبل تحقق الشروط التالية:

- [ ] لا تعديل على `dist/` أو `release/` يدويًا؛ المصدر هو `client/` و`host/` فقط.
- [ ] لكل عيب مُصلح اختبار regression يثبت العيب السابق ثم نجاح السلوك الجديد.
- [ ] لا `evalScript` مباشر خارج `AEBridge` بعد اكتمال M2.
- [ ] لا قراءة/كتابة مباشرة لحالة Session من managers بعد اكتمال M1.
- [ ] لا تبلع الأخطاء الحرجة (`catch {}`) في عمليات AE أو filesystem أو الشبكة.
- [ ] كل عملية طويلة تحمل `requestId`/`jobId` ولها مسار cleanup موثق.
- [ ] كل ميزة تُختبر أولًا في mock ثم داخل After Effects قبل وسمها ✅.

## 4. البنية المستهدفة

```text
App / UI Controllers
        │ intents + snapshots
        ▼
MapSession ───────────────► Event contracts (اختياري ومحدود)
  │ camera · comp · provider · mode · operation generations
  ├────────► AeSyncAdapter ─────► AEBridge.invoke ─────► Host dispatcher
  ├────────► PreviewCoordinator ─► TileRepository ─────► TileProviderResolver
  ├────────► ExportCoordinator ──► TileRepository ─────► JobManager ─────► Host
  └────────► VectorCoordinator ──► GeoDataRepository ──► JobManager ─────► Host

Host dispatcher
  ├─ CompositionService
  ├─ CameraService
  ├─ MetadataService
  ├─ TrajectoryService
  └─ VectorImportService
```

### الحدود المعمارية الإلزامية

| الطبقة | مسموح لها | ممنوع عليها |
|---|---|---|
| UI | DOM، intents، render snapshots، إشعار المستخدم | بناء JSX strings، إدارة cache/filesystem، تغيير state موزع |
| MapSession | state transitions وvalidation وgeneration IDs | DOM أو `XMLHttpRequest` أو `CSInterface` |
| Coordinators | ترتيب workflows وتحويل النتائج إلى Session | الوصول المباشر إلى private state لخدمة أخرى |
| TileProvider/Repository | URL/cache/download/cancellation | UI events أو AE commands |
| AEBridge | serialization/request/timeout/result envelope | منطق composition أو provider أو UI |
| Host services | عمليات AE فقط وإرجاع envelope | افتراض أسماء عالمية من دون document identity |

## 5. سجل القرارات المطلوب اعتماده قبل التنفيذ

| ID | القرار | القيمة الافتراضية المقترحة | المالك | الحالة |
|---|---|---|---|---|
| ADR-01 | هل يحتفظ المنتج بـ `uiZoom` و`compZoom`؟ | الاحتفاظ بكليهما كحقلين صريحين؛ persistence يحفظ `compZoom` فقط مع conversion محدد | Architecture | ⬜ |
| ADR-02 | هل Auto-export إلى AE يبقى أثناء السحب؟ | نعم، لكن debounce 250ms وlatest-wins، وليس لكل pointer event | Product + Architecture | ⬜ |
| ADR-03 | هل Preview tiles جزء من مشروع AE أم assets مؤقتة؟ | جزء مؤقت مقيّد بـ documentId وpreview generation | Product | ⬜ |
| ADR-04 | مسار export المعتمد | Engine + MegaTileStitcher للـ AE؛ إزالة Canvas PNG path ما لم يوجد requirement مستقل | Product + Engineering | ⬜ |
| ADR-05 | دعم أكثر من OpenGeo map في المشروع | مدعوم صراحةً عبر documentId؛ لا تعتمد أسماء composition وحدها | Product + Architecture | ⬜ |
| ADR-06 | تخزين مفاتيح provider | localStorage مؤقتًا مع توثيق المخاطر؛ لا تدخل السجلات أو payloads؛ دراسة keystore لاحقًا | Security + Product | ⬜ |
| ADR-07 | مصير LayerManager | تنفيذ end-to-end أو استبعاده من هذا الإصدار | Product | ⬜ |

لا تُغلق M1 قبل اعتماد ADR-01 وADR-02، ولا تُغلق M4 قبل ADR-04 وADR-06، ولا تُغلق M7 قبل ADR-05.

---

# المرحلة M0 — تثبيت خط الأساس وحماية التنفيذ

**الهدف:** جعل الإصلاح قابلاً للقياس والرجوع قبل لمس المنطق.

## M0-01 — إنشاء baseline قابل للاستعادة

- [x] **الحالة:** ✅ منفذة — baseline manifest وsnapshot خارجي وأوامر record/verify موثقة أعلاه.
- **الملفات/النطاق:** جذر المشروع، `package.json`، `client/`، `host/`.
- **التنفيذ:**
  1. ضع المشروع في Git أو أنشئ snapshot مؤرخًا خارج مجلد CEP المثبت.
  2. سجّل hashes للمصدر ولأصول البيانات الكبيرة.
  3. وثق إصدار After Effects وCEP/Windows وNode المتاحين للتدقيق.
  4. امنع تعديل generated folders يدويًا في دليل المساهمة.
- **اختبارات/أدلة:** يمكن إعادة المصدر إلى hash baseline؛ `npm test` و`node --check` تسجل نتيجتهما الحالية.
- **معيار القبول:** snapshot موجود، ومسار source-of-truth موثق، ولا توجد خسارة لتعديلات المستخدم السابقة.

## M0-02 — مصفوفة سلوك قبل الإصلاح

- [ ] **الحالة:** 🟨 أنشئت `docs/AE_TEST_MATRIX.md`؛ تعبئة نتائج AE الفعلية باقية.
- **التنفيذ:** إنشاء `docs/AE_TEST_MATRIX.md` يتضمن النتائج الحالية للسيناريوهات التالية:
  - فتح اللوحة ثم السحب/zoom/تغيير provider.
  - New Comp ثم Keyframe ثم Finalize.
  - تغيير active composition داخل AE.
  - provider بمفتاح وبدون مفتاح.
  - حفظ boundary ثم Vector Map.
  - مشروع غير محفوظ، شبكة منقطعة، وإغلاق/فتح اللوحة.
- **القياس المطلوب:** سجل عدد Undo steps بعد سحب 5 ثوان، وعدد layers/footage قبل وبعد exports متتالية.
- **معيار القبول:** baseline يحتوي نتائج فعلية على نسخة AE مستهدفة واحدة على الأقل؛ العيوب المعروفة تحمل ID أو وصف قابل للإعادة.

## M0-03 — تهيئة harness الاختبارات

- [x] **الحالة:** ✅ منفذة — 107 اختبارات regression/behavior/contract/smoke تعمل دون AE، وتشمل provider race وpartial Host import وfinalize cancellation وlifecycle disposal.
- **التنفيذ:** إضافة test runner حديث متوافق مع CommonJS، وfixtures صغيرة لـ `CSInterface`, `localStorage`, `XMLHttpRequest`, وAE result strings. لا تنقل كل الاختبارات مرة واحدة؛ يكفي bootstrap وتشغيل test واحد موثوق.
- **معيار القبول:** `npm test` يشغّل smoke الحالي واختبار unit جديد دون اتصال أو After Effects.

**بوابة M0:** كل عناصر M0 ✅، وADR-01/02 مسجلان على الأقل كقرارات قيد الاعتماد.

---

# المرحلة M1 — مصدر حقيقة واحد للحالة والعقود

**الهدف:** إزالة الالتباس بين `MapState`, `Viewport`, `App`, `AESyncEngine`, وEngine قبل تبديل transport أو tile code.

## M1-01 — تعريف نماذج البيانات الرسمية

- [ ] **الحالة:** 🟨 أضيف `StateContracts` بعقود `normalizeCamera` وpreferences و`toAeCamera`، وتستخدمه Session/App، وأضيف operation state إلى Session؛ اعتماد AE باقٍ.
- **التنفيذ:** إنشاء ملفات منطق نقية (JavaScript مع JSDoc أو TypeScript إن تقرر لاحقًا) تعرف:

```js
CameraState = { lat, lng, uiZoom, compZoom, tileSize }
CompositionRef = { documentId, compId, compName, width, height, fps, duration }
ProviderState = { id, tileSize, minZoom, maxZoom, hasUsableKey }
OperationState = { previewGeneration, syncGeneration, finalizeGeneration, status }
```

  - ثبّت اتجاه التسمية: `lng` في client وhost؛ لا تستعمل `lon` إلا عند adapter خارجي.
  - عرّف range واحد للـ latitude والـ longitude والـ zoom وفق provider.
  - أضف serializers منفصلة: `toPreferences`, `fromPreferences`, `toAeCamera`.
- **اختبارات:** conversion UI/comp zoom؛ lat/lng normalization؛ serialization لا يفقد tileSize أو dimensions.
- **معيار القبول:** لا تستخدم وظيفة جديدة object عشوائيًا للكاميرا أو comp؛ جميع الحقول المسموح بها مسماة ومتحقق منها.

## M1-02 — بناء `MapSession`

- [ ] **الحالة:** 🟨 Session يملك camera/composition/provider/documentId وgeneration/operation state؛ اختبارات سباق العمليات الآلية موجودة واعتماد AE باقٍ.
- **التنفيذ:**
  1. أنشئ Session يملك snapshot immutable أو copied عند القراءة.
  2. وفر commands: `hydratePreferences`, `setCamera`, `setComposition`, `setProvider`, `setFinalized`, `beginOperation`, `completeOperation`, `failOperation`.
  3. أضف `origin` لكل camera mutation: `ui`, `ae`, `metadata`, `bootstrap`.
  4. أضف خيار `emit: false` أو transaction لكي لا يطلق hydration سلسلة preview/export.
  5. احفظ generation في Session، لا في كل manager منفصل.
- **لا تفعل:** لا تحوّل UI دفعة واحدة؛ ضع adapter مؤقتًا يسمح لـ Viewport بقراءة Session.
- **اختبارات:** الاستعادة مرتين لا تغير compZoom؛ camera origin=`ae` لا ينتج intent push؛ operation قديم لا يستطيع commit بعد generation أحدث.
- **معيار القبول:** Session هو المالك الوحيد لـ camera وcomposition/provider؛ `App.activeCompId` و`AESyncEngine._activeCompId` يصبحان adapters/مستأصلين.

## M1-03 — إصلاح Viewport وpersistence دون كسر الواجهة

- [ ] **الحالة:** 🟨 اكتملت وحدة `PreferencesStore` واختبار preferences الفاسدة واستعادة `compZoom` آليًا؛ فحص reopen الحقيقي داخل AE باقٍ.
- **ملفات مستهدفة:** `MapState.js`, `map/Viewport.js`, `app.js`.
- **التنفيذ:**
  - اجعل Viewport transform/render adapter فقط؛ لا يحفظ التفضيلات ولا يعرف AE.
  - استبدل `_loadPrefs/_savePrefs` بوحدة Preferences تعتمد serializers من M1-01.
  - لا تمرر compZoom إلى `setUIZoom` عند start؛ استعمل `hydrateCamera` أو setter صريحًا.
  - خزّن theme/comp settings/provider settings في وحدات preferences منفصلة مع schema/version migration.
- **اختبارات:** reopen 10 مرات يحافظ على camera ضمن tolerance `1e-6`; تغيير حجم panel لا يغير compZoom؛ preferences فاسدة تعود defaults آمنة.
- **معيار القبول:** عيب zoom drift لم يعد قابلًا لإعادة الإنتاج.

## M1-04 — عقد أحداث مرحلي ومنع الكتابة الدائرية

- [ ] **الحالة:** 🟨 أضيفت unsubscribe/dispose للـ owners الرئيسيين و`OpenGeoEvents`/payload contracts للمزامنة الحرجة؛ اختبار loop/lifecycle داخل CEP باقٍ.
- **التنفيذ:**
  - احتفظ بـ EventBus مؤقتًا، لكن عرّف constants وpayload schemas.
  - منع events القديمة العامة من تعديل الحالة مباشرة: UI يرسل `camera:intent`، Session ينشر `session:changed` مع `origin`.
  - افصل events إلى `ui:*`, `session:*`, `ae:*`, `tile:*`, `operation:*`.
  - كل subscription يعيد `unsubscribe`; سجلها في owner.
- **اختبارات:** listener exception لا يمنع الآخرين؛ owner dispose يزيل جميع listeners؛ event من `ae` لا يولد `ae:cameraPushRequested`.
- **معيار القبول:** يوجد جدول events في الكود/الاختبار، ولا تستخدم modules الجديدة `viewport:changed` كإشارة غامضة متعددة المعنى.

**بوابة M1:** M1-01 إلى M1-04 ✅؛ tests zoom/session/event green؛ ADR-01/02 ✅.

---

# المرحلة M2 — بروتوكول AEBridge وExtendScript

**الهدف:** جعل الجسر boundary وحيدًا ذا serialization وerrors وtimeouts متوقعة.

## M2-01 — تصميم response envelope وcommand registry

- [x] **الحالة:** ✅ منفذة
- **التنفيذ:**
  - response موحد: `{ ok: true, data, requestId }` أو `{ ok: false, error: { code, message, details? }, requestId }`.
  - سجل commands مسموح به: `project.getState`, `composition.build`, `camera.getActive`, `camera.update`, `metadata.get`, `metadata.set`, `trajectory.scan`, `vector.import`, `pin.add`.
  - عرّف لكل command schema arguments وحد timeout ومسار idempotency/side effect.
- **معيار القبول:** لا function host عامة ترجع `success` أو `error:` أو JSON مختلفًا عن envelope.

## M2-02 — تنفيذ `AEBridge.invoke`

- [x] **الحالة:** ✅ منفذة
- **التنفيذ:**
  1. اجعل `_evalScript` private داخل AEBridge.
  2. `invoke` يولد requestId، يـ JSON-serialize الطلب، يستدعي host dispatcher فقط، ويفك envelope.
  3. timeout يحوّل request إلى obsolete محليًا؛ لا يسمح callback المتأخر بإكمال coordinator.
  4. سجل diagnostics مختصرة: command/requestId/duration، بلا API keys أو payload كامل.
- **اختبارات:** quote/backslash/newline/unicode/path؛ timeout ثم callback متأخر؛ `EvalScript error.`؛ host envelope invalid.
- **معيار القبول:** لا caller إنتاجي يصل إلى `_evalScript` مباشرة.

## M2-03 — Host dispatcher وservices

- [x] **الحالة:** ✅ منفذة
- **التنفيذ:**
  - أضف `opengeoDispatch(requestJson)` في `host/index.jsx` أو module جديد.
  - parse/validate request مرة واحدة، ثم route إلى service functions غير عامة.
  - اجعل كل service يعيد data أو يرمي خطأ محددًا؛ dispatcher فقط يصنع envelope.
  - أضف helpers `withUndoGroup(name, fn)` و`withFileRead` لتقليل تكرار `try/finally`.
- **اختبارات:** fixtures للـ request/response وinvalid args وcommand غير معروف.
- **معيار القبول:** public surface في JSX هو dispatcher فقط، أو adapters انتقالية موسومة deprecation لا تستعملها client.

## M2-04 — نقل payloads الثقيلة إلى Job files

- [x] **الحالة:** ✅ منفذة
- **التنفيذ:**
  - عمّم نمط `JobManager`: `createJsonJob(type, data)` و`finishJob` في finally.
  - `composition.build` و`vector.import` يرسلان `jobManifestPath` لا JSON tile list عبر evalScript.
  - host يتحقق من وجود الملف، حجمه/schema، وdocumentId قبل استخدامه.
  - أبقِ ملفات job حتى يؤكد host القراءة أو ينتهي timeout محدد؛ لا تحذف قبل انتهاء `evalScript`.
- **اختبارات:** manifest كبير؛ فشل host؛ timeout؛ cleanup مرة واحدة؛ عدم حذف job آخر.
- **معيار القبول:** لا يتجاوز أي payload JSON مباشر حجمًا صغيرًا متفقًا عليه (مثلاً 16KB)، والـ tile manifest لا يمر في command string.

## M2-05 — ترحيل callers وإزالة raw JSX

- [x] **الحالة:** ✅ منفذة
- **النطاق:** `SyncManager`, `FinalizeController`, `AESyncEngine`, `MetadataManager`, `SpatialPin`, `VectorMapManager`, `App`.
- **التنفيذ:** استبدل callers واحدًا واحدًا، واحتفظ باختبار لكل command قبل حذف wrapper القديم. انقل `generateFlightPath` إما إلى command Host أو احذفه حسب ADR.
- **معيار القبول:** البحث عن ``_evalScript(``` أو `opengeo[A-Z]` في client لا يعيد إلا AEBridge/fixtures المصرح بها.

**بوابة M2:** ✅ منفذة آليًا في 2026-08-12. M2-01…M2-05 مكتملة في المصدر؛ contract/escape/payload-file regression يغطيها `npm test`، ويظل اختبار host الفعلي مطلوبًا ضمن M9.

---

# المرحلة M3 — مزامنة AE والأحداث ودورة الحياة

**الهدف:** مزامنة ثنائية الاتجاه يمكن التنبؤ بها ولا تضخم Undo history أو تعيد تطبيق الحالة القديمة.

## M3-01 — تحويل `AESyncEngine` إلى adapter

- [ ] **الحالة:** 🟨 polling latest-wins وcomp/session adapters وepoch لإهمال الردود المتأخرة مطبقة ومحمية باختبار آلي؛ اختبارات AE للردود المتأخرة والتبديل باقية.
- **التنفيذ:**
  - يقرأ AE adapter Session snapshot ولا يحتفظ camera/comp mutable خاصًا به.
  - يقدم `start()`, `stop()`, `dispose()`؛ لا يبدأ polling عند constructor.
  - implement `pollInFlight`, sequence number، وcomp/document validation قبل apply.
  - عند ورود AE camera: `session.setCamera(camera, {origin:'ae', emitIntent:false})`.
- **اختبارات:** two out-of-order poll responses؛ active comp تغير مرتين؛ response لمستند قديم؛ stop أثناء request.
- **معيار القبول:** تبقى poll request واحدة نشطة فقط، وAE camera ينعكس في CEP فعليًا.

## M3-02 — جدولة camera push وUndo policy

- [ ] **الحالة:** 🟨 المزامنة الحية مفعلة تلقائيًا عند فتح اللوحة، وdebounce بمدة 200ms وlatest-wins ومنع push أثناء تطبيق AE/metadata مطبقة. أضيفت حماية من رد polling القديم أثناء تفاعل المستخدم وwheel متدرج ضمن animation frame، و`camera.update` أصبح يكتب عند زمن المؤشر إذا كانت الكاميرا ذات keyframes؛ قياس Undo الحقيقي في AE باقٍ.
- **التنفيذ:**
  - debounce camera intents 150–250ms؛ pending write واحد latest-wins.
  - لا تدفع تغييرات `origin: ae|metadata|bootstrap` إلى AE.
  - في host، صمم `camera.update` لتكون عملية sync لا تنتج undo step لكل pixel؛ القرار النهائي يعتمد ADR-02 ويجب أن يكون موثقًا.
  - أوقف push حين لا تكون composition الحالية هي document المقصود.
- **اختبارات AE:** سحب مستمر 5 ثوان ينتج عدد undo steps مطابق للسياسة (يفضل 0 أو 1)، والموضع النهائي في AE يساوي Session.
- **معيار القبول:** لا feedback loop ولا undo flood.

## M3-03 — metadata lifecycle

- [ ] **الحالة:** 🟨 حفظ debounced للكاميرا/provider/الأبعاد/Finalize وschema محدثة؛ reopen/switch داخل AE باقٍ.
- **التنفيذ:**
  - حفظ metadata عند commits المهمة: provider، comp dimensions، camera بعد debounce، وfinalization state.
  - hydration عند comp switch transaction صامتة؛ لا preview/export قبل اكتمال hydration.
  - metadata schema versioned وتحوي `documentId`.
- **اختبارات:** reopen project؛ metadata قديمة؛ metadata malformed؛ switch بين خريطتين.
- **معيار القبول:** `MetadataManager.saveToComp()` لم يعد dead code، ولا يرسل hydration أي auto-export.

## M3-04 — lifecycle موحد للـ UI

- [ ] **الحالة:** 🟨 أضيف dispose للمديرين والطبقات الرئيسيين؛ اختبار create/destroy في CEP باقٍ.
- **التنفيذ:** إضافة `dispose()` لـ `App`, `InputHandler`, `TileManager`, `SearchPanel`, `SettingsPanel`, `Toast`, `AESyncAdapter`. احتفظ بمراجع callbacks قبل التسجيل وألغِ ResizeObserver وwindow listeners وtimers وXHR.
- **اختبارات:** إنشاء/إتلاف App 20 مرة لا يزيد listener count أو timers؛ إغلاق panel أثناء download لا يغير AE لاحقًا.
- **معيار القبول:** لا listeners/intervals/workers معلقة بعد dispose.

**بوابة M3:** مزامنة manual وmock green؛ M3-01…04 ✅.

---

# المرحلة M4 — توحيد providers والبلاطات والـ cache

**الهدف:** نفس provider وURL وtile semantics للمعاينة والتصدير والـ Finalize.

## M4-01 — `TileProviderResolver` واحد

- [x] **الحالة:** ✅ منفذة — `ProviderManager` يقدّم definition/validation/template/URL/signature من مصدر واحد.
- **التنفيذ:**
  - استخرج من ProviderManager: `getDefinition`, `validateSelection`, `resolveTemplate`, `buildTileUrl`.
  - استعمل provider id واحدًا وtileSize/zoom limits من definition.
  - حل API keys من مصدر واحد؛ لا `prefs.apiKey` ولا TileManager.apiKey كسجل منافس.
  - رفض تشغيل operation قبل الشبكة إذا `requiresKey` بلا مفتاح.
  - إزالة Google field أو تنفيذ provider رسمي فقط وفق ADR-06.
- **اختبارات:** ESRI، Mapbox، MapTiler، Stadia، Custom XYZ valid/invalid؛ عدم تسرب key إلى diagnostics.
- **معيار القبول:** لا تمرير `src.url` خامًا إلى Engine ولا `{key}` باقٍ في URL قابل للتنفيذ.

## M4-02 — `TileRequest` و`TileRepository`

- [ ] **الحالة:** 🟨 Preview وFinalize يستخدمان `TileTransport` مشتركًا للـXHR/timeout/abort/HTTP validation وretry/cancellation policy؛ اختبار إعادة الإلغاء/requeue على runtime CEP باقٍ.
- **التنفيذ:**
  - request immutable: `{requestId, providerSignature, z, x, y, tileSize, priority, purpose}`.
  - result يشمل status/source/cache metadata؛ cache key يشمل provider signature لا provider id فقط.
  - retries/timeouts/cancellation في implementation واحدة.
  - عالج cancel/requeue: tile cancelled لا يمنع طلبًا جديدًا لنفس key بجيل أحدث.
  - قرر بوضوح: DiskCache مدعوم ومتكامل أو يحذف؛ لا object معطل.
- **اختبارات:** cancellation ثم requeue؛ timeout؛ retry؛ stale response؛ cache isolation بين provider/styles؛ 256/512.
- **معيار القبول:** implementation واحد فقط لمنطق الشبكة/cache في الإنتاج.

## M4-03 — توحيد الإحداثيات والـ zoom

- [x] **الحالة:** ✅ أصلح نطاق antimeridian وأزيلت private engine mutation. صُححت في 2026-08-14 معادلة نسبة Camera/Download Zoom، وأُلغي over-fetch الناتج عن محاذاة `8×8` وBase Zoom الضمنية؛ الاختبارات الكمية والمنطقية واختبار AE-32 ناجحة.
- **التنفيذ:**
  - احتفظ بنواة projection/TileGrid واحدة ومررها إلى preview/export/finalize.
  - دعم antimeridian صراحةً في visible-tile calculation؛ لا clamp يفقد tiles خلف ±180°.
  - حدد `effectiveDownloadZoom` بناء على provider max وsourceTileSize وسياسة quality واحدة.
  - أزل private mutation `engine._camera._state`.
- **اختبارات:** center 179.9 و-179.9؛ latitude قرب الحد؛ zoom 0/حد provider؛ 512 source؛ comp واسع.
- **معيار القبول:** لا توجد نسخ مستقلة من TileGrid/TileDownloader في runtime production.

## M4-04 — فصل preview عن export manifests

- [x] **الحالة:** ✅ منفذة — Preview يستخدم `syncResult.tiles` للطلب الحالي، وأزيل تاريخ `_accumulatedTiles`.
- **التنفيذ:** preview يمكنه cache tiles، لكن export يستدعي repository بطلب جديد مقيّد بـ request generation ولا يقرأ history عالميًا. أزل `_accumulatedTiles` من كونه input للـ composition build.
- **اختبارات:** تنقل إلى ثلاث مناطق ثم export؛ manifest لا يحتوي إلا tiles المطلوبة للـ camera الحالية؛ تبديل provider ثم export لا يخلط assets.
- **معيار القبول:** لا يمكن لتاريخ navigation أن يضخم preview composition أو export manifest.

**بوابة M4:** ADR-04/06 ✅؛ كل provider scenarios green؛ لا duplicates tile runtime.

---

# المرحلة M5 — Preview وFinalize وإدارة الأصول

**الهدف:** منع success الزائف وstale assets، وجعل كل عملية قابلة للإلغاء والتنظيف.

## M5-01 — إعادة تشكيل ExportCoordinator

- [ ] **الحالة:** 🟨 SyncManager يستخدم `MapSession.begin/complete/failOperation` ويوقف commit قديم عبر generation؛ تحقق export المتداخل داخل AE باقٍ.
- **التنفيذ:**
  - استبدل `SyncManager.exportToAE` بـ workflow منفصل: `prepareRequest → download → createManifestJob → bridge.invoke → applyResult`.
  - `createIfNeeded` يحذف أو يتحول إلى خيار واضح؛ لا parameters ميتة.
  - generation يأتي من Session ويوقف commits المتأخرة.
  - UI progress عبر operation state لا `globalEventBus` من طبقات عميقة.
- **اختبارات:** export متداخل؛ فشل AE envelope؛ provider missing key؛ إلغاء؛ retry.
- **معيار القبول:** UI لا تعلن success إلا حين `ok === true` من Host وresult يخص generation الحالي.

## M5-02 — إصلاح FinalizeController

- [x] **الحالة:** ✅ فصل المسار إلى مراحل موجود، وcleanup للـworker وsingle-flight وتحقق تغيّر الخريطة وإلغاء المستخدم الفعلي وحدود trajectory/tile work وoperation state موجودة. فُصلت معاملة Finalize للأصول عن Camera animation وأزيل تمرير آخر عينة إلى commit؛ regression ‏89/89 واختبار AE-33 ناجحان.
- **التنفيذ:**
  - فصل validate/trajectory/download/stitch/build إلى services قابلة للاختبار.
  - scan trajectory يقبل `sampleStep` رسميًا أو لا يرسله؛ ضع حدًا لحجم العمل وprogress/cancel.
  - parse Bridge envelope دائمًا؛ افشل عند host error JSON.
  - ضع `MegaTileStitcher.destroy()` وJob cleanup في `finally`.
  - لا تستعمل filesystem أو DOM مباشرة داخل domain coordinator؛ inject adapters.
- **اختبارات:** host returns error; worker throws; user cancels; project unsaved; no frames; partial downloads؛ full failure.
- **معيار القبول:** لا Finalize success زائف، ولا worker/job باقٍ بعد أي error.

## M5-03 — cache وasset identity

- [ ] **الحالة:** 🟨 هوية MegaTile وdisk cache أصبحت قصيرة ومعزولة حسب composition/provider، والتنظيف مقيّد بالـcomposition؛ اختبار AE لخريطتين وstale asset باقٍ.
- **التنفيذ:**
  - asset key: `documentId + providerSignature + tileSize + z + x + y + contentVersion`.
  - MegaTile name يتضمن `documentId` فعليًا؛ استخدم `compId` الممرر أو أزله من API.
  - manifest يحوي input tile hashes/URLs أو signature موثوقة؛ لا reuse على `file size > 1000` فقط.
  - cleanup يستخدم key نفسه ولا يمس document/job آخر.
- **اختبارات:** provider switch؛ نفس region مع tileSize مختلف؛ خريطتان في مشروع واحد؛ stale mega file؛ cleanup safety.
- **معيار القبول:** cleanup pattern يطابق asset name، وasset من provider A لا يعاد استخدامه في B.

## M5-04 — سياسة Preview tiles في AE

- [x] **الحالة:** ✅ كل Preview يستبدل طبقات/footage المعاينة للمستند نفسه فقط، و`replaceFinal` يعالج تعديل خريطة finalized. أضيف في 2026-08-14 Preview transaction مخفي `stage → validate → commit` وحزم MegaTiles لمساري viewport/trajectory، مع إلغاء build المكرر عند `Add Key`؛ اختبار AE-31 المتكرر ناجح.
- **التنفيذ:** وفق ADR-03، عرف preview generation في metadata. عند export جديد لنفس document، احذف/replace preview assets السابقة لذلك generation فقط، لا المجلد العالمي ولا tiles لمصدر مختلف في document آخر.
- **اختبارات AE:** 10 exports بحركة مختلفة؛ layer/footage counts تبقى bounded؛ Finalize يزيل preview الصحيح فقط.
- **معيار القبول:** لا تضخم غير محدود في Project Panel أو composition layers.

**بوابة M5:** Finalize/preview regression + اختبار مشروع بخريطتين ✅.

---

# المرحلة M6 — المتجهات والبيانات المحلية

**الهدف:** تصحيح spatial filtering، البحث العربي، ودورة حياة vector jobs.

## M6-01 — فصل نماذج MercatorFeature وGeoJSON

- [ ] **الحالة:** 🟨 أضيفت adapters صريحة لـMercatorFeature/GeoJSON وحساب bbox لا يغيّر المصدر، مع تغطية lines والنقاط الفاسدة؛ fixture dataset موسع واختبار AE باقٍ.
- **التنفيذ:**
  - أضف adapters صريحة: `fromInternalMercatorFeature`, `fromGeoJsonFeature`, `computeMercatorRingsBBox`.
  - لا يفترض Repository وجود `geometry` في dataset `world_mercator_boundaries.json`.
  - بنية index/WeakMap منفصلة للـ bbox/search score؛ لا mutate source feature.
- **اختبارات:** world dataset small fixture؛ bbox يختار subset؛ polygon/multipolygon/line؛ invalid rings.
- **معيار القبول:** viewport bbox محدود لا يعيد جميع 241 feature إلا إذا كان العالم كاملًا بالفعل.

## M6-02 — إصلاح البحث العربي والتخزين المحلي

- [ ] **الحالة:** 🟨 تطبيع عربي مغطى آليًا وfallback filesystem آمن؛ اختبار أسماء الملفات Unicode داخل CEP باقٍ.
- **التنفيذ:** استبدل mojibake patterns بـ Unicode الصحيح (`\u0640`… إلخ)، واكتب normalization rules وfixtures عربية. تحقق من `fs/path` قبل استخدامها في fallback، وافصل storage path validation عن UI.
- **اختبارات:** تشكيل، تطويل، ألف بأشكالها، ة، ى، وأسماء ملف Unicode آمنة.
- **معيار القبول:** query عربي قابل للتنبؤ ولا ينهار عند غياب Node/CEP filesystem.

## M6-03 — Vector job وHost import idempotency

- [ ] **الحالة:** 🟨 compId صريح، تسمية country للعنصر المفرد، الاحتفاظ بالطبقات المختلفة وتحديث التكرار المطابق بالـfeature signature، وحدود feature/path مطبقة؛ اختبارات AE للفشل/التكرار باقية.
- **التنفيذ:**
  - `VectorMapManager` يضمن `finishJob(jobId)` في finally حتى إن فشل write/bridge/host.
  - أضف `documentId`, `layerId`/`featureSignature` إلى payload.
  - host يستعمل الاسم المرسل رسميًا ويحدث layer مطابقًا أو ينشئه حسب policy، لا ينشئ shape layer مكررًا بصمت.
  - حدّ من feature/path count قبل AE وأبلغ المستخدم برسالة قابلة للإجراء.
- **اختبارات:** host failure؛ duplicate import؛ job cleanup؛ payload malformed؛ 0/large feature sets.
- **معيار القبول:** لا temp files متروكة ولا layers مكررة عند تكرار نفس الطلب.

**بوابة M6:** spatial/Arabic/vector tests ✅.

---

# المرحلة M7 — تفكيك مضيف After Effects وهوية المستند

**الهدف:** إزالة الاعتماد على names عالمية وجعل JSX قابلًا للصيانة والاختبار بالعقود.

## M7-01 — document identity وmetadata schema

- [ ] **الحالة:** 🟨 documentId وmetadata schema مطبقان؛ migration لمشروع AE قديم والتحقق متعدد الخرائط يحتاجان AE.
- **التنفيذ:** عند إنشاء/تبني composition، يولد `documentId` ويحفظ في metadata مع schema version. Resolver يبحث بالـ ID/comment أولًا ثم يوفر migration محدودًا للخريطة القديمة ذات الاسم المعروف.
- **اختبارات AE:** مشروع قديم بدون ID؛ خريطتان لهما أسماء متشابهة؛ active comp لا تخص OpenGeo.
- **معيار القبول:** لا يعتمد أي command جديد على أول `findCompByName` باسم عالمي فقط.

## M7-02 — تقسيم `compBuilder.jsx`

- [ ] **الحالة:** 🟨 فصلت ownership/asset cleanup وensure/find composition إلى `compositionAssets.jsx`، واستيراد/موضعة tiles إلى `compositionTiles.jsx`، وcontroller rig/expressions إلى `compositionRig.jsx`؛ serializer منفصل وقياس AE باقٍ.
- **التنفيذ:** فصل مسؤولياته إلى modules/services:
  - `CompositionResolver`: document/comp discovery وإنشاء آمن.
  - `AssetCleanupService`: policy مقيدة بـ document/generation.
  - `TileImportService`: manifest validation/import/replacement.
  - `ExpressionInstaller`: MapPivot/controls expressions وإصداراتها.
  - `CompositionResultSerializer`: response data فقط.
- **اختبارات:** reuse dimensions/fps/duration؛ source change؛ tile replacement؛ expression upgrade؛ failure mid-import ضمن Undo.
- **معيار القبول:** لا function واحدة تملك lifecycle كاملًا لكل composition/cleanup/import/expression/serialization.

## M7-03 — Undo Group utility وسياسة العمليات

- [ ] **الحالة:** 🟨 `withUndoGroup` مستخدمة في build/vector/pin/keyframe، وcamera sync بلا Undo؛ قياس AE باقٍ.
- **التنفيذ:** `withUndoGroup` يضمن end مرة واحدة فقط بعد begin ناجح، ويسجل اسم العملية/requestId. افصل عمليات query (`getState`, `scanTrajectory`) عن undo groups. لا يستخدم camera sync operation undo group لكل pointer event وفق M3.
- **اختبارات AE:** errors قبل/بعد begin؛ عملية import فاشلة؛ update متكرر؛ undo stack count.
- **معيار القبول:** كل mutation host يمر عبر utility واحدة، وكل query لا يغيّر history.

## M7-04 — إزالة أو ترحيل legacy JSX

- [x] **الحالة:** ✅ منفذة — أزيلت endpoints/wrappers القديمة و`host/utils.jsx`؛ المسار العام للـJSX هو dispatcher فقط.
- **العناصر:** `opengeoInitMap`, `opengeoSetMapRaster`, `opengeoClearTiles`, `opengeoGetCompState`, `opengeoSetLayerProperties`, و`host/utils.jsx`.
- **التنفيذ:** قيّم كل API وفق usage بعد M2. انقل المطلوب إلى services الجديدة، ثم احذف غير المستخدم. لا تبقِ `opengeoSetMapRaster` مع `folders.tiles` غير الموجود.
- **معيار القبول:** `host/index.jsx` لا يتضمن إلا modules حية متوافقة مع dispatcher، ولا helpers متضاربة.

**بوابة M7:** ADR-05 ✅؛ project multi-map smoke test ✅.

---

# المرحلة M8 — إزالة الدين، hardening، والتوافق

**الهدف:** إنهاء المسارات المتروكة وتأكيد أن lifecycle والأمن والتوافق لا يعيدان العيوب.

## M8-01 — قرار وتنظيف dead code

- [x] **الحالة:** ✅ منفذة — حذفت modules غير المستخدمة وwrappers القديمة وSpatialPin expression العالمي؛ لكل مسار باقٍ entry point حي.
- **قائمة التنفيذ:**
  - [ ] `BoundaryManagerUI.js`: تفعيل واختبار أو حذف.
  - [ ] `DiskCache.js`: دمج في TileRepository أو حذف.
  - [ ] `PNGExporter.js` و`TileStitcher.js`: اعتماد workflow أو حذف.
  - [ ] `LayerManager`: تنفيذ end-to-end أو حذف feature model غير الموصول.
  - [ ] `SpatialPin.generateFlightPath` وBake stubs: تنفيذ رسمي أو حذف.
  - [ ] AEBridge wrappers/endpoints القديمة: حذف بعد migration.
  - [ ] `host/utils.jsx`: حذف بعد M7-04.
- **معيار القبول:** لكل ملف متبقٍ entry point واختبار؛ لا code path ميت داخل artifact.

## M8-02 — security وresilience للـ data/network

- [ ] **الحالة:** 🟨 أزيل HTML غير الموثوق من search/attribution، وعُزز abort/timeout، وأضيف تحقق HTTPS وقالب XYZ وحدود vector وGeoJSON، وأزيل مرجع Source Map مكسور؛ اختبارات الشبكة العملية باقية.
- **التنفيذ:**
  - استبدال أي `innerHTML` يستقبل بيانات شبكة بـ `textContent`/DOM API.
  - حد لحجم GeoJSON والـ feature count/depth؛ validation قبل rendering أو file write.
  - Custom XYZ يقبل `https:` وplaceholders المعتمدة فقط.
  - rate limit/backoff وحدود Finalize لكل provider؛ attribution policy واضحة.
  - logs مصنفة ولا تكتب مفاتيح أو payloads أو مسارات حساسة.
- **اختبارات:** XSS string؛ GeoJSON كبير/فاسد؛ custom URL غير صالح؛ network timeout؛ missing key.
- **معيار القبول:** لا تنفيذ HTML خارجي، ولا retry غير محدود، ولا أسرار في logs.

## M8-03 — توافق CEP/AE ومراقبة الأداء

- [ ] **الحالة:** 🟨 عقد التوافق والـmanifest وميزانيات الأداء الآلية مكتملة: AE ‏18.4–24.x وCSXS 11، مع إثبات fallbacks وصياغة JSX وحدود memory/concurrency/tiles/logs؛ اعتماد AE-36/AE-37 وقياسات Host الفعلية باقية.
- **التنفيذ:** feature detection حول `Worker`, `OffscreenCanvas`, `ResizeObserver`, Node availability؛ fallback مختبر أو منع feature برسالة واضحة. قس زمن preview/export/finalize واستهلاك layers/tiles/worker jobs.
- **معيار القبول:** مصفوفة توافق معلنة على الأقل لأقدم وأحدث AE مدعومين، ولا توجد ميزة تعتمد API غير متاحة بلا fallback.

**بوابة M8:** لا dead code غير مقرر، security tests وcompatibility matrix ✅.

---

# المرحلة M9 — التحقق النهائي والإصدار

**الهدف:** إثبات أن artifact الحقيقي يعمل في بيئة مستخدم جديدة.

## M9-01 — حزمة اختبارات آلية نهائية

- [x] **الحالة:** ✅ منفذة — `npm run verify:release` يشغّل الاختبارات، build، package verification، syntax للعميل/المضيف، سلامة include، ومنع raw bridge/legacy/source-map المكسور.
- **تشغيل إلزامي:**
  - [ ] syntax/lint.
  - [ ] unit: Session, zoom, URL/provider, cache key, bbox, bridge envelope.
  - [ ] integration: CSInterface mock, ordering/cancellation, jobs, host response errors.
  - [ ] package integrity.
- **معيار القبول:** نتيجة واحدة قابلة لإعادة التشغيل من clean workspace، ولا توجد test skips غير مبررة لـ P0/P1.

## M9-02 — smoke test داخل After Effects

- [ ] **الحالة:** ⬜

| ID | السيناريو | النتيجة المطلوبة | الحالة |
|---|---|---|---|
| AE-01 | فتح panel وreopen | لا listeners/console errors متراكمة | ⬜ |
| AE-02 | سحب وزوم 5 ثوان | آخر camera فقط يطبق، بدون undo flood | ⬜ |
| AE-03 | تحريك camera في AE | CEP يعكس الموضع بلا feedback export | ⬜ |
| AE-04 | تبديل compositions | الحالة والـ document الصحيحان فقط يطبقان | ⬜ |
| AE-05 | ESRI Preview ثم Export | layers/assets bounded وصحيحة | ⬜ |
| AE-06 | Provider مفتاح صالح/مفقود | نجاح موحد أو منع واضح قبل الشبكة | ⬜ |
| AE-07 | Finalize متحرك | لا tiles ناقصة أو success زائف | ⬜ |
| AE-08 | خريطتان في مشروع واحد | لا cleanup/collision بينهما | ⬜ |
| AE-09 | antimeridian و512 tiles | تغطية صحيحة وبدون seams/cutoff | ⬜ |
| AE-10 | Vector bbox صغير واسم عربي | عدد features صحيح واسم/بحث صحيحان | ⬜ |
| AE-11 | فشل شبكة/worker/host | UI يعود لحالة قابلة لإعادة المحاولة وjobs تنظف | ⬜ |
| AE-31 | إنشاء مفتاح أول، الانتقال إلى زمن/مكان آخر، ثم الضغط على `Add Key` للمرة الثانية ومراقبة Viewer وProject Panel | يستجيب الزر فورًا تقريبًا؛ لا يبدأ build مكرر للموضع؛ تبقى المعاينة السابقة ظاهرة أثناء التجهيز ثم يظهر الجيل الجديد كاملًا دفعة واحدة؛ عدد طبقات Preview صغير ومحدود ولا يظهر tile-by-tile | ✅ 2026-08-14 |
| AE-32 | مراقبة Console/Network عند كادر 16:9 في Zoom 6 ثم إنشاء مفتاحين ضمن Work Area طويل | Preview العادي يطلب عددًا قريبًا من التغطية المرئية مع هامش بلاطة واحدة، ولا تظهر قفزات إلى 64/256 بسبب محاذاة؛ معاينة المسار لا تحمل المناطق الثابتة قبل/بعد المفتاحين ولا طبقة Base مكررة، ولا توجد فجوات سوداء | ✅ 2026-08-14 |
| AE-33 | في Composition جديدة: مفتاح A عند 0s ومفتاح B مختلف عند 3s، ابدأ Finalize ثم حرّك CTI بين المفتاحين أثناء التجهيز وبعد الاكتمال | تبقى قيم المفاتيح الست الأصلية دون تغيير؛ عند 0s يظهر A وعند 3s يظهر B وبينهما interpolation؛ Finalize لا يثبت آخر موقع ولا يضيف/يعدل مفاتيح | ✅ 2026-08-14 |
| AE-36 | تشغيل smoke كامل على AE 23.6 المثبت | لا parser/Bridge error؛ state/assets/Finalize/vector صحيحة | ⬜ |
| AE-37 | تشغيل smoke كامل على AE 24.6.2 المثبت مع Offline Vector وRecord | تكافؤ وظيفي مع AE 23.6 بلا capability failure | ⬜ |
| AE-38 | أثناء تنزيل Preview بدّل ESRI→OSM→Custom أو غيّر URL لـCustom XYZ من دون تحريك الكاميرا | تلغى طلبات التعريف السابق؛ لا تختلط البلاطات أو الـcache؛ ويصل إلى AE جيل كامل واحد للتعريف الأخير فقط | ⬜ |
| AE-39 | في Map composition نشطة ارفع GeoJSON يحوي Polygon وLine وPoint، ثم حرّك/كبّر الخريطة وأعد رفع الملف نفسه | تظهر الهندسة في Canvas وShape Layers داخل AE، تتبع MapPivot، تبقى الخطوط مفتوحة والمضلعات مغلقة، وإعادة الرفع تستبدل الطبقات السابقة بلا تكرار | ⬜ |

## M9-03 — قرار الإصدار

- [ ] **الحالة:** ⬜
- [ ] جميع مهام P0/P1 ✅.
- [ ] لا عنصر ⛔ مفتوح يؤثر على data integrity أو AE project assets.
- [ ] M9-01 وM9-02 ✅ على artifact النهائي نفسه.
- [ ] توثيق known limitations المتبقية (P2 فقط) بقرار product صريح.
- [ ] توقيع/حزم artifact وفق pipeline الموثوق ثم تثبيته في بيئة نظيفة.

**معيار القبول:** قرار `GO` موثق مع روابط نتائج الاختبارات وإصدار AE؛ غير ذلك القرار `NO-GO`.

---

## 6. سجل العيوب القابل للتتبع

استخدم هذا الجدول كفهرس: يحدّث ID فقط، ولا تحذف السطر عند الإصلاح؛ غيّر الحالة وأضف PR/commit وtest evidence.

| ID | العيب | الأولوية | المرحلة | الحالة | دليل الإغلاق |
|---|---|---|---|---|---|
| ARC-01 | `App`/حالات مكررة وGod Object | P0 | M1 | 🟨 | MapSession/Preferences/operation contracts مطبقة؛ اعتماد AE باقٍ |
| ARC-02 | zoom persistence drift | P0 | M1 | 🟨 | unit regression أخضر؛ reopen داخل AE باقٍ |
| ARC-03 | Event feedback loop وpoll overlap | P0 | M3 | 🟨 | debounce/latest-wins وevent contracts مطبقة؛ AE drag باقٍ |
| ARC-04 | AE inbound لا يطبق على Viewport | P0 | M3 | 🟨 | `sync:aeCamera` يحدّث Session؛ AE-03 باقٍ |
| ARC-05 | camera sync يفيض Undo Groups | P0 | M3 | 🟨 | لا UndoGroup في update؛ قياس AE باقٍ |
| ARC-06 | Bridge raw strings/contracts متعددة | P0 | M2 | ✅ | dispatcher + envelope + فحص raw-call |
| ARC-07 | Finalize يتجاهل JSON error | P0 | M2/M5 | ✅ | envelope يحول `{error}` إلى throw |
| ARC-08 | payload tiles كبير داخل evalScript | P0 | M2 | ✅ | payload file + JobManager + finally |
| ARC-09 | duplicate tile pipelines | P1 | M4/M8 | ✅ | `CoveragePlanner` و`TileTransport` و`DownloadSession` مشتركة مع adapters محدودة، واختبارات golden/behavior ناجحة |
| ARC-10 | accumulated tiles/preview growth | P1 | M4/M5 | ✅ | manifest خاص بالطلب بلا `_accumulatedTiles`؛ اختبار 4→2→1 يحتفظ ببلاطات viewport الحالي فقط |
| ARC-11 | provider keys متشظية | P1 | M4 | 🟨 | ProviderManager مرجع موحد وsignature بلا أسرار؛ اختبارات كل مزود داخل AE باقية |
| ARC-12 | antimeridian/zoom contracts مختلفة | P1 | M4 | 🟨 | antimeridian regression أخضر؛ بقية coordinate suite باقية |
| ARC-13 | MegaTile key/cleanup/cache collision | P0 | M5 | 🟨 | comp/provider signature مطبق؛ AE test باقٍ |
| ARC-14 | Finalize worker/job cleanup غير مضمون | P1 | M5 | 🟨 | `finally` ورفض jobs عند destroy مطبقان؛ AE failure test باقٍ |
| ARC-15 | GeoData bbox مكسور للـ rings dataset | P1 | M6 | ✅ | regression للـ rings bbox أخضر |
| ARC-16 | **ملاحظة تدقيق ملغاة:** Arabic normalizer mojibake | — | M6 | ✅ غير عيب | تحقق UTF-8 للمصدر؛ العرض السابق كان مشكلة طرفية |
| ARC-17 | Vector jobs/layer identity | P1 | M6 | 🟨 | compId صريح، اسم من feature، واحتفاظ بالطبقات السابقة؛ AE test باقٍ |
| ARC-18 | comp names/assets عالمية | P1 | M7 | 🟨 | documentId وasset scope مطبقان؛ multi-map AE test باقٍ |
| ARC-19 | host legacy/utils conflict | P2 | M7/M8 | ✅ | حذفت legacy endpoints و`host/utils.jsx` |
| ARC-20 | dead code/lifecycle leaks | P2 | M8 | 🟨 | حذفت dead modules وأضيف dispose؛ lifecycle CEP test باقٍ |
| ARC-21 | `Add Key` يتنافس مع Live Sync ويستورد Preview tile-by-tile | P1 | M3/M5 | ✅ | إلغاء superseded work + MegaTile packing + atomic preview staging؛ regression ‏85/85، واعتماد AE-31 ناجح |
| ARC-22 | مخطط التغطية يحمّل كتل `8×8` ومقياس Draft أكبر من الكادر | P0 | M4/M5 | ✅ | fractional zoom scale + bounded gutter + sparse packing + keyframe-bounded scan؛ regression ‏88/88، واعتماد AE-32 ناجح |
| ARC-23 | Finalize/Preview rebuild يكتب آخر trajectory camera فوق keyframe عند CTI | P0 | M3/M5 | ✅ | فصل asset transaction عن animation وحماية camera controls كمجموعة؛ regression ‏89/89، واعتماد AE-33 ناجح |
| ARC-24 | تبديل تعريف provider مع ثبات المعرّف يسمح لعملية قديمة بالـcommit | P1 | M0/M4 | ✅ آليًا | snapshot يثبت signature/template/tileSize؛ الإلغاء cancel-first ثم preview واحد؛ regression ‏107/107، وAE-38 باقٍ بصريًا |

## 7. سجل مخاطر التنفيذ

| الخطر | الاحتمال | الأثر | التخفيف | trigger للعودة/الإيقاف |
|---|---|---|---|---|
| كسر مشاريع AE القديمة عند إضافة documentId | متوسط | عالٍ | migration read-only أولًا واحتفاظ fallback بالأسماء | فشل فتح مشروع baseline قديم |
| اختلاف قدرات CEF بين AE versions | عالٍ | متوسط | feature detection وfallback/رسالة منع | Worker/OffscreenCanvas غير متاحين |
| payload/job cleanup يحذف ملفًا قبل قراءة AE | متوسط | عالٍ | lifecycle مرتبط response/requestId وfinally مضبوط | temp-file-not-found في host |
| توحيد tile engine يغير جودة preview | متوسط | متوسط | مقارنة screenshot/tile manifests قبل وبعد | اختلاف tiles المطلوبة لنفس camera |
| إزالة dead code يحذف entry مخفي | منخفض | متوسط | runtime import audit ومرحلة deprecation | feature regression بعد removal |
| تعديل Undo policy يغير توقع المستخدم | متوسط | متوسط | ADR-02 + اختبار يدوي وrelease note | ملاحظات workflow غير مقبولة |

## 8. قالب تحديث التنفيذ لكل مهمة

انسخ القالب التالي أسفل المهمة عند العمل عليها:

```markdown
### تحديث TASK-ID — YYYY-MM-DD

- الحالة: 🟦 / 🟨 / ✅ / ⛔
- المالك:
- التغيير المنفذ:
- الملفات المعدلة:
- الاختبارات المنفذة ونتائجها:
- دليل AE (إن وجد):
- المخاطر/القرارات الجديدة:
- الخطوة التالية:
```

## 9. تعريف الاكتمال النهائي

لا تعتبر الخطة مكتملة إلا إذا تحققت جميع النقاط:

- [ ] ARC-01 إلى ARC-18 ✅، أو لها قرار product موثق لا يخفض سلامة البيانات/المشروع.
- [ ] لا استدعاء JSX نصي مباشر من client خارج AEBridge.
- [ ] كل عملية AE طويلة لها `requestId/jobId`, response envelope, cleanup, وlatest-wins أو cancellation policy.
- [ ] لكل خريطة identity مستقل؛ لا تصادم tiles/mega assets/cleanup بين خريطتين أو مزودين.
- [ ] Preview وExport وFinalize تستخدم provider/camera/tile contracts نفسها.
- [ ] جميع اختبارات M9 وAE-01…AE-11 ✅ على artifact النهائي.
- [ ] سجل المخاطر والـ ADRs محدث، وقرار الإصدار `GO` موثق.

## 10. تحديث إغلاق v1 — سجل الخرائط ولوحة Layers (20 أغسطس 2026)

- **ARC-25 — 🟨 اعتماد AE:** أضيفت هوية `featureId` ثابتة للخرائط المرسومة، وسجل Composition محفوظ في Metadata schema 2.1، ومعاينة موحدة، ولوحة `Layers` للإخفاء والتركيز والحذف، وNull مكاني معلوماتي لكل خريطة.
- [x] تنفيذ العميل: `FeatureRegistry` و`FeatureManager` و`FeatureOverlayLayer` و`LayersPanel`.
- [x] تنفيذ Host: `feature.list` و`feature.visibility` و`feature.delete` وتعليقات ملكية دقيقة وController Null.
- [x] الحفاظ على مسار البحث المحلي وسياسات `MAR`/`ESH` بلا تعديل.
- [x] ترحيل Metadata 2.0 → 2.1 مع عدم تضمين هندسة المعاينة الثقيلة في تعليق الـComposition.
- [x] الاختبارات الآلية الخاصة بالسجل والهوية والجسر والترحيل وتزامن إصدار v1: `113/113`، وبوابة `verify:release` ناجحة.
- [ ] **AE-40:** الاختبار اليدوي الكامل الوارد في `V1_FEATURE_REGISTRY_LAYERS_AND_CONTROLLERS_PLAN_AR.md`.
- [ ] إعادة تشغيل بوابة الإصدار بعد اعتماد AE-40، ثم توثيق قرار `GO` أو `NO-GO` لـv1.0.

> لا تُعد ARC-25 مغلقة نهائيًا ولا تُطلق v1.0 قبل نجاح AE-40. فقد ملف GeoJSON المحلي بعد نقل المشروع لا يحذف طبقات AE؛ تظهر الحالة `AE only` ويظل هذا قيدًا موثقًا لـv1.

### ARC-26 — Preview-only ومودالات OpenGeo (20 أغسطس 2026)

- **الحالة:** 🟨 مكتمل برمجيًا، بانتظار AE-41.
- [x] عناصر GeoJSON والبلدان تظهر في `Layers` بلا Composition بحالة `Preview only`.
- [x] تبقى المسودات عند إنشاء Composition ويظهر إجراء صريح لإرسالها إلى AE.
- [x] أزيلت نوافذ `window.confirm` و`prompt` الأصلية من مسارات المنتج واستبدلت بمودال متوافق مع الثيم ولوحة المفاتيح.
- [x] أعيد تصميم Toasts لتكون بطاقات مضغوطة غير حاجبة للمعاينة.
- [x] regression آلي: `115/115` ناجح.
- [ ] **AE-41:** اعتماد السلوك البصري والوظيفي حسب ملف خطة سجل الخرائط.

## 11. ARC-27 — التدقيق الذري وإغلاق منطق v1.0 (20 أغسطس 2026)

- **الحالة:** 🟨 مكتمل برمجيًا وآليًا؛ ينتظر `AE-V1-01…07` فقط.
- [x] تدقيق 95 ملف منطق و15,313 سطرًا في العميل والمضيف والبناء.
- [x] إصلاح فقد سجل الخصائص من لقطة Finalize وفرض حد metadata قدره 256KB وميزانية descriptors قدرها 192KB.
- [x] منع stale hydration وcross-composition registration عند تبديل الكومبوزيشن أثناء الرسم أو الاستعادة.
- [x] تسلسل import/visibility/delete لكل feature ومنع تعديل الخصائص أثناء Finalize مع انتظار العمليات السابقة.
- [x] تقييد ملفات CEP→JSX إلى `OpenGeo/temp` والتحقق من المسار الحقيقي والحجم والهوية.
- [x] استعادة geometry/label/anchor للبلدان من الحزمة المحلية، بلا تغيير سياسة `MAR`/`ESH`.
- [x] جعل استبدال FeatureRegistry ذريًا، وتنظيف temp القديم، وتحسين focus للمودال وهوية warning.
- [x] إزالة إعداد Local Vector Save Directory وواجهات cache الميتة، وإزالة logs التشغيلية المتكررة.
- [x] اختبارات الانحدار: `125/125`.
- [x] `verify:release` ناجح، وArtifact: 180 ملفًا / 29,115,577 بايت / SHA-256 تجميعي `c98bc04195cfda9bcbfc6be07e854a0c25da3018a6caf24cdd2326812d322f2b`.
- [x] التقرير: `V1_FINAL_ATOMIC_AUDIT_AND_RELEASE_READINESS_AR.md`.
- [x] بوابة AE: `V1_RELEASE_CLOSURE_CHECKLIST_AR.md`.
- [ ] اعتماد `AE-V1-01…07` ثم تسجيل قرار `GO v1.0`.

> قرار ZXP باقٍ خارج نطاق إغلاق منطق الإضافة، ويبدأ فقط بعد اعتماد `GO`.

## 12. ARC-28 — نتائج قبول v1 وتصحيح Record/Clear وهوية no-comp (21 أغسطس 2026)

- **الحالة:** 🟨 مكتمل برمجيًا وآليًا؛ ينتظر خمسة اختبارات AE إصلاحية قصيرة.
- [x] تسجيل نجاح `AE-V1-01` و`02` و`04` و`06`، ونجاح المسارات الأصلية في `03` و`05` و`07` مع ملاحظات المتابعة.
- [x] إصلاح بقاء `activeCompId` القديم عندما لا يكون Map composition نشطًا؛ رفع GeoJSON يصبح Preview only ولا يستدعي Controller سابقًا.
- [x] حفظ مسودات Preview-only عند مغادرة كومبوزيشن OpenGeo بلا تسريب خصائص Host من الخريطة السابقة.
- [x] تحويل Record من flag عام إلى حالة runtime مستقلة لكل `compId`، مع بدء الخريطة الجديدة في Off.
- [x] تشغيل Record يضيف فورًا أول Key لـLatitude/Longitude/Zoom عند `comp.time`؛ فشل الإضافة يعيد الحالة إلى Off.
- [x] تثبيت `compId` ولقطة الكاميرا عبر الاستدعاء غير المتزامن ومنع بناء trajectory في كومبوزيشن انتقل إليه المستخدم لاحقًا.
- [x] تحويل Clear إلى `keyframe.clear` مكتوب النوع: تأكيد OpenGeo، UndoGroup واحدة، حذف تنازلي، وحفظ الكاميرا المقيمة عند CTI.
- [x] تبسيط Toast إلى بطاقة Compact محايدة بلا خطوط Tailwind الجانبية، مع بقاء الدلالة في الأيقونة.
- [x] cache busting: CSS v9، AESyncEngine v5، ToolbarController v6، CompositionController v3، ApplicationCoordinator v2.
- [x] اختبارات الانحدار: `129/129` ناجحة.
- [x] خطة اسم الخريطة ومتصفح خرائط المشروع: `V1_POST_ACCEPTANCE_REPAIR_AND_PROJECT_MAPS_PLAN_AR.md`.
- [ ] `AE-V1-03R`: رفع GeoJSON بلا Map composition.
- [ ] `AE-V1-05R-A/B/C`: المفتاح الأول، عزل Record بين خريطتين، ومسح المفاتيح مع Undo.
- [ ] `AE-V1-07R`: اعتماد Toast المضغوط بصريًا.
- [x] `verify:release` ناجح وArtifact مرشح الإصدار متحقق: 180 ملفًا / 29,122,529 بايت / SHA-256 تجميعي `a81c21ff6e5e4db5722a75d338a14596448bd35deba7f1af33651288d7386957`.
- [ ] قفل نطاق Project Maps إلى v1.0 أو v1.1 ثم اعتماد اختبارات AE؛ لا تعاد البوابة إلا إذا تغير المصدر.

> قرار معماري: Live Sync دائم وخفي. Record وحده وضع اختياري، وحالته لا تُحفظ بعد إعادة تشغيل اللوحة حتى لا تكتب مفاتيح غير مقصودة.

## 13. ARC-29 — Project Maps شرط إطلاق v1.0 وGeoJSON Preview-only (21 أغسطس 2026)

- **قرار المنتج:** ⛔ `NO-GO مؤقت` حتى اعتماد Project Maps واختبارات GeoJSON الجديدة داخل AE.
- [x] Host لا يعيد أي `compId` كهدف رسم ما لم يوجد Controller OpenGeo صالح وقابل لقراءة الكاميرا.
- [x] كل رسم GeoJSON/بلد يجري preflight لحظيًا بدل الاعتماد على قيمة polling قديمة.
- [x] فشل رسم GeoJSON في AE يحفظه دفاعيًا في `Layers` كـ`Preview only` بدل ترك خط معاينة غير مُدار.
- [x] تبقى Preview drafts عند فتح Map composition، ويظهر زر Draw لإرسال العنصر إلى الخريطة النشطة.
- [x] إضافة `displayName` إلى New Composition وMetadata schema 2.2 وOperationSnapshot وHost build.
- [x] زر إنشاء الخريطة أصبح `+` أخضر مضغوطًا مع tooltip وARIA.
- [x] إضافة `project.listOpenGeoMaps` read-only بحد 200 و`project.openOpenGeoMap` بهوية `compId + documentId`.
- [x] إضافة مودال Project Maps ببطاقات الاسم والأبعاد والمزوّد والحالة والصورة المصغرة، مع fallback وحد 40 صورة وفتح لوحة المفاتيح.
- [x] حماية الخرائط القديمة من التكرار: العثور على outer/map comp بالـownership قبل الاسم.
- [x] الاختبارات الآلية الحالية: `139/139`، و`verify:release` ناجح.
- [x] Artifact مرشح: 184 ملفًا / 29,175,176 بايت / SHA-256 تجميعي `a2712ccb90e067bfabe27497124b3735412ccf4f178e1512637b9bf209999877`.
- [ ] اعتماد `AE-V1-08R…11R` وتحديث القرار إلى `GO` فقط إذا لم يظهر P0/P1.

## 14. ARC-30 — تسمية خرائط المشروع ومصغرات غير مقصوصة (21 أغسطس 2026)

- [x] إضافة زر أيقونة داخل New Composition يبدّل بين `OpenGeo Map` واسم ملف مشروع After Effects المحفوظ.
- [x] توليد لاحقة رقمية من أربعة أرقام منذ الخريطة الأولى وفحصها ضد أسماء خرائط المشروع؛ تبقى `documentId` هي الهوية التقنية الوحيدة.
- [x] حفظ تفضيل نمط الاسم محليًا مع إبقاء حقل الاسم قابلًا للتحرير اليدوي قبل الإنشاء.
- [x] تمرير اسم مشروع AE من `project.getState` دون كشفه كمسار أو استعماله كهوية.
- [x] ~~استبدال قص المصغرة بـ`contain` فوق خلفية مموهة من البلاطة نفسها~~؛ استُبدل هذا الحل المؤقت بلقطة كومبوزيشن حقيقية في ARC-31.
- [x] رفع cache versions لـCSS وToolbar وProject Maps panel.
- [x] اختبارات الانحدار: `134/134` ناجحة.
- [ ] اعتماد اختبار الاسم والمصغرة `AE-V1-12R/13R` داخل After Effects.

## 15. ARC-31 — مصغرة حقيقية من إطار كومبوزيشن AE (21 أغسطس 2026)

- [x] إزالة توليد المصغرة من بلاطة المزوّد؛ Project Maps لا يستخدم الشبكة لبناء المصغرات.
- [x] إضافة أيقونة كاميرا مستقلة لكل بطاقة، من دون زر متداخل داخل زر فتح الخريطة.
- [x] التقاط `comp.time` للكومبوزيشن المختار عبر Host والتحقق من `compId + documentId + Controller` قبل الكتابة.
- [x] حفظ PNG دائم باسم حتمي داخل `OpenGeo_Assets/Thumbnails` بجانب ملف مشروع AE، من دون استيراده أو إضافة Render Queue/Undo Steps.
- [x] كتابة مؤقتة ثم حماية الصورة السابقة وcommit؛ استعادتها عند فشل الاستبدال، وتنظيف ملفات `.capture/.backup`.
- [x] حدود حماية: مشروع محفوظ، 40 megapixel للكومبوزيشن، و64MB لملف PNG الناتج.
- [x] عرض الصورة الفعلية بـ`object-fit: contain` مع fallback واضح قبل أول التقاط وcache bust بعد الاستبدال.
- [x] اختبارات آلية سلوكية وثابتة: `136/136` ناجحة.
- [ ] اعتماد `AE-V1-13R/14R` داخل After Effects، مع ملاحظة أن `saveFrameToPng` قد يختلف لونيًا في مشاريع 16/32-bpc حسب إصدار AE.

## 16. ARC-32 — تفاوض قدرة التقاط المصغرة وتشخيص Host القديم (21 أغسطس 2026)

- [x] **تحديد السبب الجذري من runtime الفعلي:** أثبت فحص CEP الجاري أن العميل يعرض Project Maps الجديدة، لكن استجابة `project.listOpenGeoMaps` لا تحتوي `thumbnailCaptureApiVersion` ولا `thumbnailCaptureSupported`؛ أي أن After Effects كان يحتفظ بنسخة Host قديمة في الذاكرة لا تعرف أمر الالتقاط.
- [x] إضافة عقد capability صريح إلى كل واصف خريطة: `thumbnailCaptureApiVersion: 1` و`thumbnailCaptureSupported` وفق توفر `saveFrameToPng`، بدل استنتاج الدعم من وجود زر في العميل.
- [x] تعطيل زر الكاميرا عند Host قديم أو API غير متاح، مع حالة مفسّرة داخل البطاقة: إعادة تشغيل After Effects أو عدم دعم الإصدار، بدل زر صامت.
- [x] عرض تقدم الالتقاط وخطئه النهائي داخل بطاقة الخريطة نفسها، بما فيه رمز الخطأ، حتى يبقى التشخيص ظاهرًا ولو تعذر فتح DevTools.
- [x] رفع طبقة Toast فوق Project Maps modal، وتسجيل دورة `project-map:thumbnail` في `%APPDATA%/OpenGeo/logs/operations.jsonl` للحالات started/completed/failed.
- [x] ضبط منفذ تطوير AEFT على `8088` وPPRO على `8089` في `.debug`، مع إبقاء `.debug` مستبعدًا من Artifact الإصدار. نقطة الفحص الصحيحة هي `http://127.0.0.1:8088/json` بعد إغلاق جميع عمليات AE وإعادة تشغيل نسخة واحدة.
- [x] اختبارات الانحدار الآلية: `137/137` ناجحة.
- [ ] اعتماد `AE-V1-15R`: إعادة تشغيل Host، تحقق اختفاء تحذير النسخة القديمة، ثم التقاط CTI والتحقق من الصورة والسجل المحلي.

## 17. ARC-33 — اكتمال PNG وإدارة ألوان مصغرات AE (21 أغسطس 2026)

- [x] تحليل ملف الفشل الحقيقي: PNG صالح بحجم 5,267,992 بايت ودقة 1920×1080 و16-bit RGBA، لكنه بلا `gAMA/sRGB/iCCP`. بذلك ثبت أن رسالة «أقل من 64MB» ناتجة عن `File.length` قديم، وأن السواد ناتج عن قيم خطية بلا توصيف لوني.
- [x] استبدال فحص `exists/length` المباشر بإعادة إنشاء `File` وفحص signature و`IEND`، مع ست محاولات محدودة خلال 250ms؛ لا يُقبل ملف ناقص ولا يبقى `.capture` بسبب cache كائن ExtendScript.
- [x] رفع عقد الالتقاط إلى `thumbnailCaptureApiVersion: 2` حتى لا يعمل عميل المعالجة اللونية فوق Host أقدم.
- [x] إضافة `ThumbnailProcessor` مستقل يتحقق من بنية PNG والمسار المُدار، ويخفض المصغرة إلى حد أقصى 960px و8-bit PNG مناسب للواجهة.
- [x] تطبيق Linear→sRGB فقط عندما يعلن Host أن `linearizeWorkingSpace` مفعّل أو أن المشروع 32-bpc، ولا تُرفع إضاءة مشاريع 8/16-bpc غير الخطية عشوائيًا.
- [x] حفظ الناتج بطريقة مؤقت/backup/rename واستعادة النسخة السابقة عند فشل commit، مع تنظيف ملفات المعالجة في `finally`.
- [x] لا يُحدّث Project Maps قبل انتهاء التحسين؛ بعد النجاح يُعاد الاستعلام فتظهر المصغرة مباشرة ببصمة cache جديدة.
- [x] الاختبارات الآلية `138/138`، و`verify:release` و`artifact:verify` ناجحة.
- [ ] إعادة اعتماد `AE-V1-15R` على مشروع 32-bpc: الصورة تظهر مباشرة، وإضاءتها تقارب Composition Viewer، ولا تبقى ملفات `.capture/.normalize`.

## 18. ARC-34 — إثبات Runtime من DevTools 8088 وانتظار الكاتب غير المتزامن (21 أغسطس 2026)

- [x] استُخدم `http://127.0.0.1:8088/` فعليًا؛ أعاد CEF صفحة Inspectable WebContents، وأثبت `/json` اتصال OpenGeo المباشر عبر WebSocket DevTools.
- [x] تحقق Runtime أن العميل المحمّل هو `ThumbnailProcessor v1` و`ProjectMapsPanel v5` وأن Host يعلن `thumbnailCaptureApiVersion: 2`؛ استُبعدت فرضية cache القديم لهذه المحاولة.
- [x] أُعيد الالتقاط على الخريطة النشطة من DevTools: عند رفض Host كان ملف PNG ما يزال 738,401 بايت، وبعد لحظات وصل إلى 5,267,992 بايت وأصبح آخر chunk هو `IEND`. ثبت أن `saveFrameToPng` يكتب خارجياً بعد عودة الاستدعاء في AE 2024.
- [x] رُفع الانتظار المحدود من 250ms إلى 15 ثانية، بفحص كل 100ms ومن دون قبول الملف قبل `IEND`؛ فُصل `THUMBNAIL_CAPTURE_TIMEOUT` عن `THUMBNAIL_SIZE_LIMIT`.
- [x] تنظيف ملفات `.capture/.backup` المتروكة الأقدم من دقيقة داخل مجلد Thumbnails المُدار، دون لمس ملفات المستخدم الأخرى أو المصغرات النهائية.
- [x] إضافة `console.error('[ProjectMapsPanel] Thumbnail capture failed:', error)`؛ أصبحت الأخطاء تظهر في Console إضافة إلى البطاقة وToast وسجل JSONL.
- [x] إضافة `NodeRuntime` قبل bootstrap لاستعادة `require/Buffer/process` من `cep_node.require` بعد DevTools Reload، مع allowlist صريحة في تدقيقي الأمن والتوافق.
- [x] الاختبارات `139/139`، و`verify:release` و`artifact:verify` ناجحة.
- [ ] إعادة فتح OpenGeo/إعادة تشغيل AE ثم إعادة `AE-V1-15R`؛ لا يُستخدم Reload القديم قبل تحميل `NodeRuntime` الجديد.

## 19. ARC-35 — مطابقة Display Gamma لمشاريع 32-bpc بلا Working Space (21 أغسطس 2026)

- [x] سجل العملية أثبت أن المعالجة السابقة نُفذت (`colorCorrected: true`)؛ استُبعد فشل تشغيل المصحح.
- [x] المصغرة النهائية 960×540 و8-bit RGBA وAlpha=255 بالكامل؛ استُبعدت الشفافية أو premultiplication كسبب للسواد.
- [x] استُعلم Host الحي عبر 8088: `bitsPerChannel=32`، و`workingSpace=None`، و`linearizeWorkingSpace=false`، و`linearBlending=false`.
- [x] فُك ضغط IDAT الخام وقيست القيم قبل Chromium: متوسط linear يقارب `[0.0573, 0.0385, 0.0341]`. ترميز sRGB واحد يعطي متوسطًا يقارب `[67.7,55.2,51.8]`، بينما مرحلتان تعطيان `[140.8,128.2,124.4]` المطابقة عمليًا لإضاءة العرض؛ بكسل بحر نموذجي ينتقل من `[0,39,45]` إلى `[0,109,117]`.
- [x] استُبدل القرار boolean بعدد مراحل صريح: مرحلتان فقط لـ`32-bpc + Working Space=None`، مرحلة واحدة لـ32-bpc ذي Working Space أو مشروع Linearized، وصفر لغير ذلك.
- [x] تمرير `thumbnailSrgbEncodingPasses` من Host إلى المعالج وتسجيل العدد مع العملية، ورفع cache versions للمعالج واللوحة.
- [x] الاختبارات `139/139`، و`verify:release` و`artifact:verify` ناجحة.
- [ ] إعادة التقاط المصغرة بعد إعادة فتح OpenGeo للتحقق البصري النهائي من مطابقة Composition Viewer.

## 20. ARC-36 — الالتقاط المطابق لعرض AE دون Gamma تخميني (21 أغسطس 2026)

- [x] **السبب الجذري المثبت:** `CompItem.saveFrameToPng()` في مشروع 32-bpc أنتج PNG داكنًا، بينما Composition Viewer يعرض تحويل الشاشة؛ التمريران اليدويان Linear→sRGB حسّنا السطوع لكن سببا posterization وانحرافًا في الأحمر والأزرق.
- [x] إثبات الحل على الكومبوزيشن الفعلية عبر `http://127.0.0.1:8088/`: الالتقاط المؤقت عند 8-bpc أعاد الأحمر والأزرق وصورة القمر الصناعي كما تظهر داخل AE.
- [x] إضافة `opengeoCaptureDisplaySafePng`: تحفظ عمق المشروع الأصلي، تبدله إلى 8-bpc خلال كتابة PNG المكتملة فقط، ثم تعيده داخل `finally` قبل رجوع Bridge، مع خطأ صريح إذا فشل التبديل أو الاسترجاع.
- [x] رفع عقد Host إلى `thumbnailCaptureApiVersion: 3` وإرجاع `sourceDepth` و`captureDepth` و`thumbnailColorStrategy=ae-display-safe-8bpc` للتشخيص.
- [x] حذف تحويلات Gamma المتكررة من `ThumbnailProcessor`؛ دوره الآن التحقق من PNG وتصغيره إلى 960px وحفظه ذريًا بلا تغيير ألوان إضافي.
- [x] تحديث الصورة الحالية للمشروع إلى 960×540 بألوان صحيحة، وحذف ملفي التشخيص المؤقتين فقط (`.diagnostic_8bpc.png` و`raw_map_*.png`).
- [x] اختبارات الانحدار `139/139` وبوابة `verify:release` ناجحتان.
- [x] Artifact المرشح الحالي: 184 ملفًا / 29,174,951 بايت / SHA-256 تجميعي `305313157046694d66453175dadc0dd15bb599b2421740898e26f31bc1328385`.
- [ ] **AE-V1-15R النهائي:** أعد تشغيل After Effects لتحميل Host API v3، التقط صورة عند CTI، وتحقق من تطابق المحتوى والألوان. علامات التحديد وإطار الطبقة في Viewer لا تُعد محتوى Render ولن تظهر في المصغرة عمدًا.

## 21. ARC-37 — مصغرة احترافية عبر Render Queue وإخراج sRGB (22 أغسطس 2026)

- [x] استبدال `CompItem.saveFrameToPng()` بالكامل بتصيير آلي لإطار CTI واحد عبر Render Queue؛ لم يعد مسار المصغرة يبدّل `app.project.bitsPerChannel` أو يطبق Gamma تخمينيًا.
- [x] اعتماد Output Module من عائلة `PNG Sequence` مع أفضل Render Settings المتاحة، ثم تمرير الصورة الناتجة عبر Canvas إلى PNG نهائي 8-bpc مناسب لعرض CEP/sRGB مع الحفاظ على نسبة الكومبوزيشن.
- [x] عزل عملية المصغرة عن طابور المستخدم: تعليق عناصر Render Queue المفعّلة مؤقتًا، تصيير عنصر OpenGeo وحده، إعادة حالات العناصر السابقة، ثم حذف العنصر المؤقت في `finally`.
- [x] دعم اختلاف تسمية ملف PNG للإطار الواحد، والتحقق من signature و`IEND` وعمق PNG قبل commit، وتنظيف كل ملفات `.rq_*` و`.backup` عند النجاح أو الفشل.
- [x] رفع عقد Host/Client إلى `thumbnailCaptureApiVersion: 4` ورفع cache versions لـ`ProjectMapsPanel` و`ThumbnailProcessor`.
- [x] الاختبارات الآلية: `139/139` ناجحة.
- [ ] **AE-V1-16R:** أعد تشغيل After Effects، افتح مشروع 32-bpc والخريطة عند CTI مميز، واضغط أيقونة الكاميرا. المتوقع: مصغرة مضيئة بألوان قريبة من Composition Viewer، ظهورها مباشرة، بقاء عمق المشروع 32-bpc، وعدم بقاء عنصر OpenGeo أو ملف `.rq_*` داخل Render Queue/Thumbnails.

## 22. ARC-38 — اكتشاف قالب PNG الفعلي وضبط مجال Camera Revision (22 أغسطس 2026)

- [x] فحص Runtime الحي عبر `127.0.0.1:8088` أثبت عدم وجود قالب اسمه `PNG Sequence`، مع وجود PNG فعلي داخل `_HIDDEN X-Factor 8/16`؛ كان الخطأ في مطابقة اسم القالب لا في دعم After Effects للصيغة.
- [x] استبدال مطابقة الاسم بفحص `OutputModule.getSettings(...).Format` لكل قالب، مع تفضيل PNG ذي `Millions of Colors+`/`X-Factor 8` وتجنب 16-bpc للمصغرة النهائية.
- [x] إصلاح `AESyncEngine` الذي كان يرسل `Date.now()` ذي 13 رقمًا إلى Slider مجاله ±1,000,000؛ أصبح revision عدادًا دائريًا محدودًا داخل `[1..999999]` مع مقارنة wrap-aware.
- [x] إضافة دفاع Host يطبّع أي revision وارد بـ`Math.floor(revision) % 1000000` قبل `setValue`، فلا يستطيع عميل قديم كسر Slider.
- [x] رفع cache version لـ`AESyncEngine` إلى v6 وإضافة اختبارات لاختيار القالب المخفي والتفاف revision داخل المجال.
- [x] الاختبارات الآلية: `139/139` ناجحة.
- [ ] إعادة تشغيل After Effects ثم إعادة `AE-V1-16R`؛ يجب اختفاء `THUMBNAIL_PNG_TEMPLATE_MISSING` وخطأ `Value ... out of range` معًا.

## 23. ARC-39 — المصغرة المباشرة من معاينة OpenGeo دون تصدير (22 أغسطس 2026)

> **قرار معماري نهائي:** تلغي هذه المرحلة مسار Render Queue في ARC-37/38 وتستبدله بالكامل. تبقى الأقسام السابقة كسجل تشخيصي فقط وليست وصفًا للسلوك الحالي.

- [x] حذف كل اعتماد Runtime على `Render Queue` وOutput Module templates و`saveFrameToPng` من خاصية المصغرات؛ لا يُنشأ عنصر تصيير ولا يُعلّق طابور المستخدم ولا يتغير عمق مشروع AE.
- [x] حصر مسؤولية Host في التحقق من `compId + documentId + Controller` وإنشاء مسار PNG مُدار داخل `OpenGeo_Assets/Thumbnails`، بعقد `thumbnailCaptureApiVersion: 5`.
- [x] إضافة `ThumbnailProcessor.captureCanvas()` لالتقاط Canvas المعاينة محليًا، وقصه من المركز وفق `frameWidth/frameHeight` الفعليين، مع احترام نسبة الكومبوزيشن وحد أقصى 960px.
- [x] حفظ PNG بطريقة ذرية مع دعم أول لقطة عندما لا يوجد ملف سابق، والتحقق من signature و`IHDR/IEND` وحد أقصى 16MB.
- [x] تقييد زر الكاميرا بالخريطة المفتوحة والنشطة فقط لمنع حفظ مشهد الخريطة الحالية تحت بطاقة خريطة أخرى؛ توضح البطاقات غير النشطة وجوب فتحها أولًا.
- [x] تحديث المصغرة مباشرة بعد الكتابة عبر إعادة فهرسة Project Maps وcache revision جديد.
- [x] اعتماد ألوان Canvas المعروضة في Chromium/CEP كما هي (`opengeo-preview-canvas-srgb`) دون Gamma تخميني أو تحويل عمق لوني.
- [x] رفع cache versions إلى `ThumbnailProcessor v5` و`ProjectMapsPanel v10`.
- [x] الاختبارات الآلية: `139/139` ناجحة، وتشمل منع رجوع `renderQueue` أو أمر الالتقاط القديم إلى Host/Bridge.
- [ ] **AE-V1-17 — اختبار قبول وحيد:** أعد تشغيل After Effects، افتح خريطة OpenGeo وانتظر اكتمال معاينتها، افتح Project Maps واضغط كاميرا البطاقة النشطة. المتوقع: ظهور المصغرة فورًا بنفس كادر إطار المعاينة وألوانه، وعدم إضافة أي عنصر إلى Render Queue. افتح خريطة ثانية وتحقق أن زر بطاقتها لا يتاح إلا بعد فتحها.

### حدود السلوك المقصودة

- المصغرة تمثل **معاينة OpenGeo الحالية** (الخريطة والـoverlays التي ترسمها الإضافة)، ولا تدّعي التقاط طبقات AE خارج منظومة OpenGeo أو علامات التحديد في Composition Viewer.
- إذا كان المطلوب مستقبلًا التقاط الناتج المركب الكامل لكل طبقات AE، فهذا مسار Export صريح ومستقل وليس جزءًا من زر المصغرة السريع.

## 24. ARC-40 — مصدر حقيقة واحد لمتحكمات الخرائط المتجهية (22 أغسطس 2026)

- [x] أثبت الفحص الحي عبر `127.0.0.1:8088` أن طبقة البلد لم تكن محذوفة: `enabled=true` و`Opacity=100` والمسار يحتوي 201 نقطة ولا توجد أخطاء Expressions؛ كان جزء معتبر من هندستها خارج الكادر، بينما جعل توزيع الحالة بين Shape وCTRL فهم النتيجة وتشخيصها مضللاً.
- [x] نقل ملكية جميع المتحكمات البصرية إلى طبقة Shape: `Visible` وAnchor وFill وStroke وOpacity وTrim؛ لم تعد الألوان أو العرض أو الشفافية تقرأ من Null خارجي.
- [x] إبقاء طبقة `CTRL` كمرجع مكاني Null فقط، بموضع جغرافي وMarker وهوية ثابتة لربط النصوص والعناصر الخارجية، دون Effect Controls مكررة.
- [x] ربط Opacity طبقة Shape بمتحكم `Visible` المحلي، وربط اسم البلد بالمتحكم نفسه على طبقة Shape بدلاً من `CTRL`.
- [x] تحديث `feature.list` و`feature.visibility` لقراءة وكتابة حالة Shape بوصفها المصدر الموثوق، مع fallback مؤقت لخرائط CTRL القديمة.
- [x] إضافة الأمر typed `feature.normalizeControls` وترحيل idempotent للخرائط القديمة عند فتحها: تُقرأ القيم المطبقة أولاً، وتُنسخ إلى Shape، وتُفك Expressions الخارجية، ثم تزال مؤثرات CTRL داخل Undo Group واحد.
- [x] عدم إنشاء Undo Group عندما تكون الخريطة مطبّعة مسبقاً؛ إعادة الفتح لا تعيد الترحيل ولا تضيف Undo Steps جديدة.
- [x] الحفاظ على عمل العميل مع Host قديم في الذاكرة: إذا لم يتوفر أمر الترحيل، تستمر المصالحة المقروءة حتى إعادة تشغيل AE.
- [x] رفع cache version إلى `FeatureManager v5`.
- [x] الاختبارات الآلية: `140/140` ناجحة، مع اختبار صريح يمنع عودة أي متحكم بصري إلى Null ويتحقق من نسخ قيم الخرائط القديمة قبل حذفها.
- [ ] **AE-V1-18:** أعد تشغيل After Effects وافتح الخريطة القديمة. المتوقع: تنفيذ Undo واحد باسم `OpenGeo: Consolidate Vector Controls` مرة واحدة، ظهور كل المتحكمات على `COUNTRY OUTLINE`، خلو `CTRL` من المؤثرات، وبقاء اللون/العرض/الشفافية الحالية دون تغير. أغلق الخريطة وافتحها مجدداً وتحقق من عدم إضافة Undo جديد.
