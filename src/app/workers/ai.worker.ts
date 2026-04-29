/* eslint-disable @typescript-eslint/no-explicit-any */
import { pipeline, env, Tensor, AutoModelForImageTextToText, AutoProcessor, AutoTokenizer, BaseStreamer, MultiModalityCausalLM, RawImage, SpeechT5ForTextToSpeech, SpeechT5HifiGan, StyleTextToSpeech2Model, TextStreamer } from '@huggingface/transformers';

const HUGGING_FACE_REMOTE_HOST = 'https://huggingface.co/';
const SPEAKER_EMBEDDINGS_URL = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin';
const ONNX_RUNTIME_ASSET_PATH = '/assets/onnxruntime/';
const SPEECHT5_MODEL_ID = 'Xenova/speecht5_tts';
const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const SUPERTONIC_MODEL_ID = 'onnx-community/Supertonic-TTS-2-ONNX';
const PIPER_MODEL_ID = 'rhasspy/piper-voices/en_US-libritts_r-medium';
const SUPERTONIC_VOICE_BASE_URL = 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices';
const PIPER_MODEL_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx';
const PIPER_CONFIG_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx.json';
const PHONEMIZER_MODULE_URL = 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.js';
const TTS_ASSET_CACHE_NAME = 'nostria-ai-tts-assets';
const KOKORO_VOICES = new Set([
  'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
]);
const SUPERTONIC_VOICES = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']);
const SUPERTONIC_LANGUAGES = new Set(['en', 'ko', 'es', 'pt', 'fr']);
const nativeFetch = globalThis.fetch.bind(globalThis);
const allowedExternalHosts = new Set([
  'huggingface.co',
  'hf.co',
  'cdn.jsdelivr.net',
  'cdn-lfs.huggingface.co',
  'cas-bridge.xethub.hf.co',
  'cas-server.xethub.hf.co',
]);

function isAllowedExternalHost(hostname: string): boolean {
  return allowedExternalHosts.has(hostname)
    || hostname.endsWith('.huggingface.co')
    || hostname.endsWith('.hf.co');
}

function normalizeFetchTarget(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }

  if (typeof input === 'string') {
    return new URL(input, self.location.href);
  }

  return new URL(input.url, self.location.href);
}

async function secureWorkerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const targetUrl = normalizeFetchTarget(input);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const isSameOrigin = targetUrl.origin === self.location.origin;
  const isHttp = targetUrl.protocol === 'http:' || targetUrl.protocol === 'https:';

  if (!isHttp) {
    return nativeFetch(input, init);
  }

  if (!isSameOrigin) {
    if (!isAllowedExternalHost(targetUrl.hostname)) {
      throw new Error(`Blocked external AI asset fetch to unexpected host: ${targetUrl.hostname}`);
    }

    if (method !== 'GET' && method !== 'HEAD') {
      throw new Error(`Blocked external AI asset fetch with unsafe method: ${method}`);
    }

    if (init?.body !== undefined) {
      throw new Error('Blocked external AI asset fetch carrying a request body.');
    }

    if (targetUrl.searchParams.size > 0) {
      throw new Error(`Blocked external AI asset fetch with query parameters: ${targetUrl.href}`);
    }

    return nativeFetch(input, {
      ...init,
      method,
      body: undefined,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  }

  return nativeFetch(input, init);
}

// Configure environment to use the Cache API for storing models
env.allowRemoteModels = true;
env.remoteHost = HUGGING_FACE_REMOTE_HOST;
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = ONNX_RUNTIME_ASSET_PATH;
env.fetch = secureWorkerFetch;
globalThis.fetch = secureWorkerFetch;

const textGenerators = new Map<string, any>();
let summarizer: any = null;
let sentiment: any = null;
let transcriber: any = null;
// let synthesizer: any = null; // Replaced by TTSPipeline
const translators = new Map<string, any>();
const imageGenerators = new Map<string, { processor: Promise<any>, model: Promise<any> }>();
const imageUpscalers = new Map<string, any>();
const multimodalGenerators = new Map<string, { processor: Promise<any>, model: Promise<any> }>();
let kokoroTts: any = null;
let supertonicTts: any = null;
let piperTts: PiperTTS | null = null;
let fp16Supported = false;
let phonemizerModulePromise: Promise<{ phonemize: (text: string, voice?: string) => Promise<string[] | string> }> | null = null;

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
      this.model = SpeechT5ForTextToSpeech.from_pretrained(this.model_id, { dtype: 'fp32', progress_callback });
    }
    if (this.vocoder === null) {
      this.vocoder = SpeechT5HifiGan.from_pretrained(this.vocoder_id, { dtype: 'fp32', progress_callback });
    }

    return Promise.all([this.tokenizer, this.model, this.vocoder]);
  }
}

