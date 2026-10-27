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

export function selectAchievements(vacancy: Pick<ScoredVacancy, "title" | "description" | "workFormat">, shift = 0): Achievement[] {
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
  const start = shift % Math.max(1, ranked.length - 1);
  return ranked.slice(start, start + 2);
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
  const company = vacancy.company ? `в компании «${vacancy.company}»` : "вам";
  const task = theme ? TASK_BY_THEME[theme] : "получить измеримый результат";
  return `Судя по вакансии, ${company} нужно ${task} — это ровно то, чем я занимался последние годы.`;
}

function locationLine(vacancy: ScoredVacancy): string {
  if (/москва|московск/i.test(`${vacancy.city} ${vacancy.region}`) || vacancy.remote) return "";
  return "Живу в Подмосковье, к командировкам готов.";
}

export function templateLetter(vacancy: ScoredVacancy, shift = 0): string {
  const [lead, extra] = selectAchievements(vacancy, shift);
  return [
    lead?.text ?? "",
    taskLine(vacancy),
    extra ? `Ещё пример: ${lowerFirst(extra.text)}` : "",
    [locationLine(vacancy), "Готов коротко рассказать, с чего начал бы у вас. Когда удобно созвониться?"].filter(Boolean).join(" "),
    profile.shortName,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function lowerFirst(text: string): string {
  // «В Комусе…» → «в Комусе…», но названия компаний не трогаем.
  return text.replace(/^(В|Во)\s/, (match) => match.toLowerCase());
}

const SYSTEM_PROMPT = `Ты пишешь сопроводительное письмо к отклику на hh.ru от имени Петра Алексеева. Так пишет занятой опытный руководитель коллеге: коротко, прямо, без канцелярита и без самовосхваления.

Структура — три коротких абзаца через пустую строку, потом подпись:
1. Одна фраза: самый близкий к вакансии результат Петра с цифрой из фактов. Начинай сразу с дела: «В X5 вёл…», «В Комусе с нуля запустил…».
2. Одна-две фразы: какую задачу компании ты видишь в вакансии и второй результат с цифрой, который это подтверждает.
3. Одна фраза: «Готов рассказать подробнее — когда удобно созвониться?» или похожая простая фраза.
Подпись: Пётр Алексеев

Запрещено:
- «Здравствуйте», «Меня зовут», «Хочу откликнуться», «Ваша вакансия меня заинтересовала».
- Оценки себя и связки-пояснения: «что демонстрирует», «что показывает», «что подтверждает», «мой потенциал», «мой опыт в», «я уверен», «мне удалось», «позволит», «эффективно», «успешно».
- «Давайте обсудим возможности сотрудничества», «буду рад», «с уважением».
- Цифры, компании, должности и навыки, которых нет в фактах. Оборот 35 млрд ₽ — это оборот направления, которым управлял Пётр; не пиши, что он его «принёс» или «создал».
- Пересказ требований вакансии, списки, эмодзи, контакты, ссылки.
Объём всего письма — 300–550 знаков.

Пример тона (для другой вакансии, не копируй):
В Комусе с нуля за 4 месяца запустил доставку из супермаркетов: заказы росли до 200% в месяц.

Вижу, что вам нужно вывести доставку в плюс. В Евроопте за 5 месяцев сократил затраты такого сервиса вдвое, списания — с 7% до 1,4%.

Готов рассказать подробнее — когда удобно созвониться?

Пётр Алексеев

Верни только текст письма.`;

function userPrompt(vacancy: ScoredVacancy, avoid?: string): string {
  const description = vacancy.description.replace(/\s+/g, " ").slice(0, 3_000);
  return [
    `Факты из резюме:\n${resumeFacts}`,
    "",
    `Вакансия: ${vacancy.title}`,
    vacancy.company ? `Компания: ${vacancy.company}` : "",
    vacancy.city ? `Город: ${vacancy.city}` : "",
    vacancy.workFormat ? `Формат: ${vacancy.workFormat}` : "",
    description ? `Текст вакансии: ${description}` : "Текста вакансии нет — опирайся на название.",
    avoid ? `\nПрошлый вариант письма не понравился, напиши заметно иначе, начни с другого результата:\n${avoid}` : "",
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
export function rejectAiLetter(letter: string, vacancy: ScoredVacancy): string | null {
  if (letter.length < 200) return "слишком короткое";
  if (letter.length > 800) return "слишком длинное";
  if (/меня зовут|хочу откликнуться|ваша вакансия меня заинтересовала/i.test(letter.slice(0, 120))) return "шаблонное начало";
  if (/[a-z]{3,}@|\+7|https?:\/\//i.test(letter)) return "контакты в тексте";
  const cliche = letter.match(/демонстрирует|показывает мой|подтверждает мой|мой потенциал|мне удалось|возможности сотрудничества|буду рад|с уважением|я уверен|принёс оборот|принес оборот/i);
  if (cliche) return `канцелярит: ${cliche[0]}`;
  const allowed = new Set([...numbersOf(resumeFacts), ...numbersOf(`${vacancy.title} ${vacancy.description}`)]);
  const invented = numbersOf(letter).filter((value) => !allowed.has(value));
  if (invented.length > 0) return `цифры не из резюме: ${invented.join(", ")}`;
  return null;
}

export async function writeLetter(
  vacancy: ScoredVacancy,
  options: { ai?: AiLike; avoid?: string; shift?: number } = {},
): Promise<LetterResult> {
  const fallback = (): LetterResult => ({ text: templateLetter(vacancy, options.shift ?? 0), by: "template" });
  if (!options.ai) return fallback();
  try {
    // Не ждём ИИ дольше 15 секунд: иначе подборку оборвёт лимит времени Cloudflare.
    const output = (await Promise.race([
      options.ai.run(AI_MODEL, {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(vacancy, options.avoid) },
        ],
        max_tokens: 500,
        temperature: options.avoid ? 0.8 : 0.4,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout 15s")), 15_000)),
    ])) as { response?: unknown };
    const raw = typeof output?.response === "string" ? output.response : "";
    const letter = cleanAiLetter(raw);
    const problem = rejectAiLetter(letter, vacancy);
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
