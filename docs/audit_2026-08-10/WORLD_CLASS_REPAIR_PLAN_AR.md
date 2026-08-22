# خطة إصلاح عالمية المستوى — OpenGeo

**الحالة:** خطة تنفيذ مرجعية  
**الهدف:** تحويل OpenGeo إلى إضافة CEP قابلة للبناء والتوزيع والصيانة بأمان، مع نتائج قابلة للتكرار ودليل قبول واضح.  
**قاعدة العمل:** لا ينفذ أي تعديل إنتاجي قبل وجود نسخة احتياطية/commit أو archive موثوق للحالة الحالية.

## 1. معايير النجاح النهائية

لن يعلن الإصدار جاهزاً إلا إذا تحققت الشروط التالية كلها:

1. `npm run build` ينشئ artefact نظيفاً كاملاً في مجلد staging، ويفشل عند أي missing asset أو خطأ bundling.
2. ZXP يبنى فقط من artefact ناجح ومتحقق منه، ولا يحتوي `.debug` أو node_modules أو ملفات مؤقتة أو وثائق داخلية.
3. لا توجد أي قراءة JSON عبر `eval` ولا أي `evalScript` مبني بـ string interpolation لمدخلات نصية.
4. جميع مسارات الكتابة تقع تحت user data، وجميع مسارات القراءة المنشورة مشتقة من CEP extension path.
5. لا تعرض الواجهة مزوداً غير صالح أو مفتاحاً غير مستخدم؛ والمفتاح الناقص ينتج حالة UI مفهومة قبل الشبكة.
6. اجتياز unit/integration/package checks آلياً، ثم smoke/regression/stress tests يدوياً في After Effects.
7. يوجد مصدر حقيقة واحد للمحرك، ورقم إصدار واحد، وتوثيق موافق للكود المنشور.

## 2. مبادئ التصميم الحاكمة

### 2.1 المصدر الواحد للحقيقة

كل سلوك يجب أن يملك implementation إنتاجياً واحداً. لا يسمح بوجود TypeScript وJavaScript قديمين يقدمان المحرك نفسه. الملفات المولدة لا تحفظ بجوار المصدر ولا تحمل مباشرة من HTML ما لم تكن هي artefact الرسمية.

### 2.2 بناء حتمي وقابل للتكرار

البناء يبدأ دائماً من مجلد stage فارغ، وينتهي بخريطة ملفات متوقعة والتحقق منها. لا يعتمد على محتوى `dist` من تشغيل سابق، ولا يحول warning إلى نجاح.

### 2.3 حدود أمان صارمة

DOM والشبكة والـ Node وExtendScript حدود ثقة مستقلة. كل انتقال بينها يمر عبر validator/serializer واضح ومختبر. لا توجد "تهرّبات" محلية في call sites.

### 2.4 قابلية التشغيل في أجهزة العملاء

لا تفترض مسار تثبيت أو قرصاً أو صلاحيات administrator. استخدم واجهات CEP للمسارات. عالج خدمة خرائط غير متاحة كحالة عمل متوقعة، لا exception خام.

### 2.5 قابلية الملاحظة بدون كشف أسرار

السجل يحتوي event code وسياقاً آمناً، ولا يكتب API keys أو payloads كاملة أو مسارات مستخدم حساسة. debugging لا يشحن مع release.

## 3. خارطة المراحل والبوابات

| المرحلة | المخرج | البوابة الإلزامية | الأولوية |
|---|---|---|---|
| 0 | حماية العمل وخط أساس | نسخة قابلة للرجوع وسجل نتائج | P0 |
| 1 | مسار نشر سليم | package integrity 100% | P0 |
| 2 | سد أخطاء التشغيل المؤكدة | overlay regression يمر | P0 |
| 3 | أمن bridge والمضيف | security regression يمر | P0 |
| 4 | مزودون ومسارات موثوقة | provider/path matrix يمر | P0/P1 |
| 5 | توحيد المحرك والبناء | runtime uses one artefact | P1 |
| 6 | اختبارات وCI | checks تعمل في clean checkout | P1 |
| 7 | تحقق AE والإصدار | smoke + stress + release checklist | P2/Release |

