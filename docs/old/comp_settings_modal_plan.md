# إصلاح دورة حياة الكومبوزيشن + نافذة إعدادات الكومبوزيشن الاحترافية

> **المستند:** خطة تنفيذ مراجعة ومصوبة — نسخة 2.0
> **النطاق:** إصلاح أخطاء حرجة في إدارة حالة الكومبوزيشن + بناء نافذة Modal احترافية

---

## 1. التحليل الجذري للأخطاء (Root Cause Analysis)

### 1.1 الخطأ الأول: فقدان مُعرّف الكومبوزيشن (activeCompId)

**العَرَض:** عند الضغط على "Keyframe" تظهر رسالة "No active comp!".

**السبب الجذري:** أثناء إعادة هيكلة دالة `_exportToAE` في التحديث السابق، تم حذف
السطر الذي يحفظ مُعرّف الكومبوزيشن بعد إنشائها بنجاح.

**الدليل:**

```javascript
// ❌ الكود الحالي في app.js سطر 393-398 — لا يوجد حفظ لـ activeCompId:
if (parsed.error) {
    globalEventBus.emit('ui:status', { message: `AE error: ${parsed.error}`, isError: true });
} else {
    if (!quiet) globalEventBus.emit('ui:status', { message: `Success: ...` });
    if (!quiet) globalEventBus.emit('toast:show', { message: 'AE Composition built...' });
    // ← هنا يجب أن يكون: this.activeCompId = parsed.compId || parsed.compName;
}
```

**السطر المفقود:**
```javascript
this.activeCompId = parsed.compId || parsed.compName;
```

**لماذا هذا مُدمّر:**
- بدون `activeCompId`، تفشل دالة `_addKeyframe` فوراً (سطر 589).
- بدون `activeCompId`، تفشل دالة `_finalize` فوراً (سطر 407).
- بدون `activeCompId`، تفشل دالة `opengeoGetTimelineTrajectory` لأن `ensureComp(null)` ترجع `null`.

---

### 1.2 الخطأ الثاني: إنشاء كومبوزيشن بدون تدخل المستخدم

**العَرَض:** كومبوزيشن "OpenGeo Map" تُنشأ تلقائياً في AE بمجرد فتح الإضافة أو تحريك الخريطة.

**السبب الجذري:** مزيج من عاملين:

| العامل | التفسير |
|--------|---------|
| **`_queueAutoExport`** لا يتحقق من وجود `activeCompId` | بعد إزالة flag `autoSync` في التحديث السابق، أصبح `_queueAutoExport` يُنادى دائماً عند كل تغيير في الـ viewport (سطر 139). ولأنه يمرر `!this.activeCompId` كـ `createIfNeeded`، فإنه سينشئ كومبوزيشن جديدة في كل مرة! |
| **`viewport:changed` → `_queueAutoExport`** | الحدث `viewport:changed` يُطلق عند كل حركة في الخريطة (سحب، زوم)، مما يعني أن أي حركة ستطلق محاولة إنشاء كومبوزيشن. |

**السطر المسبب (app.js سطر 135-140):**
```javascript
globalEventBus.on('viewport:changed', () => {
    this._triggerTileUpdate();
    this._updateUIInfo();
    this._savePrefs();
    this._queueAutoExport();  // ← يُنادى مع كل حركة!
});
```

**و`_queueAutoExport` (سطر 299-302):**
```javascript
_queueAutoExport() {
    clearTimeout(this.exportTimer);
    this.exportTimer = setTimeout(() => this._exportToAE(!this.activeCompId, true), 700);
    // !this.activeCompId = true عندما لا توجد كومبوزيشن = createIfNeeded = true!
}
```

**الحل الصحيح:**
`_queueAutoExport` يجب أن **لا يفعل شيئاً** إذا لم تكن هناك كومبوزيشن نشطة.
إنشاء الكومبوزيشن يجب أن يحدث **فقط** عندما يضغط المستخدم "New Comp" صراحةً.

---

### 1.3 الخطأ الثالث: المتغير `autoSync` لا يزال موجوداً

**العَرَض:** لا خطأ ظاهر، لكنه "كود ميت" (Dead Code).

**التفسير:** أثناء التنظيف في المرحلة 2، تم إزالة استخدامات `autoSync` من `_setupUI`
و`_queueAutoExport`، لكن تعريفه لا يزال موجوداً في الـ constructor (سطر 6):
```javascript
this.autoSync = false;  // ← كود ميت، لم يعد يُستخدم
```

