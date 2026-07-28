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
    // Find box — dialog / input aria-labels, the close-hint connective, and
    // the empty-state suggestion line (technical tokens stay Latin).
    'find.dialogLabel': 'Find',
    'find.inputLabel': 'Find input',
    'find.closeWith': ' · close with ',
    'find.tryHint':
      'Try: TransactionType · Payroll · MerchantCategoryCode · Sara · multi_currency · expat',
    // Payload toolbar (index.html).
    'toolbar.rendered': 'Rendered',
    'toolbar.rawJson': 'Raw JSON',
    'toolbar.expandFields': 'Expand fields',
    'toolbar.piiOnly': 'PII only',
    'toolbar.export': 'Export',
    // Persona-card chrome.
    'personaCard.customBadge': 'Custom (not curated)',
    'personaCard.more': 'More about this persona',
    'personaCard.emptyFiltered':
      'No personas cover this stress term yet. Clear the filter to see the full library.',
    // Field card row labels + the two link labels (EXP-13/EXP-26).
    'fieldCard.name': 'Name',
    'fieldCard.path': 'Path',
    'fieldCard.status': 'Status',
    'fieldCard.type': 'Type',
    'fieldCard.format': 'Format',
    'fieldCard.enum': 'Enum',
    'fieldCard.example': 'Example',
    'fieldCard.conditional': 'Conditional',
    'fieldCard.realLfis': 'Real LFIs',
    'fieldCard.pii': 'PII',
    'fieldCard.spec': 'Spec',
    'fieldCard.feedback': 'Feedback',
    'fieldCard.specLink': 'View on Nebras GitHub at pinned SHA →',
    'fieldCard.reportLink': 'Report an issue with this field →',
    // Transactions filter.
    'txFilter.clear': 'Clear filters',
    'txFilter.searchPlaceholder': 'Search TransactionInformation…',
    'txFilter.searchLabel': 'Search transaction information',
    'txFilter.typeLabel': 'Transaction type',
    'txFilter.subTypeLabel': 'Transaction sub-type',
    'txFilter.debitCreditLabel': 'Debit or credit',
    'txFilter.dateFrom': 'From',
    'txFilter.dateTo': 'To',
    'txFilter.amountFromPlaceholder': 'AED ≥',
    'txFilter.amountToPlaceholder': 'AED ≤',
    'txFilter.amountFromLabel': 'Minimum amount (AED)',
    'txFilter.amountToLabel': 'Maximum amount (AED)',
    'txFilter.mcc': 'MCC',
    'txFilter.mccLabel': 'Merchant category code (MCC)',
    'txFilter.humanDates': 'Humanise dates',
    'txFilter.showEnriched': 'Show enriched',
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
    // Find box — dialog / input aria-labels, the close-hint connective, and
    // the empty-state suggestion line (technical tokens stay Latin).
    'find.dialogLabel': 'بحث',
    'find.inputLabel': 'حقل البحث',
    'find.closeWith': ' · أغلق بـ ',
    'find.tryHint':
      'جرّب: TransactionType · Payroll · MerchantCategoryCode · سارة · multi_currency · expat',
    // Payload toolbar (index.html).
    'toolbar.rendered': 'منسّق',
    'toolbar.rawJson': 'JSON خام',
    'toolbar.expandFields': 'توسيع الحقول',
    'toolbar.piiOnly': 'البيانات الشخصية فقط',
    'toolbar.export': 'تصدير',
    // Persona-card chrome.
    'personaCard.customBadge': 'مخصّص (غير منسّق)',
    'personaCard.more': 'المزيد عن هذه الشخصية',
    'personaCard.emptyFiltered':
      'لا توجد شخصيات تغطي مصطلح الضغط هذا بعد. امسح عامل التصفية لعرض المكتبة الكاملة.',
    // Field card row labels + the two link labels (EXP-13/EXP-26).
    'fieldCard.name': 'الاسم',
    'fieldCard.path': 'المسار',
    'fieldCard.status': 'الحالة',
    'fieldCard.type': 'النوع',
    'fieldCard.format': 'التنسيق',
    'fieldCard.enum': 'التعداد',
    'fieldCard.example': 'مثال',
    'fieldCard.conditional': 'الشرط',
    'fieldCard.realLfis': 'المؤسسات المالية الفعلية',
    'fieldCard.pii': 'البيانات الشخصية',
    'fieldCard.spec': 'المواصفة',
    'fieldCard.feedback': 'ملاحظات',
    'fieldCard.specLink': 'العرض على GitHub الخاص بـ Nebras عند الإصدار المثبّت ←',
    'fieldCard.reportLink': 'الإبلاغ عن مشكلة في هذا الحقل ←',
    // Transactions filter.
    'txFilter.clear': 'مسح عوامل التصفية',
    'txFilter.searchPlaceholder': 'ابحث في TransactionInformation…',
    'txFilter.searchLabel': 'البحث في معلومات المعاملة',
    'txFilter.typeLabel': 'نوع المعاملة',
    'txFilter.subTypeLabel': 'النوع الفرعي للمعاملة',
    'txFilter.debitCreditLabel': 'مدين أو دائن',
    'txFilter.dateFrom': 'من',
    'txFilter.dateTo': 'إلى',
    'txFilter.amountFromPlaceholder': 'AED ≥',
    'txFilter.amountToPlaceholder': 'AED ≤',
    'txFilter.amountFromLabel': 'الحد الأدنى للمبلغ (درهم)',
    'txFilter.amountToLabel': 'الحد الأقصى للمبلغ (درهم)',
    'txFilter.mcc': 'MCC',
    'txFilter.mccLabel': 'رمز فئة التاجر (MCC)',
    'txFilter.humanDates': 'تنسيق التواريخ',
    'txFilter.showEnriched': 'عرض البيانات المُثراة',
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
