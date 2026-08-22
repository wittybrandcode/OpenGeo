# 📊 Executive Summary

**النطاق:** تدقيق ساكن عميق لملفات المنطق فقط في `client/js/**` و`host/**`، مع استبعاد ملفات Markdown والتوثيق واعتبار `dist/` و`release/` مخرجات لا مصادر للحكم.

**الحكم:** البنية تحمل نواة جيدة ومقصدًا معماريًا صحيحًا: فصل واجهة الخريطة عن تنزيل البلاطات، وجود طبقة Bridge، طبقة مضيف JSX، ومستودع بيانات محلي. لكن صحتها المعمارية الحالية **متوسطة إلى ضعيفة (4/10)** لأنها تطورت عبر مسارات تنفيذ متوازية دون عقد موحّد للحالة أو للبيانات أو للجسر.

OpenGeo في الحقيقة ينسّق ثلاثة أنظمة ذات دورة حياة مختلفة:

```text
Viewport CEP (المعاينة) ── EventBus ──► TileManager / MapRenderer
                                │
                                ├────────► AESyncEngine ── evalScript ──► AE controller
                                │
                                └────────► SyncManager / FinalizeController
                                                  └─ Engine / TilePlanner / MegaTileStitcher
                                                       └─ evalScript ──► AE composition builder
```

المشكلة ليست في حجم أي class وحسب؛ بل في أن كل مسار يحتفظ بصورة مختلفة للحالة: `MapState` و`Viewport` و`App.activeCompId` و`AESyncEngine._activeCompId` و`OpenGeo.Engine._camera` وAE نفسه. لا توجد جهة مالكة واحدة للحالة ولا بروتوكول طلبات متسلسل للجسر. النتيجة المتوقعة عند الحركة السريعة، تبديل Composition، أو Finalize طويل: تحديثات متأخرة، تصدير ببيانات قديمة، تضخم مشروع AE، ورسائل نجاح لا تعكس دائمًا نجاح AE الحقيقي.

هناك أيضًا عناصر بنيت بإتقان نسبي: `MercatorProjection` صغير ومتماسك، `MemoryCache` LRU واضح، و`JobManager` يقدّم نمط ملف مؤقت صحيح ينبغي تعميمه. لكن هذه العناصر لا تمنع أعطال التكامل أعلى الطبقات.

# 🚨 Critical Architectural Smells

## 1. لا توجد ملكية واحدة للحالة؛ و`App` أصبح منسقًا شاملًا (God Object)

`client/js/app.js` (616 سطرًا) ينشئ الخدمات، يربط عناصر DOM، يحفظ التفضيلات، يدير المودالات، يترجم الأحداث، يحدّث الواجهة، يبني URLs، ويقرر دورة Preview/Finalize. وفي الوقت نفسه يوجد أكثر من تمثيل لنفس الواقع:

- الموقع/الزوم: `MapState`، وواجهة `Viewport`، و`OpenGeo.Engine.Camera`، وحالة AE.
- الـ composition النشط: `App.activeCompId` و`AESyncEngine._activeCompId`.
- إعدادات المزود: `OpenGeoConfig` القابل للتعديل، و`ProviderManager.userSettings`، و`TileManager.apiKey`، و`prefs.apiKey` غير الموجود فعليًا.

أخطر أثر مثبت: `_savePrefs()` يحفظ `mapState.compZoom`، لكن constructor يمرره إلى `Viewport` بوصفه **UI zoom**. ولأن `MapState.setUIZoom()` يحول UI zoom إلى comp zoom وفق أبعاد framing box، فإن الزوم المحفوظ ينجرف عند كل إعادة تشغيل بدل استعادته بدقة.

**اتجاه الإصلاح:** استحداث `MapSession`/`MapDocumentState` واحد يملك `camera`, `composition`, `provider`, `renderMode`, و`finalizationState`. تصبح `App` composition root وواجهة تحكم فقط، وتقرأ الواجهة snapshot غير قابل للتعديل بدل الكتابة في حقول موزعة.

## 2. EventBus غير منظم يصنع مسارات دائرية وسباقات غير مرئية

