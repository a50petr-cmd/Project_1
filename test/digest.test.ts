import assert from "node:assert/strict";
import test from "node:test";
import { runDigest } from "../src/digest.ts";
import { memoryStore } from "../src/store.ts";

const rss = `<?xml version="1.0"?><rss><channel><item><title>Операционный директор (COO)</title><link>https://hh.ru/vacancy/555</link><pubDate>2026-10-06T10:00:00+03:00</pubDate><description><![CDATA[<p>Вакансия компании: Север Импорт</p><p>Регион: Москва</p><p>Предполагаемый уровень месячного дохода: не указан</p>]]></description></item></channel></rss>`;

const page = `<html><script type="application/ld+json">{
  "@type": "JobPosting",
  "title": "Операционный директор (COO)",
  "description": "<p>Импорт, склад и логистика. Управление EBITDA направления.</p>",
  "datePosted": "2026-10-06T10:00:00+03:00",
  "hiringOrganization": { "name": "Север Импорт" },
  "jobLocation": { "address": { "addressLocality": "Москва", "addressRegion": "Москва", "addressCountry": "RU" } }
}</script><p>Формат работы: гибрид</p></html>`;

const habr = `<html><script type="application/json" data-ssr-state="true">{"vacancies":{"list":[]}}</script></html>`;
const emptyRss = `<?xml version="1.0"?><rss><channel></channel></rss>`;

function fakeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/vacancy/555")
      ? page
      : url.includes("career.habr.com")
        ? habr
        : url.includes("opendata.trudvsem.ru")
          ? JSON.stringify({ results: { vacancies: [] } })
          : url.includes("hh.ru/search") || url.includes("zarplata.ru/search")
            ? url.includes("hh.ru")
              ? rss
              : emptyRss
            : emptyRss;
    return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
}

test("digest sends one letter and does not repeat it", async () => {
  const store = memoryStore();
  const sent: string[] = [];
  const now = new Date("2026-10-07T06:00:00Z");
  const first = await runDigest({
    store,
    fetch: fakeFetch(),
    now,
    force: true,
    contacts: { telegram: "https://t.me/PetroAlekseev" },
    send: async (text) => {
      sent.push(text);
    },
  });
  assert.equal(first.status, "sent");
  assert.equal(first.sent, 1);
  const reportAt = sent.findIndex((text) => text.startsWith("Отчёт"));
  const letterAt = sent.findIndex((text) => text.includes("X5 Group"));
  assert.ok(reportAt !== -1 && letterAt !== -1 && reportAt < letterAt);
  assert.ok(sent.some((text) => text.includes("Север Импорт") && text.includes("X5 Group")));

  const again = await runDigest({
    store,
    fetch: fakeFetch(),
    now,
    force: true,
    contacts: {},
    send: async (text) => {
      sent.push(text);
    },
  });
  assert.equal(again.sent, 0);
  assert.match(sent.at(-1) ?? "", /новых подходящих вакансий нет/);
});

test("scheduled run waits on a holiday", async () => {
  let called = false;
  const result = await runDigest({
    store: memoryStore(),
    fetch: (async () => {
      called = true;
      return new Response("no", { status: 500 });
    }) as typeof fetch,
    now: new Date("2026-11-04T06:00:00Z"),
    contacts: {},
    send: async () => {
      throw new Error("should not send");
    },
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "holiday");
  assert.equal(called, false);
});
