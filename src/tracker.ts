import { isWorkingDay } from "./calendar.ts";
import type { Store } from "./store.ts";
import type { ScoredVacancy } from "./types.ts";

// Учёт откликов: что бот прислал, на что Пётр откликнулся и чем это закончилось.
// Лёгкие записи лежат одним списком в ключе "apps", полные (с текстом вакансии и письмом) — в "app:<id>".

export type AppStatus = "new" | "applied" | "invite" | "reject" | "skip";

export type AppRecord = {
  id: string;
  title: string;
  company: string;
  url: string;
  group: string;
  status: AppStatus;
  sentAt: string;
  appliedAt?: string;
  closedAt?: string;
  remindedAt?: string;
};

export type AppDetails = {
  vacancy: ScoredVacancy;
  letter: string;
  rewrites: number;
};

const INDEX_KEY = "apps";
const INDEX_LIMIT = 500;
const DETAILS_TTL = 120 * 86_400;
export const REMIND_AFTER_WORKING_DAYS = 5;

// FNV-1a: короткий стабильный id для callback_data (лимит Telegram — 64 байта).
export function shortId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export async function readApps(store: Store): Promise<AppRecord[]> {
  const raw = await store.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AppRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeApps(store: Store, apps: AppRecord[]): Promise<void> {
  await store.put(INDEX_KEY, JSON.stringify(apps.slice(-INDEX_LIMIT)));
}

export async function addApps(store: Store, records: Array<{ record: AppRecord; details: AppDetails }>): Promise<void> {
  if (records.length === 0) return;
  const apps = await readApps(store);
  const known = new Set(apps.map((app) => app.id));
  for (const { record, details } of records) {
    if (!known.has(record.id)) apps.push(record);
    await store.put(`app:${record.id}`, JSON.stringify(details), DETAILS_TTL);
  }
  await writeApps(store, apps);
}

export async function readDetails(store: Store, id: string): Promise<AppDetails | null> {
  const raw = await store.get(`app:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AppDetails;
  } catch {
    return null;
  }
}

export async function saveDetails(store: Store, id: string, details: AppDetails): Promise<void> {
  await store.put(`app:${id}`, JSON.stringify(details), DETAILS_TTL);
}

export async function updateApp(
  store: Store,
  id: string,
  change: (record: AppRecord) => AppRecord,
): Promise<AppRecord | null> {
  const apps = await readApps(store);
  const index = apps.findIndex((app) => app.id === id);
  if (index === -1) return null;
  apps[index] = change(apps[index]);
  await writeApps(store, apps);
  return apps[index];
}

export function setStatus(status: AppStatus, now: Date): (record: AppRecord) => AppRecord {
  const at = now.toISOString();
  return (record) => {
    if (status === "applied") return { ...record, status, appliedAt: record.appliedAt ?? at };
    if (status === "invite" || status === "reject") {
      return { ...record, status, appliedAt: record.appliedAt ?? at, closedAt: at };
    }
    return { ...record, status, closedAt: at };
  };
}

export function workingDaysBetween(from: Date, to: Date): number {
  let days = 0;
  const cursor = new Date(from.getTime());
  while (cursor.getTime() + 86_400_000 <= to.getTime()) {
    cursor.setTime(cursor.getTime() + 86_400_000);
    if (isWorkingDay(cursor)) days += 1;
  }
  return days;
}

// Отклики без ответа, о которых пора спросить. Напоминаем раз в 5 рабочих дней.
export function dueReminders(apps: AppRecord[], now: Date, limit = 5): AppRecord[] {
  return apps
    .filter((app) => app.status === "applied" && app.appliedAt)
    .filter((app) => {
      const since = new Date(app.remindedAt ?? app.appliedAt ?? now.toISOString());
      return workingDaysBetween(since, now) >= REMIND_AFTER_WORKING_DAYS;
    })
    .slice(0, limit);
}

function percent(part: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

function countBy(apps: AppRecord[]): { sent: number; applied: number; invite: number; reject: number; waiting: number; skip: number } {
  const applied = apps.filter((app) => app.appliedAt || app.status === "applied");
  return {
    sent: apps.length,
    applied: applied.length,
    invite: apps.filter((app) => app.status === "invite").length,
    reject: apps.filter((app) => app.status === "reject").length,
    waiting: apps.filter((app) => app.status === "applied").length,
    skip: apps.filter((app) => app.status === "skip").length,
  };
}

export function formatStats(apps: AppRecord[], now: Date, title = "Статистика откликов"): string {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const week = apps.filter((app) => Date.parse(app.sentAt) >= weekAgo || Date.parse(app.appliedAt ?? "") >= weekAgo);
  const w = countBy(week);
  const all = countBy(apps);

  const lines = [
    title,
    "",
    "За 7 дней:",
    `Прислал вакансий: ${w.sent}, не подошло: ${w.skip}`,
    `Откликов: ${w.applied}`,
    `Приглашений: ${w.invite} · отказов: ${w.reject} · ждём ответа: ${w.waiting}`,
    "",
    "За всё время:",
    `Откликов: ${all.applied} → приглашений: ${all.invite} (${percent(all.invite, all.applied)})`,
    `Отказов: ${all.reject} · ждём ответа: ${all.waiting}`,
  ];

  const groups = new Map<string, { applied: number; invite: number }>();
  for (const app of apps) {
    if (!app.appliedAt && app.status !== "applied") continue;
    const row = groups.get(app.group) ?? { applied: 0, invite: 0 };
    row.applied += 1;
    if (app.status === "invite") row.invite += 1;
    groups.set(app.group, row);
  }
  if (groups.size > 0) {
    lines.push("", "По ролям (отклики → приглашения):");
    for (const [group, row] of [...groups.entries()].sort((a, b) => b[1].invite - a[1].invite || b[1].applied - a[1].applied)) {
      lines.push(`— ${group}: ${row.applied} → ${row.invite}`);
    }
  }

  lines.push("", advice(all, groups));
  return lines.join("\n");
}

function advice(
  all: ReturnType<typeof countBy>,
  groups: Map<string, { applied: number; invite: number }>,
): string {
  if (all.applied === 0) {
    return "Откликов пока не отмечено. Нажимайте «✅ Откликнулся» под вакансией — так появится статистика.";
  }
  if (all.applied >= 10 && all.invite === 0) {
    return "Больше 10 откликов без приглашений: скорее всего, резюме отсекают на первом просмотре. Стоит проверить заголовок резюме и первые строки опыта.";
  }
  const best = [...groups.entries()].filter(([, row]) => row.applied >= 3).sort((a, b) => b[1].invite / b[1].applied - a[1].invite / a[1].applied)[0];
  if (best && best[1].invite > 0) {
    return `Лучше всего отвечают по роли «${best[0]}» — на такие вакансии стоит откликаться в первую очередь.`;
  }
  return "Данных пока мало для выводов: нужно хотя бы 10 отмеченных откликов.";
}

export async function upsertApp(store: Store, record: AppRecord): Promise<void> {
  const apps = await readApps(store);
  const index = apps.findIndex((app) => app.id === record.id);
  if (index === -1) apps.push(record);
  else apps[index] = record;
  await writeApps(store, apps);
}

// Карточка вакансии: 1-я строка — название, 2-я — «компания · город · площадка», дальше «Роль: …» и ссылка.
export function cardToRecord(text: string, entities: Array<{ type?: string; url?: string }>, id: string, now: Date): AppRecord | null {
  const lines = text.split("\n").map((line) => line.trim());
  const title = lines[0] ?? "";
  if (!title || !lines.some((line) => line.startsWith("Роль:"))) return null;
  const [company = "", city = ""] = (lines[1] ?? "").split(" · ");
  const group = (lines.find((line) => line.startsWith("Роль:")) ?? "").replace("Роль:", "").trim() || "Другое";
  const url = entities.find((entity) => entity.type === "text_link" && entity.url)?.url ?? "";
  return { id, title, company, url, group, status: "new", sentAt: now.toISOString(), city } as AppRecord & { city: string };
}

export function detailsFromRecord(record: AppRecord): AppDetails {
  const city = (record as AppRecord & { city?: string }).city ?? "";
  return {
    vacancy: {
      source: "hh",
      id: record.id,
      dedupeKey: record.id,
      title: record.title,
      company: record.company,
      url: record.url,
      city,
      region: city,
      salary: "",
      publishedAt: "",
      workFormat: "",
      employment: "",
      description: "",
      score: 0,
      remote: false,
    },
    letter: "",
    rewrites: 0,
  };
}
