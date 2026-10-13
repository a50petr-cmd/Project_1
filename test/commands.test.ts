import assert from "node:assert/strict";
import test from "node:test";
import { commandFromText } from "../src/telegram.ts";

test("buttons map to the same commands as slash text", () => {
  assert.equal(commandFromText("Найти вакансии"), "/search");
  assert.equal(commandFromText("Статус"), "/status");
  assert.equal(commandFromText("Пауза"), "/pause");
  assert.equal(commandFromText("Включить"), "/resume");
  assert.equal(commandFromText("Справка"), "/help");
  assert.equal(commandFromText("SEO отчёт"), "/seo");
  assert.equal(commandFromText("/search@JobBot"), "/search");
});
