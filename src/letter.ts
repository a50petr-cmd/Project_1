import { achievements, profile, resumeFacts, themePatterns, type Achievement, type Theme } from "./profile.ts";
import type { ScoredVacancy } from "./types.ts";

// Workers AI: бесплатный лимит Cloudflare, отдельный ключ не нужен.
export const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export type AiLike = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

export type LetterResult = { text: string; by: "ai" | "template" };

export function dominantThemes(vacancy: Pick<ScoredVacancy, "title" | "description" | "workFormat">): Theme[] {
  const text = `${vacancy.title}\n${vacancy.description}\n${vacancy.workFormat}`;
  return (Object.keys(themePatterns) as Theme[]).filter((theme) => themePatterns[theme].test(text));
}

const THEME_WEIGHT: Record<Theme, number> = {
  import: 3,
  franchise: 3,
  ecommerce: 3,
  darkstore: 3,
  b2b: 3,
  projects: 2,
  pnl: 1,
  team: 1,
};

// Название роли весит больше, чем текст: «менеджер по франчайзингу» — это про франшизу,
// даже если в описании много слов про логистику.
function titleThemes(title: string): Theme[] {
  return (Object.keys(themePatterns) as Theme[]).filter((theme) => themePatterns[theme].test(title));
}

export function rankAchievements(vacancy: Pick<ScoredVacancy, "title" | "description" | "workFormat">): Achievement[] {
  const themes = dominantThemes(vacancy);
  const fromTitle = titleThemes(vacancy.title);
  const ranked = achievements
    .map((item, index) => ({
      item,
      index,
      score: item.themes.reduce(
        (sum, theme) => sum + (themes.includes(theme) ? THEME_WEIGHT[theme] : 0) + (fromTitle.includes(theme) ? 4 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
  return ranked;
}

export function selectAchievements(vacancy: Pick<ScoredVacancy, "title" | "description" | "workFormat">, shift = 0): Achievement[] {
  const ranked = rankAchievements(vacancy);
  const start = shift % Math.max(1, ranked.length - 1);
  return ranked.slice(start, start + 2);
}

// Пары «первый результат + второй» для подборки: у соседних писем разное начало.
export function pickPairs(vacancies: Array<Pick<ScoredVacancy, "title" | "description" | "workFormat">>): Achievement[][] {
  const usedLeads = new Map<string, number>();
  return vacancies.map((vacancy) => {
    const ranked = rankAchievements(vacancy);
    const top = ranked.slice(0, 3);
    const lead = [...top].sort((a, b) => (usedLeads.get(a.id) ?? 0) - (usedLeads.get(b.id) ?? 0))[0] ?? ranked[0];
    usedLeads.set(lead.id, (usedLeads.get(lead.id) ?? 0) + 1);
    const extra = ranked.find((item) => item.id !== lead.id);
    return extra ? [lead, extra] : [lead];
  });
}

const TASK_BY_THEME: Record<Theme, string> = {
  darkstore: "выстроить доставку, которая зарабатывает",
  ecommerce: "растить онлайн-продажи в цифрах, а не в отчётах",
  franchise: "открывать точки быстро и выводить их в плюс",
  import: "наладить поставки и логистику с понятной экономикой",
  b2b: "растить B2B-продажи",
  pnl: "отвечать за экономику направления",
  projects: "запускать новое и доводить до оборота",
  team: "собрать процессы и команду под результат",
};

const TASK_ORDER: Theme[] = ["darkstore", "ecommerce", "franchise", "import", "b2b", "projects", "pnl", "team"];

function taskLine(vacancy: ScoredVacancy): string {
  const themes = [...titleThemes(vacancy.title), ...dominantThemes(vacancy)];
  const theme = TASK_ORDER.find((item) => themes.includes(item));
  const company = vacancy.company ? `«${vacancy.company}»` : "у вас";
  const task = theme ? TASK_BY_THEME[theme] : "вырастить результат";
  return `Вижу, ${company} нужно ${task}. Это ровно то, что я делал.`;
}

function locationLine(vacancy: ScoredVacancy): string {
  if (/москва|московск/i.test(`${vacancy.city} ${vacancy.region}`) || vacancy.remote) return "";
  return "Живу в Подмосковье, к командировкам готов.";
}

export function templateLetter(vacancy: ScoredVacancy, shift = 0, pair?: Achievement[]): string {
  const [lead] = pair ?? selectAchievements(vacancy, shift);
  return [
    lead?.text ?? "",
    taskLine(vacancy),
    [locationLine(vacancy), "Готов созвониться и обсудить."].filter(Boolean).join(" "),
    `${profile.shortName}\npetr-alekseev.ru`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function lowerFirst(text: string): string {
  // «В Комусе…» → «в Комусе…», но названия компаний не трогаем.
  return text.replace(/^(В|Во)\s/, (match) => match.toLowerCase());
}

const SYSTEM_PROMPT = `Ты Пётр Алексеев. Пишешь письмо рекрутеру на hh.ru. Пишешь как опытный руководитель коллеге: уверенно, прямо, без воды. Звучит как живой человек, не бот.

Нужно:
1. Показать конкретный результат: цифра, компания, что ты сделал. Без оценок типа «успешно» или «эффективно» — цифры говорят сами.
2. Показать, что ты видишь конкретную задачу компании: что им нужно закрыть, выстроить, вырастить. И что у тебя это есть.
3. Предложить созвониться. Просто и уверенно.

Стиль:
- Живой, уверенный тон: не «я считаю, что…», а прямо «вот что нужно делать».
- Связь между тем, что ты делал, и тем, что им нужно. Это естественно, не через «Судия по вакансии…».
- Короче думай и пиши. Не лишние слова.
- В конце письма (перед подписью) добавь ссылку: petr-alekseev.ru
- Вот пример (для других данных): «В Комусе запустил доставку с нуля: за 4 месяца заказы росли до 200% в месяц. Вижу, что вам то же самое нужно выстроить. Готов созвониться и обсудить.

Пётр Алексеев
petr-alekseev.ru»

Запрещено:
- Стандартные фразы: «Здравствуйте», «Меня зовут», «Ваша вакансия меня заинтересовала», «буду рад», «с уважением», «Давайте обсудим».
- Канцелярит: «что демонстрирует», «что показывает», «мой потенциал», «я уверен», «позволит», «эффективно», «успешно».
- Цифры и компании, которых нет в фактах.
- Список требований вакансии, примеры из других компаний, эмодзи.
Объём — 250–500 знаков.

Верни только текст письма без кавычек.`;

function userPrompt(vacancy: ScoredVacancy, pair: Achievement[], avoid?: string): string {
  const description = vacancy.description.replace(/\s+/g, " ").slice(0, 3_000);
  return [
    `Факты из резюме:\n${resumeFacts}`,
    "",
    `Вакансия: ${vacancy.title}`,
    vacancy.company ? `Компания: ${vacancy.company}` : "",
    vacancy.city ? `Город: ${vacancy.city}` : "",
    vacancy.workFormat ? `Формат: ${vacancy.workFormat}` : "",
    description ? `Описание вакансии: ${description}` : "Подробного описания нет — опирайся на название роли.",
    "",
    `Твой результат, который напрямую под эту вакансию: ${pair[0]?.text ?? ""}`,
    "",
    "Напиши письмо так, чтобы звучало как от конкретного человека, который сделал это в прошлом и видит, что компании нужно то же самое.",
    "В конце (перед подписью) добавь ссылку: petr-alekseev.ru",
    avoid ? `\nПрошлый вариант не подошёл. Напиши совсем по-другому, другой результат, другой угол:\n${avoid}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function numbersOf(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((value) => value.replace(",", "."));
}

export function cleanAiLetter(raw: string): string {
  let text = raw.replace(/\r/g, "").trim();
  text = text.replace(/^["«]|["»]$/g, "").trim();
  text = text.replace(/^(здравствуйте|добрый день|уважаем\p{L}*[^\n]*)[!,.]?\s*\n+/iu, "");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!/Пётр Алексеев|Петр Алексеев/.test(text.slice(-40))) text = `${text}\n\n${profile.shortName}`;
  return text;
}

// Возвращает причину, по которой письмо ИИ нельзя отправлять, или null.
export function rejectAiLetter(letter: string, vacancy: ScoredVacancy, lead?: Achievement): string | null {
  if (lead && !lead.marker.test(letter.slice(0, 160))) return `начало не с результата ${lead.id}`;
  if (letter.length < 200) return "слишком короткое";
  if (letter.length > 800) return "слишком длинное";
  if (/меня зовут|хочу откликнуться|ваша вакансия меня заинтересовала/i.test(letter.slice(0, 120))) return "шаблонное начало";
  // Разрешаем ссылку на petr-alekseev.ru, но не email и телефон
  if (/[a-z]{3,}@|\+7/i.test(letter)) return "контакты в тексте";
  // Ссылки допустимы только на сайт
  const links = letter.match(/https?:\/\/[^\s]+/gi) ?? [];
  const invalidLinks = links.filter((link) => !link.toLowerCase().includes("petr-alekseev.ru"));
  if (invalidLinks.length > 0) return "чужие ссылки в тексте";
  const cliche = letter.match(/демонстрирует|показывает мой|подтверждает мой|мой потенциал|мне удалось|возможности сотрудничества|буду рад|с уважением|я уверен|принёс оборот|принес оборот/i);
  if (cliche) return `канцелярит: ${cliche[0]}`;
  const allowed = new Set([...numbersOf(resumeFacts), ...numbersOf(`${vacancy.title} ${vacancy.description}`)]);
  const invented = numbersOf(letter).filter((value) => !allowed.has(value));
  if (invented.length > 0) return `цифры не из резюме: ${invented.join(", ")}`;
  return null;
}

export async function writeLetter(
  vacancy: ScoredVacancy,
  options: { ai?: AiLike; avoid?: string; shift?: number; pair?: Achievement[] } = {},
): Promise<LetterResult> {
  const pair = options.pair ?? selectAchievements(vacancy, options.shift ?? 0);
  const fallback = (): LetterResult => ({ text: templateLetter(vacancy, 0, pair), by: "template" });
  if (!options.ai) return fallback();
  try {
    // Не ждём ИИ дольше 15 секунд: иначе подборку оборвёт лимит времени Cloudflare.
    const output = (await Promise.race([
      options.ai.run(AI_MODEL, {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(vacancy, pair, options.avoid) },
        ],
        max_tokens: 500,
        temperature: options.avoid ? 0.8 : 0.4,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout 15s")), 15_000)),
    ])) as { response?: unknown };
    const raw = typeof output?.response === "string" ? output.response : "";
    const letter = cleanAiLetter(raw);
    const problem = rejectAiLetter(letter, vacancy, pair[0]);
    if (problem) {
      console.warn(`AI letter rejected: ${problem}`);
      return fallback();
    }
    return { text: letter, by: "ai" };
  } catch (error) {
    console.warn(`AI letter failed: ${error instanceof Error ? error.message : String(error)}`);
    return fallback();
  }
}
