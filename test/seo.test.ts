import assert from "node:assert/strict";
import test from "node:test";
import { renderSeoReport, shouldSendWeeklySeo } from "../src/seo.ts";

const page = {
  url: "https://petr-alekseev.ru/",
  ok: true,
  status: 200,
  title: "Оптимизация бизнес-процессов — Пётр Алексеев",
  description: "Аудит процессов",
  canonical: "https://petr-alekseev.ru/",
  h1: "Превращаем процессы в систему",
  metrikaGated: true,
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