لا يبدأ التوقيع أو التوزيع قبل نهاية المرحلة 7.

---

## المرحلة 0 — حماية العمل وخط الأساس

### الهدف

إنشاء نقطة رجوع واضحة وسجل baseline يمنع خلط إصلاحات المنتج مع آثار التجارب.

### التنفيذ

1. أنشئ مستودع Git إن لم يكن المشروع في مستودع، أو ضع نسخة snapshot خارج مجلد الإضافة.
2. سجل hashes وحجم كل artefact حالي: `client/`, `host/`, `CSXS/`, `scripts/`, `dist/`.
3. وثق بيئة البناء: Node, npm, TypeScript, Rollup، نظام التشغيل، وإصدار AE/CEP المستهدف.
4. اكتب قائمة المخاطر المفتوحة من تقرير التدقيق كـ issues بمعرفات OG-001…OG-012.
5. لا تنظف `dist` القديم قبل حفظ baseline؛ قد يكون مفيداً فقط للمقارنة، وليس كمصدر إنتاج.

### معايير القبول

- يمكن استعادة الحالة السابقة دون اعتماد على ملفات مؤقتة.
- يعرف كل issue مالكه، أولويته، وحالة إغلاقه.
- كل تعديل لاحق قابل للمراجعة والتتبع.

---

## المرحلة 1 — إصلاح البناء والتغليف (Release Blocker)

### 1.1 اختيار بنية artefact

اعتمد الهيكل التالي، بأسماء قابلة للتغيير لكن بفصل ثابت:

```text
OpenGeo/
  client/                 # مصدر الواجهة
  host/                   # مصدر ExtendScript
  CSXS/                   # manifest المصدر
  build/                  # مخرجات compiler فقط، ignored
  release/stage/          # artefact جاهز للتغليف، ignored
  scripts/
    build.js
    verify-package.js
    package-zxp.js
```

يجب أن يكون `release/stage` هو المصدر الوحيد لـ ZXP. لا تستخدم `dist` مختلطاً مع بقايا قديمة.

### 1.2 إعادة بناء `scripts/build.js`

المتطلبات الدقيقة:

1. احذف stage القديم فقط بعد التحقق أن الهدف هو المسار المتوقع المحدد حرفياً.
2. شغّل compiler/bundler أولاً، وتحقق من exit code.
3. انسخ أشجار `client`, `host`, `CSXS` بشكل كامل، مع استبعاد محدد: source maps إن لم تكن مطلوبة، ملفات test، `.debug`، node_modules، docs، temp، ومخرجات development.
4. انسخ أو ولّد `manifest.xml` الخاص بالإنتاج فقط.
5. لا تتجاهل الملفات المفقودة: ارمِ Error باسم المورد والمسار.
6. نفّذ verifier بعد النسخ.
7. اطبع manifest: عدد الملفات، الحجم الكلي، hash اختياري، وإصدار الإصدار.

### 1.3 إنشاء `verify-package.js`

يفحص على الأقل:

- وجود `CSXS/manifest.xml`, `client/index.html`, `host/index.jsx`.
- أن `MainPath` و`ScriptPath` من manifest موجودان فعلياً في stage.
- كل `script[src]`, `link[href]`, image/font محلي من HTML موجود.
- أن `#include` من JSX يشير إلى ملف موجود في stage.
- عدم وجود `.debug`, `node_modules`, `temp`, ملف private key، أو API key صريح.
- عدم وجود مراجع إلى `C:/Program Files` في artefact، إلا إن كان النص وثائقياً مستبعداً.
- وجود الأيقونات المطلوبة في manifest.

### 1.4 package scripts

عرّف بوضوح:

```json
{
  "scripts": {
    "clean": "node scripts/clean.js",
    "compile": "tsc -p tsconfig.json",
    "bundle": "rollup -c",
    "build": "npm run clean && npm run compile && npm run bundle && node scripts/build.js",
    "verify:package": "node scripts/verify-package.js",
    "test": "...",
    "package:zxp": "npm run build && npm run verify:package && node scripts/zxp.js --sign"
  }
}
```

