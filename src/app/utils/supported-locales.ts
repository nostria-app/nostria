export interface SupportedLocale {
  code: string;
  angularCode: string;
  nativeName: string;
  englishName: string;
  fontFamily?: string;
  fontUrl?: string;
  rtl?: boolean;
}

export const SUPPORTED_LOCALES: SupportedLocale[] = [
  {
    code: 'en',
    angularCode: 'en',
    nativeName: 'English',
    englishName: 'English',
  },
  {
    code: 'ar',
    angularCode: 'ar',
    nativeName: 'العربية',
    englishName: 'Arabic',
    fontFamily: 'Noto Sans Arabic',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@100..900&display=swap',
    rtl: true,
  },
  {
    code: 'cnr',
    angularCode: 'sr-Latn',
    nativeName: 'Crnogorski',
    englishName: 'Montenegrin',
  },
  {
    code: 'de',
    angularCode: 'de',
    nativeName: 'Deutsch',
    englishName: 'German',
  },
  {
    code: 'es',
    angularCode: 'es',
    nativeName: 'Español',
    englishName: 'Spanish',
  },
  {
    code: 'fa',
    angularCode: 'fa',
    nativeName: 'فارسی',
    englishName: 'Persian',
    fontFamily: 'Vazirmatn',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Vazirmatn:wght@100..900&display=swap',
    rtl: true,
  },
  {
    code: 'fr',
    angularCode: 'fr',
    nativeName: 'Français',
    englishName: 'French',
  },
  {
    code: 'hi',
    angularCode: 'hi',
    nativeName: 'हिन्दी',
    englishName: 'Hindi',
    fontFamily: 'Noto Sans Devanagari',
    fontUrl:
      'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@100..900&display=swap',
  },
  {
    code: 'id',
    angularCode: 'id',
    nativeName: 'Bahasa Indonesia',
    englishName: 'Indonesian',
  },
  {
    code: 'it',
    angularCode: 'it',
    nativeName: 'Italiano',
    englishName: 'Italian',
  },
  {
    code: 'ja',
    angularCode: 'ja',
    nativeName: '日本語',
    englishName: 'Japanese',
    fontFamily: 'Noto Sans JP',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&display=swap',
  },
  {
    code: 'ko',
    angularCode: 'ko',
    nativeName: '한국어',
    englishName: 'Korean',
    fontFamily: 'Noto Sans KR',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@100..900&display=swap',
  },
  {
    code: 'no',
    angularCode: 'nb',
    nativeName: 'Norsk',
    englishName: 'Norwegian',
  },
  {
    code: 'pt',
    angularCode: 'pt',
    nativeName: 'Português',
    englishName: 'Portuguese',
  },
  {
    code: 'ru',
    angularCode: 'ru',
    nativeName: 'Русский',
    englishName: 'Russian',
  },
  {
    code: 'th',
    angularCode: 'th',
    nativeName: 'ไทย',
    englishName: 'Thai',
    fontFamily: 'Noto Sans Thai',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@100..900&display=swap',
  },
  {
    code: 'tr',
    angularCode: 'tr',
    nativeName: 'Türkçe',
    englishName: 'Turkish',
  },
  {
    code: 'vi',
    angularCode: 'vi',
    nativeName: 'Tiếng Việt',
    englishName: 'Vietnamese',
  },
  {
    code: 'sw',
    angularCode: 'sw',
    nativeName: 'Kiswahili',
    englishName: 'Swahili',
  },
  {
    code: 'zh',
    angularCode: 'zh',
    nativeName: '中文',
    englishName: 'Chinese',
    fontFamily: 'Noto Sans SC',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@100..900&display=swap',
  },
  {
    code: 'zu',
    angularCode: 'zu',
    nativeName: 'isiZulu',
    englishName: 'Zulu',
  },
];

export const SUPPORTED_LOCALE_LABELS = SUPPORTED_LOCALES.map((locale) => ({
  code: locale.code,
  name: locale.nativeName,
  displayName:
    locale.nativeName === locale.englishName
      ? locale.nativeName
      : `${locale.nativeName} (${locale.englishName})`,
}));

const SUPPORTED_LOCALE_MAP = new Map(SUPPORTED_LOCALES.map((locale) => [locale.code, locale]));

const LOCALE_ALIASES = new Map<string, string>([
  ['en-us', 'en'],
  ['en-gb', 'en'],
  ['nb', 'no'],
  ['nb-no', 'no'],
  ['no-no', 'no'],
  ['pt-br', 'pt'],
  ['pt-pt', 'pt'],
  ['zh-cn', 'zh'],
  ['zh-hans', 'zh'],
  ['zh-sg', 'zh'],
  ['zh-tw', 'zh'],
  ['zh-hk', 'zh'],
  ['zh-hant', 'zh'],
]);

export function getSupportedLocale(localeCode: string): SupportedLocale | undefined {
  return SUPPORTED_LOCALE_MAP.get(localeCode.trim().toLowerCase());
}

function coerceLocaleCode(localeCode: string | null | undefined): string {
  return localeCode?.trim().toLowerCase().replace(/_/g, '-') ?? '';
}

export function normalizeLocale(localeCode: string | null | undefined): string {
  const normalizedCode = coerceLocaleCode(localeCode);

  if (!normalizedCode) {
    return 'en';
  }

  const alias = LOCALE_ALIASES.get(normalizedCode);
  if (alias) {
    return alias;
  }

  const directMatch = getSupportedLocale(normalizedCode);
  if (directMatch) {
    return directMatch.code;
  }

  const primaryLanguage = normalizedCode.split('-')[0];
  return getSupportedLocale(primaryLanguage)?.code ?? 'en';
}

export function getAngularLocaleCode(localeCode: string | null | undefined): string {
  return getSupportedLocale(normalizeLocale(localeCode))?.angularCode ?? 'en';
}

export function detectPreferredLocale(localeCodes: Iterable<string | null | undefined>): string {
  for (const localeCode of localeCodes) {
    const normalizedCode = coerceLocaleCode(localeCode);
    if (!normalizedCode) {
      continue;
    }

    const alias = LOCALE_ALIASES.get(normalizedCode);
    if (alias) {
      return alias;
    }

    const directMatch = getSupportedLocale(normalizedCode);
    if (directMatch) {
      return directMatch.code;
    }

    const primaryLanguage = normalizedCode.split('-')[0];
    const primaryMatch = getSupportedLocale(primaryLanguage);
    if (primaryMatch) {
      return primaryMatch.code;
    }
  }

  return 'en';
}
