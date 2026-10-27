import type { ScoredVacancy, SourceReport } from "./types.ts";
import { escapeHtml } from "./text.ts";

const SOURCE_LABEL: Record<ScoredVacancy["source"], string> = {
  hh: "hh.ru",
  zarplata: "Зарплата.ру",
  trudvsem: "Работа России",
  habr: "Хабр Карьера",
  superjob: "SuperJob",
};

export type InlineButton = { text: string; callback_data: string };
export type InlineMarkup = { inline_keyboard: InlineButton[][] };

// Кнопки под карточкой вакансии. id — короткий ключ записи в трекере.
export function newVacancyButtons(id: string): InlineMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Откликнулся", callback_data: `ap:${id}` },
        { text: "❌ Не подходит", callback_data: `sk:${id}` },
      ],
      [{ text: "✍️ Другое письмо", callback_data: `rw:${id}` }],
    ],
  };
}

export function appliedButtons(id: string): InlineMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🎉 Пригласили", callback_data: `iv:${id}` },
        { text: "🚫 Отказ", callback_data: `rj:${id}` },
      ],
    ],
  };
}

export function reminderButtons(id: string): InlineMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🎉 Пригласили", callback_data: `iv:${id}` },
        { text: "🚫 Отказ", callback_data: `rj:${id}` },
      ],
      [{ text: "⏳ Пока тишина", callback_data: `nr:${id}` }],
    ],
  };
}

export const emptyMarkup: InlineMarkup = { inline_keyboard: [] };

export function formatVacancyCard(vacancy: ScoredVacancy, why: string, group: string): string {
  const place = [vacancy.company, vacancy.city || vacancy.region, SOURCE_LABEL[vacancy.source]].filter(Boolean);
  const lines = [`<b>${escapeHtml(vacancy.title)}</b>`, escapeHtml(place.join(" · "))];
  if (vacancy.salary) lines.push(`💰 ${escapeHtml(vacancy.salary)}`);
  const workFormat = vacancy.workFormat.replace(/<[^>]*>?/g, " ").replace(/\s+/g, " ").trim();
  if (workFormat && !workFormat.includes("<")) lines.push(escapeHtml(`Формат: ${workFormat}`));
  lines.push(`Роль: ${escapeHtml(group)}`);
  if (why) lines.push(`Почему подходит: ${escapeHtml(why)}`);
  lines.push(`<a href="${escapeHtml(vacancy.url)}">Открыть вакансию</a>`);
  lines.push("", "Письмо — следующим сообщением: зажмите его → «Копировать» → вставьте в отклик на hh.");
  return lines.join("\n");
}

export function formatSourceStatus(dateLabel: string, reports: SourceReport[]): string {
  const lines = reports.map((report) => {
    const state = report.ok ? String(report.count) : `ошибка${report.error ? `: ${report.error}` : ""}`;
    const note = report.ok && report.error ? ` (${report.error})` : "";
    return `${report.source}: ${state}${note}`;
  });
  return [`Поиск на ${dateLabel}. Найдено на площадках:`, "", ...lines].join("\n");
}

export const commandKeyboard = {
  keyboard: [
    [{ text: "Найти вакансии" }, { text: "Статистика" }],
    [{ text: "Пауза" }, { text: "Включить" }],
    [{ text: "Статус" }, { text: "Справка" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const buttonCommands: Record<string, string> = {
  "найти вакансии": "/search",
  статистика: "/stats",
  статус: "/status",
  пауза: "/pause",
  включить: "/resume",
  справка: "/help",
};

export function commandFromText(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/ё/g, "е");
  const button = buttonCommands[normalized];
  if (button) return button;
  const head = (normalized.split(/\s+/)[0] ?? "").split("@")[0];
  return head;
}

export type SendOptions = {
  mode?: "html" | "plain";
  markup?: InlineMarkup;
  fetchImpl?: typeof fetch;
};

async function failure(response: Response): Promise<Error> {
  const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 180);
  return new Error(`Telegram ${response.status}${detail ? `: ${detail}` : ""}`);
}

export async function sendTelegram(token: string, chatId: string, text: string, options: SendOptions = {}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const payload = {
    chat_id: chatId,
    link_preview_options: { is_disabled: true },
    reply_markup: options.markup ?? commandKeyboard,
  };
  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;
  const post = (body: Record<string, unknown>) =>
    fetchImpl(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  if (options.mode === "plain") {
    const plain = await post({ ...payload, text });
    if (!plain.ok) throw await failure(plain);
    return;
  }
  const response = await post({ ...payload, text, parse_mode: "HTML" });
  if (response.ok) return;
  const plain = await post({ ...payload, text: text.replace(/<[^>]+>/g, "") });
  if (!plain.ok) throw await failure(plain);
}

export async function telegramApi(token: string, method: string, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
}

export async function publishCommands(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await telegramApi(
    token,
    "setMyCommands",
    {
      commands: [
        { command: "search", description: "Найти вакансии сейчас" },
        { command: "stats", description: "Статистика откликов" },
        { command: "status", description: "Состояние рассылки" },
        { command: "pause", description: "Остановить ежедневную рассылку" },
        { command: "resume", description: "Включить рассылку" },
        { command: "help", description: "Справка" },
      ],
    },
    fetchImpl,
  );
}

export const helpText = [
  "Ищу по всей России вакансии под резюме Петра Алексеева: операционный директор, операционные проекты, руководитель направления, франчайзинг и развитие сети, e-commerce и доставка, B2B.",
  "",
  "По рабочим дням в 10:00 мск присылаю до 5 новых вакансий. На каждую — два сообщения:",
  "1) карточка с кнопками;",
  "2) только текст письма: зажмите его → «Копировать» → вставьте в отклик на hh.",
  "",
  "Кнопки под карточкой:",
  "✅ Откликнулся — через 5 рабочих дней спрошу, ответили ли;",
  "❌ Не подходит — больше не покажу;",
  "✍️ Другое письмо — напишу новый вариант.",
  "После ответа работодателя нажмите 🎉 Пригласили или 🚫 Отказ.",
  "",
  "По пятницам в 18:00 присылаю сводку: сколько откликов, приглашений и какие роли отвечают лучше.",
  "",
  "Команды: /search, /stats, /status, /pause, /resume, /help. Отклик на hh сам не отправляю.",
].join("\n");
