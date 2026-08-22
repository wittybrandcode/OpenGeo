# ADR-007 — مصفوفة توافق OpenGeo مع After Effects وCEP

**الحالة:** مقبول برمجيًا؛ اعتماد التشغيل على الحدين الأدنى والأعلى باقٍ  
**تاريخ القرار:** 14 أغسطس 2026  
**صاحب القرار:** OpenGeo  
**العقد الآلي:** `config/compatibility-policy.json`  
**المدقق:** `scripts/compatibility-audit.js`

## 1. القرار التنفيذي

يعتمد OpenGeo نطاق Host صريحًا هو `AEFT [18.4,24.99]`، ويتطلب `CSXS 11.0` على الأقل. أُلغي النطاق السابق `[15.0,99.9]` لأنه كان يدّعي توافقًا مع محركات قديمة وإصدارات مستقبلية لم تُفحص.

هذا القرار يعني:

- AE 18.4 هو أقدم إصدار يسمح manifest بتحميل الإضافة عليه، لأنه أول إصدار After Effects تربطه وثائق Adobe الرسمية بـCEP 11.
- AE 24.x هو أحدث major مسموح حاليًا، لأن أحدث بيئة مثبتة ومفحوصة محليًا هي 24.6.2.
- AE 25 وما بعده ليس مصنفًا «غير متوافق»؛ إنه غير معتمد بعد، ويحتاج دورة تحقق مستقلة قبل توسيع الحد الأعلى.
- AE 15 حتى 17.x غير مدعوم. لن نضيف transpilation أو نسخة Lucide قديمة فقط للإبقاء على محركات CEP 9/10.
- Windows هو النظام المفحوص حاليًا. macOS غير مرفوض هندسيًا، لكنه غير معتمد بلا اختبار Host وfilesystem منفصل.

## 2. لماذا أصبح CEP 11 خط الأساس؟

توثق Adobe أن After Effects 18.4 يدمج CEP 11، وأن CEP 11.1 يستخدم Chromium 88 وNode.js 15.9.0 وV8 8.7. في المقابل يستخدم CEP 10 Chromium 74. الكود الحالي لا يقتصر على ES5: حزمة `lucide.min.js` تحتوي optional chaining وobject spread، ويستخدم العميل `class` و`async/await`، كما يعتمد التشغيل على Node built-ins للوصول إلى الملفات.

الاستنتاج المعماري هو أن الإعلان عن CSXS 9 أو AE 15 كان أخطر من تضييق النطاق: قد يسمح بتثبيت الإضافة ثم يفشل parser قبل أن تستطيع الواجهة عرض رسالة خطأ أو fallback.

## 3. مصفوفة الدعم

| نطاق After Effects | CEP المعروف | حالة OpenGeo | مستوى الدليل | القرار |
|---|---:|---|---|---|
| 15.0–17.1.3 | CEP 9 | غير مدعوم | محرك أقدم من عقد JavaScript الحالي | يمنع manifest التحميل |
| 17.1.4–18.3 | CEP 10 | غير مدعوم | Adobe توثق Chromium 74؛ baseline الحالي هو CEP 11 | يمنع manifest التحميل |
| 18.4–22.x | CEP 11 family | متوافق بالعقد، غير معتمد يدويًا | جدول Adobe + تدقيق syntax/fallback | مسموح، مع known limitation للاختبار |
| 23.6 / Windows | CEPHtmlEngine 11.5.3 | مثبت ومفحوص محليًا | File version probe بتاريخ 2026-08-14 | مرشح اختبار الحد الأدنى العملي |
| 24.6.2 / Windows | CEPHtmlEngine 11.5.3 | مثبت ومفحوص محليًا | File version probe بتاريخ 2026-08-14 | أحدث إصدار معتمد في manifest |
| 25.x وما بعده | غير مثبت محليًا | غير معتمد بعد | لا يوجد دليل تشغيل | يُضاف فقط بعد compatibility review |

> «مفحوص محليًا» هنا يعني إثبات وجود Host ونسخة CEPHtmlEngine. لا يعني نجاح smoke test كاملًا ما لم يسجل اختبار AE-36 أو AE-37 صراحة.

## 4. عقد القدرات وبدائلها

