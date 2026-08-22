# OpenGeo — سياسة الشبكة والأسرار في بيئة CEP

**الإصدار:** 1.0.0  
**تاريخ الاعتماد البرمجي:** 14 أغسطس 2026  
**النطاق:** طلبات البلاطات، بحث Nominatim، روابط الإسناد، مفاتيح مزودي الخرائط، وسجلات الدعم.

## 1. عقد الشبكة الملزم

| المسار | البروتوكول | المهلة | الحد الأقصى | سياسة التحويل |
|---|---|---:|---:|---|
| Raster Preview وFinalize | HTTPS فقط | 15 ثانية افتراضيًا | 16MB للبلاطة | يسمح بتحويلات CEF الداخلية إذا بقي العنوان النهائي HTTPS وبلا credentials |
| بحث Nominatim | HTTPS فقط | 10 ثوانٍ | 1MB و5 نتائج | العنوان النهائي يجب أن يبقى HTTPS |
| Attribution | HTTPS فقط | — | — | HTTP و`javascript:` وcredentials تُرفض ولا ينشأ رابط قابل للنقر |
| Custom XYZ | HTTPS وقالب `{z}/{x}/{y}` | كمسار البلاطات | 16MB | يخضع لنفس `NetworkPolicy` |

- `NetworkPolicy` هو مصدر قواعد URL والمهلة والحجم والتحقق من الوجهة النهائية.
- `TileTransport` هو المالك الوحيد لـXHR الخاص بالبلاطات؛ أزيل fallback الشبكي الموازي من Engine.
- `SearchPanel` هو مالك XHR الوحيد الآخر، لأنه endpoint JSON متخصص، لكنه يطبق السياسة المركزية نفسها.
- CEF لا يكشف عدد حلقات redirect بصورة موثوقة؛ لذلك تُحكم المخاطرة بمهلة كلية وبالتحقق من URL النهائي. لا يُقبل downgrade إلى HTTP.
- الاستجابة التي تتجاوز الحد تُرفض وتُلغى عند progress قبل decoding متى أتاح CEF حجم التدفق.

## 2. سياسة المفاتيح والأسرار

- مفاتيح Mapbox/MapTiler/Stadia محفوظة حاليًا في `localStorage` داخل ملف CEP تحت `opengeo_providers`.
- هذا التخزين **ليس OS credential vault ولا تشفيرًا آمنًا**. لا ينبغي إعادة استخدام كلمة مرور أو مفتاح ذي صلاحيات أوسع من خدمة الخرائط.
- يظهر هذا القيد صراحة داخل Settings. يمكن مسح المفاتيح بإفراغ حقولها ثم الحفظ.
- لا تُرسل المفاتيح إلى AE metadata أو Bridge payloads عمدًا؛ تُحقن فقط في URL طلب المزوّد عند التنفيذ.
- `OperationLogger` يحجب حقول `key/keys/apiKey/token/authorization/secret/password/signature`، ويحجب قيم query المسماة `key`, `api_key`, `access_token`, `token`, `signature`, `sig`.
- لا يُعتمد obfuscation محلي على أنه حماية. الانتقال إلى credential vault يحتاج native/OS integration منفصلًا وقرار توافق CEP.

## 3. سياسة بيئة البناء

- `npm strict-ssl` يجب أن يساوي `true`.
- يجب ألا يكون `NODE_TLS_REJECT_UNAUTHORIZED` معرفًا في User أو Machine scope.
- أي تعطيل مؤقت لـTLS يمنع اعتماد build أو dependency operation حتى إزالته وإعادة الفحص.

## 4. بوابات المنع الآلية

- `npm run audit:security`: يفشل عند ظهور XHR owner جديد، أو Node capability غير مسموح، أو HTML/eval sink، أو غياب CSP/HTTPS/limits.
- `npm test`: يختبر HTTP rejection، downgrade redirect، response overflow، URL credentials، UTF-8 byte limits، وredaction للمفاتيح.
- `npm run verify:release`: يشغل تدقيق الأمن قبل بناء stage والتحقق منه.

## 5. القيود المتبقية

- تخزين المفاتيح محلي plaintext هو مخاطرة مقبولة مؤقتًا ومعلنة، وليس حلًا مثاليًا.
- حدود الحجم لا تمنع نقل كل byte إذا لم يرسل CEF progress قبل اكتمال الاستجابة، لكنها تمنع decoding/processing وتتحقق مجددًا بعد التحميل.
- الاعتماد النهائي لسلوك timeout/recovery داخل CEF مسجل في AE-35.
