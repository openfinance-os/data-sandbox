// Arabic / RTL i18n foundation — D-10 (amended v0.10).
//
// Scope of this slice: parallel-text app-shell chrome (topbar + pane
// headers + first-run controls), RTL direction switching, and an optional
// Arabic-Indic numeral mode. Deeper module strings (export popover, tour,
// find-box) and bulk persona-narrative translation are follow-up slices.
//
// Leaf module by design: it imports nothing from app/ or ui/, so pure
// helpers (`t`, `toArabicIndic`, `localizeDigits`) are unit-testable without
// a DOM and `src/app/utils.js` can route `formatAmount` through the numeral
// converter without a circular import.

export const LOCALES = ['en', 'ar'];
export const DEFAULT_LOCALE = 'en';
// Language → writing direction. Drives <html dir> and the [dir="rtl"] CSS
// cascade. English stays ltr; Arabic flips to rtl.
export const DIRECTION = { en: 'ltr', ar: 'rtl' };

// Arabic-Indic digits U+0660–U+0669, indexed 0-9.
const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** Replace every ASCII digit in `str` with its Arabic-Indic counterpart. */
export function toArabicIndic(str) {
  return String(str).replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);
}

// Numeral mode is module-level so the many existing `formatAmount()` call
// sites need no signature change. 'latn' = Western 0-9 (default, identity);
// 'arab' = Arabic-Indic ٠-٩. Per D-10 the numeral mode is *independent* of
// language, so a reader can pair Arabic UI with Western digits or vice-versa.
let numeralMode = 'latn';

/** Set the active numeral mode. Anything other than 'arab' is treated as 'latn'. */
export function setNumeralMode(mode) {
  numeralMode = mode === 'arab' ? 'arab' : 'latn';
}

/** The active numeral mode ('latn' | 'arab'). */
export function getNumeralMode() {
  return numeralMode;
}

/** Localise the digits in an already-formatted string per the active numeral mode. */
export function localizeDigits(str) {
  return numeralMode === 'arab' ? toArabicIndic(str) : String(str);
}

