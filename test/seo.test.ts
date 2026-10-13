import assert from "node:assert/strict";
import test from "node:test";
import { inspectSite, renderSeoReport, shouldSendWeeklySeo } from "../src/seo.ts";

const page = {
  url: "https://petr-alekseev.ru/",
  ok: true,
  status: 200,
  title: "Оптимизация бизнес-процессов — Пётр Алексеев",
  description: "Аудит процессов",
  canonical: "https://petr-alekseev.ru/",
  h1: "Превращаем процессы в систему",
  metrikaGated: true,
  tagsChecked: true,
  error: "",
};

test("seo report names a healthy site and the metrika gap", () => {
  const report = renderSeoReport({
    dateLabel: "13 октября 2026 г.",
    robotsOk: true,
    sitemapOk: true,
    pages: [page],
    home: page,
    wwwStatus: 200,
    wwwCanonical: "https://petr-alekseev.ru/",
    indexStatus: 200,
    indexCanonical: "https://petr-alekseev.ru/",
  });
  assert.match(report, /SEO-отчёт petr-alekseev\.ru/);
  assert.match(report, /Все страницы из карты открываются/);
  assert.match(report, /www открывается отдельно/);
  assert.match(report, /\/index\.html тоже открывается/);
  assert.match(report, /после согласия на cookie/);
});

test("seo report lists a page that did not open", () => {
  const report = renderSeoReport({
    dateLabel: "13 октября 2026 г.",
    robotsOk: false,
    sitemapOk: true,
    pages: [{ ...page, url: "https://petr-alekseev.ru/missing.html", ok: false, status: 404, title: "", description: "", canonical: "", h1: "" }],
    home: page,
    wwwStatus: 0,
    wwwCanonical: "",
    indexStatus: 0,
    indexCanonical: "",
  });
  assert.match(report, /robots\.txt не открылся/);
  assert.match(report, /missing\.html не открылась/);
});

test("weekly seo report is due on Monday only", () => {
  assert.equal(shouldSendWeeklySeo(new Date("2026-10-12T07:00:00Z"), false), true);
  assert.equal(shouldSendWeeklySeo(new Date("2026-10-12T07:00:00Z"), true), false);
  assert.equal(shouldSendWeeklySeo(new Date("2026-10-13T07:00:00Z"), false), false);
});

test("a page checked by status only is not blamed for a missing title", () => {
  const report = renderSeoReport({
    dateLabel: "13 октября 2026 г.",
    robotsOk: true,
    sitemapOk: true,
    pages: [{ ...page, title: "", description: "", canonical: "", h1: "", tagsChecked: false }],
    home: page,
    wwwStatus: 0,
    wwwCanonical: "",
    indexStatus: 0,
    indexCanonical: "",
  });
  assert.doesNotMatch(report, /нет заголовок/);
});

test("inspectSite reads the start of each page and names closed ones", async () => {
  const readBytes = new Map<string, number>();
  const html = `<!doctype html><html><head><title>Заголовок страницы</title><meta name="description" content="Описание"><link rel="canonical" href="https://petr-alekseev.ru/"></head><body><h1>Система</h1>${"x".repeat(80_000)}</body></html>`;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    const text = url.endsWith("/robots.txt")
      ? "User-agent: *\nSitemap: https://petr-alekseev.ru/sitemap.xml\n"
      : url.endsWith("/sitemap.xml")
        ? "<urlset><url><loc>https://petr-alekseev.ru/</loc></url><url><loc>https://petr-alekseev.ru/about.html</loc></url><url><loc>https://petr-alekseev.ru/missing.html</loc></url></urlset>"
        : url.endsWith("/consent.js")
          ? "function loadMetrika(){ window.initYandexMetrika(); }"
          : html;
    const status = url.endsWith("/missing.html") ? 404 : 200;
    const bytes = new TextEncoder().encode(text);
    let sent = 0;
    readBytes.set(url, 0);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes.length) {
          controller.close();
          return;
        }
        const slice = bytes.subarray(sent, Math.min(bytes.length, sent + 512));
        sent += slice.byteLength;
        readBytes.set(url, sent);
        controller.enqueue(slice);
      },
    });
    return new Response(body, { status });
  };
  const report = await inspectSite(fetchImpl, "https://petr-alekseev.ru", 5_000);
  assert.match(report, /В карте 3 страниц/);
  assert.match(report, /missing\.html не открылась/);
  assert.match(report, /Главная: «Заголовок страницы»/);
  assert.match(report, /после согласия на cookie/);
  assert.match(report, /Итог: отчёт собран\./);
  const about = readBytes.get("https://petr-alekseev.ru/about.html") ?? 0;
  assert.ok(about > 0 && about < 8_000, `about page read ${about} bytes`);
});

test("inspectSite still answers when the site does not respond", async () => {
  const fetchImpl: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  const started = Date.now();
  const report = await inspectSite(fetchImpl, "https://petr-alekseev.ru", 50);
  assert.match(report, /собран частично/);
  assert.ok(Date.now() - started < 1_500);
});
