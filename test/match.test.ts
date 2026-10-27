import assert from "node:assert/strict";
import test from "node:test";
import { rankVacancies, titleScore } from "../src/match.ts";
import { pickForEnrich } from "../src/search.ts";
import { hhQueries, zarplataQueries } from "../src/sources.ts";
import type { Vacancy } from "../src/types.ts";

const now = Date.parse("2026-10-07T06:00:00Z");

function vacancy(patch: Partial<Vacancy>): Vacancy {
  return {
    source: "hh",
    id: "1",
    dedupeKey: "board:1",
    title: "Операционный директор (COO)",
    company: "Пример",
    url: "https://hh.ru/vacancy/1",
    city: "Москва",
    region: "Москва",
    salary: "",
    publishedAt: "2026-10-06T10:00:00+03:00",
    workFormat: "гибрид",
    employment: "",
    description: "Управление операционным контуром, P&L и логистикой.",
    ...patch,
  };
}

test("title score prefers COO and drops junior roles", () => {
  assert.ok(titleScore("Операционный директор (COO)") >= 60);
  assert.ok(titleScore("Менеджер операционных проектов") >= 56);
  assert.ok(titleScore("Операционный менеджер") >= 54);
  assert.ok(titleScore("Менеджер проектов") >= 50);
  assert.ok(titleScore("Менеджер проекта") >= 50);
  assert.ok(titleScore("Руководитель проектов") >= 50);
  assert.ok(titleScore("Руководитель операционных проектов") >= 56);
  assert.ok(titleScore("Руководитель направления") >= 52);
  assert.ok(titleScore("Менеджер по продажам и реализации проектов") < 30);
  assert.ok(titleScore("Менеджер IT-проектов") <= 16);
  assert.equal(titleScore("Помощник операционного директора"), 0);
  assert.equal(titleScore("Курьер"), 0);
  assert.ok(titleScore("Коммерческий директор") < 30);
});

test("keeps office roles across Russia, including project managers", () => {
  const ranked = rankVacancies(
    [
      vacancy({}),
      vacancy({
        id: "2",
        dedupeKey: "board:2",
        title: "Операционный директор",
        city: "Казань",
        region: "Татарстан",
        workFormat: "на месте работодателя",
      }),
      vacancy({
        id: "3",
        dedupeKey: "board:3",
        title: "Операционный директор",
        city: "Казань",
        region: "Татарстан",
        workFormat: "удалённо",
      }),
      vacancy({
        id: "4",
        dedupeKey: "board:4",
        title: "Менеджер проектов",
        city: "Новосибирск",
        region: "Новосибирская область",
        workFormat: "на месте работодателя",
        description: "Запуск розничных магазинов, бюджет и команда.",
      }),
    ],
    { now, periodDays: 14, minScore: 78, limit: 5 },
  );
  assert.deepEqual(ranked.map((item) => item.id), ["1", "2", "3", "4"]);
});

test("keeps one project role in the daily shortlist when director roles fill it", () => {
  const directors = [1, 2, 3, 4, 5].map((id) =>
    vacancy({ id: String(id), dedupeKey: `board:${id}`, title: "Операционный директор" }),
  );
  const ranked = rankVacancies(
    [
      ...directors,
      vacancy({
        id: "6",
        dedupeKey: "board:6",
        title: "Менеджер операционных проектов",
        city: "Казань",
        region: "Татарстан",
        workFormat: "на месте работодателя",
        description: "Запуск импорта, склада и логистики. Ответственность за бюджет.",
      }),
    ],
    { now, periodDays: 14, minScore: 78, limit: 5 },
  );
  assert.equal(ranked.length, 5);
  assert.ok(ranked.some((item) => item.id === "6"));
});

test("drops a project role in a distant industry", () => {
  const ranked = rankVacancies(
    [
      vacancy({
        title: "Менеджер проектов",
        city: "Казань",
        region: "Татарстан",
        workFormat: "на месте работодателя",
        description: "Ведение проектов застройщика и отделка квартир.",
      }),
    ],
    { now, periodDays: 14, minScore: 78, limit: 5 },
  );
  assert.equal(ranked.length, 0);
});

test("keeps a head of direction vacancy outside Moscow", () => {
  const ranked = rankVacancies(
    [
      vacancy({
        title: "Руководитель направления",
        city: "Казань",
        region: "Татарстан",
        workFormat: "на месте работодателя",
        description: "Развитие направления.",
      }),
    ],
    { now, periodDays: 14, minScore: 78, limit: 5 },
  );
  assert.equal(ranked.length, 1);
});

test("search queries cover project roles across Russia", () => {
  const blob = [...hhQueries(), ...zarplataQueries()].map((query) => query.text).join("\n");
  assert.match(blob, /менеджер проекта/);
  assert.match(blob, /руководитель операционных проектов/);
  assert.match(blob, /руководитель направления/);
  assert.match(blob, /операционный менеджер/);
  assert.ok([...hhQueries(), ...zarplataQueries()].every((query) => query.area === "113" && query.remote === false));
});

test("enrichment keeps room for project roles", () => {
  const directors = [1, 2, 3, 4, 5, 6].map((id) => vacancy({ id: String(id), dedupeKey: `board:${id}` }));
  const projects = [7, 8, 9].map((id) =>
    vacancy({ id: String(id), dedupeKey: `board:${id}`, title: "Менеджер проектов" }),
  );
  const picked = pickForEnrich([...directors, ...projects], 8);
  assert.equal(picked.length, 8);
  assert.ok(picked.filter((item) => item.title === "Менеджер проектов").length >= 3);
});

test("drops a vacancy that is an assistant role in the description", () => {
  const ranked = rankVacancies(
    [vacancy({ description: "Операционный директор, ассистент руководителя по проектам." })],
    { now, periodDays: 14, minScore: 78, limit: 5 },
  );
  assert.equal(ranked.length, 0);
});

test("drops a COO role in a distant industry", () => {
  const ranked = rankVacancies(
    [
      vacancy({
        title: "Операционный директор (отделка квартир)",
        description: "Управление стройкой и отделкой квартир у застройщика.",
      }),
    ],
    { now, periodDays: 14, minScore: 78, limit: 5 },
  );
  assert.equal(ranked.length, 0);
});
