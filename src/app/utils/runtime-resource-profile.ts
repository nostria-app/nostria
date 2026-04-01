interface ConnectionLike {
  effectiveType?: string;
  saveData?: boolean;
}

interface NavigatorLike {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  connection?: ConnectionLike | null;
  mozConnection?: ConnectionLike | null;
  webkitConnection?: ConnectionLike | null;
}

export interface FeedMemoryLimits {
  maxEvents: number;
  maxPending: number;
  maxCache: number;
}

export interface RuntimeResourceProfile {
  likelyConstrained: boolean;
  idleTaskTimeoutMs: number;
  feedLimits: FeedMemoryLimits;
}

export const DEFAULT_FEED_MEMORY_LIMITS: FeedMemoryLimits = {
  maxEvents: 1600,
  maxPending: 320,
  maxCache: 1920,
};

export const CONSTRAINED_FEED_MEMORY_LIMITS: FeedMemoryLimits = {
  maxEvents: 900,
  maxPending: 180,
  maxCache: 1080,
};

export function getRuntimeResourceProfile(navigatorLike = getNavigatorLike()): RuntimeResourceProfile {
  const connection = navigatorLike?.connection
    ?? navigatorLike?.mozConnection
    ?? navigatorLike?.webkitConnection
    ?? null;

  const deviceMemory = navigatorLike?.deviceMemory;
  const hardwareConcurrency = navigatorLike?.hardwareConcurrency;
  const effectiveType = connection?.effectiveType?.toLowerCase() ?? '';
  const saveData = connection?.saveData === true;

  const likelyConstrained =
    (typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory <= 4) ||
    (typeof hardwareConcurrency === 'number' && hardwareConcurrency > 0 && hardwareConcurrency <= 4) ||
    saveData ||
    /(^|-)2g$/.test(effectiveType);

  return {
    likelyConstrained,
    idleTaskTimeoutMs: likelyConstrained ? 5000 : 2000,
    feedLimits: likelyConstrained
      ? CONSTRAINED_FEED_MEMORY_LIMITS
      : DEFAULT_FEED_MEMORY_LIMITS,
  };
}

function getNavigatorLike(): NavigatorLike | undefined {
  if (typeof navigator === 'undefined') {
    return undefined;
  }

  return navigator as NavigatorLike;
}
