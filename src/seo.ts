import { formatMoscowDate, moscowParts } from "./calendar.ts";
import type { FetchLike } from "./sources.ts";
import { USER_AGENT } from "./sources.ts";
import { decodeEntities } from "./text.ts";

export const SITE_ORIGIN = "https://petr-alekseev.ru";

type PageFacts = {
  url: string;
  ok: boolean;
  status: number;
  title: string;
  description: string;
  canonical: string;
  h1: string;
  metrikaGated: boolean;
  tagsChecked: boolean;
  error: string;
};

function attr(html: string, what: "description" | "canonical"): string {
  if (what === "description") {
    const named = html.match(/<meta[^>]+name=["']description["'][^>]*>/i)?.[0] ?? "";
    const content = named.match(/content=["']([^"']*)["']/i)?.[1] ?? "";
    return decodeEntities(content).replace(/\s+/g, " ").trim();
  }
  const link = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0] ?? "";
  return link.match(/href=["']([^"']*)["']/i)?.[1]?.trim() ?? "";
}

function textTag(html: string, tag: string): string {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return "";
  return decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function sitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) => match[1]);
}

const PAGE_BYTES = 4_096;
const HOME_BYTES = 12_288;
const INSPECT_DEADLINE_MS = 8_000;

function boundSignal(parent: AbortSignal, ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const abort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", abort);
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}

async function prefixText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(Math.min(size, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, merged.byteLength - offset);
    if (take <= 0) break;
    merged.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return new TextDecoder("utf-8").decode(merged);
}

