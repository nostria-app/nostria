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
    fontUrl: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@100..900&display=swap',
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

export const SUPPORTED_LOCALE_LABELS = SUPPORTED_LOCALES.map(locale => ({
  code: locale.code,
  name: locale.nativeName,
  displayName: locale.nativeName === locale.englishName
    ? locale.nativeName
    : `${locale.nativeName} (${locale.englishName})`,
}));

export function getSupportedLocale(localeCode: string): SupportedLocale | undefined {
  return SUPPORTED_LOCALES.find(locale => locale.code === localeCode);
}

export function normalizeLocale(localeCode: string | null | undefined): string {
  if (!localeCode) {
    return 'en';
  }

  return getSupportedLocale(localeCode)?.code ?? 'en';
}

export function getAngularLocaleCode(localeCode: string | null | undefined): string {
  return getSupportedLocale(normalizeLocale(localeCode))?.angularCode ?? 'en';
}