`EventBus` نفسه بسيط وصحيح ميكانيكيًا، لكنه global وsynchronous وبدون عقود payload أو ownership أو lifecycle. المثال الأخطر:

```text
المستخدم يسحب الخريطة
  → viewport:changed
  → App: يجلب tiles ويحفظ prefs ويطلب auto-export
  → AESyncEngine: يرسل opengeoUpdateCamera فورًا إلى AE
  → polling يقرأ AE ويطلق viewport:changed_from_ae
  → App: يعيد render/save، لكن لا يطبّق إحداثيات AE على Viewport
```

المسارات غير محمية من التسابق:

- `AESyncEngine` يعمل polling كل 500ms بعملية async من دون single-flight guard؛ إذا تأخر `evalScript` تتداخل poll requests وتصل النتائج خارج ترتيبها.
- كل `viewport:changed` أثناء drag يرسل `opengeoUpdateCamera` مباشرة؛ لا debounce ولا queue ولا latest-wins. هذا يفيض جسر CEP ويمتلك احتمال إنشاء عدد كبير من Undo Groups في AE.
- handler `sync:compChanged` يستدعي `Viewport.setCenter` أثناء تحميل metadata؛ هذا يطلق `viewport:changed` من جديد ويعامل الحركة كحركة مستخدم (`isAeDrivenMove = false`) ثم قد يعيد دفعها إلى AE.
- `viewport:changed_from_ae` يضع flag ويرسم فقط؛ لا يستدعي `viewport.setCenter` أو `setZoom`. إذًا تحديث AE الوارد محفوظ في `_aeCameraState` لكنه لا يصبح حالة الخريطة المعروضة. والمسار الاختياري الذي يستعمله (`useAeState`) لا يستدعى من أي caller.

**اتجاه الإصلاح:** events domains محددة وtyped (مثل `camera.intentChanged`, `camera.appliedFromAe`, `export.requested`)، reducer/session مركزي، ومفتاح operation generation واحد لكل camera/comp. اجعل AE sync آخر مستهلك للحالة مع debounce، single-flight، وآلية latest-wins.

## 3. طبقة الجسر ليست حد أمان أو عقدًا موحدًا؛ ونتائج JSX تُفسر بطرق متناقضة

`AEBridge._evalScript()` يوفر timeout محليًا مفيدًا، لكنه لا يوقف ExecuteScript داخل AE بعد timeout. الأهم: معظم commands تُركّب خارج `AEBridge` كسلاسل نصية يدوية، لذلك لا تضمن طبقة الجسر serialization أو validation أو شكل response موحدًا.

أمثلة مباشرة:

- `SyncManager` يمرر payload مزدوج JSON ويفك response JSON، بينما `FinalizeController.buildComposition()` يفحص فقط بادئة `error:`. لكن `opengeoBuildComposition()` يرجع أخطاءً بصيغة `{"error":"..."}`؛ لذلك يمكن أن يعلن Finalize النجاح رغم فشل البناء في AE.
- `VectorMapManager` يبني `opengeoImportVectorMapFromFile("${safePath}", ...)` يدويًا؛ المسار لا يمر عبر `JSON.stringify` كحجة ExtendScript.
- `SpatialPin.generateFlightPath()` ينفذ كود ExtendScript خامًا من العميل، يبتلع الأخطاء داخل JSX، ويتجاوز عقد host API كليًا.
- payload البلاطات الضخم في Preview/Finalize يُنقل داخل `evalScript` كنص JSON مزدوج، بينما vector export يستخدم ملفًا مؤقتًا—النمط الآمن والقابل للتوسع موجود لكنه غير موحّد.

**اتجاه الإصلاح:** API واحد مثل `bridge.invoke(command, args, {timeout})` يستخدم `JSON.stringify` لكل argument، envelope للنتيجة `{ok,data,error,requestId}`، وطبقة Host dispatcher. انقل payloads الكبيرة إلى ملفات Jobs وأرسل path/manifest فقط.

## 4. ثلاث طبقات تنزيل/تجميع متداخلة تؤدي إلى DRY مكسور وبيانات قديمة

