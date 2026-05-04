function createValidatedUtcDate(year: number, month: number, day: number): number | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.getTime();
}

export function parseMusicReleasedTag(value: string | null | undefined): number | null {
  const released = value?.trim();
  if (!released) {
    return null;
  }

  if (/^\d{4}$/.test(released)) {
    return Date.UTC(Number.parseInt(released, 10), 0, 1);
  }

  const ymdMatch = released.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymdMatch) {
    const [, year, month, day] = ymdMatch;
    return createValidatedUtcDate(
      Number.parseInt(year, 10),
      Number.parseInt(month, 10),
      Number.parseInt(day, 10),
    );
  }

  const mdyMatch = released.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, month, day, year] = mdyMatch;
    return createValidatedUtcDate(
      Number.parseInt(year, 10),
      Number.parseInt(month, 10),
      Number.parseInt(day, 10),
    );
  }

  const parsed = Date.parse(released);
  return Number.isNaN(parsed) ? null : parsed;
}