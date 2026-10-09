# منظومة القضاء على فواصل البلاطات في OpenGeo (Tile Seams Architecture)

> **مسار المجلد:** `docs/tile-seams-architecture/`  
> **تاريخ التوثيق:** 27 سبتمبر 2026  
> **الحالة المعمارية:** وثائق التشخيص والخطة التنفيذية المعتمدة (Definitive Architecture)

يحتوي هذا المجلد المخصص على كامل التوثيق البحثي المعمق والخطة الهندسية التنفيذية لحل مشكلة الخطوط الفاصلة والانزياح بين بلاطات الخرائط في Adobe After Effects، استناداً إلى تشريح محرك الرسوميات ودراسة الكود المصدري لـ GEOlayers 3 وسجل Git التاريخي:

---

### محتويات المجلد:

1. [`01_ROOT_CAUSE_RESEARCH_AR.md`](file:///c:/Program%20Files%20%28x86%29/Common%20Files/Adobe/CEP/extensions/OpenGeo/docs/tile-seams-architecture/01_ROOT_CAUSE_RESEARCH_AR.md):  
   **البحث الهندسي المعمق والتشريح الفيزيائي والرياضي للمشكلة:**
   - التتبع الدقيق لسجل Git: كيف كانت البلاطات متلاصقة تماماً في البداية (`79144cb`) ومتى ظهر الخلل عند تفعيل الـ 3D Pitch (`009db82`).
   - تشريح محرك After Effects Classic 3D وظاهرة تشقق الحواف المشتركة للمضلعات (Polygon Edge Conflation Artifact).
   - التحليل الرياضي لمعادلات الألفا: ثقوب الشفافية في `NORMAL` مقابل الشبكة البيضاء المشعة في `ALPHA_ADD`.
   - لغز نافذة المعاينة في الإضافة: لماذا تنعدم الفواصل كلياً في الـ CEF Canvas بينما تظهر في After Effects.
   - **الكشف المعماري لـ GEOlayers 3:** دراسة كود `main.js` واكتشاف دمج البلاطات في الـ Client عبر `Canvas 2D` قبل الاستيراد، وإبقاء البلاطات كطبقات 2D داخل تركيب الخريطة.

2. [`02_EXECUTION_PLAN_AR.md`](file:///c:/Program%20Files%20%28x86%29/Common%20Files/Adobe/CEP/extensions/OpenGeo/docs/tile-seams-architecture/02_EXECUTION_PLAN_AR.md):  
   **الخطة الهندسية التنفيذية الشاملة (المعمارية الثنائية):**
   - المبادئ الصارمة: تلاصق رياضي تام ($0\text{ overlap}, 0\text{ gap}$)، حظر التمديد القسري، وحظر المهاد اللونية التقديرية.
   - **الركيزة الأولى (الـ Client):** دمج البلاطات في لوحات موحدة خالية من الفواصل الداخلية عبر `MegaTileStitcher`.
   - **الركيزة الثانية (الـ Host):** إرجاع البلاطات إلى طبقات 2D مسطحة داخل `mapComp` ومعالجة الـ 3D ككتلة واحدة في التركيب الحاوي.
   - مراحل التنفيذ الخمس: فحص الـ Worker، تعديل كود الـ ExtendScript، تحديث الاختبارات، الفحص الميداني، والتنظيف الشامل للكود القديم عند النجاح.

3. [`03_FINAL_SOLUTION_AND_EDGE_GUTTER_ARCHITECTURE_AR.md`](file:///c:/Program%20Files%20%28x86%29/Common%20Files/Adobe/CEP/extensions/OpenGeo/docs/tile-seams-architecture/03_FINAL_SOLUTION_AND_EDGE_GUTTER_ARCHITECTURE_AR.md):  
   **المعمارية المعتمدة النهائية: منظومة حافة البلاطات المخبوزة (Baked Edge Gutter Architecture):**
   - الحل النهائي الدائم المعتمد في كود الإنتاج (Production Golden Reference).
   - الجمع بين توليد حافة أمان مكررة 1px مخبوزة (`extrudeCanvasGutter`) تحاكي عتاد `GL_CLAMP_TO_EDGE`، ومقياس محتوى جغرافي صارم 1:1 (`worldTileSize / contentPixelSize * 100`).
   - القضاء التام على فواصل البلاطات في الحركة والـ 3D Pitch، والقضاء التام على التشوه وازدواج المعالم (Ghosting) عند التكبير العالي 800%.
   - توثيق تكامل After Effects ونمط الدمج القياسي `NORMAL` والاختبار الآلي المعياري `TB.11`.
