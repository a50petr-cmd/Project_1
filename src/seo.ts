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

async function readUrl(fetchImpl: FetchLike, url: string): Promise<{ status: number; body: string; error: string }> {
  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await response.text()).slice(0, 20_000);
    return { status: response.status, body, error: "" };
  } catch (error) {
    return { status: 0, body: "", error: error instanceof Error ? error.message : String(error) };
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

function factsFrom(url: string, status: number, body: string, error: string): PageFacts {
  return {
    url,
    ok: status >= 200 && status < 300 && !error,
    status,
    title: textTag(body, "title"),
    description: attr(body, "description"),
    canonical: attr(body, "canonical"),
    h1: textTag(body, "h1"),
    metrikaGated: /initYandexMetrika|consent\.js/i.test(body) && !/mc\.yandex\.ru\/metrika\/tag\.js/i.test(body),
    error,
  };
}

function pageProblems(page: PageFacts): string[] {
  if (!page.ok) return [`${page.url} не открылась${page.error ? `: ${page.error}` : ` (${page.status || "нет ответа"})`}`];
  const missing = [
    page.title ? "" : "заголовок",
    page.description ? "" : "описание",
    page.canonical ? "" : "каноническая ссылка",
    page.h1 ? "" : "заголовок h1",
  ].filter(Boolean);
  if (missing.length === 0) return [];
  return [`${page.url}: нет ${missing.join(", ")}`];
}

export async function inspectSite(fetchImpl: FetchLike, origin = SITE_ORIGIN): Promise<string> {
  const root = origin.replace(/\/$/, "");
  const [robots, sitemap, home, www, indexHtml] = await Promise.all([
    readUrl(fetchImpl, `${root}/robots.txt`),
    readUrl(fetchImpl, `${root}/sitemap.xml`),
    readUrl(fetchImpl, `${root}/`),
    readUrl(fetchImpl, "https://www.petr-alekseev.ru/"),
    readUrl(fetchImpl, `${root}/index.html`),
  ]);
  const urls = sitemapUrls(sitemap.body).slice(0, 25);
  const pages = await mapPool(urls, 4, async (url) => {
    const loaded = await readUrl(fetchImpl, url);
    return factsFrom(url, loaded.status, loaded.body, loaded.error);
  });
  const homeFacts = factsFrom(`${root}/`, home.status, home.body, home.error);
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