class KokoroLocalTTS {
  private readonly voiceDataCache = new Map<string, Float32Array>();

  private constructor(
    private readonly model: any,
    private readonly tokenizer: any,
  ) { }

  static async fromPretrained(
    modelId: string,
    options: { dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'; device?: 'wasm' | 'webgpu' | 'cpu' | null; progress_callback?: any },
  ): Promise<KokoroLocalTTS> {
    const [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(modelId, options),
      AutoTokenizer.from_pretrained(modelId, { progress_callback: options.progress_callback }),
    ]);

    return new KokoroLocalTTS(model, tokenizer);
  }

  async synthesize(text: string, options: { voice?: string; speed?: number }): Promise<Blob> {
    const voice = this.validateVoice(options.voice);
    const voicePrefix = voice.at(0) === 'b' ? 'b' : 'a';
    const phonemes = await phonemizeKokoroText(text, voicePrefix);
    const { input_ids } = this.tokenizer(phonemes, { truncation: true });
    const tokenCount = input_ids.dims.at(-1) ?? 0;
    const voiceData = await this.getVoiceData(voice);
    const offset = 256 * Math.min(Math.max(tokenCount - 2, 0), 509);
    const style = voiceData.slice(offset, offset + 256);
    const speed = normalizeVoiceSpeed(options.speed);
    const { waveform } = await this.model({
      input_ids,
      style: new Tensor('float32', style, [1, 256]),
      speed: new Tensor('float32', [speed], [1]),
    });

    return rawAudioToWavBlob(waveform.data, 24000);
  }

  private validateVoice(voice: unknown): string {
    const candidate = typeof voice === 'string' && KOKORO_VOICES.has(voice) ? voice : 'af_heart';
    return candidate;
  }

