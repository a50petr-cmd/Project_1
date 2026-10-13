import assert from "node:assert/strict";
import test from "node:test";
import { coverLetter } from "../src/letter.ts";
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

test("letter is short, names the vacancy, and keeps a real result", () => {
  const letter = coverLetter(vacancy, { telegram: "https://t.me/PetroAlekseev" });
  assert.match(letter, /Север Импорт/);
  assert.match(letter, /Операционный директор \(COO\)/);
  assert.match(letter, /Операционный контур/);
  assert.match(letter, /По поставкам/);
  assert.match(letter, /X5 Group/);
  assert.match(letter, /10–15%/);
  assert.match(letter, /t\.me\/PetroAlekseev/);
  assert.doesNotMatch(letter, /для меня главное/);
  assert.doesNotMatch(letter, /Нужен руководитель импортных поставок/);
  assert.ok(letter.length < 800);
  assert.doesNotMatch(letter, /\+7/);
  assert.doesNotMatch(letter, /@/);
});

test("letter for a store launch outside Moscow uses that experience", () => {
  const letter = coverLetter(
    {
      ...vacancy,
      title: "Менеджер проектов",
      company: "Сеть Юг",
      city: "Краснодар",
      region: "Краснодарский край",
      workFormat: "на месте работодателя",
      description: "Запуск розничных магазинов франшизы.",
      remote: false,
    },
    { telegram: "https://t.me/PetroAlekseev" },
  );
  assert.match(letter, /Направление|Проект|розниц/);
  assert.match(letter, /Фасоль|Пятёрочка/);
  assert.match(letter, /командировк/);
  assert.doesNotMatch(letter, /Переезд не рассматриваю/);
  assert.ok(letter.length < 800);
});

test("letter adds phone and email only from contacts", () => {
  const letter = coverLetter(vacancy, {
    phone: "+7 000 000-00-00",
    email: "person@example.com",
    telegram: "https://t.me/PetroAlekseev",
  });
  assert.match(letter, /\+7 000 000-00-00/);
  assert.match(letter, /person@example.com/);
});
