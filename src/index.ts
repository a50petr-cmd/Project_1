import { moscowParts } from "./calendar.ts";
import { runDigest, setPaused } from "./digest.ts";
import { inspectSite, shouldSendWeeklySeo } from "./seo.ts";
import { profile } from "./profile.ts";
import { readSettings, type Settings, type Store } from "./store.ts";
import { commandFromText, helpText, publishCommands, sendTelegram } from "./telegram.ts";

export interface Env {
  JOBS: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
  OWNER_CHAT_ID?: string;
  CONTACT_PHONE?: string;
  CONTACT_EMAIL?: string;
  SUPERJOB_API_KEY?: string;
  DIGEST_LIMIT?: string;
  SEARCH_PERIOD_DAYS?: string;
  MIN_SCORE?: string;
}

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
};

function storeOf(env: Env): Store {
  return {
    get: (key) => env.JOBS.get(key),
    put: (key, value, ttlSeconds) => env.JOBS.put(key, value, ttlSeconds ? { expirationTtl: ttlSeconds } : undefined),
  };
}

function settingsFromEnv(env: Env): Partial<Settings> {
  const limit = Number(env.DIGEST_LIMIT);
  const periodDays = Number(env.SEARCH_PERIOD_DAYS);
  const minScore = Number(env.MIN_SCORE);
  return {
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    ...(Number.isFinite(periodDays) && periodDays > 0 ? { periodDays } : {}),
    ...(Number.isFinite(minScore) && minScore > 0 ? { minScore } : {}),
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

async function tell(env: Env, chatId: string | null, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !chatId) return;
  await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, text).catch((error: unknown) => {
    console.error(errorText(error));
  });
}

function sendPlain(env: Env, chatId: string, text: string): Promise<void> {
  return sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, text, fetch, "plain");
}

async function pushSeoReport(env: Env, chatId: string): Promise<void> {
  const report = await inspectSite(fetch);
  await sendPlain(env, chatId, report);
  const closing = report.includes("Итог: отчёт собран.")
    ? "SEO-отчёт доставлен."
    : "SEO-отчёт пришёл не полностью: проверка оборвалась по времени.";
  await sendPlain(env, chatId, closing);
}

async function deliverSeo(env: Env, chatId: string): Promise<void> {
  try {
    const owner = await ownerChat(storeOf(env), env);
    if (owner && owner !== chatId) {
      await sendPlain(env, chatId, "Этот бот уже привязан к другому чату.");
      return;
    }
    if (!owner) {
      await sendPlain(env, chatId, "Напишите /start, чтобы привязать этот чат.");
      return;
    }
    await sendPlain(env, chatId, "Собираю SEO-отчёт по petr-alekseev.ru.");
    await pushSeoReport(env, chatId);
  } catch (error) {
    await sendPlain(env, chatId, `SEO-отчёт не собрался: ${errorText(error)}`).catch((sendError: unknown) => {
      console.error(errorText(sendError));
    });
  }
}

async function sendWeeklySeo(env: Env): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const store = storeOf(env);
  const now = new Date();
  const lock = `seo-report:${moscowParts(now).iso}`;
  const chatId = await ownerChat(store, env);
  if (!chatId || !shouldSendWeeklySeo(now, Boolean(await store.get(lock)))) return;
  try {
    await pushSeoReport(env, chatId);
    await store.put(lock, now.toISOString(), 36 * 3600);
  } catch (error) {
    await tell(env, chatId, `SEO-отчёт не собрался: ${errorText(error)}`);
  }
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
    contacts: { phone: env.CONTACT_PHONE, email: env.CONTACT_EMAIL, telegram: profile.telegram },
    superjobKey: env.SUPERJOB_API_KEY,
    settingsOverride: settingsFromEnv(env),
    send: (text) => sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, text),
  });
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
    await send(`Чат подключён. Идентификатор: ${chat}\n\n${helpText}`);
    await publishCommands(env.TELEGRAM_BOT_TOKEN).catch(() => undefined);
    return;
  }
  if (command === "/help") {
    await send(helpText);
    return;
  }
  if (command === "/pause") {
    await setPaused(store, true);
    await send("Ежедневная рассылка остановлена. Команда /search по-прежнему ищет вакансии сразу.");
    return;
  }
  if (command === "/resume") {
    await setPaused(store, false);
    await send("Ежедневная рассылка включена: по рабочим дням в 10:00 мск.");
    return;
  }
  if (command === "/status") {
    const settings = { ...(await readSettings(store)), ...settingsFromEnv(env) };
    const last = await store.get("last-run");
    await send(
      [
        `Рассылка: ${settings.enabled ? "включена" : "на паузе"}`,
        `Чат: ${chat}`,
        `Телефон в письме: ${env.CONTACT_PHONE ? "задан" : "не задан"}`,
        `Почта в письме: ${env.CONTACT_EMAIL ? "задана" : "не задана"}`,
        `SuperJob: ${env.SUPERJOB_API_KEY ? "подключён" : "без ключа"}`,
        last ? `Последний запуск: ${last}` : "Запусков ещё не было.",
      ].join("\n"),
    );
    return;
  }
  if (command === "/search") {
    await send("Собираю подборку. Это займёт около минуты.");
    await deliver(env, true);
    return;
  }
  await send("Не понял команду. Список команд: /help");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok seo-3");
    }
    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return new Response("alekseev job bot");
    }
    if (env.WEBHOOK_SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    const update = (await request.json()) as TelegramUpdate;
    const text = update.message?.text?.trim() ?? "";
    const chatId = update.message?.chat?.id;
    if (text && chatId !== undefined && commandFromText(text) === "/seo") {
      if (env.TELEGRAM_BOT_TOKEN) await deliverSeo(env, String(chatId));
      return new Response("ok");
    }
    ctx.waitUntil(
      handleMessage(env, update).catch(async (error: unknown) => {
        console.error(errorText(error));
        if (chatId !== undefined) await tell(env, String(chatId), `Не получилось: ${errorText(error)}`);
      }),
    );
    return new Response("ok");
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          await deliver(env, false);
        } catch (error) {
          console.error(errorText(error));
          const chatId = env.OWNER_CHAT_ID || (await storeOf(env).get("owner"));
          await tell(env, chatId, `Подборка вакансий не собралась: ${errorText(error)}`);
        }
        try {
          await sendWeeklySeo(env);
        } catch (error) {
          console.error(errorText(error));
          const chatId = env.OWNER_CHAT_ID || (await storeOf(env).get("owner"));
          await tell(env, chatId, `SEO-отчёт не собрался: ${errorText(error)}`);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
