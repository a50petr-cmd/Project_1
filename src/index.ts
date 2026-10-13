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

async function sendWeeklySeo(env: Env): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const store = storeOf(env);
  const now = new Date();
  const lock = `seo-report:${moscowParts(now).iso}`;
  if (!shouldSendWeeklySeo(now, Boolean(await store.get(lock)))) return;
  const chatId = await ownerChat(store, env);
  if (!chatId) return;
  await store.put(lock, now.toISOString(), 36 * 3600);
  await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, await inspectSite(fetch));
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
  const owner = await ownerChat(store, env);
  const command = commandFromText(text);

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
  if (command === "/seo") {
    await send("Проверяю petr-alekseev.ru.");
    await send(await inspectSite(fetch));
    return;
  }
  await send("Не понял команду. Список команд: /help");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok");
    }
    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return new Response("alekseev job bot");
    }
    if (env.WEBHOOK_SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    const update = (await request.json()) as TelegramUpdate;
    ctx.waitUntil(
      handleMessage(env, update).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
      }),
    );
    return new Response("ok");
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await sendWeeklySeo(env);
        await deliver(env, false);
      })().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
