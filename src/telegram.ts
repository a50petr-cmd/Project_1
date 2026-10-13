import type { ScoredVacancy, SourceReport } from "./types.ts";
import { escapeHtml, splitText } from "./text.ts";

const SOURCE_LABEL: Record<ScoredVacancy["source"], string> = {
  hh: "hh.ru",
  zarplata: "Зарплата.ру",
  trudvsem: "Работа России",
  habr: "Хабр Карьера",
  superjob: "SuperJob",
};

export function formatVacancyMessages(vacancy: ScoredVacancy, letter: string): string[] {
  const place = [vacancy.company, vacancy.city || vacancy.region, SOURCE_LABEL[vacancy.source]].filter(Boolean);
  const lines = [`<b>${escapeHtml(vacancy.title)}</b>`, escapeHtml(place.join(" · "))];
  if (vacancy.salary) lines.push(escapeHtml(vacancy.salary));
  const workFormat = vacancy.workFormat.replace(/<[^>]*>?/g, " ").replace(/\s+/g, " ").trim();
  if (workFormat && !workFormat.includes("<")) lines.push(escapeHtml(`Формат: ${workFormat}`));
  lines.push(`<a href="${escapeHtml(vacancy.url)}">Открыть вакансию</a>`);
  const head = lines.join("\n");
  const body = `<b>Сопроводительное письмо</b>\n\n${escapeHtml(letter)}`;
  const combined = `${head}\n\n${body}`;
  if (combined.length <= 3900) return [combined];
  return [head, ...splitText(body, 3900)];
}

export function formatSourceStatus(dateLabel: string, reports: SourceReport[]): string {
  const lines = reports.map((report) => {
    const state = report.ok ? String(report.count) : `ошибка${report.error ? `: ${report.error}` : ""}`;
    const note = report.ok && report.error ? ` (${report.error})` : "";
    return `${report.source}: ${state}${note}`;
  });
  return [`Отчёт на ${dateLabel}.`, "", ...lines].join("\n");
}

export function formatRunSummary(dateLabel: string, reports: SourceReport[], sent: number): string {
  const lines = reports.map((report) => {
    const state = report.ok ? String(report.count) : `ошибка${report.error ? `: ${report.error}` : ""}`;
    const note = report.ok && report.error ? ` (${report.error})` : "";
    return `${report.source}: ${state}${note}`;
  });
  if (sent === 0) {
    return [`На ${dateLabel} новых подходящих вакансий нет.`, "", ...lines].join("\n");
  }
  return [`Подборка на ${dateLabel}. Новых вакансий: ${sent}.`, "", ...lines].join("\n");
}

export const commandKeyboard = {
  keyboard: [
    [{ text: "Найти вакансии" }, { text: "Статус" }],
    [{ text: "Пауза" }, { text: "Включить" }],
    [{ text: "Справка" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const buttonCommands: Record<string, string> = {
  "найти вакансии": "/search",
  статус: "/status",
  пауза: "/pause",
  включить: "/resume",
  справка: "/help",
};

export function commandFromText(text: string): string {
  const trimmed = text.trim();
  const button = buttonCommands[trimmed.toLowerCase()];
  if (button) return button;
  return (trimmed.split(/\s+/)[0] ?? "").split("@")[0].toLowerCase();
}

export async function sendTelegram(token: string, chatId: string, text: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const payload = {
    chat_id: chatId,
    link_preview_options: { is_disabled: true },
    reply_markup: commandKeyboard,
  };
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, text, parse_mode: "HTML" }),
  });
  if (response.ok) return;
  const plain = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, text: text.replace(/<[^>]+>/g, "") }),
  });
  if (!plain.ok) {
    throw new Error(`Telegram ${plain.status}`);
  }
}

export async function publishCommands(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: [
        { command: "search", description: "Найти вакансии сейчас" },
        { command: "status", description: "Состояние рассылки" },
        { command: "pause", description: "Остановить ежедневную рассылку" },
        { command: "resume", description: "Включить рассылку" },
        { command: "help", description: "Справка" },
      ],
    }),
  });
}

export const helpText = [
  "Ищу по всей России операционного директора, операционного менеджера, руководителя направления, менеджера проекта и руководителя операционных проектов. К каждой вакансии пишу отдельное письмо по резюме Петра Алексеева.",
  "",
  "Команды:",
  "/search — найти вакансии сейчас",
  "/status — состояние рассылки",
  "/pause — остановить ежедневную рассылку",
  "/resume — включить рассылку",
  "/help — эта справка",
  "",
  "Кнопки под полем ввода вызывают те же команды.",
  "По рабочим дням в 10:00 мск присылаю до 5 новых вакансий и письмо к каждой.",
  "Площадки: hh.ru, Зарплата.ру, Работа России, Хабр Карьера. SuperJob подключается ключом API.",
  "Отклик на вакансию сам не отправляю.",
].join("\n");
