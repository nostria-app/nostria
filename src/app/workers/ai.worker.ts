import { pipeline, env } from '@xenova/transformers';

// Configure environment to use the Cache API for storing models
env.allowLocalModels = false;
env.useBrowserCache = true;

let textGenerator: any = null;
let translator: any = null;

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
  } else if (task === 'translation') {
    translator = await pipeline(task, model, { progress_callback: progressCallback });
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

async function handleTranslate(payload: { text: string, src_lang?: string, tgt_lang?: string, params?: any }, id: string) {
  if (!translator) {
    throw new Error('Translation model not loaded');
  }
  const result = await translator(payload.text, payload.params);
  postMessage({
    type: 'result',
    id,
    payload: result
  });
}

async function handleCheck(payload: { task: string, model: string }, id: string) {
  const { task } = payload;
  try {
    postMessage({
      type: 'status',
      id,
      payload: { loaded: (task === 'text-generation' && !!textGenerator) || (task === 'translation' && !!translator) }
    });
  } catch {
    postMessage({
      type: 'status',
      id,
      payload: { loaded: false }
    });
  }
}