استبدل `...` باختبار فعلي قبل الدمج. لا تجعل `package:zxp` يعمل مع self-signed افتراضياً في قناة release.

### 1.5 معايير قبول المرحلة 1

- تشغيل build مرتين متتاليتين ينتج نفس قائمة الملفات ولا يعتمد على artefact سابق.
- فشل build مقصود عبر إعادة تسمية resource يؤدي إلى non-zero exit ورسالة واضحة.
- `verify:package` يمر على artefact الصحيح ويفشل عند حذف script محمل من HTML.
- تثبيت stage في مسار اختبار فارغ لا يحتوي ملفات التطبيق خارج stage، ثم فتح panel حتى تحميل الصفحة بلا 404 محلية.

---

## المرحلة 2 — إصلاحات الصحة التشغيلية العاجلة

### 2.1 إصلاح `_queueAutoExport`

**قرار مفضل:** اجعل `SyncManager` المالك الوحيد لطابور التصدير. في `App`، استبدل الاستدعاء بالدالة العامة:

```js
this.syncManager.queueAutoExport();
```

أو عرّف wrapper إن كانت السياسة المركزية تحتاج شروطاً إضافية:

```js
_queueAutoExport() {
  return this.syncManager.queueAutoExport();
}
```

لا تكرر debounce/generation logic في App.

### 2.2 اختبار regression للـ overlay

اختبر الحالات التالية بمضاعفات mocks:

1. `overlay:changed` يرسم tiles الحالية ويطلب تصديراً واحداً.
2. خمس أحداث متتابعة تنتج تصديراً واحداً بعد debounce، لا خمسة.
3. حدث صادر من AE لا يعيد تصديراً إلى AE.
4. فشل التصدير يظهر toast/status آمن ولا يكسر event bus.
5. marker وGeoJSON وlayer removal كلها تمر بالمسار نفسه.

### 2.3 منع حالة loading العالقة

في `TileManager.update`، إن أعاد URL provider قائمة فارغة، اجعل entry غير loading وسجل خطأ provider واضح. لا تترك tile في `loading: true` بلا task.

### معايير القبول

- لا يظهر `TypeError` عند أي تغير overlay.
- لا loop تصدير عند تحريك timeline في AE.
- لا تبقى tile معلقة إذا كان المصدر ناقص الاعتماد.

---

## المرحلة 3 — برنامج أمن CEP وExtendScript (Release Blocker)

### 3.1 API موحد وآمن للـ bridge

أنشئ في `core/AEBridge.js` دالة عامة صغيرة، مثلاً:

```js
call(functionName, args, timeoutMs) {
  if (!/^[A-Za-z_$][\w$]*$/.test(functionName)) {
    return Promise.reject(new Error('Invalid host function name'));
  }
  const serializedArgs = args.map(serializeExtendScriptArgument).join(', ');
  return this._evalScript(functionName + '(' + serializedArgs + ')', timeoutMs);
}
```

قواعد `serializeExtendScriptArgument`:

- string: `JSON.stringify(String(value))`.
- finite number: `String(value)` فقط بعد `Number.isFinite`.
- boolean/null: literals ثابتة.
- object: `JSON.stringify(JSON.stringify(value))` فقط لعقد API محدد، لا كحل عام.
- ممنوع تمرير function أو raw script أو `undefined`.

حوّل كل call sites إلى API الجديد. لا تبقِ wrapper قديم يسمح بسلسلة خام إلا للاستخدام الداخلي الموثق وبمراجعة أمنية.

### 3.2 إزالة `eval` من host

استبدل:

```js
eval('(' + jsonData + ')')
```

بـ:

```js
JSON.parse(jsonData)
```

ثم نفذ validation قبل العمل:

- object فقط، لا array في root حيث لا يتوقعها العقد.
- `tiles` array محدودة العدد والحجم.
- `x`, `y`, `z`, width, height, opacity أرقام finite وبحدود عملية.
- file paths تأتي فقط من directories مسموحة.
- أسماء الطبقات نصوص مقيدة الطول.
- GeoJSON يقبل types مدعومة فقط، وعدد points محدود.

### 3.3 سياسة المسارات

