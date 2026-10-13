import { themePatterns } from "./profile.ts";
import type { ScoredVacancy, Vacancy } from "./types.ts";

const ASSISTANT = /(?<![\p{L}])(стаж[её]р\p{L}*|junior|помощник\p{L}*|ассистент\p{L}*|стажировк\p{L}*)/iu;
const BLUE_COLLAR = /(?<![\p{L}])(курьер|кассир|кладовщик|продавец|водитель|грузчик|упаковщик|мерчандайзер)(?![\p{L}])/iu;
const PART_TIME = /частичн\p{L}*\s+занятост|подработк|part[- ]?time/iu;

export function titleScore(title: string): number {
  const value = title.toLowerCase().replace(/ё/g, "е");
  if (ASSISTANT.test(value) || BLUE_COLLAR.test(value)) return 0;

  let score = 8;
  if (/\bcoo\b|chief operating/.test(value)) score = 62;
  else if (/операционн\p{L}*\s+директор|директор\s+по\s+операционн/u.test(value)) score = 62;
  else if (/head of operations/.test(value)) score = 60;
  else if (/операционн\p{L}*\s+деятельност/u.test(value) && /директор|руководител/.test(value)) score = 58;
  else if (/операционн\p{L}*\s+проект|проект\p{L}*\s+операционн|operations?\s+project/u.test(value)) score = 56;
  else if (/операционн/.test(value) && /руководител|директор|head|менеджер/.test(value)) score = 54;
  else if (/руководител\p{L}*\s+направлен/u.test(value)) score = 52;
  else if (/(?<![\p{L}])(менеджер\s+проект\p{L}*|руководител\p{L}*\s+проект\p{L}*|project manager|\bpm\b)/u.test(value)) score = 50;
  else if (/исполнительн\p{L}*\s+директор/u.test(value)) score = 36;
  else if (/управляющ\p{L}*\s+директор/u.test(value)) score = 34;
  else if (/директор\s+по\s+развитию/.test(value)) score = 30;
  else if (/\bceo\b|генеральн\p{L}*\s+директор/u.test(value)) score = 26;
  else if (/операционн/.test(value)) score = 24;

  if (/(коммерческ\p{L}*\s+директор|директор\s+по\s+продажам|директор\s+по\s+маркетинг)/u.test(value) && !/операционн|\bcoo\b/.test(value)) {
    score = Math.min(score, 18);
  }
  if (/(техническ\p{L}*\s+директор|финансовый директор|\bcio\b|\bcto\b|директор по ит|директор по персоналу|\bhr\b)/u.test(value) && !/операционн|\bcoo\b/.test(value)) {
    score = Math.min(score, 12);
  }
  if (
    /проект|project manager|\bpm\b/.test(value) &&
    /(разработ|frontend|backend|\bios\b|android|тестиров|\bqa\b|\bit\b|программ)/.test(value) &&
    !/операционн|\bcoo\b/.test(value)
  ) {
    score = Math.min(score, 16);
  }
  if (/магазин[аеу]?|ресторан|кофейн|салон[аеу]?|аптек/.test(value) && !/сет|федеральн|холдинг|групп/.test(value)) {
    score = Math.min(score, 40);
  }
  return score;
}

export function allowsRemote(workFormat: string): boolean | null {
  const value = workFormat.toLowerCase().replace(/ё/g, "е");
  if (!value) return null;
  if (/удален|remote|гибрид|hybrid|дистанц/.test(value)) return true;
  if (/на месте работодателя|в офисе|офис/.test(value)) return false;
  return null;
}

export function isMoscow(city: string, region: string): boolean {
  return /москва|московск/i.test(`${city} ${region}`);
}

const CONTENT_GROUPS = [
  /операционн|процесс|p&l|ebitda|юнит|маржинал/i,
  /логист|склад|импорт|поставк|закуп/i,
  /e-?com|e-?grocery|доставк|даркстор|интернет-магазин|маркетплейс/i,
  /розниц|франчайз|франшиз|ритейл|fmcg|магазин/i,
  /b2b|оптов/i,
  /кросс-функц|kpi|бюджет|команд/i,
  /проект|запуск|масштабир/i,
];

