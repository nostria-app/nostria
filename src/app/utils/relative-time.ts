/**
 * Localized relative-time formatting for Nostr timestamps (seconds).
 *
 * Used by the ago pipe (notes, reactions) and getRelativeTime (event headers).
 * Strings go through $localize so extract-i18n + locale JSON pick them up.
 */

export type RelativeTimeFormat = 'short' | 'long';

const MINUTE = 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const WEEK = DAY * 7;
const MONTH = DAY * 30;
const YEAR = DAY * 365;

export function formatRelativeTimeAgo(
  timestampSeconds: number | null | undefined,
  format: RelativeTimeFormat = 'long',
): string {
  if (timestampSeconds === null || timestampSeconds === undefined || timestampSeconds === 0) {
    return '';
  }

  const diff = Math.floor(Date.now() / 1000) - timestampSeconds;

  if (diff < 0) {
    return format === 'short'
      ? $localize`:@@ago.now:now`
      : $localize`:@@ago.future:in the future`;
  }

  if (format === 'short') {
    return formatShortAgo(diff);
  }

  return formatLongAgo(diff);
}

/**
 * Compact header-style relative time: "just now", "7m ago", "2h ago".
 */
export function formatCompactRelativeTime(
  timestampSeconds: number,
  includeAgo = true,
): string {
  const diff = Math.floor(Date.now() / 1000) - timestampSeconds;

  if (diff < 0) {
    return $localize`:@@ago.future:in the future`;
  }

  if (diff < MINUTE) {
    return $localize`:@@ago.just-now:just now`;
  }

  const count = compactUnitCount(diff);
  if (!includeAgo) {
    return count.label;
  }

  return count.withAgo;
}

export function formatRelativeDuration(seconds: number): string {
  const diff = Math.max(0, seconds);

  if (diff < 5) {
    return $localize`:@@ago.duration.few-seconds:a few seconds`;
  }
  if (diff < MINUTE) {
    const count = Math.floor(diff);
    return $localize`:@@ago.duration.seconds:${count}:count: seconds`;
  }
  if (diff < MINUTE * 2) {
    return $localize`:@@ago.duration.a-minute:a minute`;
  }
  if (diff < HOUR) {
    const count = Math.floor(diff / MINUTE);
    return $localize`:@@ago.duration.minutes:${count}:count: minutes`;
  }
  if (diff < HOUR * 2) {
    return $localize`:@@ago.duration.an-hour:an hour`;
  }
  if (diff < DAY) {
    const count = Math.floor(diff / HOUR);
    return $localize`:@@ago.duration.hours:${count}:count: hours`;
  }
  if (diff < DAY * 2) {
    return $localize`:@@ago.duration.a-day:a day`;
  }
  if (diff < WEEK) {
    const count = Math.floor(diff / DAY);
    return $localize`:@@ago.duration.days:${count}:count: days`;
  }
  if (diff < WEEK * 2) {
    return $localize`:@@ago.duration.a-week:a week`;
  }
  if (diff < MONTH) {
    const count = Math.floor(diff / WEEK);
    return $localize`:@@ago.duration.weeks:${count}:count: weeks`;
  }
  if (diff < MONTH * 2) {
    return $localize`:@@ago.duration.a-month:a month`;
  }
  if (diff < YEAR) {
    const count = Math.floor(diff / MONTH);
    return $localize`:@@ago.duration.months:${count}:count: months`;
  }
  if (diff < YEAR * 2) {
    return $localize`:@@ago.duration.a-year:a year`;
  }

  const count = Math.floor(diff / YEAR);
  return $localize`:@@ago.duration.years:${count}:count: years`;
}

export function formatNever(): string {
  return $localize`:@@ago.never:never`;
}

function formatShortAgo(diff: number): string {
  if (diff < 5) {
    return $localize`:@@ago.now:now`;
  }
  if (diff < MINUTE) {
    const count = Math.floor(diff);
    return $localize`:@@ago.short.seconds:${count}:count:s`;
  }
  return compactUnitCount(diff).withAgo;
}

function formatLongAgo(diff: number): string {
  if (diff < 5) {
    return $localize`:@@ago.just-now:just now`;
  }
  if (diff < MINUTE) {
    const count = Math.floor(diff);
    return $localize`:@@ago.seconds:${count}:count: seconds ago`;
  }
  if (diff < MINUTE * 2) {
    return $localize`:@@ago.a-minute:a minute ago`;
  }
  if (diff < HOUR) {
    const count = Math.floor(diff / MINUTE);
    return $localize`:@@ago.minutes:${count}:count: minutes ago`;
  }
  if (diff < HOUR * 2) {
    return $localize`:@@ago.an-hour:an hour ago`;
  }
  if (diff < DAY) {
    const count = Math.floor(diff / HOUR);
    return $localize`:@@ago.hours:${count}:count: hours ago`;
  }
  if (diff < DAY * 2) {
    return $localize`:@@ago.yesterday:yesterday`;
  }
  if (diff < WEEK) {
    const count = Math.floor(diff / DAY);
    return $localize`:@@ago.days:${count}:count: days ago`;
  }
  if (diff < WEEK * 2) {
    return $localize`:@@ago.a-week:a week ago`;
  }
  if (diff < MONTH) {
    const count = Math.floor(diff / WEEK);
    return $localize`:@@ago.weeks:${count}:count: weeks ago`;
  }
  if (diff < MONTH * 2) {
    return $localize`:@@ago.a-month:a month ago`;
  }
  if (diff < YEAR) {
    const count = Math.floor(diff / MONTH);
    return $localize`:@@ago.months:${count}:count: months ago`;
  }
  if (diff < YEAR * 2) {
    return $localize`:@@ago.a-year:a year ago`;
  }

  const count = Math.floor(diff / YEAR);
  return $localize`:@@ago.years:${count}:count: years ago`;
}

function compactUnitCount(diff: number): { label: string; withAgo: string } {
  if (diff < HOUR) {
    const count = Math.floor(diff / MINUTE);
    return {
      label: $localize`:@@ago.short.minutes:${count}:count:m`,
      withAgo: $localize`:@@ago.short.minutes-ago:${count}:count:m ago`,
    };
  }
  if (diff < DAY) {
    const count = Math.floor(diff / HOUR);
    return {
      label: $localize`:@@ago.short.hours:${count}:count:h`,
      withAgo: $localize`:@@ago.short.hours-ago:${count}:count:h ago`,
    };
  }
  if (diff < WEEK) {
    const count = Math.floor(diff / DAY);
    return {
      label: $localize`:@@ago.short.days:${count}:count:d`,
      withAgo: $localize`:@@ago.short.days-ago:${count}:count:d ago`,
    };
  }
  if (diff < MONTH) {
    const count = Math.floor(diff / WEEK);
    return {
      label: $localize`:@@ago.short.weeks:${count}:count:w`,
      withAgo: $localize`:@@ago.short.weeks-ago:${count}:count:w ago`,
    };
  }
  if (diff < YEAR) {
    const count = Math.floor(diff / MONTH);
    return {
      label: $localize`:@@ago.short.months:${count}:count:mo`,
      withAgo: $localize`:@@ago.short.months-ago:${count}:count:mo ago`,
    };
  }

  const count = Math.floor(diff / YEAR);
  return {
    label: $localize`:@@ago.short.years:${count}:count:y`,
    withAgo: $localize`:@@ago.short.years-ago:${count}:count:y ago`,
  };
}