يوجد:

1. `TileManager` + `TileDownloader` للمعاينة داخل Canvas.
2. `OpenGeo.Engine` الداخلي، وفيه `TileGrid` و`TileDownloader` آخران للتصدير إلى AE.
3. `TileStitcher` + `PNGExporter` لتجميع/تصدير Canvas، لكنه ليس جزءًا من workflow الفعلي؛ و`MegaTileStitcher` هو المسار الفعلي لـ Finalize.

هذا ليس abstraction متعدد الاستخدام؛ إنها تطبيقات متباعدة لقواعد URL/cache/retry/tile coordinate. مثلًا، المعاينة تستعمل `ProviderManager.getURL()`، أما `SyncManager` فيمرر `src.url` الخام إلى engine، وFinalize يمرر `prefs.apiKey` رغم أن المفتاح مخزن في ProviderManager.

أخطر أثر: `OpenGeo.Engine._accumulatedTiles` يبقى بين exports ولا يُمسح. `getAccumulatedTiles()` يعيد كل البلاطات التي زارتها الكاميرا على zoom نفسه، و`opengeoBuildComposition()` لا يزيل preview tiles حين يبقى source نفسه. وبالتالي يزداد مشروع AE وبلاطاته مع التنقل بدل اقتصاره على frame/viewport الحاليين.

**اتجاه الإصلاح:** Tile request model واحد مستقل عن UI (`TileRequest`, `TileResult`, `TileCache`, `TileProvider`) تستخدمه preview وexport وfinalize. اجعل export محددًا بـ session/generation ويحصل فقط على results لذلك الطلب، لا accumulated global history.

## 5. هوية Composition والملفات المرحلية ليست معزولة؛ وFinalize cache قد يعيد بيانات مزود/مشهد آخر

طبقة JSX تفترض أسماء عالمية ثابتة: `OpenGeo Map` و`OpenGeo World Mapcomp` و`MapPivot`. البناء يعيد استخدام أول composition يطابق الاسم، وFinalize يحذف عناصر مجلدات Preview/Final Tiles عالميًا. هذه بنية single-document/single-map غير معلنة.

وفي client، `MegaTileStitcher` يستقبل `compId` لكنه لا يضعه في اسم الملف؛ ملفات mega تستخدم `mega<size>_<z>_<x>_<y>.png` فقط. كما أن cleanup في `FinalizeController` يبحث عن اسم يتضمن `_<safeCompId>_`، وهو شرط لا يطابق الاسم المنتج أصلًا. والأسوأ أن `_stitchCanvas()` يعيد ملف mega موجودًا إن تجاوز حجمه 1000 bytes حتى إن تغير provider أو محتوى tile.

**النتيجة:** cache خاطئ أو tiles قديمة عند تبديل المصدر/المشروع، وعدم تنظيف حقيقي، وعدم أمان عند وجود أكثر من OpenGeo map في مشروع واحد.

**اتجاه الإصلاح:** `documentId` ثابت مخزن في metadata، أسماء AE وfolders وtiles مقيّدة به وبـ`provider/version/tile signature`، وcache manifest يثبت input hash قبل reuse.

# 🧩 Module-by-Module Assessment

