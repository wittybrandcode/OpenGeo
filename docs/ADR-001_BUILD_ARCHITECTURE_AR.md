# ADR-001 — بنية بناء وتشغيل JavaScript في OpenGeo

**الحالة:** مقبول ومطبق  
**التاريخ:** 20 أغسطس 2026  
**النطاق:** كود Client داخل Adobe CEP  
**القرار:** JavaScript كلاسيكي محمّل بترتيب صريح في `client/index.html` خلال دورة التثبيت الحالية

## السياق

تعمل لوحة OpenGeo داخل CEP عبر ملفات JavaScript كلاسيكية/IIFE يحملها `client/index.html` بترتيب محدد. الملف الفعلي للمحرك هو `client/js/engine/OpenGeoEngine.js`، وتبني `scripts/build.js` حزمة التشغيل من `client`, `host`, و`CSXS` إلى `release/stage`.

كان جذر المشروع يحتوي أيضًا على `rollup.config.js` و`tsconfig.json` يشيران إلى `client/js/engine/src/index.ts`، مع أن مجلد `engine/src` غير موجود، وملحق Rollup المطلوب غير مثبت، ولا يوجد script في `package.json` يشغّل هذا المسار. لم يكن الناتج المفترض يُحمّل في `client/index.html` أو يدخل مسار الإصدار؛ لذلك مثّل مصدر حقيقة زائفًا لا بنية بناء احتياطية صالحة.

## القرار

1. اعتماد ملفات JavaScript الموجودة تحت `client/js/**` كمصدر تشغيل وحيد للعميل في هذه الدورة.
2. اعتماد ترتيب `<script>` في `client/index.html` كعقد تحميل صريح، و`release/stage` كـartifact مبني قابل للتحقق.
3. إزالة إعدادات TypeScript/Rollup غير العاملة والمراجع الخاصة بمجلدي `engine/src` و`engine/dist` غير الموجودين.
4. إبقاء الاستثناءين العامين `src` و`dist` في build كحاجز تعبئة default-deny؛ لا يعني وجودهما أن لهما دورًا في بنية المصدر الحالية.
5. منع إعادة إدخال Rollup/TypeScript جزئيًا: أي انتقال مستقبلي يحتاج ADR جديدًا، spike صغيرًا، entry فعليًا، dependency مقفلة، اختبارات تكافؤ، وربط الناتج نفسه ببوابة الإصدار.

## أسباب القرار

- يقلل عدد مصادر الحقيقة ويحذف إعدادًا لا يمكن تشغيله.
- لا يغيّر runtime أو ترتيب التحميل، ولذلك مخاطره أقل أثناء تثبيت المنتج.
- يحافظ على توافق CEP 11/Chromium 88 الموثق دون إدخال transpilation غير مضبوط.
- يجعل أي migration مستقبلية قرارًا معماريًا قابلاً للقياس بدل مزج تدريجي غير مكتمل.

## البدائل المرفوضة الآن

### تشغيل Rollup/TypeScript فورًا

مرفوض لهذه الدورة لأنه يتطلب نقل implementation الفعلي، حسم globals وترتيب التهيئة، إضافة toolchain جديدة، والتحقق داخل نسختي AE المستهدفتين. هذه مخاطرة واسعة لا تعالج عيبًا سلوكيًا حاليًا.

### إبقاء الإعدادات بوصفها خطة مستقبلية

مرفوض لأن config يشير إلى ملفات واعتماديات غير موجودة ويوحي خطأً بوجود build ثانٍ صالح. تحفظ الخطة المستقبلية في ADR/task، لا في ملفات تنفيذ مكسورة.

## النتائج والتبعات

- لا يوجد compile/transpile للعميل؛ يجب أن يحترم الكود baseline التوافق الموثق في `COMPATIBILITY_MATRIX_AR.md`.
- يظل ترتيب scripts عقدًا مهمًا ويخضع لفحص package/syntax/release الحالي.
- لا يحق لأي ملف config جديد إنشاء artifact موازٍ خارج `release/stage`.
- عند بدء migration مستقبلية يجب أن يكون rollback هو العودة إلى ملفات JavaScript الحالية المثبتة بالبصمات والاختبارات.

## شروط فتح ADR migration جديد

لا يبدأ الانتقال إلى modules/TypeScript إلا إذا توفر جميع ما يلي:

1. مشكلة قابلة للقياس لا تحلها العقود والاختبارات الحالية.
2. entry واحد فعلي يضم جزءًا محدودًا أولًا، لا Big Bang.
3. toolchain مقفلة في `package-lock.json` ولا تحتوي runtime dependency داخل CEP بلا مبرر.
4. مقارنة behavior وtile manifests وBridge contracts قبل/بعد.
5. نجاح `verify:release` واختبارات AE 23.6 و24.6.2 على artifact الناتج نفسه.

## دليل التطبيق

- حُذف `rollup.config.js` و`tsconfig.json` الميتان.
- أزيلت الإشارتان الخاصتان إلى `client/js/engine/src` و`client/js/engine/dist` من build.
- أضيف اختبار يمنع عودة config الميت ويتحقق أن HTML يحمّل المحرك الفعلي وأن build لا يشير إلى المسارين الوهميين.

