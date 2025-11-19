import { pipeline, env } from '@xenova/transformers';

// Configure environment to use the Cache API for storing models
env.allowLocalModels = false;
env.useBrowserCache = true;

let textGenerator: any = null;
let summarizer: any = null;
let sentiment: any = null;
const translators = new Map<string, any>();

addEventListener('message', async ({ data }) => {
  const { type, payload, id } = data;

  try {
    switch (type) {
      case 'load':
        await handleLoad(payload, id);
        break;
      case 'generate':
        await handleGenerate(payload, id);
        break;
      case 'summarize':
        await handleSummarize(payload, id);
        break;
      case 'sentiment':
        await handleSentiment(payload, id);
        break;
      case 'translate':
        await handleTranslate(payload, id);
        break;
      case 'check':
        await handleCheck(payload, id);
        break;
    }
  } catch (error: unknown) {
    postMessage({
      type: 'error',
      id,
      payload: error instanceof Error ? error.message : String(error)
    });
  }
});

async function handleLoad(payload: { task: string, model: string }, id: string) {
  const { task, model } = payload;

  const progressCallback = (data: unknown) => {
    postMessage({
      type: 'progress',
      id,
      payload: data
    });
  };

  if (task === 'text-generation') {
    textGenerator = await pipeline(task, model, { progress_callback: progressCallback });
  } else if (task === 'summarization') {
    summarizer = await pipeline(task, model, { progress_callback: progressCallback });
  } else if (task === 'sentiment-analysis') {
    sentiment = await pipeline(task, model, { progress_callback: progressCallback });
  } else if (task === 'translation') {
    const translator = await pipeline(task, model, { progress_callback: progressCallback });
    translators.set(model, translator);
  }

  postMessage({
    type: 'complete',
    id,
    payload: { task, model, status: 'loaded' }
  });
}

async function handleGenerate(payload: { text: string, params?: any }, id: string) {
  if (!textGenerator) {
    throw new Error('Text generation model not loaded');
  }
  const result = await textGenerator(payload.text, payload.params);
  postMessage({
    type: 'result',
    id,
    payload: result
  });
}

async function handleSummarize(payload: { text: string, params?: any }, id: string) {
  if (!summarizer) {
    throw new Error('Summarization model not loaded');
  }
  const result = await summarizer(payload.text, payload.params);
  postMessage({
    type: 'result',
    id,
    payload: result
  });
}

async function handleSentiment(payload: { text: string, params?: any }, id: string) {
  if (!sentiment) {
    throw new Error('Sentiment analysis model not loaded');
  }
  const result = await sentiment(payload.text, payload.params);
  postMessage({
    type: 'result',
    id,
    payload: result
  });
}

async function handleTranslate(payload: { text: string, model: string, params?: any }, id: string) {
  const translator = translators.get(payload.model);
  if (!translator) {
    throw new Error(`Translation model ${payload.model} not loaded`);
  }
  const result = await translator(payload.text, payload.params);
  postMessage({
    type: 'result',
    id,
    payload: result
  });
}

async function handleCheck(payload: { task: string, model: string }, id: string) {
  const { task, model } = payload;
  let isLoaded = false;
  let isCached = false;

  // Check memory
  if (task === 'text-generation') isLoaded = !!textGenerator;
  else if (task === 'summarization') isLoaded = !!summarizer;
  else if (task === 'sentiment-analysis') isLoaded = !!sentiment;
  else if (task === 'translation') isLoaded = translators.has(model);

  // Check cache if not loaded
  if (!isLoaded) {
    try {
      const cache = await caches.open('transformers-cache');
      // We check for the existence of the model config file in the cache
      // The URL pattern is usually: https://huggingface.co/{model}/resolve/main/config.json
      // But it might vary.
      const modelPath = model.startsWith('http') ? model : `https://huggingface.co/${model}/resolve/main/config.json`;
      const match = await cache.match(modelPath);
      if (match) {
        isCached = true;
      }
    } catch (e) {
      console.warn('Cache check failed', e);
    }
  }

  postMessage({
    type: 'status',
    id,
    payload: { loaded: isLoaded, cached: isCached }
  });
}