| النظام | ما هو جيد | الخلل المعماري/المنطقي |
|---|---|---|
| `MercatorProjection`, `MemoryCache` | وحدات صغيرة ومحددة المسؤولية؛ الإسقاط واضح وLRU فعلي. | حدود zoom مختلفة بين `Viewport` (حتى 22)، engine (حتى 19)، host (`MAX_ZOOM=23`)؛ لا يوجد contract موحد للتوافق. |
| `MapState` + `Viewport` | فصل معقول بين comp dimensions وpanel dimensions؛ API الحركة مناسب. | يحملان نموذجين للزوم بلا نوع/اسم صريح؛ persistence يعامل `compZoom` كـ UI zoom عند الاستعادة، فيسبب drift. التغيير يطلق event في كل set ولا توجد معاملات صامتة للـ hydration من AE. |
| `EventBus` | يدعم `on/off/once` ويعزل listener exceptions. | global mutable bus بلا تعريف events أو unsubscribe ownership. listeners من managers لا تُزال. لا توجد حدود بين UI/domain/infrastructure events. |
| `App` | composition root موجود ويجمع كل الاعتمادات في مكان واحد. | تجاوز composition root ليصبح God Object: DOM + state + workflow + provider URL + status + persistence. حقول `exportTimer` و`_bridgeLoaded` غير مستخدمة. لا يملك `dispose()`. |
| `TileManager` / preview downloader | priority queue وparent fallback أفكار جيدة لتحسين تجربة المعاينة. | `DiskCache` يُنشأ لكنه لا يقرأ أو يكتب مطلقًا. إلغاء task نشط يمنع إعادة جدولة المفتاح حتى تنتهي عملية abort، وXHR timeout/abort قد يطلق reject أكثر من مرة. لا توجد دورة حياة لإلغاء كل listeners. |
| `OpenGeo.Engine` | إخفاء تفاصيل filesystem وتنزيل batch خلف API مفيد؛ retries وفحص magic bytes جيدان. | نسخة ثانية من TileGrid/Downloader بمنطق مختلف؛ `_camera._state` يُعدّل من `SyncManager` مباشرة؛ max zoom ثابت 19؛ لا يعالج antimeridian في TileGrid؛ accumulated tiles بلا scope ولا clear بين exports. |
| `SyncManager` | debounce export وgeneration token يحميان من تطبيق response متأخر على UI. | token لا يلغي التنزيل/AE request؛ engine يحتفظ بتاريخ tiles؛ URL template الخام يهمل مفاتيح provider؛ يكسر encapsulation بالوصول إلى `_camera._state`; `createIfNeeded` غير مستعمل. |
| `FinalizeController` / `TilePlanner` | workflow واضح: validate → scan → download → stitch → build؛ وplanner يفكر في base coverage. | controller يعرف DOM وfilesystem وprovider وAE وprogress؛ parser لا يفسر JSON error من host؛ لا `finally` يضمن `stitcher.destroy()` إن رمى stitch؛ `apiKey` من مصدر حالة خاطئ؛ parameter sample step يرسل للـ host لكنه غير مدعوم؛ `maxDownloadZoom` محسوب ولا يستخدم. |
| `MegaTileStitcher` / Worker | worker + `OffscreenCanvas` فكرة أداء جيدة، وتحويل Buffer قابل للنقل صحيح. | cache key لا يتضمن comp/provider/input hash؛ `compId` غير مستخدم رغم تمريره؛ cleanup pattern لا يطابق الملفات؛ jobQueue يبقى معلقًا عند فشل قراءة الملفات بعد التسجيل؛ worker lifecycle داخلي لكنه غير محمي في exceptional finalize path. |
| `GeoDataRepository` | repository محلي، caching، وملفات boundary per country اتجاه صحيح. | الداتا الأساسية ليست GeoJSON؛ هي features ذات `rings` على root. `_calculateFeatureBBox()` كان يبحث عن `feature.geometry` فقط ويرجع infinities، لذلك كان `query({bbox})` لا يفلتر `world_mercator_boundaries.json` فعليًا. كما كان يضيف `_bbox` و`_searchScore` إلى نموذج المصدر أثناء query. **تصحيح تدقيقي:** `normalizeArabic()` في المصدر UTF-8 صحيح؛ عرض mojibake السابق كان من ترميز طرفية القراءة وليس عيبًا في الكود. |
| `VectorMapManager` / `vectorHost.jsx` | اعتماد ملف مؤقت عبر JobManager أفضل pattern في المشروع؛ projection للـ GeoJSON الخارجي مفهومة. | manager يجمع repository/network/FS/bridge/UI؛ لا يضمن `finishJob()` في finally؛ `layerName` المرسل للـ host يُهمل والـ payload لا يحمله؛ host ينشئ layer كل مرة بلا identity/deduplication؛ spatial culling مكسور كما سبق. |
| `LayerManager`, overlays | overlays منفصلة للرسم، وMarker/GeoJSON بسيطان. | LayerManager هو نموذج ميزة غير موصول: لا ينشئ tileManagers ولا يستهلكه MapRenderer، وحدث `layers:changed` بلا مستمع. `MetadataManager.saveToComp()` لا يُستدعى، لذلك serialize layers ليس persistence فعليًا. |
| `AESyncEngine` | يميّز مبدئيًا بين panel وAE ويخزن last camera hash. | لا يزامن `App.activeCompId` مع `_activeCompId`، ولا يطبق AE camera inbound على Viewport، ولا يحمي polling من التداخل، ويدفع كل حركة UI مباشرة إلى AE Undo history. `setActiveComp` غير مستدعى. |
| `AEBridge` | `Promise` wrapper وtimeout وJSON.stringify في بعض wrappers خطوة جيدة. | ليس boundary حقيقيًا؛ callers يبنون scripts يدويًا. timeout محلي لا يلغي JSX. response protocol غير موحّد. `initializeHost()` لا يحمّل شيئًا لكنه يعلن completion. wrappers legacy غير مستخدمة. |
| `host/modules/compBuilder.jsx` | Undo group محاط بـ `try/finally`، وبناء expressions/tiles مفهوم وظيفيًا. | 338 سطرًا تمزج composition discovery/creation, source switching, cleanup, import, transforms, expressions, response serialization. أسماء عالمية ثابتة، preview لا يحذف tiles القديمة لنفس source، وتغيير fps/duration لا يحدّث composition موجودة. `opengeoSetMapRaster()` مرجع legacy ويعتمد `folders.tiles` غير الموجود في helpers الفعلي. |
| `host/modules/metadataSync.jsx`, `trajectoryScanner.jsx` | أغلب `beginUndoGroup/endUndoGroup` متوازنة في المسار الاعتيادي. | camera update له Undo group لكل حركة؛ timeline scan يبني JSON string frame-by-frame بدون حد للحجم؛ `opengeoBakeTimeline()` لا يخبز أي keyframe—يعد frames فقط. الخطأ يعاد أحيانًا `error:` وأحيانًا JSON؛ لا contract واحد. |
| `host/utils.jsx` مقابل `host/modules/helpers.jsx` | helpers الفعلي غني بأدوات folders/project state. | `host/utils.jsx` نسخة utilities متضاربة وغير included من `host/index.jsx`; تعريف `ensureComp` فيه مختلف. هذا مصدر خطر عند أي include أو صيانة مستقبلية. |

