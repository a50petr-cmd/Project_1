// Факты взяты из резюме от 23 сентября 2026. Цифры не дополнять.
// Телефон и почта в репозиторий не входят: репозиторий публичный.
// Их нужно положить в секреты Cloudflare CONTACT_PHONE и CONTACT_EMAIL.

export const profile = {
  name: "Алексеев Петр Александрович",
  shortName: "Петр Алексеев",
  city: "Москва",
  telegram: "https://t.me/PetroAlekseev",
  targetRole: "Операционный директор (COO)",
  experienceYears: 18,
  employment: "полная занятость",
  relocation: false,
  trips: true,
} as const;

export type Theme =
  | "import"
  | "ecommerce"
  | "franchise"
  | "darkstore"
  | "b2b"
  | "pnl"
  | "team"
  | "projects";

export type Achievement = {
  id: string;
  themes: Theme[];
  text: string;
};

export const achievements: Achievement[] = [
  {
    id: "x5-import",
    themes: ["import", "pnl", "b2b", "team", "projects"],
    text: "В X5 Group запускал оптовый импорт продуктов: выручка росла на 10–15% в квартал, EBITDA — на 5–10%.",
  },
  {
    id: "kuper",
    themes: ["b2b", "ecommerce", "pnl", "team"],
    text: "В Купере за три месяца GMV направления B2B вырос на 15%, средний чек nonfood — на 50%.",
  },
  {
    id: "komus",
    themes: ["ecommerce", "darkstore", "pnl", "projects"],
    text: "В Комусе с нуля запустил доставку: заказы росли до 200% в месяц, конверсия — с 0,3% до 1,3%.",
  },
  {
    id: "euroopt",
    themes: ["darkstore", "pnl", "team"],
    text: "В Евроопте за пять месяцев сократил затраты направления в два раза, списание — с 7% до 1,4% оборота.",
  },
  {
    id: "metro",
    themes: ["franchise", "darkstore", "pnl", "projects"],
    text: "В METRO и Яндекс Лавке открыл 25 магазинов «Фасоль» с оборотом более 900 млн ₽ в год.",
  },
  {
    id: "x5-franchise",
    themes: ["franchise", "pnl", "projects"],
    text: "Во франшизе «Пятёрочка» открыл 10 магазинов, выручка проекта выросла на 150 млн ₽ в месяц.",
  },
];

export const themePatterns: Record<Theme, RegExp> = {
  import: /импорт|вэд|поставк|закуп|порт|сырь|логист|склад|тамож/i,
  ecommerce: /e-?com|интернет-магазин|маркетплейс|онлайн|цифров|gmv|конверси/i,
  franchise: /франчайз|франшиз|рознич|ритейл|fmcg|(?<!интернет-)магазин/i,
  darkstore: /даркстор|быстр\p{L}*\s+доставк|e-?grocery|доставк|курьер/iu,
  b2b: /b2b|оптов|horeca|корпоративн\p{L}*\s+клиент/iu,
  pnl: /p&l|ebitda|прибыл|маржинал|бюджет|себестоим|выручк|unit|затрат|списан|оборот/i,
  team: /команд|кросс-функц|kpi|оргструктур|процесс/i,
  projects: /проект|запуск|открыти|масштабир|mvp/i,
};
