export interface AiDeviceSnapshot {
  deviceMemoryGb: number | null;
  hardwareConcurrency: number | null;
  webGpuAvailable: boolean;
  saveDataEnabled: boolean;
  effectiveConnectionType: string | null;
  likelyConstrained: boolean;
  storageQuotaBytes: number | null;
  storageUsageBytes: number | null;
}

export type AiGuidanceMode = 'cloud-first' | 'hybrid' | 'local-chat' | 'full-local';

export interface AiDeviceGuidance {
  mode: AiGuidanceMode;
  title: string;
  summary: string;
  reasons: string[];
  tips: string[];
}

const FOUR_GIB = 4 * 1024 * 1024 * 1024;

export function buildAiDeviceGuidance(snapshot: AiDeviceSnapshot): AiDeviceGuidance {
  const lowMemory = snapshot.deviceMemoryGb !== null && snapshot.deviceMemoryGb <= 4;
  const midMemory = snapshot.deviceMemoryGb !== null && snapshot.deviceMemoryGb < 8;
  const lowCpu = snapshot.hardwareConcurrency !== null && snapshot.hardwareConcurrency <= 4;
  const midCpu = snapshot.hardwareConcurrency !== null && snapshot.hardwareConcurrency < 8;
  const availableStorageBytes = getAvailableStorageBytes(snapshot);
  const lowStorage = availableStorageBytes !== null && availableStorageBytes < FOUR_GIB;
  const noWebGpu = !snapshot.webGpuAvailable;
  const constrained = snapshot.likelyConstrained || snapshot.saveDataEnabled;
  const reasons = buildReasons(snapshot, { lowMemory, lowCpu, noWebGpu, lowStorage, constrained });

  if (lowMemory || (noWebGpu && (lowCpu || constrained))) {
    return {
      mode: 'cloud-first',
      title: 'Cloud providers are the safer default on this device',
      summary: 'You can still use the AI page, but larger local models will be limited here. Add an OpenAI or xAI API key in AI Settings when you want faster or heavier workloads.',
      reasons,
      tips: [
        'Use cloud chat or image providers for heavier tasks and long responses.',
        'Keep local usage to smaller models such as DistilGPT2 when you want on-device privacy.',
        'Janus image generation needs WebGPU, so it will stay unavailable until the browser exposes it.',
      ],
    };
  }

  if (noWebGpu || midMemory || midCpu || lowStorage || constrained) {
    return {
      mode: 'hybrid',
      title: 'Use a hybrid setup: small local models plus cloud APIs',
      summary: 'This device should handle lighter local chat well, but heavier local models and image generation are better handled by a cloud provider when available.',
      reasons,
      tips: [
        'Start with smaller local chat models like Qwen 3 0.6B or DistilGPT2.',
        'Use API keys in AI Settings for bigger chat tasks, image generation, or faster replies.',
        'Expect local downloads to take extra space because models are cached in the browser.',
      ],
    };
  }

  if ((snapshot.deviceMemoryGb === null || snapshot.deviceMemoryGb >= 12)
    && (snapshot.hardwareConcurrency === null || snapshot.hardwareConcurrency >= 8)
    && !lowStorage) {
    return {
      mode: 'full-local',
      title: 'This device looks ready for local AI workloads',
      summary: 'Local chat, vision, and browser-based image generation should be a good fit here. Cloud providers are still useful when you want different models or faster turnaround.',
      reasons,
      tips: [
        'Qwen 3.5 Vision, Gemma, and Janus image generation are the best local fits.',
        'Expect the first run to download and cache models before responses are fast.',
        'Keep cloud providers configured as a fallback when you want alternate models.',
      ],
    };
  }

  return {
    mode: 'local-chat',
    title: 'Local chat should work well here',
    summary: 'This device looks capable enough for local chat models. Cloud providers remain useful for heavier prompts, image generation, or faster responses.',
    reasons,
    tips: [
      'Qwen 3 chat models are a good local starting point on this device.',
      'Vision and image generation may still benefit from cloud providers depending on prompt size.',
      'Downloaded models stay cached locally, so available storage still matters over time.',
    ],
  };
}

function buildReasons(
  snapshot: AiDeviceSnapshot,
  flags: {
    lowMemory: boolean;
    lowCpu: boolean;
    noWebGpu: boolean;
    lowStorage: boolean;
    constrained: boolean;
  },
): string[] {
  const reasons: string[] = [];

  if (flags.lowMemory) {
    reasons.push('The browser reports 4 GB of device memory or less.');
  } else if (snapshot.deviceMemoryGb !== null) {
    reasons.push(`The browser reports about ${snapshot.deviceMemoryGb} GB of device memory.`);
  } else {
    reasons.push('The browser does not expose total device memory, so guidance is based on the remaining signals.');
  }

  if (flags.lowCpu) {
    reasons.push('CPU concurrency is low, which usually means slower local inference.');
  } else if (snapshot.hardwareConcurrency !== null) {
    reasons.push(`The browser reports ${snapshot.hardwareConcurrency} logical CPU threads.`);
  }

  if (flags.noWebGpu) {
    reasons.push('WebGPU is not available, so the larger local chat and image models are limited.');
  } else {
    reasons.push('WebGPU is available for browser-based acceleration.');
  }

  if (flags.lowStorage) {
    reasons.push('Free browser storage looks tight for keeping several local models cached.');
  }

  if (flags.constrained) {
    reasons.push('The device or connection appears to be running in a constrained mode.');
  }

  return reasons;
}

function getAvailableStorageBytes(snapshot: AiDeviceSnapshot): number | null {
  if (snapshot.storageQuotaBytes === null || snapshot.storageUsageBytes === null) {
    return null;
  }

  return Math.max(0, snapshot.storageQuotaBytes - snapshot.storageUsageBytes);
}