## سلامة Undo Groups والجسر JS ↔ JSX

- عمليات host التي تبدأ Undo Group تنهيه في `finally` في المسارات العادية، ولم يظهر استدعاء مباشر متداخل بين host public functions في تدفق الإنتاج الحالي.
- لكن السلامة العملية ليست مضمونة: `AESyncEngine` يمكنه إرسال عمليات update متزامنة كثيرة، وكل واحدة تضيف Undo Group مستقلًا؛ لا يوجد queue أو coalescing.
- `opengeoAddKeyframe()` يفتح group داخل `try` ثم ينهيه بلا guard مستقل لو فشل فتحه؛ خطر منخفض لكنه نمط هش.
- `SpatialPin.generateFlightPath()` هو path منفصل يبني JSX نصيًا داخل client ويبتلع `catch(e) {}` في الكود المنفذ؛ يجب إلغاؤه أو نقله إلى host command واضح.
- كل وظيفة host عامة يجب أن ترجع envelope JSON موحدًا، لا خليط `success`, `error:`, وJSON نصي.

# 💀 Dead Code / Duplication Report

## ملفات أو مسارات غير موصولة بالـ runtime الحالي

| العنصر | الدليل الساكن | القرار المقترح |
|---|---|---|
| `client/js/ui/BoundaryManagerUI.js` | غير محمّل في `client/index.html` ولا يُنشأ في أي ملف runtime. | احذفه بعد تأكيد عدم وجود entry مخفي، أو اربطه عبر feature مكتمل واختبره. |
| `client/js/tiles/DiskCache.js` | `TileManager` ينشئه بلا `cacheDir`، ولا يستدعي `diskCache.get/set`; لا يوجد caller آخر. | دمجه فعليًا في TileManager أو حذفه. |
| `client/js/export/PNGExporter.js` | لا caller لـ `exportToPNG`. | حذف/أرشفة أو إدخاله في workflow واضح. |
| `client/js/export/TileStitcher.js` | `App` ينشئ `this.tileStitcher` لكن لا يستدعي `stitch`; Finalize يستخدم `MegaTileStitcher` بدلًا منه. | اختر مسار export واحدًا. |
| `LayerManager` workflow | لا UI layer controls، ولا MapRenderer يقرأ `layerManager`; `layers:changed` بلا listener. | إما تنفيذ feature end-to-end أو إزالته من المنتج الحالي. |
| `MetadataManager.saveToComp()` | لا توجد أي invocation؛ يوجد load فقط. | وصل الحفظ بعد state commits أو احذف ادعاء persistence. |
| `AESyncEngine.setActiveComp()` | لا توجد invocation. | اجعل App/Session المالك الوحيد للـ comp ID أو أزل duplicative state. |
| `FinalizeController.bakeTimeline()` و`opengeoBakeTimeline()` | لا زر/حدث يستدعيهما؛ والـ host لا يكتب keyframes. | احذفها أو نفذ bake الحقيقي قبل كشفها. |
| `SpatialPin.generateFlightPath()` | لا caller، ويبني raw JSX خارج bridge. | استبداله بـ host command أو حذفه. |
| AEBridge wrappers `initMap`, `updateMapRaster`, `setLayerProperties`, `log` | لا callers إنتاجية؛ endpoints JSX المقابلة غير مستدعاة. | إزالة مسار legacy كامل أو إدخاله في contract الجديد. |
| `host/utils.jsx` | غير included في `host/index.jsx`; `host/modules/helpers.jsx` هو المصدر الفعلي للـ helpers. | حذف النسخة المتضاربة بعد نقل أي دالة وحيدة مطلوبة. |