عرّف دوال canonical واحدة:

- `getExtensionPath()` للـ read-only bundled data.
- `getUserDataPath('OpenGeo')` للـ cache والـ logs والـ jobs.
- `resolveInside(base, relativeName)` يمنع `..`, UNC path، وabsolute paths غير المعتمدة.

يجب أن تتحقق قبل أي `readFile`, `writeFile`, `unlink`, أو ExtendScript `File` import. لا يسمح للعميل باختيار path خارج job directory إلا عبر تدفق import صريح ومراجعة المستخدم.

### 3.4 فصل التطوير والإنتاج

1. لا تنسخ `.debug` إلى stage.
2. استخدم manifest production منفصلاً أو generation flag واضحاً.
3. راجع الحاجة لكل flag:
   - `--enable-nodejs`: احتفظ به فقط إن بقيت dependencies Node لازمة.
   - `--mixed-context`: أزله إن أمكن بعد عزل bridge.
   - `--allow-file-access-from-files`: أزله إن لم يكن مطلوباً عملياً بعد اختبار الموارد المحلية.
4. لا تسمح بتحميل scripts remote أو HTML remote.
5. حدّث سياسة content security إن كانت CEP target تدعمها دون كسر التطبيق.

### 3.5 اختبارات أمن إلزامية

- marker name يحوي quotes/backslashes/newlines لا ينفذ أي أمر إضافي.
- comp/layer IDs تحوي payload-like strings لا تكسر command.
- ملف JSON يتضمن `); app.quit(); (` يفشل parse ولا ينفذ.
- path مثل `../../sensitive` أو UNC أو `C:\\Windows` يرفض.
- API key لا يظهر في console/log/error/toast.
- artefact release لا يحتوي `.debug` أو مفاتيح أو مجلد temp.

### معايير القبول

- لا توجد `eval(` في `host/` إلا إذا كانت مستثناة بمراجعة أمنية مكتوبة؛ الهدف صفر.
- لا توجد interpolation مباشرة لقيم نصية داخل `opengeo*(`.
- جميع الاختبارات أعلاه تمر آلياً.

---

## المرحلة 4 — موثوقية البيانات والمزوّدين

### 4.1 Provider contract

أنشئ schema واحداً لكل provider:

```js
{
  id: 'string',
  name: 'string',
  urlTemplate: 'https URL with {z}/{x}/{y}',
  minZoom: 0,
  maxZoom: 22,
  tileSize: 256 | 512,
  format: 'png' | 'jpg',
  requiresKey: boolean,
  keyId: 'optional string',
  attribution: 'string',
  attributionUrl: 'https URL',
  enabled: boolean
}
```

Validate هذا contract عند بدء التطبيق وقبل حفظ custom XYZ. تحقق أن الرابط HTTPS وأنه يحوي كل placeholders المطلوبة، وأن min/max zoom صالحان.

### 4.2 Stadia وMapbox وMapTiler

- Stadia: عطّلها فوراً أو أضف key configuration رسمي قبل إظهارها.
- Mapbox/MapTiler: إذا لم يوجد key، عطّل option أو اعرض badge "API key required" ورسالة إعداد مباشرة.
- لا تحفظ المفتاح في log أو payload AE أو metadata المشروع. اشرح للمستخدم أن localStorage ليس key vault مثالياً؛ للاستخدام الحساس استخدم storage مخصصاً أو أدخل المفتاح لكل session.

### 4.3 شبكة وتنزيل

- أضف AbortController/cleanup موحداً للطلبات الملغاة؛ امسح timers عند abort.
- اعترف بالحالات: 401/403 = اعتماد مطلوب، 404 = tile غير موجود، 429 = rate limited/backoff، 5xx = retry محدود، decode error = payload غير صورة.
- لا تستخدم fallback provider صامتاً إذا كان له ترخيص مختلف؛ الخيار الحالي للعزل صحيح ويجب الحفاظ عليه.
- اضبط concurrency وcache limits قابلة للتكوين وموثقة.

### 4.4 اختبارات provider

