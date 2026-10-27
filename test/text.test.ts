import assert from "node:assert/strict";
import test from "node:test";
import { extractWorkFormat, htmlToText, parseJobPosting, parseRssItems, pickCompany, rssField } from "../src/text.ts";

const rss = `<?xml version="1.0"?><rss><channel><title>x</title><item><title>Операционный директор (COO)</title><link>https://hh.ru/vacancy/137910011</link><pubDate>2026-10-06T10:00:00+03:00</pubDate><description><![CDATA[<p>Вакансия компании: SIBERIA</p> <p>Регион: Москва</p> <p>Предполагаемый уровень месячного дохода: от&nbsp;500&nbsp;000&nbsp;₽</p>]]></description></item></channel></rss>`;

test("parses hh rss item and salary", () => {
  const [item] = parseRssItems(rss);
  assert.equal(item.title, "Операционный директор (COO)");
  assert.equal(item.link, "https://hh.ru/vacancy/137910011");
  assert.equal(rssField(item.description, "Вакансия компании"), "SIBERIA");
  assert.equal(rssField(item.description, "Регион"), "Москва");
  assert.match(htmlToText(item.description), /500 000 ₽/);
});

test("reads job posting and work format", () => {
  const html = `<html><script type="application/ld+json">{
    "@type": "JobPosting",
    "title": "Операционный директор",
    "description": "<p>Импорт и логистика. Управление P&amp;L.</p>",
    "datePosted": "2026-10-06T10:00:00+03:00",
    "hiringOrganization": { "name": "Job Offer" },
    "jobLocation": { "address": { "addressLocality": "Москва", "addressRegion": "Москва", "addressCountry": "RU" } }
  }</script><p>Формат работы: <!-- -->на&nbsp;месте работодателя или гибрид</p></html>`;
  const job = parseJobPosting(html);
  assert.equal(job?.city, "Москва");
  assert.match(job?.description ?? "", /Импорт и логистика/);
  assert.match(extractWorkFormat(html), /гибрид/);
  assert.equal(
    extractWorkFormat(
      `<p>Формат работы: на месте работодателя</p><div class="vacancy-actions vacancy-actions_applicant vacancy-actions_magritte-vacancy">x</div>`,
    ),
    "на месте работодателя",
  );
  assert.equal(pickCompany(job?.company ?? "", "SIBERIA"), "SIBERIA");
});