## تكرار وظيفي ومصادر حقيقة متعددة

- **Tile fetching:** preview `TileDownloader` مقابل engine `TileDownloader` مقابل `TileStitcher._downloadTile`.
- **Tile coordinates:** `client/js/map/TileGrid.js` مقابل TileGrid داخل `OpenGeoEngine.js` مقابل TilePlanner الذي يستهلك API ثالثة.
- **Camera state:** Viewport/MapState/Engine/AESyncEngine/AE.
- **Provider/key resolution:** config، ProviderManager، TileManager.apiKey، `prefs.apiKey`.
- **Host utilities:** `host/utils.jsx` و`host/modules/helpers.jsx`، مع semantics مختلفة.
- **Export paths:** TileStitcher/PNGExporter القديم مقابل Engine+MegaTileStitcher الفعلي.

التكرار هنا ليس “احتياطيًا” لأن المسارات لا تشترك في اختبارات أو contracts؛ كل تعديل في provider أو zoom أو retry يحتاج تطبيقه في أكثر من موضع.

# 🛠️ Actionable Refactoring Roadmap

## P0 — ثبّت العقد قبل أي إعادة كتابة

1. اكتب عقدًا صغيرًا لـ `CameraState`, `CompositionRef`, `ProviderId`, `TileRequest`, `TileResult`, و`BridgeResponse`. عرّف صراحةً معنى `uiZoom` و`compZoom` أو ألغِ أحدهما من persistence.
2. أنشئ `MapSession` واحدًا كمالك للحالة. يمنع أي module من تعديل `mapState` أو `activeCompId` مباشرة؛ كل تغيير يمر عبر commands مثل `setCamera(origin)`, `setComposition`, `setProvider`.
3. أضف اختبارات regression قبل تغيير التنفيذ: استعادة zoom دون drift؛ انتقال active comp؛ AE inbound camera؛ Finalize يرجع JSON error؛ تغيير provider لا يعيد cache قديمًا.

**معيار الخروج:** لا توجد حقول `activeCompId` أو camera mutable متكررة بين App وAESyncEngine وEngine دون مصدر واحد واضح.

## P0 — استبدل bridge النصي ببروتوكول واحد