// App-shell chrome catalog. English values MUST match the literal text in
// src/index.html exactly so re-applying the 'en' locale is a visual no-op
// (this keeps the LTR visual baselines valid). Keys are dotted by area.
export const STRINGS = {
  en: {
    'controls.lfi': 'LFI profile',
    'controls.compareWith': 'Compare with',
    'controls.seed': 'Seed',
    'controls.seedReset': 'Reset',
    'controls.language': 'Language',
    'controls.numerals': 'Numerals',
    'lfi.rich': 'Rich',
    'lfi.median': 'Median',
    'lfi.sparse': 'Sparse',
    'lfi.compare': '+ Compare',
    'topbar.find': 'Find',
    'topbar.tour': 'Tour',
    'banner.synthetic': 'SYNTHETIC',
    'menu.more': 'More',
    'menu.integrate': 'Integrate',
    'menu.about': 'About',
    'pane.personaLibrary': 'Persona library',
    'pane.navigator': 'Accounts & endpoints',
    'pane.fieldDetail': 'Field detail',
    // EXP-13 field-status badge values + legend.
    'status.mandatory': 'Mandatory',
    'status.optional': 'Optional',
    'status.conditional': 'Conditional',
    // Find box (⌘K) chrome.
    'find.placeholder': 'Search fields, paths, enums, persona names, narratives, stress coverage…',
    'find.searches': 'Searches',
    'find.corpus.fieldNames': 'Field names',
    'find.corpus.fieldPaths': 'Field paths',
    'find.corpus.enumValues': 'Enum values',
    'find.corpus.personas': 'Personas',
    'find.corpus.stressCoverage': 'Stress coverage',
    'find.clickToJump': 'Click any result to jump',
    'find.openWith': 'Open with ',
    'find.noMatches': 'No matches.',
    // Transactions filter.
    'txFilter.clear': 'Clear filters',
    // Export popover. Format names (JSON/CSV/Tarball/npm/Python/curl/MCP) and
    // the code snippets themselves stay English by design — only chrome,
    // actions, and the tarball note are localised.
    'export.title': 'Export',
    'export.close': 'Close export popover',
    'export.closeTitle': 'Close (Esc)',
    'export.formatLabel': 'Export format',
    'export.tab.permalink': 'Permalink',
    'export.tab.embed': 'Embed iframe',
    'export.downloadTarball': 'Download tarball',
    'export.tarballNote':
      'Tarball is a binary artefact — click "Download" below to save a single .tar with every endpoint + CSV for {persona} / {lfi} / seed {seed}.',
    'export.copy': 'Copy',
    'export.copyAria': 'Copy snippet to clipboard',
    'export.copiedTpl': '{label} copied.',
    'export.downloadJson': 'Download .json',
    'export.downloadCsv': 'Download .csv',
    // EXP-13/14/26 field-card facet labels + authored value prose. The facet
    // VALUES that flow from the spec/field-knowledge helpers (Real-LFI
    // guidance, concrete conditional-rule prose) stay as their source text —
    // only the left-column labels and the strings authored in this module are
    // localised.
    'fc.name': 'Name',
    'fc.path': 'Path',
    'fc.status': 'Status',
    'fc.type': 'Type',
    'fc.format': 'Format',
    'fc.enum': 'Enum',
    'fc.example': 'Example',
    'fc.conditional': 'Conditional',
    'fc.realLfis': 'Real LFIs',
    'fc.pii': 'PII',
    'fc.spec': 'Spec',
    'fc.feedback': 'Feedback',
    'fc.specLink': 'View on Nebras GitHub at pinned SHA →',
    'fc.reportLink': 'Report an issue with this field →',
    'fc.piiYes': 'Yes — under PDPL this field requires explicit data-handling controls.',
    'fc.piiNo': 'No (per the v1 PII allowlist).',
    'fc.conditionalFallback':
      'Triggered by a parent-field value — see the spec link for the exact rule.',
    // PRD §5.4 guided tour — chrome, step titles, and step bodies. Technical
    // tokens (Flags=Payroll, endpoint paths, field names) stay Latin inside
    // the prose; LFI band names reuse the lfi.* terms.
    'tour.stepOf': 'Step {n} of {total}',
    'tour.skip': 'Skip',
    'tour.back': 'Back',
    'tour.next': 'Next →',
    'tour.finish': 'Finish',
    'tour.s1.title': 'Meet Sara',
    'tour.s1.body':
      'Sara is a salaried expat in Dubai. She has two accounts: a current account where her AED 25k salary lands on the 25th, and a credit card. The persona library lets you swap her for eleven other UAE archetypes — gig worker, SME, HNW multi-currency, joint family, corporate treasury, and more.',
    'tour.s2.title': 'Watch the salary marker',
    'tour.s2.body':
      "Open the transactions endpoint on Sara's current account. Notice the monthly salary credit — it carries Flags=Payroll. That's the v2.1 spec-clean way to identify income; everything else (fallbacks, recurrence-clustering) is a workaround for LFIs that don't populate it.",
    'tour.s3.title': 'See the rent commitment',
    'tour.s3.body':
      'Switch to /standing-orders for the same account. Sara has a rent standing order that hits the 27th of every month — two days after her salary. Click that row and the sandbox jumps to the matching transactions in /transactions, with the cross-link banner offering you a way back.',
    'tour.s4.title': 'Read the field card',
    'tour.s4.body':
      "Click any field name in the rendered table to open the field card. Every field carries: a status badge (Mandatory / Optional / Conditional, derived live from the OpenAPI spec — never hand-authored), type and format, enum values, an example from the persona, a 'Real LFIs' guidance note, and a deep link to the field on the upstream Nebras GitHub at the pinned SHA.",
    'tour.s5.title': 'Sparse vs Median',
    'tour.s5.body':
      "Switch the LFI profile (top bar) to Sparse. Watch the coverage meter drop and watch optional fields like MerchantDetails / Flags / ValueDateTime / Nickname disappear. That's the Phase-1 minimum your downstream UI and decisioning logic needs to handle. Switch back to Median, then to Rich, and pick a different persona to finish — the URL updates as you go, so you can paste it into a slide deck.",
  },
  ar: {
    'controls.lfi': 'ملف المؤسسة المالية',
    'controls.compareWith': 'قارن مع',
    'controls.seed': 'البذرة',
    'controls.seedReset': 'إعادة تعيين',
    'controls.language': 'اللغة',
    'controls.numerals': 'الأرقام',
    'lfi.rich': 'وفير',
    'lfi.median': 'متوسط',
    'lfi.sparse': 'ضئيل',
    'lfi.compare': '+ مقارنة',
    'topbar.find': 'بحث',
    'topbar.tour': 'جولة',
    'banner.synthetic': 'اصطناعي',
    'menu.more': 'المزيد',
    'menu.integrate': 'التكامل',
    'menu.about': 'حول',
    'pane.personaLibrary': 'مكتبة الشخصيات',
    'pane.navigator': 'الحسابات ونقاط النهاية',
    'pane.fieldDetail': 'تفاصيل الحقل',
    // EXP-13 field-status badge values + legend.
    'status.mandatory': 'إلزامي',
    'status.optional': 'اختياري',
    'status.conditional': 'شرطي',
    // Find box (⌘K) chrome.
    'find.placeholder': 'ابحث في الحقول والمسارات والقيم وأسماء الشخصيات والسرد وتغطية الضغط…',
    'find.searches': 'نطاق البحث',
    'find.corpus.fieldNames': 'أسماء الحقول',
    'find.corpus.fieldPaths': 'مسارات الحقول',
    'find.corpus.enumValues': 'قيم التعداد',
    'find.corpus.personas': 'الشخصيات',
    'find.corpus.stressCoverage': 'تغطية الضغط',
    'find.clickToJump': 'انقر أي نتيجة للانتقال',
    'find.openWith': 'افتح بـ ',
    'find.noMatches': 'لا توجد نتائج.',
    // Transactions filter.
    'txFilter.clear': 'مسح عوامل التصفية',
    // Export popover.
    'export.title': 'تصدير',
    'export.close': 'إغلاق نافذة التصدير',
    'export.closeTitle': 'إغلاق (Esc)',
    'export.formatLabel': 'صيغة التصدير',
    'export.tab.permalink': 'رابط دائم',
    'export.tab.embed': 'تضمين iframe',
    'export.downloadTarball': 'تنزيل الأرشيف',
    'export.tarballNote':
      'الأرشيف ملف ثنائي — انقر «تنزيل» أدناه لحفظ ملف ‎.tar‎ واحد يضم كل نقاط النهاية وملف CSV للشخصية {persona} / {lfi} / البذرة {seed}.',
    'export.copy': 'نسخ',
    'export.copyAria': 'نسخ المقتطف إلى الحافظة',
    'export.copiedTpl': 'تم نسخ {label}.',
    'export.downloadJson': 'تنزيل ‎.json‎',
    'export.downloadCsv': 'تنزيل ‎.csv‎',
    // Field-card facet labels + authored value prose.
    'fc.name': 'الاسم',
    'fc.path': 'المسار',
    'fc.status': 'الحالة',
    'fc.type': 'النوع',
    'fc.format': 'الصيغة',
    'fc.enum': 'التعداد',
    'fc.example': 'مثال',
    'fc.conditional': 'الشرط',
    'fc.realLfis': 'المؤسسات المالية الفعلية',
    'fc.pii': 'بيانات شخصية',
    'fc.spec': 'المواصفة',
    'fc.feedback': 'ملاحظات',
    'fc.specLink': 'العرض على Nebras GitHub عند الـ SHA المثبّت ←',
    'fc.reportLink': 'الإبلاغ عن مشكلة في هذا الحقل ←',
    'fc.piiYes':
      'نعم — بموجب قانون حماية البيانات (PDPL) يتطلب هذا الحقل ضوابط صريحة لمعالجة البيانات.',
    'fc.piiNo': 'لا (وفقًا لقائمة PII المسموح بها في الإصدار الأول).',
    'fc.conditionalFallback': 'يُفعَّل بقيمة حقل أصلي — راجع رابط المواصفة للقاعدة الدقيقة.',
    // Guided tour.
    'tour.stepOf': 'الخطوة {n} من {total}',
    'tour.skip': 'تخطّي',
    'tour.back': 'رجوع',
    'tour.next': 'التالي ←',
    'tour.finish': 'إنهاء',
    'tour.s1.title': 'تعرّف على سارة',
    'tour.s1.body':
      'سارة وافدة تتقاضى راتبًا في دبي. لديها حسابان: حساب جارٍ يُودَع فيه راتبها البالغ 25 ألف درهم في اليوم الخامس والعشرين، وبطاقة ائتمان. تتيح لك مكتبة الشخصيات استبدالها بأحد عشر نموذجًا إماراتيًا آخر — عامل بالقطعة، منشأة صغيرة ومتوسطة، عميل ثري متعدد العملات، أسرة بحساب مشترك، خزينة شركة، وغير ذلك.',
    'tour.s2.title': 'راقب علامة الراتب',
    'tour.s2.body':
      'افتح نقطة نهاية المعاملات على حساب سارة الجاري. لاحظ القيد الدائن للراتب الشهري — يحمل Flags=Payroll. هذه هي الطريقة المتوافقة مع مواصفة v2.1 لتحديد الدخل؛ وكل ما عداها (الحلول البديلة، تجميع التكرار) هو التفاف على المؤسسات المالية التي لا تملؤه.',
    'tour.s3.title': 'اطّلع على التزام الإيجار',
    'tour.s3.body':
      'انتقل إلى /standing-orders للحساب نفسه. لدى سارة أمر دائم لدفع الإيجار يُنفَّذ في اليوم السابع والعشرين من كل شهر — بعد يومين من راتبها. انقر ذلك الصف لينتقل الصندوق إلى المعاملات المطابقة في /transactions، مع لافتة الربط البيني التي تتيح لك العودة.',
    'tour.s4.title': 'اقرأ بطاقة الحقل',
    'tour.s4.body':
      'انقر اسم أي حقل في الجدول المعروض لفتح بطاقة الحقل. يحمل كل حقل: شارة حالة (إلزامي / اختياري / شرطي، مشتقة مباشرةً من مواصفة OpenAPI — وليست مكتوبة يدويًا)، النوع والصيغة، قيم التعداد، مثالًا من الشخصية، ملاحظة إرشادية بعنوان «المؤسسات المالية الفعلية»، ورابطًا مباشرًا إلى الحقل على Nebras GitHub المصدري عند الـ SHA المثبّت.',
    'tour.s5.title': 'ضئيل مقابل متوسط',
    'tour.s5.body':
      'بدّل ملف المؤسسة المالية (الشريط العلوي) إلى «ضئيل». راقب انخفاض مقياس التغطية واختفاء الحقول الاختيارية مثل MerchantDetails / Flags / ValueDateTime / Nickname. هذا هو الحد الأدنى للمرحلة الأولى الذي يجب أن تتعامل معه واجهتك وأنظمة اتخاذ القرار لديك. ارجع إلى «متوسط»، ثم إلى «وفير»، واختر شخصية مختلفة للإنهاء — يتحدّث الرابط أثناء تنقّلك، فيمكنك لصقه في عرض تقديمي.',
  },
};

