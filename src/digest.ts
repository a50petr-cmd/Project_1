import { formatMoscowDate, isWorkingDay } from "./calendar.ts";
import { dominantThemes, writeLetter, type AiLike } from "./letter.ts";
import { roleGroup, scoreVacancy } from "./match.ts";
import { profile } from "./profile.ts";
import { findVacancies, selectMatches } from "./search.ts";
import type { FetchLike } from "./sources.ts";
import { readSettings, writeBook, writeSettings, type Settings, type Store } from "./store.ts";
import { formatSourceStatus, formatVacancyCard, newVacancyButtons, type InlineMarkup } from "./telegram.ts";
import type { Theme } from "./profile.ts";
import { addApps, shortId, type AppDetails, type AppRecord } from "./tracker.ts";
import type { ScoredVacancy, SourceReport } from "./types.ts";

export type Send = (text: string, extra?: { markup?: InlineMarkup; plain?: boolean }) => Promise<void>;

const THEME_LABEL: Record<Theme, string> = {
  import: "импорт и логистика",
  ecommerce: "онлайн-продажи",
  franchise: "розница и франчайзинг",
  darkstore: "доставка",
  b2b: "B2B и опт",
  pnl: "P&L и затраты",
  team: "процессы и команда",
  projects: "запуски проектов",
};

export function whyLine(vacancy: ScoredVacancy): string {
  const themes = dominantThemes(vacancy).slice(0, 4);
  if (themes.length === 0) return "";
  return `в вакансии ${themes.map((theme) => THEME_LABEL[theme]).join(", ")} — это есть в вашем опыте.`;
}

export type DigestResult = {
  status: "sent" | "empty" | "skipped" | "failed";
  reason?: string;
  sent: number;
  reports: SourceReport[];
};

export async function runDigest(options: {
  store: Store;
  fetch: FetchLike;
  send: Send;
  ai?: AiLike;
  now?: Date;
  force?: boolean;
  superjobKey?: string;
  settingsOverride?: Partial<Settings>;
}): Promise<DigestResult> {
  const now = options.now ?? new Date();
  const settings = { ...(await readSettings(options.store)), ...options.settingsOverride };
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(now);
  const lockKey = `digest-lock:${day}`;

  if (!options.force && !settings.enabled) {
    return { status: "skipped", reason: "paused", sent: 0, reports: [] };
  }
  if (!options.force && !isWorkingDay(now)) {
    return { status: "skipped", reason: "holiday", sent: 0, reports: [] };
  }
  if (!options.force && (await options.store.get(lockKey))) {
    return { status: "skipped", reason: "already-ran", sent: 0, reports: [] };
  }
  if (!options.force) await options.store.put(lockKey, now.toISOString(), 36 * 3600);

  try {
    const found = await findVacancies({
      fetch: options.fetch,
      store: options.store,
      now,
      periodDays: settings.periodDays,
      enrichLimit: Math.max(settings.limit, 8),
      superjobKey: options.superjobKey,
      minSalary: settings.minSalary,
      onReports: (reports) => options.send(formatSourceStatus(formatMoscowDate(now), reports)),
    });

    const timestamp = now.getTime();
    const book = found.book;
    for (const vacancy of found.vacancies) {
      const scored = scoreVacancy(vacancy, timestamp, settings.minSalary);
      if (!scored || scored.score < settings.minScore) book[vacancy.dedupeKey] = "skip";
    }

    const chosen = selectMatches(found.vacancies, {
      now: timestamp,
      periodDays: settings.periodDays,
      minScore: settings.minScore,
      limit: settings.limit,
      minSalary: settings.minSalary,
    });
    if (chosen.length === 0) await options.send(`На ${formatMoscowDate(now)} новых подходящих вакансий нет.`);
    const tracked: Array<{ record: AppRecord; details: AppDetails }> = [];
    for (const vacancy of chosen) {
      const id = shortId(vacancy.dedupeKey);
      const group = roleGroup(vacancy.title);
      const letter = await writeLetter(vacancy, { ai: options.ai });
      await options.send(formatVacancyCard(vacancy, whyLine(vacancy), group), { markup: newVacancyButtons(id) });
      await options.send(letter.text, { plain: true });
      book[vacancy.dedupeKey] = "seen";
      tracked.push({
        record: {
          id,
          title: vacancy.title,
          company: vacancy.company,
          url: vacancy.url,
          group,
          status: "new",
          sentAt: now.toISOString(),
        },
        details: { vacancy: { ...vacancy, description: vacancy.description.slice(0, 4_000) }, letter: letter.text, rewrites: 0 },
      });
    }
    await addApps(options.store, tracked);
    await writeBook(options.store, book);

    const result: DigestResult = {
      status: chosen.length ? "sent" : "empty",
      sent: chosen.length,
      reports: found.reports,
    };
    await options.store.put("last-run", JSON.stringify({ ...result, at: now.toISOString() }));
    await options.store.put("profile", JSON.stringify({ name: profile.name, city: profile.city, targetRole: profile.targetRole }));
    await options.store.put(lockKey, now.toISOString(), 36 * 3600);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await options.store.put("last-run", JSON.stringify({ status: "failed", reason: message, at: now.toISOString(), sent: 0, reports: [] }));
    if (!options.force) await options.store.put(lockKey, "failed", 120);
    try {
      await options.send(`Не удалось собрать подборку: ${message.slice(0, 400)}`);
    } catch {
      // отправитель тоже может быть недоступен
    }
    return { status: "failed", reason: message, sent: 0, reports: [] };
  }
}

export async function setPaused(store: Store, paused: boolean): Promise<Settings> {
  const settings = await readSettings(store);
  const next = { ...settings, enabled: !paused };
  await writeSettings(store, next);
  return next;
}