- mock HTTP لـ 200, 401, 403, 404, 429, timeout, image decode failure.
- smoke HTTP في pipeline غير مفاتيح فقط للمزوّدين العامة، ولا يعتبر بديلاً عن الاختبارات المخبرية.
- اختبار custom XYZ صحيح وخاطئ، بما فيه template ناقص وURL غير HTTPS.

---

## المرحلة 5 — توحيد المحرك وTypeScript

### القرار المعماري المطلوب

اختر أحد المسارين قبل أي refactor كبير:

**المسار الموصى به: TypeScript كمصدر للحقيقة.**

1. انقل implementation الفعلي المطلوب من `OpenGeoEngine.js` إلى `engine/src` تدريجياً.
2. عالج إعداد Rollup: إما `rollup.config.mjs` مع package مناسب، أو config CommonJS متوافق.
3. أخرج bundle واحداً مثل `client/js/engine/opengeo-engine.bundle.js`.
4. يحمل `index.html` هذا bundle فقط، بعد dependencies المطلوبة.
5. لا تحفظ `.js` المولدة داخل `src`; اجعلها ignored.
6. احذف/أرشف المحرك القديم بعد انتقال coverage والاختبارات.

**بديل مؤقت: JavaScript الحالي كمصدر للحقيقة.**

احذف TypeScript/Rollup من scripts وdependencies حتى لا يدّعي المشروع مساراً غير مستخدم. هذا أسرع، لكنه أقل ملاءمة للنمو؛ لا يوصى به إن كان التطوير مستمراً.

### خطة انتقال TypeScript آمنة

1. اكتب characterization tests لسلوك TileGrid/Camera/Downloader الحالي قبل النقل.
2. انقل وحدة واحدة في كل change: GeoMath، ثم Camera، ثم TileGrid، ثم downloader.
3. طابق fixtures (tiles visible, URLs, pixel positions) بين القديم والجديد.
4. لا تدمج اثنين من المحركات في runtime أبداً.
5. راقب حجم bundle والتوافق مع نسخة Chromium المضمّنة في CEP المستهدف؛ لا تعتمد syntax غير مدعوم دون transpilation مناسب.

### معايير القبول

- ملف تشغيل واحد للمحرك في HTML.
- مصدر واحد قابل للتحرير لكل class إنتاجية.
- Rollup وTypeScript ينجحان من clean checkout.
- اختبارات mathematics وtile selection متطابقة مع fixtures المعتمدة.

---

## المرحلة 6 — الاختبارات، lint، CI، وإدارة الجودة

### 6.1 هرم الاختبار

| المستوى | النطاق | أمثلة |
|---|---|---|
| Unit | منطق نقي | Mercator, TileGrid, URL template, serialization, path validation |
| Component | DOM مع mocks | App event handlers, Settings, TileManager, provider states |
| Integration | CEP/host mocks | bridge commands, metadata roundtrip, payload schema |
| Package | artefact | manifest references, HTML assets, excludes, version consistency |
| Manual AE | المضيف الحقيقي | comps, tiles, layers, undo, metadata, finalize |
| Performance | 4K/8K وتعدد tiles | memory, cancellation, timing, project bloat |

### 6.2 مجموعة الاختبارات الدنيا

1. roundtrip Lat/Lng ↔ Mercator مع edge latitudes.
2. antimeridian وzoom fractional وtile wrap.
3. request cancellation لا ينتج completion متأخر يرسم tile قديمة.
4. parent fallback يرسم quadrant الصحيح.
5. schema rejects malformed tile/vector payloads.
6. bridge serializer يحمي جميع أحرف escaping.
7. `overlay:changed` لا يرمي ولا يولد export loop.
8. build verifier يمسك resource مفقوداً و`.debug` وآثار node_modules.
9. provider required key يعطل request ويعرض حالة مفهومة.
10. كل version files تملك قيمة واحدة مصدرها release config.

### 6.3 lint والتنسيق

- أضف ESLint بقواعد: no-eval، no-implied-eval، no-console في release إلا logger مصرح، no-unused-vars، eqeqeq، security rules.
- أضف Prettier أو formatter واحداً، وليس أدوات متداخلة بلا قرار.
- ExtendScript قد يحتاج parser أو قواعد منفصلة بسبب قدم اللغة؛ على الأقل نفذ static forbidden-pattern check وinclude verification.

