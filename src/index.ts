import { isWorkingDay, moscowParts } from "./calendar.ts";
import { runDigest, setPaused, type Send } from "./digest.ts";
import { writeLetter, type AiLike } from "./letter.ts";
import { readSettings, type Settings, type Store } from "./store.ts";
import {
  appliedButtons,
  commandFromText,
  emptyMarkup,
  helpText,
  publishCommands,
  reminderButtons,
  sendTelegram,
  telegramApi,
} from "./telegram.ts";
import {
  dueReminders,
  formatStats,
  readApps,
  readDetails,
  saveDetails,
  setStatus,
  updateApp,
  upsertApp,
  writeApps,
  cardToRecord,
  detailsFromRecord,
  type AppRecord,
  type AppStatus,
} from "./tracker.ts";

export const VERSION = "jobs-10";

export interface Env {
  JOBS: KVNamespace;
  AI?: AiLike;
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
  OWNER_CHAT_ID?: string;
  SUPERJOB_API_KEY?: string;
  DIGEST_LIMIT?: string;
  SEARCH_PERIOD_DAYS?: string;
  MIN_SCORE?: string;
  MIN_SALARY?: string;
}

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      message_id?: number;
      chat?: { id?: number };
      text?: string;
      entities?: Array<{ type?: string; url?: string }>;
    };
  };
};

function storeOf(env: Env): Store {
  return {
    get: (key) => env.JOBS.get(key),
    put: (key, value, ttlSeconds) => env.JOBS.put(key, value, ttlSeconds ? { expirationTtl: ttlSeconds } : undefined),
  };
}

function settingsFromEnv(env: Env): Partial<Settings> {
  const read = (value: string | undefined) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  const limit = read(env.DIGEST_LIMIT);
  const periodDays = read(env.SEARCH_PERIOD_DAYS);
  const minScore = read(env.MIN_SCORE);
  // Порог зарплаты задаётся только в wrangler.toml, 0 — без фильтра.
  const salary = Number(env.MIN_SALARY);
  const minSalary = Number.isFinite(salary) && salary >= 0 ? salary : null;
  return {
    ...(limit ? { limit } : {}),
    ...(periodDays ? { periodDays } : {}),
    ...(minScore ? { minScore } : {}),
    ...(minSalary !== null ? { minSalary } : {}),
  };
}

async function ownerChat(store: Store, env: Env): Promise<string | null> {
  if (env.OWNER_CHAT_ID) return env.OWNER_CHAT_ID;
  return store.get("owner");
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 350);
}

function sender(env: Env, chatId: string): Send {
  return (text, extra) =>
    sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, text, {
      markup: extra?.markup,
      mode: extra?.plain ? "plain" : "html",
    });
}

async function tell(env: Env, chatId: string | null, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !chatId) return;
  await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, text).catch((error: unknown) => {
    console.error(errorText(error));
  });
}

async function deliver(env: Env, force: boolean): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const store = storeOf(env);
  const chatId = await ownerChat(store, env);
  if (!chatId) return;
  await runDigest({
    store,
    fetch,
    force,
    ai: env.AI,
    superjobKey: env.SUPERJOB_API_KEY,
    settingsOverride: settingsFromEnv(env),
    send: sender(env, chatId),
  });
}

// Вечером по рабочим дням: напоминания об откликах без ответа, по пятницам — недельная сводка.
async function evening(env: Env, now: Date): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const store = storeOf(env);
  const chatId = await ownerChat(store, env);
  if (!chatId || !isWorkingDay(now)) return;
  const lock = `evening:${moscowParts(now).iso}`;
  if (await store.get(lock)) return;
  await store.put(lock, now.toISOString(), 36 * 3600);

  const apps = await readApps(store);
  const due = dueReminders(apps, now);
  const send = sender(env, chatId);
  for (const app of due) {
    const company = app.company ? ` в «${app.company}»` : "";
    await send(`Прошло 5 рабочих дней после отклика на «${app.title}»${company}. Ответили?\n${app.url}`, {
      markup: reminderButtons(app.id),
      plain: true,
    });
    app.remindedAt = now.toISOString();
  }
  if (due.length > 0) await writeApps(store, apps);

  if (moscowParts(now).weekday === 5) {
    await send(formatStats(apps, now, "Сводка недели"), { plain: true });
  }
}