  private async getVoiceData(voice: string): Promise<Float32Array> {
    const cached = this.voiceDataCache.get(voice);
    if (cached) {
      return cached;
    }

    const url = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${voice}.bin`;
    const response = await cachedFetch(url);
    const data = new Float32Array(await response.arrayBuffer());
    this.voiceDataCache.set(voice, data);
    return data;
  }
}

class PiperRawAudio {
  constructor(
    readonly audio: Float32Array,
    readonly samplingRate: number,
  ) { }

  toBlob(): Blob {
    return new Blob([encodeWAV(this.audio, this.samplingRate)], { type: 'audio/wav' });
  }
}

class PiperTTS {
  private constructor(
    private readonly voiceConfig: any,
    private readonly session: any,
  ) { }

  static async fromPretrained(progressCallback: (data: unknown) => void): Promise<PiperTTS> {
    const ort = await import('onnxruntime-web');
    ort.env.wasm.wasmPaths = ONNX_RUNTIME_ASSET_PATH;

    progressCallback({ status: 'progress', progress: 0.05 });
    const [modelResponse, configResponse] = await Promise.all([
      cachedFetch(PIPER_MODEL_URL),
      cachedFetch(PIPER_CONFIG_URL),
    ]);
    progressCallback({ status: 'progress', progress: 0.35 });

    const [modelBuffer, voiceConfig] = await Promise.all([
      modelResponse.arrayBuffer(),
      configResponse.json(),
    ]);
    progressCallback({ status: 'progress', progress: 0.55 });

    const session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: [{ name: 'wasm', simd: true }],
    });
    progressCallback({ status: 'progress', progress: 1 });

    return new PiperTTS(voiceConfig, session);
  }

  async synthesize(text: string, options: { voice?: number; speed?: number }): Promise<Blob> {
    const chunks = await Promise.all(
      chunkTextForTts(text).map(chunk => this.synthesizeChunk(chunk, options)),
    );
    const audio = mergeAudioChunks(chunks);
    normalizePeak(audio.audio, 0.9);
    return new PiperRawAudio(trimSilence(audio.audio, 0.002, Math.floor(audio.samplingRate * 0.02)), audio.samplingRate).toBlob();
  }

  private async synthesizeChunk(text: string, options: { voice?: number; speed?: number }): Promise<PiperRawAudio> {
    const ort = await import('onnxruntime-web');
    const textPhonemes = await this.textToPhonemes(text);
    const phonemeIds = this.phonemesToIds(textPhonemes);
    const speed = typeof options.speed === 'number' && Number.isFinite(options.speed) ? options.speed : 1;
    const lengthScale = 1 / Math.min(Math.max(speed, 0.5), 2);
    const inputs: Record<string, unknown> = {
      input: new ort.Tensor('int64', new BigInt64Array(phonemeIds.map(id => BigInt(id))), [1, phonemeIds.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(phonemeIds.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([0.667, lengthScale, 0.8]), [3]),
    };

    if (this.voiceConfig.num_speakers > 1) {
      const voice = Math.min(Math.max(Math.round(options.voice ?? 0), 0), this.voiceConfig.num_speakers - 1);
      inputs['sid'] = new ort.Tensor('int64', BigInt64Array.from([BigInt(voice)]), [1]);
    }

    const results = await this.session.run(inputs);
    const audioOutput = results.output;
    return new PiperRawAudio(new Float32Array(audioOutput.data), this.voiceConfig.audio.sample_rate);
  }

  private async textToPhonemes(text: string): Promise<string[][]> {
    if (this.voiceConfig.phoneme_type === 'text') {
      return [Array.from(text.normalize('NFD'))];
    }

    const { phonemize } = await loadPhonemizer();
    const phonemes = await phonemize(text, this.voiceConfig.espeak?.voice || 'en-us');
    const phonemeText = Array.isArray(phonemes) ? phonemes.join(' ') : String(phonemes || text);
    return phonemeText
      .split(/[.!?]+/)
      .map(sentence => sentence.trim())
      .filter(Boolean)
      .map(sentence => Array.from(sentence.normalize('NFD')));
  }

  private phonemesToIds(textPhonemes: string[][]): number[] {
    const idMap = this.voiceConfig.phoneme_id_map;
    if (!idMap) {
      throw new Error('Piper phoneme ID map is not available.');
    }

    const phonemeIds: number[] = [];
    for (const sentencePhonemes of textPhonemes) {
      phonemeIds.push(idMap['^'], idMap['_']);
      for (const phoneme of sentencePhonemes) {
        if (phoneme in idMap) {
          phonemeIds.push(idMap[phoneme], idMap['_']);
        }
      }
      phonemeIds.push(idMap['$']);
    }

    return phonemeIds;
  }
}

class ImageProgressStreamer extends BaseStreamer {
  private generatedTokens = 0;

  constructor(
    private readonly totalTokens: number,
    private readonly callback: (payload: { status: 'image-progress'; progress: number }) => void,
  ) {
    super();
  }

  put(): void {
    this.generatedTokens += 1;
    const progress = this.totalTokens > 0 ? Math.min(this.generatedTokens / this.totalTokens, 1) : 0;
    this.callback({ status: 'image-progress', progress });
  }

  end(): void {
    this.callback({ status: 'image-progress', progress: 1 });
  }
}

async function detectFp16Support() {
  if (!('gpu' in navigator)) {
    fp16Supported = false;
    return;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    fp16Supported = !!adapter?.features?.has('shader-f16');
  } catch {
    fp16Supported = false;
  }
}

async function getImageGenerator(modelId: string, progressCallback: (data: unknown) => void) {
  const existing = imageGenerators.get(modelId);
  if (existing) {
    return Promise.all([existing.processor, existing.model]);
  }

  await detectFp16Support();

  const processor = AutoProcessor.from_pretrained(modelId, { progress_callback: progressCallback });
  const model = MultiModalityCausalLM.from_pretrained(modelId, {
    dtype: fp16Supported
      ? {
        prepare_inputs_embeds: 'q4',
        language_model: 'q4f16',
        lm_head: 'fp16',
        gen_head: 'fp16',
        gen_img_embeds: 'fp16',
        image_decode: 'fp32',
      }
      : {
        prepare_inputs_embeds: 'fp32',
        language_model: 'q4',
        lm_head: 'fp32',
        gen_head: 'fp32',
        gen_img_embeds: 'fp32',
        image_decode: 'fp32',
      },
    device: {
      prepare_inputs_embeds: 'wasm',
      language_model: 'webgpu',
      lm_head: 'webgpu',
      gen_head: 'webgpu',
      gen_img_embeds: 'webgpu',
      image_decode: 'webgpu',
    },
    progress_callback: progressCallback,
  });

  imageGenerators.set(modelId, { processor, model });
  return Promise.all([processor, model]);
}

async function getMultimodalGenerator(
  modelId: string,
  progressCallback: (data: unknown) => void,
  options: { device?: 'webgpu' | 'wasm'; dtype?: string | Record<string, string> } = {},
) {
  const existing = multimodalGenerators.get(modelId);
  if (existing) {
    return Promise.all([existing.processor, existing.model]);
  }

  const processor = AutoProcessor.from_pretrained(modelId, { progress_callback: progressCallback });
  const model = AutoModelForImageTextToText.from_pretrained(modelId, {
    ...options,
    progress_callback: progressCallback,
  });

  multimodalGenerators.set(modelId, { processor, model });
  return Promise.all([processor, model]);
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
      case 'generate-multimodal':
        await handleGenerateMultimodal(payload, id);
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
      case 'generate-image':
        await handleGenerateImage(payload, id);
        break;
      case 'upscale-image':
        await handleUpscaleImage(payload, id);
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

async function handleLoad(payload: { task: string, model: string, options?: Record<string, unknown> }, id: string) {
  const { task, model } = payload;
  const options = payload.options ?? {};

  const progressCallback = (data: unknown) => {
    postMessage({
      type: 'progress',
      id,
      payload: data
    });
  };

  if (task === 'text-generation') {
    const textGenerator = await pipeline(task, model, { ...options, progress_callback: progressCallback });
    textGenerators.set(model, textGenerator);
  } else if (task === 'image-text-to-text') {
    await getMultimodalGenerator(model, progressCallback, options);
  } else if (task === 'summarization') {
    summarizer = await pipeline(task, model, { ...options, progress_callback: progressCallback });
  } else if (task === 'sentiment-analysis') {
    sentiment = await pipeline(task, model, { ...options, progress_callback: progressCallback });
  } else if (task === 'translation') {
    const translator = await pipeline(task, model, { ...options, progress_callback: progressCallback });
    translators.set(model, translator);
  } else if (task === 'automatic-speech-recognition') {
    transcriber = await pipeline(task, model, { ...options, progress_callback: progressCallback });
  } else if (task === 'text-to-speech') {
    if (model === KOKORO_MODEL_ID) {
      kokoroTts = await KokoroLocalTTS.fromPretrained(model, {
        dtype: normalizeKokoroDtype(options['dtype']),
        device: normalizeKokoroDevice(options['device']),
        progress_callback: progressCallback,
      });
    } else if (model === SUPERTONIC_MODEL_ID) {
      supertonicTts = await pipeline('text-to-speech', model, {
        dtype: 'fp32',
        device: normalizeSupertonicDevice(options['device']),
        progress_callback: progressCallback,
      });
      patchSupertonicPostprocessWaveform(supertonicTts);
    } else if (model === PIPER_MODEL_ID) {
      piperTts = await PiperTTS.fromPretrained(progressCallback);
    } else {
      await TTSPipeline.getInstance(progressCallback);
    }
  } else if (task === 'image-generation') {
    await getImageGenerator(model, progressCallback);
  } else if (task === 'image-upscaling') {
    const upscaler = await pipeline('image-to-image', model, { ...options, progress_callback: progressCallback });
    imageUpscalers.set(model, upscaler);
  }

  postMessage({
    type: 'complete',
    id,
    payload: { task, model, status: 'loaded' }
  });
}

function normalizeChatRole(role: string): 'system' | 'user' | 'assistant' {
  if (role === 'assistant' || role === 'system') {
    return role;
  }

  return 'user';
}

function serializeGemma4Chat(messages: { role: string; content: string }[]): string {
  const turns = messages
    .map(message => ({
      role: normalizeChatRole(message.role),
      content: message.content.trim(),
    }))
    .filter(message => message.content.length > 0)
    .map(message => `<|turn|>${message.role}\n${message.content}<turn|>`);

  return `<bos>${turns.join('\n')}\n<|turn|>assistant\n`;
}

function serializeGenericChat(messages: { role: string; content: string }[]): string {
  const transcript = messages
    .map(message => ({
      role: normalizeChatRole(message.role),
      content: message.content.trim(),
    }))
    .filter(message => message.content.length > 0)
    .map(message => `${message.role === 'system' ? 'System' : message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n\n');

  return `${transcript}\n\nAssistant:`;
}

function resolveGenerationInput(
  input: string | { role: string; content: string }[],
  modelId: string,
  tokenizer: { chat_template?: string | null } | undefined,
): { input: string | { role: string; content: string }[]; usedFallbackTemplate: boolean } {
  if (!Array.isArray(input) || tokenizer?.chat_template) {
    return { input, usedFallbackTemplate: false };
  }

  const serialized = modelId.includes('gemma-4')
    ? serializeGemma4Chat(input)
    : serializeGenericChat(input);

  return {
    input: serialized,
    usedFallbackTemplate: true,
  };
}

async function handleGenerate(payload: { input: string | { role: string, content: string }[], model: string, params?: any }, id: string) {
  const textGenerator = textGenerators.get(payload.model);
  if (!textGenerator) {
    throw new Error(`Text generation model ${payload.model} not loaded`);
  }

  const generationInput = resolveGenerationInput(payload.input, payload.model, textGenerator.tokenizer);
  const generationParams = generationInput.usedFallbackTemplate && !Object.prototype.hasOwnProperty.call(payload.params ?? {}, 'return_full_text')
    ? { ...payload.params, return_full_text: false }
    : { ...payload.params };

  const streamer = new TextStreamer(textGenerator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (!text) {
        return;
      }

      postMessage({
        type: 'progress',
        id,
        payload: {
          status: 'stream',
          text,
        }
      });
    },
  });

