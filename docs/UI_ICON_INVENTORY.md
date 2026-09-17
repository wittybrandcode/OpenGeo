# جرد شامل لكافة أيقونات وعناصر واجهة OpenGeo (UI Icon Master Inventory)

هذا المستند هو الجرد الكامل والشامل لكل أيقونة وزر ورمز مستخدم في واجهة إضافة OpenGeo (64 موضعاً للأيقونات). يمكنك مراجعة الجدول وكتابة اسم الأيقونة التي تختارها في العمود الأخير (**اسم الأيقونة المختار**)، وسنقوم بتطبيقها بدقة في الكود.

---

## 🧭 جدول الجرد العام للأيقونات (Icon Inventory Table)

### 1. شريط الأدوات العلوي (Top Header Toolbar)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-01` | `client/index.html` #header-brand | شعار OpenGeo في الترويسة | `assets/logos/opengeo-logo.svg` | هوية الإضافة والبراند في الأعلى | |
| `ICON-02` | `client/index.html` #zoom-in | زر تكبير الخريطة (Zoom In) | `zoom-in` | تكبير مستوى زووم الخريطة بمقدار +1 | |
| `ICON-03` | `client/index.html` #zoom-out | زر تصغير الخريطة (Zoom Out) | `zoom-out` | تصغير مستوى زووم الخريطة بمقدار -1 | |
| `ICON-04` | `client/index.html` #provider-status-dot | نقطة حالة المزود (Status Dot) | *CSS Beacon Dot* | إشارة حالة اتصال مزود الخرائط أونلاين/أوفلاين | |
| `ICON-05` | `client/index.html` #provider-settings-btn | زر إعدادات المزود ومفاتيح API | `settings` | فتح نافذة ضبط مفاتيح المزودين ومسار XYZ | |
| `ICON-06` | `client/index.html` #preview-mode-btn | زر نمط الفكتور غير المتصل | `map` | التبديل بين خريطة الصور ونمط الفكتور المحلي | |
| `ICON-07` | `client/index.html` #finalize-btn | زر التثبيت النهائي (Finalize) | *Inline SVG: Stacked Layers + Sparkle* | بدء تنزيل البلاطات فائقة الدقة وبناء التركيبة في AE | |

---

### 2. شريط بيانات الموقع الجغرافي (Sub-Header Geo Location HUD)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-08` | `client/index.html` .location-hud-icon | أيقونة المكان الجغرافي النشط | `map-pin` | إشارة إلى اسم المدينة/الدولة الحالية في الرؤية | |
| `ICON-09` | `client/index.html` #map-compass | مؤشر بوصلة الشمال (Compass) | `.compass-needle` + 'N' | توجيه الشمال والضغط لإعادة ضبط التوجيه | |
| `ICON-10` | `client/index.html` #center-btn | زر محاذاة / توسيط الخريطة | `locate-fixed` | إعادة ضبط العرض ومحاذاة الرؤية بدقة | |

---

### 3. شريط البحث والتعرف التلقائي على الروابط (Search & Universal Geo Target)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-11` | `client/index.html` .search-icon | أيقونة حقل البحث الرئيسية | `search` | مؤشر حقل البحث عن الأماكن والإحداثيات | |
| `ICON-12` | `client/index.html` #search-clear-btn | زر تفريغ البحث (Clear Search) | `x` | مسح النص المكتوب في حقل البحث | |
| `ICON-13` | `client/index.html` #search-paste-btn | زر اللصق من الحافظة (Paste) | `clipboard-paste` | لصق روابط خرائط جوجل/أوبن ستريت مباشرة | |
| `ICON-14` | `client/index.html` .detected-service-tag | وسم الخدمة المكتشفة تلقائياً | `map-pin` | وسم خدمة الخرائط الملصقة (مثل Google Maps) | |
| `ICON-15` | `client/index.html` #detected-jump-btn | زر القفز للهدف المكتشف | `navigation` | الانتقال الفوري لموقع الرابط الملصق | |
| `ICON-16` | `client/index.html` #detected-pin-btn | زر تثبيت دبوس للهدف المكتشف | `plus` | إنشاء Spatial Pin فوري للموقع الملصق | |
| `ICON-17` | `client/index.html` #search-close-btn | زر إغلاق نتائج البحث | `x` | طي قائمة نتائج البحث المنسدلة | |

---

### 4. أزرار إجراءات نتائج البحث المنسدلة (Search Results Row Actions)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-18` | `client/js/ui/SearchPanel.js:532` | زر القفز للنتيجة المحددة | `crosshair` | تمركز الخريطة فوق نتيجة البحث المختارة | |
| `ICON-19` | `client/js/ui/SearchPanel.js:537` | زر إسقاط دبوس مكاني (Drop Pin) | `map-pin` | إضافة ماركر فوري عند إحداثيات النتيجة | |
| `ICON-20` | `client/js/ui/SearchPanel.js:549` | زر رسم حدود الدولة (Draw Borders) | `pen-tool` | رسم حدود الدولة والساحل بدقة 10 أمتار في AE | |

