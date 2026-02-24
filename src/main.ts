import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { registerLocaleData } from '@angular/common';
import { loadTranslations } from '@angular/localize';
import { initializeDebugUtils } from './app/utils/debug-utils';

console.log('[BOOTSTRAP] Starting application bootstrap');

let appLang = 'en'; // Default language

if (typeof window !== 'undefined') {
  const settings = localStorage.getItem('nostria-settings');

  if (settings) {
    const parsedSettings = JSON.parse(settings);
    appLang = parsedSettings.locale || 'en'; // Fallback to 'en' if locale is not set
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
  console.log(`[BOOTSTRAP] Initializing language: ${locale}`);

  if (locale === 'en') {
    // Default behavior, no changes required
    return;
  }

  try {
    // Fetch JSON translation file
    const response = await fetch(`/locale/messages.${locale}.json`);
    if (!response.ok) {
      throw new Error(`Failed to load translations for locale: ${locale}`);
    }

    const translationData = await response.json();

    // Load translations directly from JSON
    loadTranslations(translationData.translations);
    $localize.locale = locale;

    // Load required locale module based on the actual locale
    const localeModule = await getLocaleModule(locale);
    registerLocaleData(localeModule.default);
  } catch (error) {
    console.error(`[BOOTSTRAP ERROR] Failed to initialize language ${locale}:`, error);
    // Fallback to English if translation loading fails
  }
}

async function getLocaleModule(locale: string) {
  switch (locale) {
    case 'ar':
      return await import('@angular/common/locales/ar');
    // case 'cnr':
    //   return await import('@angular/common/locales/cnr');
    case 'es':
      return await import('@angular/common/locales/es');
    case 'fr':
      return await import('@angular/common/locales/fr');
    case 'it':
      return await import('@angular/common/locales/it');
    case 'fa':
      return await import('@angular/common/locales/fa');
    case 'ru':
      return await import('@angular/common/locales/ru');
    case 'no':
      return await import('@angular/common/locales/nb');
    case 'sw':
      return await import('@angular/common/locales/sw');
    case 'zu':
      return await import('@angular/common/locales/zu');
    default:
      throw new Error(`Unsupported locale: ${locale}`);
  }
}