  const result = await textGenerator(generationInput.input, { ...generationParams, streamer });
  postMessage({
    type: 'result',
    id,
    payload: result
  });
}

async function handleGenerateMultimodal(
  payload: {
    input: {
      role: string;
      content: (| { type: 'text'; text: string }
        | { type: 'image'; image: Blob })[];
    }[];
    model: string;
    params?: any;
  },
  id: string,
) {
  const multimodalGenerator = multimodalGenerators.get(payload.model);
  if (!multimodalGenerator) {
    throw new Error(`Multimodal generation model ${payload.model} not loaded`);
  }

  const [processor, model] = await Promise.all([multimodalGenerator.processor, multimodalGenerator.model]);
  const messages = payload.input;
  const images = await Promise.all(
    messages
      .flatMap(message => message.content)
      .filter((part): part is { type: 'image'; image: Blob } => part.type === 'image')
      .map(part => RawImage.read(part.image)),
  );
  const preparedMessages = messages.map(message => ({
    role: message.role,
    content: message.content.map(part => part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image' as const }),
  }));

  const prompt = processor.apply_chat_template(preparedMessages, {
    add_generation_prompt: true,
  });
  const inputs = images.length > 0
    ? await processor(prompt, images)
    : await processor(prompt);

  const streamer = new TextStreamer(processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (!text) {
        return;
      }

      postMessage({
        type: 'progress',
        id,
        payload: {
          status: 'stream',
          text,
        }
      });
    },
  });

  const { sequences } = await model.generate({
    ...inputs,
    ...payload.params,
    streamer,
    return_dict_in_generate: true,
  });
  const decoded = processor.batch_decode(sequences.slice(null, [inputs.input_ids.dims.at(-1), null]), {
    skip_special_tokens: true,
  });

  postMessage({
    type: 'result',
    id,
    payload: decoded[0] ?? '',
  });
}

