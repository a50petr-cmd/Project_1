import assert from "node:assert/strict";
import test from "node:test";
import { belowSalary, roleGroup, titleScore } from "../src/match.ts";
import { memoryStore } from "../src/store.ts";
import { addApps, dueReminders, formatStats, readApps, setStatus, shortId, updateApp, type AppRecord } from "../src/tracker.ts";
import type { ScoredVacancy } from "../src/types.ts";

function record(id: string, extra: Partial<AppRecord> = {}): AppRecord {
  return { id, title: "Операционный директор", company: "А", url: "https://hh.ru/vacancy/1", group: "Операционный директор", status: "new", sentAt: "2026-10-19T07:00:00Z", ...extra };
}

test("short id fits Telegram callback data and is stable", () => {
  const id = shortId("trudvsem:3f0a1c2e-1111-2222-3333-444455556666");
  assert.equal(id, shortId("trudvsem:3f0a1c2e-1111-2222-3333-444455556666"));
  assert.ok(`ap:${id}`.length < 64);
});

test("statuses move from applied to invite", async () => {
  const store = memoryStore();
  await addApps(store, [{ record: record("x"), details: { vacancy: {} as ScoredVacancy, letter: "", rewrites: 0 } }]);
  const now = new Date("2026-10-20T10:00:00Z");
  await updateApp(store, "x", setStatus("applied", now));
  const later = await updateApp(store, "x", setStatus("invite", new Date("2026-10-23T10:00:00Z")));
  assert.equal(later?.status, "invite");
  assert.equal(later?.appliedAt, now.toISOString());
  assert.equal((await readApps(store)).length, 1);
});

test("reminder comes after 5 working days, skipping the 4 November holiday", () => {
  const apps = [record("a", { status: "applied", appliedAt: "2026-10-30T09:00:00Z" })];
  assert.equal(dueReminders(apps, new Date("2026-11-05T15:00:00Z")).length, 0);
  assert.equal(dueReminders(apps, new Date("2026-11-09T15:00:00Z")).length, 1);
  const reminded = [{ ...apps[0], remindedAt: "2026-11-09T15:00:00Z" }];
  assert.equal(dueReminders(reminded, new Date("2026-11-10T15:00:00Z")).length, 0);
});

test("stats count responses by role", () => {
  const now = new Date("2026-10-23T15:00:00Z");
  const apps = [
    record("1", { status: "invite", appliedAt: "2026-10-20T10:00:00Z", group: "Франчайзинг и развитие сети" }),
    record("2", { status: "applied", appliedAt: "2026-10-21T10:00:00Z" }),
    record("3", { status: "reject", appliedAt: "2026-10-21T10:00:00Z" }),
    record("4", { status: "skip" }),
  ];
  const text = formatStats(apps, now);
  assert.match(text, /Откликов: 3 → приглашений: 1 \(33%\)/);
  assert.match(text, /Франчайзинг и развитие сети: 1 → 1/);
});

test("salary filter keeps vacancies without salary and converts gross to net", () => {
  assert.equal(belowSalary("", 250_000), false);
  assert.equal(belowSalary("от 150 000 до 200 000 ₽ на руки", 250_000), true);
  assert.equal(belowSalary("от 200 000 до 280 000 ₽ до вычета налогов", 250_000), true);
  assert.equal(belowSalary("от 300 000 ₽ до вычета налогов", 250_000), false);
  assert.equal(belowSalary("до 400 000 ₽", 250_000), false);
  assert.equal(belowSalary("от 3 000 $", 250_000), false);
});

test("new roles score high enough to be searched", () => {
  assert.ok(titleScore("Руководитель отдела франчайзинга") >= 50);
  assert.ok(titleScore("Директор по развитию сети") >= 50);
  assert.ok(titleScore("Директор интернет-магазина") >= 50);
  assert.ok(titleScore("Руководитель направления B2B") >= 50);
  assert.ok(titleScore("Менеджер по продажам B2B") < 26);
  assert.equal(roleGroup("Руководитель e-commerce"), "E-commerce и доставка");
  assert.equal(roleGroup("Директор по франчайзингу"), "Франчайзинг и развитие сети");
});

test("a card that lost its record is rebuilt from the message text", async () => {
  const { cardToRecord, upsertApp } = await import("../src/tracker.ts");
  const text = "Директор по логистике\nОчаковская Логистическая Компания · Москва · hh.ru\nРоль: Другое\nОткрыть вакансию";
  const record = cardToRecord(text, [{ type: "text_link", url: "https://hh.ru/vacancy/9" }], "abc", new Date("2026-10-27T18:00:00Z"));
  assert.equal(record?.title, "Директор по логистике");
  assert.equal(record?.company, "Очаковская Логистическая Компания");
  assert.equal(record?.url, "https://hh.ru/vacancy/9");
  const store = memoryStore();
  await upsertApp(store, setStatus("applied", new Date())(record!));
  assert.equal((await readApps(store))[0].status, "applied");
  assert.equal(cardToRecord("просто текст", [], "x", new Date()), null);
});