async function readPrefix(
  fetchImpl: FetchLike,
  url: string,
  maxBytes: number,
  parent: AbortSignal,
): Promise<{ status: number; body: string; error: string }> {
  const bound = boundSignal(parent, 5_000);
  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xml,text/plain,*/*" },
      redirect: "follow",
      signal: bound.signal,
    });
    const body = maxBytes > 0 ? await prefixText(response, maxBytes) : "";
    if (maxBytes <= 0) await response.body?.cancel().catch(() => undefined);
    return { status: response.status, body, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 0, body: "", error: parent.aborted ? "время вышло" : message.slice(0, 120) };
  } finally {
    bound.cancel();
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

function factsFrom(url: string, status: number, body: string, error: string, tagsChecked = true): PageFacts {
  return {
    url,
    ok: status >= 200 && status < 300 && !error,
    status,
    title: textTag(body, "title"),
    description: attr(body, "description"),
    canonical: attr(body, "canonical"),
    h1: textTag(body, "h1"),
    metrikaGated: false,
    tagsChecked,
    error,
  };
}

function pageProblems(page: PageFacts): string[] {
  if (!page.ok) return [`${page.url} не открылась${page.error ? `: ${page.error}` : ` (${page.status || "нет ответа"})`}`];
  if (!page.tagsChecked) return [];
  const missing = [
    page.title ? "" : "заголовок",
    page.description ? "" : "описание",
    page.canonical ? "" : "каноническая ссылка",
    page.h1 ? "" : "заголовок h1",
  ].filter(Boolean);
  if (missing.length === 0) return [];
  return [`${page.url}: нет ${missing.join(", ")}`];
}

function unfinishedReport(): string {
  return [
    `SEO-отчёт petr-alekseev.ru, ${formatMoscowDate(new Date())}`,
    "",
    "Проверка сайта не уложилась в 8 секунд, поэтому полный разбор оборван.",
    "Итог: отчёт собран частично.",
  ].join("\n");
}

function byteBudget(url: string, root: string): number {
  try {
    const path = new URL(url).pathname;
    if (path === "/" || path.endsWith("/index.html")) return HOME_BYTES;
  } catch {
    if (url === root || url === `${root}/`) return HOME_BYTES;
  }
  return PAGE_BYTES;
}

async function collectSite(fetchImpl: FetchLike, origin: string, signal: AbortSignal): Promise<string> {
  const root = origin.replace(/\/$/, "");
  const host = new URL(root).host.replace(/^www\./, "");
  const [robots, sitemap, www, indexHtml, consent] = await Promise.all([
    readPrefix(fetchImpl, `${root}/robots.txt`, PAGE_BYTES, signal),
    readPrefix(fetchImpl, `${root}/sitemap.xml`, 8_192, signal),
    readPrefix(fetchImpl, `https://www.${host}/`, HOME_BYTES, signal),
    readPrefix(fetchImpl, `${root}/index.html`, HOME_BYTES, signal),
    readPrefix(fetchImpl, `${root}/assets/js/consent.js`, PAGE_BYTES, signal),
  ]);
  if (signal.aborted) return unfinishedReport();
  const urls = sitemapUrls(sitemap.body).slice(0, 20);
  const pages = await mapPool(urls, 5, async (url) => {
    const loaded = await readPrefix(fetchImpl, url, byteBudget(url, root), signal);
    return factsFrom(url, loaded.status, loaded.body, loaded.error);
  });
  const homeUrl = `${root}/`;
  const homeFacts = pages.find((page) => page.url === homeUrl || page.url === root) ?? factsFrom(homeUrl, 0, "", "нет в карте сайта");
  homeFacts.metrikaGated = /initYandexMetrika|loadMetrika/i.test(consent.body) && !/mc\.yandex\.ru\/metrika\/tag\.js/i.test(consent.body);
  return renderSeoReport({
    dateLabel: formatMoscowDate(new Date()),
    robotsOk: robots.status >= 200 && robots.status < 300 && /sitemap:/i.test(robots.body),
    sitemapOk: sitemap.status >= 200 && sitemap.status < 300 && urls.length > 0,
    pages,
    home: homeFacts,
    wwwStatus: www.status,
    wwwCanonical: attr(www.body, "canonical"),
    indexStatus: indexHtml.status,
    indexCanonical: attr(indexHtml.body, "canonical"),
  });
}

export async function inspectSite(fetchImpl: FetchLike, origin = SITE_ORIGIN, deadlineMs = INSPECT_DEADLINE_MS): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(unfinishedReport());
    }, deadlineMs);
  });
  const work = collectSite(fetchImpl, origin, controller.signal).catch(() => unfinishedReport());
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function renderSeoReport(input: {
  dateLabel: string;
  robotsOk: boolean;
  sitemapOk: boolean;
  pages: PageFacts[];
  home: PageFacts;
  wwwStatus: number;
  wwwCanonical: string;
  indexStatus: number;
  indexCanonical: string;
}): string {
  const problems = input.pages.flatMap(pageProblems);
  const lines = [
    `SEO-отчёт petr-alekseev.ru, ${input.dateLabel}`,
    "",
    input.robotsOk ? "robots.txt открывается, карта сайта в нём указана." : "robots.txt не открылся или в нём нет ссылки на карту сайта.",
    input.sitemapOk
      ? `В карте ${input.pages.length} страниц.`
      : "Карта сайта не открылась или в ней нет адресов.",
  ];
  const opened = input.pages.filter((page) => page.ok).length;
  if (input.pages.length > 0) {
    lines.push(
      `Проверено страниц: ${input.pages.length}. Открылись: ${opened}. С заголовком: ${input.pages.filter((page) => page.title).length}. С описанием: ${input.pages.filter((page) => page.description).length}. С h1: ${input.pages.filter((page) => page.h1).length}. С канонической ссылкой: ${input.pages.filter((page) => page.canonical).length}.`,
    );
  }
  if (input.pages.length > 0 && problems.length === 0) {
    lines.push("Все страницы из карты открываются. У каждой есть заголовок, описание, каноническая ссылка и h1.");
  } else if (problems.length > 0) {
    lines.push("Замечания по страницам:", ...problems.slice(0, 12).map((line) => `• ${line}`));
    if (problems.length > 12) lines.push(`И ещё ${problems.length - 12}.`);
  }
  if (input.wwwStatus >= 200 && input.wwwStatus < 400) {
    const canon = input.wwwCanonical || "не указана";
    lines.push(`Адрес www открывается отдельно (${input.wwwStatus}), каноническая ссылка: ${canon}. Редиректа на адрес без www нет.`);
  }
  if (input.indexStatus >= 200 && input.indexStatus < 400) {
    lines.push(`Адрес /index.html тоже открывается (${input.indexStatus}), каноническая ссылка: ${input.indexCanonical || "не указана"}.`);
  }
  if (input.home.metrikaGated) {
    lines.push("Яндекс Метрика на главной включается только после согласия на cookie. До согласия визиты в отчёт Метрики не попадают.");
  }
  if (input.home.title) lines.push(`Главная: «${input.home.title}».`);
  lines.push("", "Итог: отчёт собран.");
  return lines.join("\n");
}

export function shouldSendWeeklySeo(date: Date, alreadySent: boolean): boolean {
  return moscowParts(date).weekday === 1 && !alreadySent;
}
