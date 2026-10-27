// Нерабочие будни по производственному календарю.
// 2026: постановление Правительства РФ от 24.09.2025 № 1466 и ст. 112 ТК РФ
// (в том числе 9 марта и 11 мая — перенос выходного).
// 2027: постановление Правительства РФ от 17.09.2026 № 1187 и ст. 112 ТК РФ.
const NON_WORKING_WEEKDAYS = new Set<string>([
  "2026-01-01",
  "2026-01-02",
  "2026-01-05",
  "2026-01-06",
  "2026-01-07",
  "2026-01-08",
  "2026-01-09",
  "2026-02-23",
  "2026-03-09",
  "2026-05-01",
  "2026-05-11",
  "2026-06-12",
  "2026-11-04",
  "2026-12-31",
  "2027-01-01",
  "2027-01-04",
  "2027-01-05",
  "2027-01-06",
  "2027-01-07",
  "2027-01-08",
  "2027-02-22",
  "2027-02-23",
  "2027-03-08",
  "2027-05-03",
  "2027-05-10",
  "2027-06-14",
  "2027-11-04",
  "2027-11-05",
  "2027-12-31",
]);

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function moscowParts(date: Date): { iso: string; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY[parts.weekday] ?? 0,
  };
}

export function isWorkingDay(date: Date): boolean {
  const { iso, weekday } = moscowParts(date);
  return weekday >= 1 && weekday <= 5 && !NON_WORKING_WEEKDAYS.has(iso);
}

export function formatMoscowDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