const ACTIONS: Record<string, { status?: AppStatus; answer: string }> = {
  ap: { status: "applied", answer: "Отметил отклик. Через 5 рабочих дней спрошу про ответ." },
  sk: { status: "skip", answer: "Убрал. Больше эту вакансию не покажу." },
  iv: { status: "invite", answer: "Отлично! Записал приглашение." },
  rj: { status: "reject", answer: "Записал отказ. Учту в статистике." },
  nr: { answer: "Хорошо, спрошу ещё раз через 5 рабочих дней." },
  rw: { answer: "Пишу другой вариант письма…" },
};

async function handleCallback(env: Env, query: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const store = storeOf(env);
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const [code, id] = (query.data ?? "").split(":");
  const action = ACTIONS[code ?? ""];
  const owner = await ownerChat(store, env);
  if (!action || !id || chatId === undefined || String(chatId) !== owner) {
    await telegramApi(token, "answerCallbackQuery", { callback_query_id: query.id, text: "Кнопка устарела." });
    return;
  }
  await telegramApi(token, "answerCallbackQuery", { callback_query_id: query.id, text: action.answer });
  const chat = String(chatId);
  const now = new Date();

  // Запасной путь: если записи нет (подборка оборвалась до сохранения), восстанавливаем её по тексту карточки.
  const card = query.message?.text ? cardToRecord(query.message.text, query.message.entities ?? [], id, now) : null;

  if (code === "rw") {
    const details = (await readDetails(store, id)) ?? (card ? detailsFromRecord(card) : null);
    if (!details) {
      await tell(env, chat, "Не нашёл эту вакансию: данные хранятся 120 дней.");
      return;
    }
    const letter = await writeLetter(details.vacancy, { ai: env.AI, avoid: details.letter, shift: details.rewrites + 1 });
    await saveDetails(store, id, { ...details, letter: letter.text, rewrites: details.rewrites + 1 });
    await sendTelegram(token, chat, letter.text, { mode: "plain" });
    return;
  }

  const change = (app: AppRecord): AppRecord => {
    if (code === "nr") return { ...app, remindedAt: now.toISOString() };
    return setStatus(action.status as AppStatus, now)(app);
  };
  let record = await updateApp(store, id, change);
  if (!record && card) {
    record = change(card);
    await upsertApp(store, record);
  }
  if (!record) {
    await tell(env, chat, "Не нашёл эту вакансию в учёте.");
    return;
  }
  if (messageId !== undefined && code !== "nr") {
    const markup = code === "ap" ? appliedButtons(id) : emptyMarkup;
    await telegramApi(token, "editMessageReplyMarkup", { chat_id: chat, message_id: messageId, reply_markup: markup }).catch(
      (error: unknown) => console.error(errorText(error)),
    );
  }
  if (code === "nr" && messageId !== undefined) {
    await telegramApi(token, "editMessageReplyMarkup", { chat_id: chat, message_id: messageId, reply_markup: emptyMarkup }).catch(
      () => undefined,
    );
  }
}

async function handleMessage(env: Env, update: TelegramUpdate): Promise<void> {
  const text = update.message?.text?.trim() ?? "";
  const chatId = update.message?.chat?.id;
  if (!text || chatId === undefined || !env.TELEGRAM_BOT_TOKEN) return;
  const chat = String(chatId);
  const send = (message: string) => sendTelegram(env.TELEGRAM_BOT_TOKEN, chat, message);
  const store = storeOf(env);
  const command = commandFromText(text);
  try {
    await routeMessage(env, store, chat, command, send);
  } catch (error) {
    await tell(env, chat, `Не получилось выполнить команду: ${errorText(error)}`);
  }
}