1. في client: `bridge.invoke(name, args)` هو المنفذ الوحيد لـ `evalScript`. يمنع public access إلى `_evalScript` خارج module الجسر.
2. في host: dispatcher صغير يستقبل request JSON ويعيد دائمًا `{ok:true,data}` أو `{ok:false,error:{code,message}}`.
3. انقل payloads الكبيرة (preview tile manifest, finalize manifest, vector payload) إلى JobManager files؛ يرسل الجسر path وrequest id فقط.
4. نفّذ queue single-flight أو latest-wins للـ camera sync؛ timeout يعلّم request obsolete ولا يسمح لنتيجته بتغيير session.
5. عدّل `FinalizeController` ليحلل envelope قبل إعلان النجاح، وليستخدم `try/finally` لتدمير stitcher وإنهاء job.

**معيار الخروج:** لا يبقى template `opengeo...(${...})` خارج AEBridge، ولا توجد صيغ error متعددة بين client وhost.

## P0 — صحح دورة مزامنة AE والحالة

1. اجعل `AESyncEngine` adapter لا owner: يستقبل snapshot من Session ويرسل intents debounced (100–250ms) إلى AE.
2. امنع تداخل poll عبر `pollInFlight`; أرفق generation/comp ID بكل response، وتجاهل المتأخر.
3. عند AE inbound، طبّق camera في Session بorigin=`ae` دون إعادة دفعه إلى AE؛ حدّث `App.activeCompId` أو أزله لصالح Session.
4. coalesce camera writes في AE حتى لا ينشأ Undo Group لكل pointer move؛ يمكن أيضًا تعطيل Undo group أثناء sync التقني أو تجميعه في command مدروس.
5. صل `MetadataManager.saveToComp()` بـ commits المهمة، واحفظ/حمّل metadata من الـ composition الصحيح فقط.

**معيار الخروج:** drag سريع ينتج آخر camera write فقط، وAE move يظهر في CEP بلا feedback export أو undo flood.

## P1 — وحّد tile/provider/export pipeline

1. استخرج `TileProviderResolver` واحدًا من `ProviderManager`: يتحقق من required key ويبني URL/template للمعاينة وEngine وPlanner.
2. استخرج `TileRepository` واحدًا: cache key يشمل provider/style/tileSize/z/x/y؛ retries/timeouts/cancellation موحدة.
3. اجعل Export request immutable ومقيدًا بـ `requestId`; أزل `_accumulatedTiles` أو اجعله cache داخليًا لا manifest للتصدير.
4. اختر تنفيذًا واحدًا للتصدير: إما MegaTile Finalize أو Canvas PNG، ثم احذف الآخر أو ضعه في package منفصل.
5. وحّد zoom limits مع provider capabilities، وأضف antimeridian cases و512px cases كاختبارات.

**معيار الخروج:** provider ذو API key يعمل بالمنطق نفسه في preview/auto-export/finalize، ولا يمكن أن تتسرب tiles من camera أو provider سابقين إلى request جديد.

## P1 — اعزل Finalize وموارد مشروع AE

1. أنشئ `OpenGeoDocumentId` UUID محفوظًا في composition metadata؛ استخدمه في أسماء comps/layers/folders/assets بدل الأسماء العالمية وحدها.
2. اسم MegaTiles بـ document ID + provider signature + z/x/y + sourceTileSize، واحتفظ manifest مع hash للمدخلات؛ لا تعد استخدام ملف بالحجم فقط.
3. أصلح cleanup ليستخدم الاسم المنتج فعلًا، وليحذف فقط assets التابعة لنفس document/job.
4. افصل `CompositionBuilder` في host إلى: resolver, cleanup policy, tile importer, expression installer, response serializer. حدّث fps/duration عند reuse أو ارفض التغيير بوضوح.

**معيار الخروج:** مشروع يحوي خريطتين لا يدمّر واحدة عند Finalize الأخرى، وتبديل provider لا يعيد MegaTile قديمًا.

## P1 — أصلح vector/data path

