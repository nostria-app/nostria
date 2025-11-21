/* eslint-disable @typescript-eslint/no-explicit-any */
import { pipeline, env, Tensor, AutoTokenizer, SpeechT5ForTextToSpeech, SpeechT5HifiGan } from '@xenova/transformers';

// Configure environment to use the Cache API for storing models
env.allowLocalModels = false;
env.useBrowserCache = true;

let textGenerator: any = null;
let summarizer: any = null;
let sentiment: any = null;
let transcriber: any = null;
// let synthesizer: any = null; // Replaced by TTSPipeline
const translators = new Map<string, any>();

class TTSPipeline {
  static model_id = 'Xenova/speecht5_tts';
  static vocoder_id = 'Xenova/speecht5_hifigan';
  static tokenizer: any = null;
  static model: any = null;
  static vocoder: any = null;

  static async getInstance(progress_callback: any = null) {
    if (this.tokenizer === null) {
      this.tokenizer = AutoTokenizer.from_pretrained(this.model_id, { progress_callback });
    }
    if (this.model === null) {
      this.model = SpeechT5ForTextToSpeech.from_pretrained(this.model_id, { quantized: false, progress_callback });
    }
    if (this.vocoder === null) {
      this.vocoder = SpeechT5HifiGan.from_pretrained(this.vocoder_id, { quantized: false, progress_callback });
    }

    return Promise.all([this.tokenizer, this.model, this.vocoder]);
  }
}

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
      case 'transcribe':
        await handleTranscribe(payload, id);
        break;
      case 'synthesize':
        await handleSynthesize(payload, id);
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
  } else if (task === 'automatic-speech-recognition') {
    transcriber = await pipeline(task, model, { progress_callback: progressCallback });
  } else if (task === 'text-to-speech') {
    await TTSPipeline.getInstance(progressCallback);
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

async function handleTranscribe(payload: { audio: Float32Array, params?: any }, id: string) {
  if (!transcriber) {
    throw new Error('Transcription model not loaded');
  }
  const result = await transcriber(payload.audio, payload.params);
  postMessage({
    type: 'result',
    id,
    payload: result
  });
}

async function handleSynthesize(payload: { text: string, params?: any }, id: string) {
  if (!TTSPipeline.model) {
    throw new Error('Text-to-speech model not loaded');
  }

  if (!payload.params) {
    payload.params = {};
  }

  if (!payload.params.speaker_embeddings) {
    payload.params.speaker_embeddings = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin';
  }

  if (payload.params && payload.params.speaker_embeddings && typeof payload.params.speaker_embeddings === 'string') {
    const url = payload.params.speaker_embeddings;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch speaker embeddings: ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();

      let data: Float32Array;

      if (url.endsWith('.npy')) {
        data = parseNpy(buffer);
      } else {
        // Assume raw float32 binary (e.g. .bin from Xenova/cmu-arctic-xvectors-extracted)
        data = new Float32Array(buffer);
      }

      console.log('Embedding parsed. Length:', data.length);
      // console.log('First 5 values:', Array.from(data.slice(0, 5)));

      const tensor = new Tensor('float32', data, [1, data.length]);
      payload.params.speaker_embeddings = tensor;
      console.log('Loaded speaker embeddings:', url, 'Shape:', tensor.dims);
    } catch (e) {
      console.error('Failed to fetch or parse speaker embeddings', e);
      throw e; // Re-throw to stop synthesis with invalid embeddings
    }
  }

  console.log('Synthesizing speech with params:', payload.params);

  const tokenizer = await TTSPipeline.tokenizer;
  const model = await TTSPipeline.model;
  const vocoder = await TTSPipeline.vocoder;

  const { input_ids } = tokenizer(payload.text);
  const speaker_embeddings = payload.params.speaker_embeddings;

  const { waveform } = await model.generate_speech(input_ids, speaker_embeddings, { vocoder });

  const wav = encodeWAV(waveform.data);
  const blob = new Blob([wav], { type: 'audio/wav' });

  const result = {
    blob: blob,
    sampling_rate: 16000
  };

  console.log('Synthesis result:', result);

  postMessage({
    type: 'result',
    id,
    payload: result
  });
}

function encodeWAV(samples: Float32Array) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const sampleRate = 16000;

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, 1, true); // 1 = PCM
  /* channel count */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; ++i) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

function parseNpy(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  // Check magic number
  const magic = new Uint8Array(buffer, 0, 6);
  if (magic[0] !== 0x93 || String.fromCharCode(...magic.slice(1)) !== 'NUMPY') {
    throw new Error('Invalid .npy file');
  }

  // Read version
  const major = view.getUint8(6);
  // const minor = view.getUint8(7);

  // Read header length
  let headerLen = view.getUint16(8, true); // Little endian
  let offset = 10;

  if (major >= 2) {
    headerLen = view.getUint32(8, true);
    offset = 12;
  }

  // The data starts after the header
  const dataOffset = offset + headerLen;

  // Assume float32 (f4) and little endian (<)
  // In a full parser we would parse the header JSON to check 'descr' and 'fortran_order' and 'shape'
  // But for this specific use case (speecht5 embeddings), we know it's float32

  return new Float32Array(buffer.slice(dataOffset));
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
  else if (task === 'automatic-speech-recognition') isLoaded = !!transcriber;
  else if (task === 'text-to-speech') isLoaded = !!TTSPipeline.model;

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