---

## 2. نافذة إعدادات الكومبوزيشن (Comp Settings Modal)

### 2.1 لماذا هذه النافذة ضرورية؟

حالياً، القيم مكتوبة بشكل ثابت (Hard-coded) في `index.jsx`:
```javascript
var compWidth = (camera && camera.viewportWidth) || 1920;
var compHeight = (camera && camera.viewportHeight) || 1080;
var fps = 30;
var duration = 3600;  // ساعة كاملة!
```

**المشاكل:**
1. المستخدم لا يستطيع اختيار أبعاد غير 1920×1080.
2. `fps = 30` ثابت بينما مشاريع AE العربية غالباً تستخدم 25fps (PAL).
3. `duration = 3600` (ساعة!) مبالغ فيه — يستهلك ذاكرة AE بلا فائدة.
4. لا يوجد خيار 4K أو عمودي (للجوال) أو مربع (للسوشال ميديا).

### 2.2 الإعدادات المطلوبة

| الإعداد | النوع | القيم المتاحة | الافتراضي |
|---------|-------|---------------|-----------|
| **Preset** | قائمة منسدلة | `1920×1080 (HD)`, `3840×2160 (4K)`, `1080×1920 (Vertical)`, `1080×1080 (Square)`, `Custom` | HD |
| **Width** | حقل رقمي | 100–7680 | 1920 |
| **Height** | حقل رقمي | 100–4320 | 1080 |
| **Frame Rate** | قائمة منسدلة | `23.976`, `24`, `25`, `29.97`, `30`, `50`, `60` | 30 |
| **Duration** | حقل رقمي (ثوانٍ) | 1–3600 | 30 |

### 2.3 تصميم الواجهة

```
┌──────────────────────────────────────────────────┐
│          New Composition                     [×] │
│──────────────────────────────────────────────────│
│                                                  │
│  Preset    [  1920×1080 (HD)             ▼ ]     │
│                                                  │
│  Width     [ 1920 ] px    Height  [ 1080 ] px    │
│                                                  │
│  Frame Rate   [  30          ▼ ]  fps            │
│                                                  │
│  Duration     [  30              ]  seconds       │
│                                                  │
│──────────────────────────────────────────────────│
│                         [ Cancel ]  [ Create ]   │
└──────────────────────────────────────────────────┘
```

### 2.4 سلوك الـ Preset

عند تغيير الـ Preset:
- يتم تعبئة Width و Height تلقائياً.
- إذا اختار المستخدم "Custom"، تبقى الحقول فارغة ليكتب فيها.
- إذا عدّل المستخدم Width أو Height يدوياً بعد اختيار Preset، يتحول الـ Preset تلقائياً إلى "Custom".

### 2.5 حفظ الإعدادات (LocalStorage)

آخر إعدادات يختارها المستخدم تُحفظ في `localStorage` تحت المفتاح `opengeo_comp_settings`:
```json
{
    "preset": "hd",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "duration": 30
}
```
عند فتح الـ Modal مرة أخرى، تُستعاد هذه القيم تلقائياً.

---

## 3. تدفق البيانات الكامل (Data Flow)

```
المستخدم يضغط "New Comp"
         │
         ▼
Modal تظهر مع آخر إعدادات محفوظة
         │
         ▼
المستخدم يختار الإعدادات ويضغط "Create"
         │
         ▼
compSettings = { width, height, fps, duration }
         │
         ├──► حفظ في localStorage
         │
         ├──► تحديث mapState.setCompSize(width, height)
         │
         ├──► تحديث mapState.compFps = fps
         │
         └──► استدعاء _exportToAE(true, false, false, compSettings)
                    │
                    ▼
              الـ payload يحتوي على:
              {
                  tiles: [...],
                  camera: {...},
                  compSettings: { width, height, fps, duration }
              }
                    │
                    ▼
              opengeoBuildComposition في index.jsx
                    │
                    ▼
              var compWidth = data.compSettings ? data.compSettings.width : 1920;
              var compHeight = data.compSettings ? data.compSettings.height : 1080;
              var fps = data.compSettings ? data.compSettings.fps : 30;
              var duration = data.compSettings ? data.compSettings.duration : 30;
                    │
                    ▼
              app.project.items.addComp("OpenGeo Map", compWidth, compHeight, 1, duration, fps);
                    │
                    ▼
              النتيجة تُرسل ← app.js يحفظ this.activeCompId ← syncEngine يبدأ
```