1. عرّف نوعي dataset منفصلين: `MercatorFeature {rings,...}` وGeoJSON Feature. `GeoDataRepository` يجب أن يحسب bbox من `rings` للـ dataset الداخلي أو يحفظ bbox وقت build.
2. لا تعدّل feature source بـ `_bbox`/`_searchScore`; ضع metadata في `WeakMap` أو index مستقل.
3. أضف fixtures للبحث العربي بحروف تشكيل/ألف/ة/ى؛ لا يلزم تعديل `normalizeArabic` إذ تحقق أن المصدر Unicode صحيح.
4. اجعل `VectorMapManager` service نقية نسبيًا: repository → projector → job writer → bridge. ضع `finishJob(jobId)` في finally.
5. مرر `layerName` داخل payload أو احذف argument الخادع من host API؛ أضف idempotency/deduplication للـ shape layers.

**معيار الخروج:** bbox صغير لا يرسل 241 feature عالميًا، وفشل host لا يترك files/jobs، واسم layer المطلوب يظهر في AE.

## P2 — أزل المسارات الميتة ثم أضف lifecycle واختبارات

1. قبل الحذف، أضف فحص تحميل runtime؛ ثم احذف أو فعّل: BoundaryManagerUI، DiskCache، PNGExporter، TileStitcher، LayerManager workflow، legacy AE bridge endpoints، `host/utils.jsx`, flight/bake stubs.
2. أضف `dispose()` للـ App وAESyncEngine وTileManager وInputHandler وMegaTileStitcher؛ احفظ مراجع listeners بدلاً من `.bind()` غير القابل للإزالة، وألغِ observer/timers/worker/XHR.
3. اختبارات وحدات: zoom persistence، tile URL/key، GeoData bbox، provider key، bridge envelope، cache signature.
4. اختبارات integration بمزيف CSInterface وAE responses: poll out-of-order، JSON error، active comp switch، finalize cleanup، cancellation.
5. smoke tests داخل AE: 2 maps في مشروع واحد، تغيير provider، finalization متحرك، antimeridian، reopen panel، project unsaved، وnetwork failure.

**معيار الإغلاق النهائي:** لا توجد paths legacy غير مختبرة في production؛ preview وAE وFinalize تشترك في camera/provider/tile contracts نفسها؛ وكل أخطاء host تظهر كفشل حقيقي للمستخدم لا كنجاح زائف.

# ملحق نتائج التدقيق اللاحقة

## OG-AUD-033 — سباق تعريف المزوّد مع ثبات المعرّف

**الشدة الأصلية:** P1  
**الحالة:** مغلق آليًا في 20 أغسطس 2026؛ تحقق AE-38 البصري باقٍ

كان `OperationSnapshot` يتحقق من `sourceKey` فقط. عند تغيير URL أو credentials لمزوّد `customXYZ` مع بقاء المعرّف نفسه، كان من الممكن أن تنتهي عملية بدأت بالتعريف القديم بعد التغيير وتكتب Preview أو AE assets قديمة. كما لم يكن تغيير المزوّد نفسه يضمن إلغاء تنزيلات Sync ومعاينة المسار قبل mutation، ولا يضمن إعادة بناء المعاينة إذا لم تتحرك الكاميرا.

أصبح snapshot يثبت `providerSignature` و`resolvedTemplate` و`tileSize`، وتتحقق الصلاحية منها عند كل commit. يطبق `ApplicationCoordinator` انتقالًا cancel-first: يلغي DownloadSession والتجميع والمؤقتات، يرفع أجيال Sync/Preview، ثم يغير الحالة ويطلب معاينة واحدة للتعريف الأخير. ويطبق تغيير حجم البلاطة العقد نفسه. يغطي الاختبار السلوكي تعريفين بالمعرّف نفسه، ترتيب الإلغاء قبل mutation، منع أكثر من preview واحد، وانتقالات viewport المتكررة 4→2→1 دون تراكم.

**الدليل:** `npm test` ‏107/107، و`verify:release` و`artifact:verify` ناجحة. لا يعد ذلك بديلًا عن AE-38 تحت شبكة حقيقية، لكنه يغلق العيب المعماري ومسار عودته آليًا.