async function routeMessage(
  env: Env,
  store: Store,
  chat: string,
  command: string,
  send: (message: string) => Promise<void>,
): Promise<void> {
  const owner = await ownerChat(store, env);

  if (owner && owner !== chat) {
    await send("Этот бот уже привязан к другому чату.");
    return;
  }
  if (!owner && command !== "/start") {
    await send("Напишите /start, чтобы привязать этот чат.");
    return;
  }

  if (command === "/start") {
    if (!env.OWNER_CHAT_ID) await store.put("owner", chat);
    await send(`Чат подключён.\n\n${helpText}`);
    await publishCommands(env.TELEGRAM_BOT_TOKEN).catch(() => undefined);
    return;
  }
  if (command === "/help") {
    await publishCommands(env.TELEGRAM_BOT_TOKEN).catch(() => undefined);
    await send(helpText);
    return;
  }
  if (command === "/pause") {
    await setPaused(store, true);
    await send("Ежедневная рассылка остановлена. Кнопка «Найти вакансии» по-прежнему ищет сразу.");
    return;
  }
  if (command === "/resume") {
    await setPaused(store, false);
    await send("Ежедневная рассылка включена: по рабочим дням в 10:00 мск.");
    return;
  }
  if (command === "/stats") {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chat, formatStats(await readApps(store), new Date()), { mode: "plain" });
    return;
  }
  if (command === "/status") {
    const settings = { ...(await readSettings(store)), ...settingsFromEnv(env) };
    const last = await store.get("last-run");
    await send(
      [
        `Версия: ${VERSION}`,
        `Рассылка: ${settings.enabled ? "включена" : "на паузе"}`,
        `Письма пишет: ${env.AI ? "ИИ Cloudflare (если ответ не прошёл проверку — шаблон)" : "шаблон (ИИ не подключён)"}`,
        settings.minSalary > 0 ? `Зарплата от: ${settings.minSalary.toLocaleString("ru-RU")} ₽ на руки` : "Фильтр по зарплате: выключен",
        `SuperJob: ${env.SUPERJOB_API_KEY ? "подключён" : "без ключа"}`,
        last ? `Последний запуск: ${last}` : "Запусков ещё не было.",
      ].join("\n"),
    );
    return;
  }
  if (command === "/search") {
    await send("Ищу вакансии и пишу письма. Это займёт пару минут.");
    await deliver(env, true);
    return;
  }
  await send("Не понял команду. Список команд: /help");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(`ok ${VERSION}`);
    }
    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return new Response("alekseev job bot");
    }
    if (env.WEBHOOK_SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    const update = (await request.json()) as TelegramUpdate;
    if (update.callback_query) {
      const query = update.callback_query;
      ctx.waitUntil(
        handleCallback(env, query).catch(async (error: unknown) => {
          console.error(errorText(error));
          const chatId = query.message?.chat?.id;
          if (chatId !== undefined) await tell(env, String(chatId), `Кнопка не сработала: ${errorText(error)}`);
        }),
      );
      return new Response("ok");
    }
    const chatId = update.message?.chat?.id;
    ctx.waitUntil(
      handleMessage(env, update).catch(async (error: unknown) => {
        console.error(errorText(error));
        if (chatId !== undefined) await tell(env, String(chatId), `Не получилось: ${errorText(error)}`);
      }),
    );
    return new Response("ok");
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date(controller.scheduledTime);
    const isEvening = controller.cron === EVENING_CRON;
    ctx.waitUntil(
      (async () => {
        try {
          if (isEvening) await evening(env, now);
          else await deliver(env, false);
        } catch (error) {
          console.error(errorText(error));
          const chatId = env.OWNER_CHAT_ID || (await storeOf(env).get("owner"));
          await tell(env, chatId, `${isEvening ? "Напоминания не отправились" : "Подборка вакансий не собралась"}: ${errorText(error)}`);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;

// Должно совпадать с wrangler.toml.
export const EVENING_CRON = "0 15 * * 1-5";
