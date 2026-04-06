import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { registerLocaleData } from '@angular/common';
import { loadTranslations } from '@angular/localize';
import { initializeDebugUtils } from './app/utils/debug-utils';
import { getAngularLocaleCode, normalizeLocale } from './app/utils/supported-locales';

console.log('[BOOTSTRAP] Starting application bootstrap');

let appLang = 'en'; // Default language

if (typeof window !== 'undefined') {
  const settings = localStorage.getItem('nostria-settings');

  if (settings) {
    const parsedSettings = JSON.parse(settings);
    appLang = normalizeLocale(parsedSettings.locale);
  }
}

// Init provided language
initLanguage(appLang)
  .then(() => bootstrapApplication(App, appConfig))
  .then((appRef) => {
    console.log('[BOOTSTRAP] Application bootstrapped successfully');
    // Initialize debug utilities
    initializeDebugUtils(appRef);
  })
  .catch(err => {
    console.error('[BOOTSTRAP ERROR] Failed to bootstrap application', err);
  });

async function initLanguage(locale: string): Promise<void> {
  const normalizedLocale = normalizeLocale(locale);
  console.log(`[BOOTSTRAP] Initializing language: ${normalizedLocale}`);

  if (normalizedLocale === 'en') {
    // Default behavior, no changes required
    return;
  }

  try {
    // Fetch JSON translation file
    const response = await fetch(`/locale/messages.${normalizedLocale}.json`);
    if (!response.ok) {
      throw new Error(`Failed to load translations for locale: ${normalizedLocale}`);
    }

    const translationData = await response.json();

    // Load translations directly from JSON
    loadTranslations(translationData.translations);
    $localize.locale = normalizedLocale;

    // Load required locale module based on the actual locale
    const localeModule = await getLocaleModule(normalizedLocale);
    registerLocaleData(localeModule.default);
  } catch (error) {
    console.error(`[BOOTSTRAP ERROR] Failed to initialize language ${normalizedLocale}:`, error);
    // Fallback to English if translation loading fails
  }
}

async function getLocaleModule(locale: string) {
  switch (getAngularLocaleCode(locale)) {
    case 'ar':
      return await import('@angular/common/locales/ar');
    case 'de':
      return await import('@angular/common/locales/de');
    case 'es':
      return await import('@angular/common/locales/es');
    case 'fr':
      return await import('@angular/common/locales/fr');
    case 'fa':
      return await import('@angular/common/locales/fa');
    case 'hi':
      return await import('@angular/common/locales/hi');
    case 'it':
      return await import('@angular/common/locales/it');
    case 'ja':
      return await import('@angular/common/locales/ja');
    case 'ko':
      return await import('@angular/common/locales/ko');
    case 'pt':
      return await import('@angular/common/locales/pt');
    case 'ru':
      return await import('@angular/common/locales/ru');
    case 'sr-Latn':
      return await import('@angular/common/locales/sr-Latn');
    case 'nb':
      return await import('@angular/common/locales/nb');
    case 'sw':
      return await import('@angular/common/locales/sw');
    case 'zh':
      return await import('@angular/common/locales/zh');
    case 'zu':
      return await import('@angular/common/locales/zu');
    default:
      throw new Error(`Unsupported locale: ${locale}`);
  }
}