| القدرة | إلزامية؟ | الاستخدام | سلوك الغياب |
|---|---:|---|---|
| JavaScript حديث | نعم | العميل وحزمة الأيقونات | لا يمكن fallback بعد parse؛ لذلك يفرض CEP 11 |
| Node + `--enable-nodejs` | نعم | `fs/path/os/crypto` والـpayload/cache | يفشل تدقيق الإصدار إذا غاب العلم أو ظهرت وحدة غير مصرح بها |
| `ResizeObserver` | لا | قياس نافذة الخريطة | `window.resize` listener |
| `Worker` + `OffscreenCanvas` | لا | دمج MegaTiles خارج UI thread | canvas stitcher في main thread |
| `fetch` | لا | بعض طلبات الشبكة | `XMLHttpRequest` محدود بالمهلة والحجم وHTTPS |
| ExtendScript legacy syntax | نعم | جميع ملفات `host/**/*.jsx` | بوابة الإصدار ترفض `let/const/class` أو arrow/template syntax |

## 5. ما يتحقق آليًا

يشغّل `npm run audit:compatibility` تدقيقًا fail-closed يتحقق من:

1. تطابق `HostList` و`RequiredRuntime` مع عقد JSON.
2. وجود `--enable-nodejs`.
3. استمرار وجود baseline الصياغة الحديثة الذي يبرر الحد الأدنى، لمنع تغيير السياسة بصمت.
4. وجود fallback فعلي لـResizeObserver وWorker/OffscreenCanvas وطلبات XHR.
5. حصر Node modules المسموحة في `buffer/crypto/fs/os/path/process`؛ يُستخدم `buffer/process` فقط في Bootstrap استعادة Node بعد CEF DevTools Reload.
6. بقاء JSX ضمن صياغة ExtendScript القديمة.
7. اقتصار مصادر قرار التوافق على موارد Adobe CEP الرسمية.

ينتج المدقق `release/compatibility-report.json`. تدخل بصمته في `release/artifact-manifest.json`، لذلك يؤدي تغيير السياسة أو التقرير بعد بناء الحزمة إلى فشل `artifact:verify`.

## 6. اختبارات Host المتبقية لإغلاق القرار

### AE-36 — الحد الأدنى العملي

على AE 23.6 المثبت: افتح اللوحة، أنشئ Composition، نفذ pan/zoom وAdd Key وFinalize، ارسم بلدًا من البحث، أغلق اللوحة وافتحها. القبول: لا parser error، ولا Bridge error، ولا اختلاف state أو assets.

### AE-37 — الحد الأعلى الحالي

على AE 24.6.2 المثبت: أعد السيناريو نفسه مع Offline Vector Preview وRecord ومسار keyframes. القبول: كل العمليات تعمل، وتطابق نتائجها النسخة 23.6 وظيفيًا.

لا يلزم التحكم بالشبكة لإجراء جوهر هذين الاختبارين؛ يمكن استخدام cache وOffline Vector للأجزاء غير الشبكية. يبقى AE-35 اختبار resilience الشبكي مؤجلًا بصورة مستقلة.

## 7. قواعد توسيع النطاق مستقبلًا

لا يغيّر المطور رقمًا في manifest منفردًا. لإضافة AE major جديد يجب:

1. توثيق CEPHtmlEngine وChromium/Node المدمجين.
2. تشغيل `verify:release` دون استثناءات.
3. تنفيذ smoke test مكافئ لـAE-37 على ذلك major.
4. مراجعة Node integration وCSP وWorker/OffscreenCanvas والـBridge.
5. تحديث policy والمصفوفة وmanifest معًا، ثم إعادة توليد compatibility report وartifact manifest.

## 8. الأدلة المرجعية

- [Adobe CEP 11.1 HTML Extension Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_11.x/Documentation/CEP%2011.1%20HTML%20Extension%20Cookbook.md)
- [Adobe CEP Resources releases](https://github.com/Adobe-CEP/CEP-Resources/releases)
- [Adobe CEP Samples compatibility guidance](https://github.com/Adobe-CEP/Samples)

## 9. النتيجة

أصبحت مصفوفة التوافق عقدًا قابلًا للفشل وليس ادعاءً وثائقيًا. التنفيذ البرمجي مكتمل؛ لا تتحول M8-04 إلى اعتماد نهائي إلا بعد تسجيل AE-36 وAE-37 على نسختي Host المثبتتين.