### 6.4 CI pipeline المقترح

```text
install (npm ci)
  -> lint
  -> unit/component/integration tests
  -> compile + bundle
  -> build stage
  -> verify package
  -> dependency audit
  -> publish artefact (غير موقّع)
  -> manual approval
  -> sign ZXP from verified artefact only
```

لا تمرر secrets إلى builds الخاصة بـ pull requests غير موثوقة. لا تشغل signing في forked builds.

### 6.5 Quality gates

- لا أخطاء lint.
- اختبارات P0/P1 كلها green.
- لا `eval` ولا hardcoded install paths في release scan.
- version consistency check green.
- code review إلزامية لأي تغيير manifest/bridge/host/build.

---

## المرحلة 7 — تحقق Adobe After Effects وإدارة الإصدار

### 7.1 مصفوفة التوافق

اختبر على الأقل:

| البعد | الحد الأدنى |
|---|---|
| After Effects | أقدم إصدار مدعوم + أحدث إصدار مدعوم |
| Windows | حساب مستخدم عادي، ومسار `%APPDATA%` |
| المشروع | محفوظ وغير محفوظ، مشروع فارغ، مشروع يحتوي comps كثيرة |
| الشبكة | متاحة، offline، provider 401، timeout، rate limit |
| المقاس | HD، 4K، 8K ضمن حدود الذاكرة المعلنة |

### 7.2 Smoke checklist

1. يظهر panel ويحمّل بلا console errors.
2. zoom/pan/resize يعرض tiles صحيحة.
3. كل provider في القائمة إما يعمل أو يعلن بوضوح أن مفتاحه مطلوب.
4. إنشاء comp يستدعي host ويترك project في حالة سليمة.
5. marker باسم عربي، واسم يحوي quotes، لا يكسر AE ولا ينفذ أمراً إضافياً.
6. import GeoJSON صحيح وخاطئ.
7. keyframe/trajectory/finalize/undo تعمل.
8. إغلاق المشروع وإعادة فتحه يعيد metadata بأمان.
9. حذف/cancel job لا يزيل ملفاً خارج user-data job directory.

### 7.3 Stress وperformance

- 200+ tile مع pan سريع وإلغاء متكرر.
- multiple finalize متقاربة للتأكد من generation cancellation.
- 4K و8K مع قياس زمن التنزيل، stitching، peak memory، وحجم مشروع AE.
- تغيير provider وسط تنزيل نشط.
- مسار offline بعد cache warm.

حدد قبل الاختبار ميزانية أداء واقعية، مثل: عدم تجميد واجهة panel لأكثر من 100ms في التفاعلات، وعدم تجاوز حد ذاكرة متفق عليه. لا تعتمد أرقاماً عامة دون قياس البيئة المستهدفة.

### 7.4 release checklist

- [ ] branch/commit محدد ومراجع.
- [ ] كل CI gates خضراء.
- [ ] نسخة package/manifest/config/metadata متسقة.
- [ ] artefact verifier ناجح.
- [ ] `.debug` غير موجود.
- [ ] لا مفاتيح أو بيانات مستخدم في الحزمة.
- [ ] smoke وstress results موثقة.
- [ ] ZXP موقّع بشهادة الإنتاج.
- [ ] تم اختبار ZXP المثبت، لا stage فقط.
- [ ] release notes تشمل المزوّدين والقيود المعروفة.
- [ ] خطة rollback والإصدار السابق متاحان.

## 4. إدارة المخاطر وقرارات التصعيد

| الخطر | الاستجابة |
|---|---|
| لا يمكن إزالة Node بسبب ميزات حالية | أبقه مؤقتاً، وعزز كل boundaries؛ افتح مبادرة لاحقة لتقليل الامتيازات |
| مزود خرائط يغير سياسة الخدمة | افصل provider registry، واختبره دورياً، وعطّل المزوّد remotely في الإصدار التالي فقط بعد مراجعة الترخيص |
| JSON.parse غير متاح في AE قديم جداً | وفر polyfill JSON آمن ومدقق، ولا تعد إلى eval |
| الانتقال إلى TS قد يغير سلوك الخرائط | characterization tests وincremental migration؛ لا big-bang rewrite |
| ضغط الموعد | نفذ P0 كاملاً أولاً؛ لا تختصر أمن bridge أو package integrity |