async function handleGenerateImage(payload: { prompt: string, model: string }, id: string) {
  const progressCallback = (data: unknown) => {
    postMessage({
      type: 'progress',
      id,
      payload: data
    });
  };

  const [processor, model] = await getImageGenerator(payload.model, progressCallback);
  const inputs = await processor([
    {
      role: '<|User|>',
      content: payload.prompt,
    },
  ], {
    chat_template: 'text_to_image',
  });

  const numImageTokens = processor.num_image_tokens;
  const streamer = new ImageProgressStreamer(numImageTokens, progress => {
    postMessage({
      type: 'progress',
      id,
      payload: progress
    });
  });

  const outputs = await model.generate_images({
    ...inputs,
    min_new_tokens: numImageTokens,
    max_new_tokens: numImageTokens,
    do_sample: true,
    streamer,
  });

  const images = await Promise.all(outputs.map(async (image: { toBlob: () => Promise<Blob> }) => {
    const blob = await image.toBlob();
    return {
      blob,
      mimeType: blob.type || 'image/png',
    };
  }));

  postMessage({
    type: 'result',
    id,
    payload: { images }
  });
}

async function handleUpscaleImage(payload: { image: Blob, model: string }, id: string) {
  const upscaler = imageUpscalers.get(payload.model);
  if (!upscaler) {
    throw new Error(`Image upscaling model ${payload.model} not loaded`);
  }

  const output = await upscaler(payload.image);
  const blob = await output.toBlob();

  postMessage({
    type: 'result',
    id,
    payload: {
      image: {
        blob,
        mimeType: blob.type || 'image/png',
      },
    }
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
  const modelId = payload.params?.model ?? SPEECHT5_MODEL_ID;

  if (modelId === KOKORO_MODEL_ID) {
    await handleKokoroSynthesize(payload, id);
    return;
  }

  if (modelId === PIPER_MODEL_ID) {
    await handlePiperSynthesize(payload, id);
    return;
  }

  if (modelId === SUPERTONIC_MODEL_ID) {
    await handleSupertonicSynthesize(payload, id);
    return;
  }

  if (!TTSPipeline.model) {
    throw new Error('Text-to-speech model not loaded');
  }

  if (!payload.params) {
    payload.params = {};
  }

  if (!payload.params.speaker_embeddings) {
    payload.params.speaker_embeddings = SPEAKER_EMBEDDINGS_URL;
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

async function handleKokoroSynthesize(payload: { text: string, params?: any }, id: string) {
  if (!kokoroTts) {
    throw new Error('Kokoro text-to-speech model not loaded');
  }

  const voice = typeof payload.params?.voice === 'string' ? payload.params.voice : 'af_heart';
  const speed = normalizeVoiceSpeed(payload.params?.speed);
  const blob = await kokoroTts.synthesize(payload.text, { voice, speed });

  postMessage({
    type: 'result',
    id,
    payload: {
      blob,
      sampling_rate: 24000,
      voiceId: voice,
      language: voice.startsWith('b') ? 'en-gb' : 'en-us',
    }
  });
}

async function handlePiperSynthesize(payload: { text: string, params?: any }, id: string) {
  if (!piperTts) {
    throw new Error('Piper text-to-speech model not loaded');
  }

  const voice = normalizePiperVoice(payload.params?.voice);
  const speed = normalizeVoiceSpeed(payload.params?.speed);
  const blob = await piperTts.synthesize(payload.text, { voice, speed });

  postMessage({
    type: 'result',
    id,
    payload: {
      blob,
      sampling_rate: 22050,
      voiceId: `Voice ${voice + 1}`,
      language: 'en-us',
    }
  });
}

async function handleSupertonicSynthesize(payload: { text: string, params?: any }, id: string) {
  if (!supertonicTts) {
    throw new Error('Supertonic text-to-speech model not loaded');
  }

  const voice = normalizeSupertonicVoice(payload.params?.voice);
  const language = normalizeSupertonicLanguage(payload.params?.language);
  const speed = normalizeVoiceSpeed(payload.params?.speed);
  const result = await supertonicTts(`<${language}>${payload.text}</${language}>`, {
    speaker_embeddings: `${SUPERTONIC_VOICE_BASE_URL}/${voice}.bin`,
    num_inference_steps: 5,
    speed,
  });
  const samplingRate = result?.sampling_rate ?? result?.samplingRate ?? 24000;
  const blob = rawAudioToWavBlob(result, samplingRate);

  postMessage({
    type: 'result',
    id,
    payload: {
      blob,
      sampling_rate: samplingRate,
      voiceId: voice,
      language,
    }
  });
}

function rawAudioToWavBlob(audio: any, fallbackSampleRate: number): Blob {
  if (typeof audio?.toBlob === 'function') {
    return audio.toBlob();
  }

  const samples = audio?.audio instanceof Float32Array
    ? audio.audio
    : audio?.data instanceof Float32Array
      ? audio.data
      : audio instanceof Float32Array
        ? audio
        : null;

  if (!samples) {
    throw new Error('The TTS model returned an unsupported audio payload.');
  }

  return new Blob([encodeWAV(samples, audio?.sampling_rate ?? audio?.samplingRate ?? fallbackSampleRate)], { type: 'audio/wav' });
}

function encodeWAV(samples: Float32Array, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

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

async function cachedFetch(url: string): Promise<Response> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(TTS_ASSET_CACHE_NAME);
    const cached = await cache.match(url);
    if (cached) {
      return cached;
    }
  } catch (error) {
    console.warn('Unable to open TTS asset cache', error);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch TTS model asset (${response.status}).`);
  }

  if (cache) {
    try {
      await cache.put(url, response.clone());
    } catch (error) {
      console.warn('Unable to cache TTS model asset', error);
    }
  }

  return response;
}

async function phonemizeKokoroText(text: string, voicePrefix: string): Promise<string> {
  const normalized = text
    .replace(/[‘’]/g, '\'')
    .replace(/[“”]/g, '"')
    .replace(/、/g, ', ')
    .replace(/。/g, '. ')
    .replace(/[^\S \n]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  const { phonemize } = await loadPhonemizer();
  const voice = voicePrefix === 'a' ? 'en-us' : 'en';
  const phonemes = await phonemize(normalized, voice);
  const phonemeText = Array.isArray(phonemes) ? phonemes.join(' ') : String(phonemes || normalized);

  return phonemeText
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .trim();
}

async function loadPhonemizer(): Promise<{ phonemize: (text: string, voice?: string) => Promise<string[] | string> }> {
  if (!phonemizerModulePromise) {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{ phonemize: (text: string, voice?: string) => Promise<string[] | string> }>;
    phonemizerModulePromise = dynamicImport(PHONEMIZER_MODULE_URL);
  }

  return phonemizerModulePromise;
}

function chunkTextForTts(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  const sentences = normalized.match(/[^.!?]+[.!?]*/g) ?? [normalized];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences.map(value => value.trim()).filter(Boolean)) {
    if (current && `${current} ${sentence}`.length > 320) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function mergeAudioChunks(chunks: PiperRawAudio[]): PiperRawAudio {
  if (chunks.length === 0) {
    return new PiperRawAudio(new Float32Array(), 22050);
  }

  const samplingRate = chunks[0].samplingRate;
  const totalLength = chunks.reduce((total, chunk) => total + chunk.audio.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk.audio, offset);
    offset += chunk.audio.length;
  }

  return new PiperRawAudio(merged, samplingRate);
}

function normalizePeak(samples: Float32Array, target = 0.9): void {
  if (!samples.length) {
    return;
  }

  let max = 1e-9;
  for (const sample of samples) {
    max = Math.max(max, Math.abs(sample));
  }

  const gain = Math.min(4, target / max);
  if (gain < 1) {
    for (let index = 0; index < samples.length; index++) {
      samples[index] *= gain;
    }
  }
}

function trimSilence(samples: Float32Array, threshold = 0.002, paddingSamples = 480): Float32Array {
  let start = 0;
  let end = samples.length - 1;

  while (start < end && Math.abs(samples[start]) < threshold) {
    start++;
  }

  while (end > start && Math.abs(samples[end]) < threshold) {
    end--;
  }

  start = Math.max(0, start - paddingSamples);
  end = Math.min(samples.length, end + paddingSamples);

  return samples.slice(start, end);
}

function normalizeVoiceSpeed(value: unknown): number {
  const speed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : 1;
  return Number.isFinite(speed) ? Math.min(Math.max(speed, 0.5), 2) : 1;
}

function normalizePiperVoice(value: unknown): number {
  const voice = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : 0;
  return Number.isFinite(voice) ? Math.min(Math.max(Math.round(voice), 0), 903) : 0;
}

function normalizeKokoroDtype(value: unknown): 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16' {
  return value === 'fp32' || value === 'fp16' || value === 'q4' || value === 'q4f16' ? value : 'q8';
}

function normalizeKokoroDevice(value: unknown): 'wasm' | 'webgpu' | 'cpu' | null {
  return value === 'webgpu' || value === 'cpu' ? value : 'wasm';
}

function normalizeSupertonicDevice(value: unknown): 'wasm' | 'webgpu' {
  return value === 'webgpu' ? 'webgpu' : 'wasm';
}

function normalizeSupertonicVoice(value: unknown): string {
  const voice = typeof value === 'string' ? value.trim() : '';
  return SUPERTONIC_VOICES.has(voice) ? voice : 'F1';
}

function normalizeSupertonicLanguage(value: unknown): string {
  const language = typeof value === 'string' ? value.trim() : '';
  return SUPERTONIC_LANGUAGES.has(language) ? language : 'en';
}

function patchSupertonicPostprocessWaveform(pipelineInstance: any): void {
  const model = pipelineInstance?.model;
  if (!model || typeof model._postprocess_waveform !== 'function' || model.__nostriaPostprocessPatchApplied) {
    return;
  }

  const originalPostprocess = model._postprocess_waveform.bind(model);
  model._postprocess_waveform = function patchedPostprocessWaveform(waveform: any, ...args: any[]) {
    if (waveform?.dims?.length === 1 && typeof waveform.view === 'function') {
      waveform = waveform.view(1, waveform.dims[0]);
    } else if (waveform?.dims?.length === 3 && waveform.dims[1] === 1 && typeof waveform.view === 'function') {
      waveform = waveform.view(waveform.dims[0], waveform.dims[2]);
    }

    return originalPostprocess(waveform, ...args);
  };
  model.__nostriaPostprocessPatchApplied = true;
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
  if (task === 'text-generation') isLoaded = textGenerators.has(model);
  else if (task === 'image-text-to-text') isLoaded = multimodalGenerators.has(model);
  else if (task === 'summarization') isLoaded = !!summarizer;
  else if (task === 'sentiment-analysis') isLoaded = !!sentiment;
  else if (task === 'translation') isLoaded = translators.has(model);
  else if (task === 'automatic-speech-recognition') isLoaded = !!transcriber;
  else if (task === 'text-to-speech') {
    if (model === KOKORO_MODEL_ID) {
      isLoaded = !!kokoroTts;
    } else if (model === SUPERTONIC_MODEL_ID) {
      isLoaded = !!supertonicTts;
    } else if (model === PIPER_MODEL_ID) {
      isLoaded = !!piperTts;
    } else {
      isLoaded = !!TTSPipeline.model;
    }
  }
  else if (task === 'image-generation') isLoaded = imageGenerators.has(model);
  else if (task === 'image-upscaling') isLoaded = imageUpscalers.has(model);

  // Check cache if not loaded
  if (!isLoaded) {
    try {
      const cache = await caches.open(model === PIPER_MODEL_ID ? TTS_ASSET_CACHE_NAME : 'transformers-cache');
      // We check for the existence of the model config file in the cache
      // The URL pattern is usually: https://huggingface.co/{model}/resolve/main/config.json
      // But it might vary.
      const modelPath = model === PIPER_MODEL_ID
        ? PIPER_CONFIG_URL
        : model.startsWith('http') ? model : `https://huggingface.co/${model}/resolve/main/config.json`;
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