---

## 4. خريطة الملفات المتأثرة

| الملف | التعديل | الأولوية |
|-------|---------|---------|
| `client/js/app.js` | 🔴 إرجاع `this.activeCompId = ...` + حماية `_queueAutoExport` + إضافة Modal logic + إضافة `compSettings` + إزالة `autoSync` | حرج |
| `client/index.html` | 🟡 إضافة HTML للـ Modal | متوسط |
| `client/css/style.css` | 🟡 إضافة تنسيقات Modal (Glassmorphism) | متوسط |
| `host/index.jsx` | 🟡 قراءة `data.compSettings` بدلاً من القيم الثابتة | متوسط |
| `client/js/MapState.js` | 🟢 إضافة `compFps` و `compDuration` (اختياري) | منخفض |

---

## 5. خطة التنفيذ خطوة بخطوة

### المرحلة 1: إصلاح الأخطاء الحرجة (Critical Bug Fixes) 🔴

- [x] **1.1** إرجاع السطر `this.activeCompId = parsed.compId || parsed.compName;` بعد نجاح `opengeoBuildComposition` في `app.js`.
- [x] **1.2** تعديل `_queueAutoExport` لتتحقق من `this.activeCompId` قبل أي شيء — إذا لم تكن هناك كومبوزيشن، لا تفعل شيئاً.
- [x] **1.3** إزالة `this.autoSync = false;` من الـ constructor (كود ميت).

### المرحلة 2: بناء واجهة الـ Modal (UI) 🟡

- [x] **2.1** إضافة HTML للـ Modal (`comp-settings-modal`) في `index.html` قبل `</body>`.
- [x] **2.2** إضافة تنسيقات CSS الاحترافية في `style.css`:
  - خلفية شفافة مع تأثير Blur (Glassmorphism).
  - انتقال ظهور ناعم (fadeIn/scaleUp).
  - حقول إدخال متناسقة مع تصميم الإضافة الداكن.
  - زر "Create" مميز باللون الأخضر (مثل Finalize).

### المرحلة 3: ربط المنطق البرمجي (App Logic) 🟡

- [x] **3.1** تعديل زر "New Comp" ليفتح الـ Modal بدلاً من الإنشاء المباشر.
- [x] **3.2** برمجة منطق الـ Preset (تغيير القائمة → تعبئة Width/Height).
- [x] **3.3** برمجة الكشف التلقائي عن Custom (تعديل Width أو Height يدوياً → Preset = Custom).
- [x] **3.4** ربط زر "Create" بجمع القيم وحفظها في localStorage واستدعاء `_exportToAE`.
- [x] **3.5** ربط زر "Cancel" ومفتاح Escape بإغلاق الـ Modal.
- [x] **3.6** تعديل `_exportToAE` لقبول `compSettings` وتمريرها في `payload`.
- [x] **3.7** تحديث `mapState.setCompSize(width, height)` عند الإنشاء.

### المرحلة 4: تعديل محرك After Effects (ExtendScript) 🟡

- [x] **4.1** تعديل `opengeoBuildComposition` في `index.jsx` لقراءة `data.compSettings`.
- [x] **4.2** استخدام القيم الجديدة (`width`, `height`, `fps`, `duration`) في `addComp`.
- [x] **4.3** التأكد من أن القيم الافتراضية تعمل إذا لم يتم تمرير `compSettings` (للتوافق مع Auto-Sync).

---

## 6. التحقق والاختبار

| السيناريو | النتيجة المتوقعة |
|-----------|-----------------|
| فتح الإضافة وتحريك الخريطة بدون ضغط "New Comp" | **لا تُنشأ أي كومبوزيشن** |
| ضغط "New Comp" | يظهر الـ Modal بالإعدادات الافتراضية |
| اختيار "4K" من Preset | Width=3840, Height=2160 يتعبأان تلقائياً |
| تعديل Width يدوياً | Preset يتحول إلى "Custom" |
| ضغط "Create" | الكومبوزيشن تُنشأ بالأبعاد المحددة |
| ضغط "Keyframe" بعد الإنشاء | يُضاف كايفريم بنجاح (بدون خطأ "No active comp") |
| إغلاق الإضافة وإعادة فتحها ثم ضغط "New Comp" | الـ Modal يعرض آخر إعدادات مستخدمة |
| ضغط "Finalize" بعد الإنشاء | يعمل بنجاح (بدون خطأ "No active comp") |