---

### 5. الشريط السفلي لإدارة المشروع والحركة (Bottom Action Bar)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-21` | `client/index.html` #create-comp-btn | زر إنشاء خريطة جديدة (New Comp) | `plus` | فتح نافذة إعدادات خريطة ومقاسات جديدة | |
| `ICON-22` | `client/index.html` #project-maps-btn | زر معرض خرائط المشروع (Maps) | `layout-grid` | فتح معرض الخرائط المسجلة في مشروع AE | |
| `ICON-23` | `client/index.html` #keyframe-add-btn | زر إضافة كي فريم (Add Key) | `diamond` | تسجيل كي فريم يدوي للكاميرا في التايم لاين | |
| `ICON-24` | `client/index.html` #keyframe-record-btn | زر تسجيل الحركة التلقائي (Record) | `circle` | تسجيل مستمر لحركة الماوس على التايم لاين | |
| `ICON-25` | `client/index.html` #pin-btn | زر إضافة دبوس مكاني (Add Pin) | `map-pin` | فتح نافذة تخصيص الدبوس المكاني ثلاثي الأبعاد | |
| `ICON-26` | `client/index.html` #load-geojson-btn | زر استيراد بيانات GeoJSON | `file-json` | استيراد ملفات المتجهات والحدود الجغرافية | |
| `ICON-27` | `client/index.html` #feature-layers-btn | زر لوحة طبقات المتجهات (Layers) | `list-tree` | فتح لوحة إدارة الطبقات الجغرافية في التركيبة | |
| `ICON-28` | `client/index.html` #clear-markers-btn | زر تفريغ الماركرات (Clear) | `trash-2` | مسح الماركرات والدبابيس المؤقتة من المعاينة | |

---

### 6. درج طبقات المتجهات الجغرافية (Vector Maps Drawer)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-29` | `client/index.html` #feature-layers-close | زر إغلاق درج الطبقات | `x` | إغلاق وطي لوحة الطبقات الجانبية | |
| `ICON-30` | `client/js/ui/LayersPanel.js:39` | زر إظهار/إخفاء الطبقة | `eye` / `eye-off` | التحكم في رؤية الطبقة داخل المعاينة و AE | |
| `ICON-31` | `client/js/ui/LayersPanel.js:49` | زر التركيز على الطبقة | `crosshair` | عمل زووم وتوسيط على حدود الطبقة الجغرافية | |
| `ICON-32` | `client/js/ui/LayersPanel.js:52` | زر رفع الطبقة ورسمها في AE | `upload-cloud` | رسم متجهات المعاينة داخل تركيبة After Effects | |
| `ICON-33` | `client/js/ui/LayersPanel.js:56` | زر حذف الطبقة | `trash-2` | حذف طبقة المتجهات نهائياً من المشروع | |

---

### 7. شاشة مراقبة التنزيل والتثبيت (Download & Finalize Telemetry HUD)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-34` | `client/index.html` #dl-icon | أيقونة نافذة التنزيل الرئيسية | `cloud-download` | إشارة إلى مرحلة سحب البلاطات من السيرفر | |
| `ICON-35` | `client/index.html` #dl-resolution-chip | شريحة معلومات الدقة والريزوليوشن | `monitor` | توضيح أبعاد الصورة النهائية (مثل 1920×1080) | |
| `ICON-36` | `client/index.html` #dl-transferred-chip | شريحة حجم البيانات المنقولة | `arrow-down-circle` | عداد الميجابايت المستلمة لحظة بلحظة | |

---

### 8. نافذة معرض خرائط المشروع (Project Maps Modal)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-37` | `client/index.html` #project-maps-refresh | زر تحديث قائمة الخرائط | `refresh-cw` | إعادة فحص تراكيب الخرائط النشطة في AE | |
| `ICON-38` | `client/index.html` #project-maps-close | زر إغلاق نافذة المعرض | `x` | إغلاق نافذة خرائط المشروع | |
| `ICON-39` | `client/js/ui/ProjectMapsPanel.js:249` | زر التقاط صورة الغلاف (Thumbnail) | `camera` | التقاط فريم المعاينة وتعيينه كغلاف للخريطة | |
| `ICON-40` | `client/js/ui/ProjectMapsPanel.js:108` | الأيقونة البديلة لغلاف الخريطة | `camera` | تظهر عند عدم وجود غلاف مصغر محفوظ | |
| `ICON-41` | `client/js/ui/ProjectMapsPanel.js:427` | أيقونة حالة المعرض الفارغ | `map` | تظهر عند عدم وجود خرائط مسجلة في المشروع | |

---

### 9. نافذة الحوار والتأكيد الشاملة (OpenGeo Confirmation & Prompt Dialog)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-42` | `client/index.html` .opengeo-dialog-symbol | شارة الحوار الافتراضية | `sparkles` | رمز رسائل الإرشاد والمدخلات العامة | |
| `ICON-43` | `client/js/ui/DialogManager.js:68` | شارة الحوار في حالة النجاح | `check-circle` | رمز رسائل اكتمال العمليات بنجاح | |
| `ICON-44` | `client/index.html` #opengeo-dialog-close | زر إغلاق نافذة الحوار | `x` | إلغاء الحوار وإغلاق النافذة | |