export function contentScore(text: string): number {
  const hits = CONTENT_GROUPS.filter((pattern) => pattern.test(text)).length;
  return Math.min(12, hits * 3);
}

export function experienceScore(text: string): number {
  const hits = Object.values(themePatterns).filter((pattern) => pattern.test(text)).length;
  return Math.min(12, hits * 3);
}

export function isAddedRole(title: string): boolean {
  const value = title.toLowerCase().replace(/ё/g, "е");
  return (
    /(?<![\p{L}])(менеджер\s+проект|руководител\p{L}*\s+проект|project manager)/u.test(value) ||
    /руководител\p{L}*\s+направлен/u.test(value) ||
    /операционн\p{L}*\s+менеджер|operations manager/u.test(value) ||
    /операционн\p{L}*\s+проект|проект\p{L}*\s+операционн/u.test(value)
  );
}

const CLOSE_INDUSTRY = /розниц|ритейл|fmcg|e-?com|e-?grocery|логист|оптов|франчайз|франшиз|доставк|маркетплейс|дистриб|продукт\p{L}*\s+питан/iu;
const FAR_INDUSTRY = /коллект|взыскан|микрофинанс|банн|спа-комплекс|стоматолог|застройщик|девелопер|отделк\p{L}*\s+квартир/iu;

export function industryAdjustment(text: string): number {
  const close = CLOSE_INDUSTRY.test(text);
  const far = FAR_INDUSTRY.test(text);
  if (far && !close) return -36;
  if (close) return 6;
  return 0;
}

export function freshnessScore(publishedAt: string, now: number): number {
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published)) return 4;
  const days = (now - published) / 86_400_000;
  if (days <= 3) return 8;
  if (days <= 7) return 6;
  if (days <= 14) return 3;
  return 0;
}

export function isRecent(publishedAt: string, now: number, periodDays: number): boolean {
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published)) return true;
  const days = (now - published) / 86_400_000;
  return days <= periodDays && days >= -1;
}

export function scoreVacancy(vacancy: Vacancy, now: number): ScoredVacancy | null {
  if (PART_TIME.test(`${vacancy.title} ${vacancy.employment}`)) return null;
  if (/ассистент|личный помощник/i.test(vacancy.description.slice(0, 500))) return null;

  let role = titleScore(vacancy.title);
  if (role === 0) return null;
  const description = `${vacancy.title}\n${vacancy.description}`;
  if (role < 50 && /операционн\p{L}*\s+директор|\bcoo\b|chief operating|менеджер\s+проектов|менеджер\s+операционн/iu.test(description)) {
    role = Math.max(role, 50);
  }

  const moscow = isMoscow(vacancy.city, vacancy.region);
  const remote = allowsRemote(vacancy.workFormat);
  const location = moscow ? 24 : 18;
  const body = `${vacancy.title}\n${vacancy.description}`;
  const relevance = Math.min(12, contentScore(vacancy.description) + experienceScore(body));

  const score = role + location + freshnessScore(vacancy.publishedAt, now) + relevance + industryAdjustment(body);
  return { ...vacancy, score, remote: remote === true };
}

export function rankVacancies(
  vacancies: Vacancy[],
  options: { now: number; periodDays: number; minScore: number; limit: number },
): ScoredVacancy[] {
  const ranked = vacancies
    .filter((vacancy) => isRecent(vacancy.publishedAt, options.now, options.periodDays))
    .map((vacancy) => scoreVacancy(vacancy, options.now))
    .filter((vacancy): vacancy is ScoredVacancy => vacancy !== null && vacancy.score >= options.minScore)
    .sort((a, b) => b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const top = ranked.slice(0, options.limit);
  if (top.length === options.limit && !top.some((item) => isAddedRole(item.title))) {
    const extra = ranked.find((item) => isAddedRole(item.title));
    if (extra) top[top.length - 1] = extra;
  }
  return top;
}
