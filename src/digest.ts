import { formatMoscowDate, isWorkingDay } from "./calendar.ts";
import { coverLetter } from "./letter.ts";
import { scoreVacancy } from "./match.ts";
import { profile } from "./profile.ts";
import { findVacancies, seenKey, selectMatches } from "./search.ts";
import type { FetchLike } from "./sources.ts";
import { readSettings, writeBook, writeSettings, type Settings, type Store } from "./store.ts";
import { formatSourceStatus, formatVacancyMessages } from "./telegram.ts";
import type { Contacts, SourceReport } from "./types.ts";

export type DigestResult = {
  status: "sent" | "empty" | "skipped" | "failed";
  reason?: string;
  sent: number;
  reports: SourceReport[];
};

export async function runDigest(options: {
  store: Store;
  fetch: FetchLike;
  send: (text: string) => Promise<void>;
  now?: Date;
  force?: boolean;
  contacts: Contacts;
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
      onReports: (reports) => options.send(formatSourceStatus(formatMoscowDate(now), reports)),
    });

    const timestamp = now.getTime();
    const book = found.book;
    for (const vacancy of found.vacancies) {
      const scored = scoreVacancy(vacancy, timestamp);
      if (!scored || scored.score < settings.minScore) book[vacancy.dedupeKey] = "skip";
    }

    const chosen = selectMatches(found.vacancies, {
      now: timestamp,
      periodDays: settings.periodDays,
      minScore: settings.minScore,
      limit: settings.limit,
    });
    const contacts = { telegram: profile.telegram, ...options.contacts };
    if (chosen.length === 0) await options.send(`На ${formatMoscowDate(now)} новых подходящих вакансий нет.`);
    for (const vacancy of chosen) {
      const letter = coverLetter(vacancy, contacts);
      for (const message of formatVacancyMessages(vacancy, letter)) {
        await options.send(message);
      }
      book[vacancy.dedupeKey] = "seen";
      await options.store.put(
        seenKey(vacancy.dedupeKey),
        JSON.stringify({ title: vacancy.title, url: vacancy.url, company: vacancy.company, letter, sentAt: now.toISOString() }),
        120 * 86_400,
      );
    }
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
