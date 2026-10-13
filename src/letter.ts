import { achievements, profile, themePatterns, type Achievement, type Theme } from "./profile.ts";
import type { Contacts, ScoredVacancy } from "./types.ts";

function dominantThemes(vacancy: ScoredVacancy): Theme[] {
  const text = `${vacancy.title}\n${vacancy.description}\n${vacancy.workFormat}`;
  return (Object.keys(themePatterns) as Theme[])
    .map((theme) => ({ theme, hit: themePatterns[theme].test(text) }))
    .filter((item) => item.hit)
    .map((item) => item.theme);
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

function selectAchievements(themes: Theme[]): Achievement[] {
  const ranked = achievements
    .map((item, index) => ({
      item,
      index,
      score: item.themes.reduce((sum, theme) => sum + (themes.includes(theme) ? THEME_WEIGHT[theme] : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const matched = ranked.filter((item) => item.score > 0).slice(0, 2);
  const selected = matched.length > 0 ? matched : ranked.slice(0, 2);
  return selected.map((item) => item.item);
}

function roleLine(title: string): string {
  const value = title.toLowerCase().replace(/ё/g, "е");
  if (/операционн\p{L}*\s+проект|проект\p{L}*\s+операционн/u.test(value)) {
    return "Операционный проект для меня — это запуск, который потом живёт в цифрах, а не в статусе.";
  }
  if (/(?<![\p{L}])(менеджер\s+проект|руководител\p{L}*\s+проект|project manager)/u.test(value)) {
    return "Проект беру до результата: срок, люди и понятная цифра на выходе.";
  }
  if (/руководител\p{L}*\s+направлен/u.test(value)) {
    return "Направление веду как отдельный контур: команда, процесс и экономика.";
  }
  if (/операционн\p{L}*\s+менеджер/u.test(value)) {
    return "В операционке отвечаю за процесс и показатель, не за презентацию.";
  }
  if (/операционн|\bcoo\b|chief operating/.test(value)) {
    return "Операционный контур для меня — это процесс, люди и P&L вместе.";
  }
  return "По этой задаче есть близкий опыт, поэтому пишу.";
}

function proofLine(themes: Theme[]): string {
  if (themes.includes("import")) return "По поставкам это выглядело так.";
  if (themes.includes("franchise")) return "По запуску розницы было так.";
  if (themes.includes("darkstore") || themes.includes("ecommerce")) return "По доставке и онлайн-продажам ближе всего это.";
  if (themes.includes("b2b")) return "По оптовому контуру есть прямой результат.";
  if (themes.includes("pnl")) return "Если про деньги направления, вот что уже делал.";
  if (themes.includes("projects")) return "По запускам, которые доводил до оборота.";
  if (themes.includes("team")) return "По сборке процесса и команды.";
  return "Из того, что похоже на эту роль.";
}

function closing(vacancy: ScoredVacancy): string {
  const moscow = /москва|московск/i.test(`${vacancy.city} ${vacancy.region}`);
  if (moscow) {
    return "Я в Москве, смотрю офис, гибрид и удалёнку. Если отклик подойдёт, давайте созвонимся.";
  }
  if (vacancy.remote) {
    return "Могу вести роль удалённо из Москвы и приезжать в командировки. Если отклик подойдёт, давайте созвонимся.";
  }
  return "Я в Москве и готов к командировкам по России. Если формат роли подойдёт, давайте созвонимся.";
}

function signature(contacts: Contacts): string {
  const lines = ["С уважением,", profile.name, profile.city];
  if (contacts.phone) lines.push(contacts.phone);
  if (contacts.email) lines.push(contacts.email);
  if (contacts.telegram) lines.push(contacts.telegram);
  return lines.join("\n");
}

export function coverLetter(vacancy: ScoredVacancy, contacts: Contacts): string {
  const themes = dominantThemes(vacancy);
  const [lead, extra] = selectAchievements(themes);
  const place = [vacancy.company, vacancy.city].filter(Boolean).join(", ");
  const where = place ? ` в ${place}` : "";
  return [
    "Здравствуйте!",
    "",
    `${roleLine(vacancy.title)} Пишу на «${vacancy.title}»${where}.`,
    "",
    proofLine(themes),
    "",
    lead?.text ?? "",
    ...(extra ? ["", extra.text] : []),
    "",
    closing(vacancy),
    "",
    signature(contacts),
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
}
