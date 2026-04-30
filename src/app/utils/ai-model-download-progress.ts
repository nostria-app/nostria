export interface AiModelDownloadProgressState {
  modelName: string;
  status: string;
  file: string;
  progress: number | null;
  loadedBytes: number | null;
  totalBytes: number | null;
}

interface AiModelProgressPayload {
  status?: string;
  file?: string;
  name?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

interface AiModelFileProgress {
  loadedBytes: number;
  totalBytes: number | null;
  done: boolean;
}

export function describeAiModelLoadingStatus(status: string | undefined): string {
  switch (status) {
    case 'initiate':
      return 'Starting download';
    case 'download':
    case 'progress':
    case 'progress_total':
      return 'Downloading';
    case 'done':
      return 'Downloaded';
    case 'ready':
      return 'Loading into memory';
    default:
      return status ? status.replace(/[-_]/g, ' ') : 'Loading';
  }
}

export function normalizeAiModelProgress(data: unknown, modelName: string): AiModelDownloadProgressState | null {
  const payload = toAiModelProgressPayload(data);
  if (!payload) {
    return null;
  }

  const rawProgress = typeof payload.progress === 'number' && Number.isFinite(payload.progress)
    ? payload.progress
    : null;
  const progress = rawProgress === null
    ? null
    : normalizeProgressPercent(rawProgress);

  return {
    modelName,
    status: describeAiModelLoadingStatus(payload.status),
    file: payload.file ?? payload.name ?? '',
    progress,
    loadedBytes: toFiniteByteCount(payload.loaded),
    totalBytes: toFiniteByteCount(payload.total),
  };
}

export class AiModelDownloadProgressTracker {
  private readonly files = new Map<string, AiModelFileProgress>();
  private fallbackProgress: number | null = null;

  constructor(private readonly modelName: string) {
  }

  update(data: unknown): AiModelDownloadProgressState | null {
    const normalized = normalizeAiModelProgress(data, this.modelName);
    const payload = toAiModelProgressPayload(data);
    if (!normalized || !payload) {
      return null;
    }

    const file = normalized.file;
    const loadedBytes = normalized.loadedBytes;
    const totalBytes = normalized.totalBytes;

    if (file) {
      const current = this.files.get(file) ?? { loadedBytes: 0, totalBytes: null, done: false };
      const nextTotal = totalBytes ?? current.totalBytes;
      const nextLoaded = loadedBytes
        ?? (payload.status === 'done' && nextTotal !== null ? nextTotal : current.loadedBytes);

      this.files.set(file, {
        loadedBytes: Math.max(current.loadedBytes, nextLoaded),
        totalBytes: nextTotal,
        done: payload.status === 'done' || current.done,
      });
    }

    if (normalized.progress !== null) {
      this.fallbackProgress = Math.max(this.fallbackProgress ?? 0, normalized.progress);
    }

    const aggregate = this.aggregateProgress();
    return {
      ...normalized,
      progress: aggregate.progress ?? normalized.progress,
      loadedBytes: aggregate.loadedBytes ?? normalized.loadedBytes,
      totalBytes: aggregate.totalBytes ?? normalized.totalBytes,
    };
  }

  private aggregateProgress(): {
    progress: number | null;
    loadedBytes: number | null;
    totalBytes: number | null;
  } {
    const trackedFiles = [...this.files.values()].filter(file => file.totalBytes !== null);
    if (trackedFiles.length === 0) {
      return {
        progress: this.fallbackProgress,
        loadedBytes: null,
        totalBytes: null,
      };
    }

    const loadedBytes = trackedFiles.reduce((sum, file) => sum + Math.min(file.loadedBytes, file.totalBytes ?? file.loadedBytes), 0);
    const totalBytes = trackedFiles.reduce((sum, file) => sum + (file.totalBytes ?? 0), 0);
    const progress = totalBytes > 0 ? Math.max(0, Math.min(99, Math.round((loadedBytes / totalBytes) * 100))) : null;

    return {
      progress,
      loadedBytes,
      totalBytes,
    };
  }
}

function toAiModelProgressPayload(data: unknown): AiModelProgressPayload | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  return data as AiModelProgressPayload;
}

function normalizeProgressPercent(progress: number): number {
  return Math.max(0, Math.min(99, Math.round(progress <= 1 ? progress * 100 : progress)));
}

function toFiniteByteCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
