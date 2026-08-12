import { estimateCount, hllDecode, mergeHll, newHll } from 'nostr-tools/nip45';

export type RelayCountCheckSource = 'probe' | 'nip11';

export interface RelayCountResponse {
  count: number;
  approximate?: boolean;
  hll?: string;
  queriedRelays?: number;
}

export interface EventInteractionCounts {
  reactions: number;
  replies: number;
  comments: number;
  zaps: number;
  reposts: number;
  quotes: number;
}

export function createEmptyInteractionCounts(): EventInteractionCounts {
  return {
    reactions: 0,
    replies: 0,
    comments: 0,
    zaps: 0,
    reposts: 0,
    quotes: 0,
  };
}

export function relayAdvertisesCountSupport(supportedNips: number[] | undefined): boolean {
  return Array.isArray(supportedNips) && supportedNips.includes(45);
}

/**
 * Merge COUNT responses from multiple relays.
 * Uses the NIP-45 max-of-raw-counts rule and prefers a HyperLogLog estimate
 * when any relay returned compatible `hll` registers.
 */
export function mergeRelayCountResponses(
  responses: Array<RelayCountResponse | null | undefined>,
): { count: number; approximate: boolean } {
  let maxCount = 0;
  let hll: Uint8Array | undefined;
  let anyApproximate = false;
  let sawResponse = false;

  for (const response of responses) {
    if (!response) {
      continue;
    }

    sawResponse = true;
    if (response.count > maxCount) {
      maxCount = response.count;
    }
    if (response.approximate) {
      anyApproximate = true;
    }
    if (!response.hll) {
      continue;
    }

    const registers = hllDecode(response.hll);
    if (!registers) {
      continue;
    }

    hll = mergeHll(hll || newHll(), registers);
  }

  if (hll) {
    return {
      count: Math.max(maxCount, estimateCount(hll)),
      approximate: true,
    };
  }

  return {
    count: maxCount,
    approximate: anyApproximate || !sawResponse,
  };
}

/**
 * Feed badge string: prefer a NIP-45 COUNT hint when it exceeds loaded events,
 * otherwise keep the existing "10+" overflow style from limited REQ results.
 */
export function resolveDisplayedInteractionCount(
  loaded: number,
  hint: number,
  hasMore: boolean,
): string {
  const count = Math.max(loaded, hint);
  if (count === 0) {
    return '';
  }

  if (hint > loaded) {
    return `${hint}`;
  }

  if (hasMore) {
    return `${Math.max(count - 1, 1)}+`;
  }

  return `${count}`;
}