---

### 10. نافذة إعدادات التركيبة الجديدة (New Composition Settings Modal)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-45` | `client/index.html` .comp-modal-icon-badge | شارة ترويسة نافذة التركيبة | *Inline SVG: 3D Layers* | رمز ترويسة إعدادات الكومبوزيشن | |
| `ICON-46` | `client/index.html` #comp-settings-close | زر إغلاق نافذة التركيبة | `x` | إغلاق نافذة إعداد التركيبة | |
| `ICON-47` | `client/index.html` .comp-input-icon | أيقونة حقل اسم الخريطة | `map-pin` | توضيح مدخل اسم الخريطة / الكومب | |
| `ICON-48` | `client/index.html` #comp-name-mode | زر مزامنة الاسم مع مشروع AE | `map` (أو `folder` في نمط المشروع) | التبديل بين الاسم التلقائي واسم مشروع AE | |
| `ICON-49` | `client/index.html` .comp-select-arrow (1) | سهم قائمة المقاسات الجاهزة | `chevron-down` | فتح قائمة القوالب (HD, 4K, Reel, Square) | |
| `ICON-50` | `client/index.html` .comp-dim-link-icon | أيقونة ربط نسبة العرض للارتفاع | `link` | توضيح قفل نسبة الأبعاد (Aspect Ratio Lock) | |
| `ICON-51` | `client/index.html` .comp-select-arrow (2) | سهم قائمة معدل الإطارات (FPS) | `chevron-down` | فتح قائمة معدلات الإطارات (24, 25, 30, 60) | |
| `ICON-52` | `client/index.html` #comp-settings-create | زر إنشاء التركيبة (Create Comp) | `plus` | اعتماد وإنشاء كومبوزيشن الكاميرا في AE | |

---

### 11. نافذة إعدادات المزود ومفاتيح API (Provider Settings Modal)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-53` | `client/index.html` #provider-settings-close | زر إغلاق نافذة الإعدادات | `x` | إغلاق نافذة إعدادات المزودين ومفاتيح API | |

---

### 12. نافذة إضافة الدبوس المكاني (Add Spatial Pin Modal)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-54` | `client/index.html` #spatial-pin-modal (Header) | أيقونة ترويسة نافذة الدبوس | `map-pin` | إشارة إلى نافذة الـ 3D Spatial Pin | |
| `ICON-55` | `client/index.html` #pin-modal-close | زر إغلاق نافذة الدبوس | `x` | إغلاق نافذة تخصيص الدبوس المكاني | |
| `ICON-56` | `client/index.html` #pin-modal-create | زر إنشاء الدبوس في AE | `plus` | توليد طبقة الـ Null Tracker في After Effects | |

---

### 13. رسائل الإشعارات السريعة (Toast Notification System)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-57` | `client/js/ui/Toast.js:18` (Success) | إشعار النجاح (Toast Success) | `circle-check` | تأكيد إتمام العمليات بنجاح | |
| `ICON-58` | `client/js/ui/Toast.js:18` (Error) | إشعار الخطأ (Toast Error) | `circle-alert` | تنبيه بحدوث خطأ أو فشل اتصال | |
| `ICON-59` | `client/js/ui/Toast.js:18` (Warning) | إشعار التحذير (Toast Warning) | `triangle-alert` | تحذير بعدم حفظ المشروع أو تجاوز الحدود | |
| `ICON-60` | `client/js/ui/Toast.js:18` (Info) | إشعار المعلومات (Toast Info) | `info` | إشعارات الحالة العامة والإرشادية | |

---

### 14. لوحة المعاينة والتأطير (Framing HUD & Markers)
| المعرف (ID) | الموضع والملف (Location) | الزر / العنصر (Element) | الأيقونة الحالية (Current Icon) | الوظيفة والغرض (Function) | اسم الأيقونة المختار (Your Choice) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ICON-61` | `client/index.html` #framing-badge | شارة أبعاد التأطير (Framing Badge) | *Text Badge (16:9 • 1920×1080)* | إظهار دقة ونسبة تأطير الكومبوزيشن | |
| `ICON-62` | `client/js/overlays/MarkerLayer.js` | دبوس المعاينة على الخريطة | *SVG Pin Graphic* | وسم الإحداثيات على لوحة المعاينة | |
| `ICON-63` | `client/js/ui/InputHandler.js` (Cursor) | مؤشر الماوس للتجول والسحب | *Grab / Grabbing Cursor* | إيماءة سحب وتحريك الخريطة | |
| `ICON-64` | `client/index.html` #splash-logo | شعار شاشة البداية (Splash Screen) | `assets/logos/opengeo-logo.svg` | شعار البداية عند تشغيل الإضافة | |