## 5. ترتيب التنفيذ المقترح

- [x] المرحلة 0 كاملة.
- [x] OG-001: build/stage/verifier حتى تصبح الحزمة قابلة للفحص.
- [x] OG-002 وOG-005: إصلاح خطأ overlay وإزالة/تأمين Stadia.
- [x] OG-003 وOG-004 وOG-006: bridge، JSON parsing، production manifest.
- [x] OG-009: user-data paths وjob boundaries.
- [x] OG-007 وOG-008: قرار المحرك وتوحيد البناء.
- [x] OG-010 إلى OG-012: tests, CI, docs, versions.
- [x] المرحلة 7 ثم توقيع وتوزيع مضبوط.

هذا التسلسل يمنع إنفاق وقت على تحسين محرك أو واجهة بينما artefact المنشور مكسور أو غير آمن.

---

## 6. ملحق التنفيذ المباشر (التطوير المضاف للخطة)

بناءً على الفحص المعماري والتحليل الذري الأخير، تمت إضافة هذه النقاط التفصيلية غير المذكورة في خطة التدقيق الأصلية، والتي تمثل خريطة طريق مباشرة للتعديل على الكود المصدري:

### 6.1 إصلاحات بصرية وهندسية (تم إنجازها)
هذه المشاكل لم يكتشفها التدقيق لأنها تتعلق بمنطق تشغيل الخرائط البصري:
- [x] **إصلاح `TileGrid.js`:** تمت إضافة هامش أمان (Buffer) `±1` لمعادلة `getCompVisibleTiles` لمنع ظهور فراغات سوداء عند حدود الشاشة (AABB Intersection).
- [x] **إصلاح `compBuilder.jsx`:** تم إلغاء تمديد البلاطات (Overlap) ليكون 0 بكسل تماماً، وتم تفعيل وضع الدمج `BlendingMode.ALPHA_ADD` لعلاج الخطوط السوداء (Hairline Seams) رياضياً بدون تشويه الألوان.
- [x] **إضافة `MapTiler`:** تم دمج مزود MapTiler وتفعيله في `config.js` وربطه بواجهة المستخدم.

### 6.2 تفاصيل تنفيذ إصلاحات الأمان (الخطوة القادمة فوراً)
لترجمة الخطة النظرية (المرحلة 2 و 3) إلى أكواد قابلة للتنفيذ الآن:

- [x] **1. إصلاح `app.js` (OG-002):**
   - السطر المستهدف: `this._queueAutoExport();`
   - التعديل: استبداله بـ `this.syncManager.queueAutoExport();`.

- [x] **2. إزالة `eval` من المضيف (OG-004):**
   - الملفات المستهدفة: `compBuilder.jsx`, `spatialPinHost.jsx`, `vectorHost.jsx`.
   - التعديل: إزالة `eval('(' + raw + ')')` واستخدام `JSON.parse(raw)` داخل كتل `try/catch` آمنة.

- [x] **3. تأمين Bridge (OG-003):**
   - الملفات المستهدفة: `AEBridge.js` و `SpatialPin.js`.
   - التعديل: برمجة دالة `escapeExtendScriptString` لمنع حقن علامات الاقتباس الفردية والمزدوجة `"` و `'` ورموز السطور `\n` في المتغيرات المرسلة لـ AE.

- [x] **4. المسارات المطلقة (OG-009):**
   - الملفات المستهدفة: `JobManager.js` و `GeoDataRepository.js`.
   - التعديل: استبدال مسار `C:/Program Files...` الصلب بالاستدعاء الديناميكي `window.__adobe_cep__.getSystemPath("extension")`.

- [x] **5. تأمين مزود Stadia (OG-005):**
   - الملف المستهدف: `config.js`.
   - التعديل: إضافة حقل `requiresKey: true` لـ `stamenTerrain` لتفعيله فقط عند وجود مفتاح.
