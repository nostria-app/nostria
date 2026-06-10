import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const localeDir = path.join(workspaceRoot, 'src', 'locale');
const supportedLocalesFile = path.join(
  workspaceRoot,
  'src',
  'app',
  'utils',
  'supported-locales.ts',
);
const sourceMessagesPath = path.join(localeDir, 'messages.json');

const translateTargetMap = {
  cnr: 'sr',
  no: 'no',
};

const args = new Set(process.argv.slice(2));
const requestedLocalesArg = process.argv.find((arg) => arg.startsWith('--locales='));
const shouldTranslate = args.has('--translate');
const batchSize = 75;

const sourceMessages = JSON.parse(await readFile(sourceMessagesPath, 'utf8'));
const sourceTranslations = sourceMessages.translations ?? {};
const sourceKeys = Object.keys(sourceTranslations);
const targetLocales = requestedLocalesArg
  ? requestedLocalesArg
      .split('=')[1]
      .split(',')
      .map((locale) => locale.trim())
      .filter(Boolean)
  : await getSupportedLocales();

for (const locale of targetLocales) {
  if (locale === 'en') {
    continue;
  }

  await syncLocale(locale);
}

async function getSupportedLocales() {
  const fileContents = await readFile(supportedLocalesFile, 'utf8');
  const matches = [...fileContents.matchAll(/code:\s*'([^']+)'/g)];
  return matches.map((match) => match[1]).filter((locale) => locale !== 'en');
}

async function syncLocale(locale) {
  const localePath = path.join(localeDir, `messages.${locale}.json`);
  const existingMessages = await readLocaleFile(localePath);
  const existingTranslations = existingMessages.translations ?? {};
  const nextTranslations = {};
  const missingKeys = [];

  for (const key of sourceKeys) {
    if (Object.hasOwn(existingTranslations, key)) {
      nextTranslations[key] = existingTranslations[key];
      continue;
    }

    missingKeys.push(key);
  }

  if (shouldTranslate && missingKeys.length > 0) {
    for (let index = 0; index < missingKeys.length; index += batchSize) {
      const batchKeys = missingKeys.slice(index, index + batchSize);
      const batchTexts = batchKeys.map((key) => sourceTranslations[key]);
      const translatedTexts = await translateBatch(batchTexts, locale);

      for (let translatedIndex = 0; translatedIndex < batchKeys.length; translatedIndex += 1) {
        nextTranslations[batchKeys[translatedIndex]] = translatedTexts[translatedIndex];
      }

      console.log(
        `translated ${locale}: ${Math.min(index + batchKeys.length, missingKeys.length)}/${missingKeys.length}`,
      );
    }
  } else {
    for (const key of missingKeys) {
      nextTranslations[key] = sourceTranslations[key];
    }
  }

  const orderedTranslations = {};
  for (const key of sourceKeys) {
    orderedTranslations[key] = nextTranslations[key];
  }

  const nextMessages = {
    locale,
    translations: orderedTranslations,
  };

  await writeJson(localePath, nextMessages);
  console.log(`synced ${locale}: ${missingKeys.length} missing key(s) filled`);
}

async function readLocaleFile(localePath) {
  try {
    return JSON.parse(await readFile(localePath, 'utf8'));
  } catch (error) {
    return { translations: {} };
  }
}

async function translateText(text, locale) {
  if (!text.trim()) {
    return text;
  }

  const placeholders = [];
  const maskedText = text.replace(/\{\$[^}]+\}/g, (token) => {
    const placeholder = `__PLACEHOLDER_${placeholders.length}__`;
    placeholders.push({ placeholder, token });
    return placeholder;
  });

  const translatedText = await requestTranslation(maskedText, translateTargetMap[locale] ?? locale);
  let restoredText = translatedText;

  for (const { placeholder, token } of placeholders) {
    restoredText = restoredText.replaceAll(placeholder, token);
  }

  return restoredText;
}

async function translateBatch(texts, locale) {
  const segmentRegex = /__SEG_(\d{4})__([\s\S]*?)(?=(?:__SEG_\d{4}__|$))/g;
  const maskedSegments = texts.map((text, index) => {
    const placeholders = [];
    const maskedText = text.replace(/\{\$[^}]+\}/g, (token) => {
      const placeholder = `__PLACEHOLDER_${index}_${placeholders.length}__`;
      placeholders.push({ placeholder, token });
      return placeholder;
    });

    return { maskedText, placeholders };
  });

  const payload = maskedSegments
    .map(
      ({ maskedText }, index) =>
        `__SEG_${String(index).padStart(4, '0')}__ ${maskedText || '__EMPTY__'}`,
    )
    .join('\n');

  const translatedPayload = await requestTranslation(payload, translateTargetMap[locale] ?? locale);
  const translatedSegments = Array.from(translatedPayload.matchAll(segmentRegex));

  if (translatedSegments.length !== texts.length) {
    return Promise.all(texts.map((text) => translateText(text, locale)));
  }

  return translatedSegments.map((segment, index) => {
    const rawText = segment[2].trimStart().replace(/^__EMPTY__$/, '');
    let restoredText = rawText;

    for (const { placeholder, token } of maskedSegments[index].placeholders) {
      restoredText = restoredText.replaceAll(placeholder, token);
    }

    return restoredText;
  });
}

async function requestTranslation(text, locale, attempt = 0) {
  try {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'en',
      tl: locale,
      dt: 't',
      q: text,
    });

    const response = await fetch(
      `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
    );
    if (!response.ok) {
      throw new Error(`Translation request failed with ${response.status}`);
    }

    const data = await response.json();
    const translatedText = Array.isArray(data?.[0])
      ? data[0].map((part) => part?.[0] ?? '').join('')
      : '';

    if (!translatedText) {
      throw new Error('Translation response was empty');
    }

    return translatedText;
  } catch (error) {
    if (attempt >= 2) {
      console.warn(
        `translation fallback for locale ${locale}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return text;
    }

    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    return requestTranslation(text, locale, attempt + 1);
  }
}

async function writeJson(filePath, value) {
  const formatted = `${JSON.stringify(value, null, 2)}\n`.replace(/\n/g, '\r\n');
  await writeFile(filePath, formatted, 'utf8');
}