/** Look up a chrome string; falls back to the English value, then the key itself. */
export function t(key, locale = DEFAULT_LOCALE) {
  const table = STRINGS[locale] || STRINGS[DEFAULT_LOCALE];
  return table[key] ?? STRINGS[DEFAULT_LOCALE][key] ?? key;
}

/** Normalise an arbitrary string to a supported locale code. */
export function normalizeLocale(lang) {
  return LOCALES.includes(lang) ? lang : DEFAULT_LOCALE;
}

/** The writing direction for a locale ('ltr' | 'rtl'). */
export function directionFor(lang) {
  return DIRECTION[normalizeLocale(lang)];
}

/**
 * Swap the textContent of every [data-i18n] element (and attributes named in
 * [data-i18n-attr="attr:key;attr2:key2"]) to the given locale. Pure DOM walk;
 * does not touch <html> attributes — callers decide when first paint may be
 * mutated (see setDocumentLocale).
 */
export function translateChrome(doc, lang) {
  const locale = normalizeLocale(lang);
  for (const node of doc.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.getAttribute('data-i18n'), locale);
  }
  for (const node of doc.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.getAttribute('data-i18n-attr').split(';')) {
      const [attr, key] = pair.split(':').map((s) => s && s.trim());
      if (attr && key) node.setAttribute(attr, t(key, locale));
    }
  }
}

/**
 * Set <html lang> + <html dir> and the numeral mode for a document, then
 * translate the chrome. Returns the resolved locale.
 *
 * `skipChromeWhenDefault` lets the boot path leave the literal English HTML
 * untouched on first paint (so the LTR visual baselines never drift): pass
 * true on init for lang='en', false on every explicit toggle.
 */
export function setDocumentLocale(
  doc,
  { lang = DEFAULT_LOCALE, numerals = 'latn', skipChromeWhenDefault = false } = {},
) {
  const locale = normalizeLocale(lang);
  const root = doc.documentElement;
  root.lang = locale;
  root.dir = directionFor(locale);
  setNumeralMode(numerals);
  if (!(skipChromeWhenDefault && locale === DEFAULT_LOCALE)) {
    translateChrome(doc, locale);
  }
  return locale;
}
