import assert from "node:assert/strict";
import test from "node:test";
import { cleanAiLetter, rejectAiLetter, templateLetter, writeLetter, type AiLike } from "../src/letter.ts";
import type { ScoredVacancy } from "../src/types.ts";

const vacancy: ScoredVacancy = {
  source: "hh",
  id: "1",
  dedupeKey: "board:1",
  title: "Операционный директор (COO)",
  company: "Север Импорт",
  url: "https://hh.ru/vacancy/1",
  city: "Москва",
  region: "Москва",
  salary: "",
  publishedAt: "2026-10-06T10:00:00+03:00",
  workFormat: "гибрид",
  employment: "",
  description: "Нужен руководитель импортных поставок, склада и логистики. Ответственность за EBITDA.",
  score: 90,
  remote: true,
};

test("template letter opens with a result, not a greeting, and has no contacts", () => {
  const letter = templateLetter(vacancy);
  assert.match(letter.split("\n")[0], /^В X5 Group/);
  assert.match(letter, /10–15%/);
  assert.match(letter, /Север Импорт/);
  assert.doesNotMatch(letter, /Здравствуйте|Меня зовут|С уважением/);
  assert.doesNotMatch(letter, /\+7|@|https?:/);
  assert.match(letter, /Пётр Алексеев$/);
  assert.ok(letter.length < 700, `length ${letter.length}`);
});

test("franchise role leads with franchise results and mentions trips outside Moscow", () => {
  const letter = templateLetter({
    ...vacancy,
    title: "Руководитель отдела франчайзинга",
    company: "Сеть Юг",
    city: "Краснодар",
    region: "Краснодарский край",
    workFormat: "на месте работодателя",
    description: "Запуск розничных магазинов франшизы.",
    remote: false,
  });
  assert.match(letter.split("\n")[0], /Фасоль/);
  assert.match(letter, /командировк/);
});

test("another letter variant starts with a different result", () => {
  assert.notEqual(templateLetter(vacancy, 0).split("\n")[0], templateLetter(vacancy, 1).split("\n")[0]);
});

const goodAi =
  "В X5 Group запускал оптовый импорт продуктов: выручка росла на 10–15% в квартал, EBITDA — на 5–10%. Вам нужен человек, который соберёт поставки, склад и логистику в одну экономику, — этим я и занимался. В Евроопте за 5 месяцев вдвое сократил затраты направления. Удобно созвониться на этой неделе?";

function fakeAi(response: string): AiLike {
  return { run: async () => ({ response }) };
}

test("AI letter is used when it passes the checks", async () => {
  const result = await writeLetter(vacancy, { ai: fakeAi(`Здравствуйте!\n\n${goodAi}`) });
  assert.equal(result.by, "ai");
  assert.doesNotMatch(result.text, /^Здравствуйте/);
  assert.match(result.text, /Пётр Алексеев$/);
});

test("AI letter with an invented number falls back to the template", async () => {
  const result = await writeLetter(vacancy, { ai: fakeAi(goodAi.replace("10–15%", "47%")) });
  assert.equal(result.by, "template");
  assert.match(rejectAiLetter(cleanAiLetter(goodAi.replace("10–15%", "47%")), vacancy) ?? "", /47/);
});

test("AI failure falls back to the template", async () => {
  const result = await writeLetter(vacancy, { ai: { run: async () => Promise.reject(new Error("quota")) } });
  assert.equal(result.by, "template");
});

test("AI letter with bureaucratic phrases falls back to the template", async () => {
  const text = goodAi.replace("Удобно созвониться на этой неделе?", "Это демонстрирует мой потенциал. Давайте обсудим возможности сотрудничества.");
  const result = await writeLetter(vacancy, { ai: fakeAi(text) });
  assert.equal(result.by, "template");
});
