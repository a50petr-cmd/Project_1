const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  bull: "•",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

export function htmlToText(html: string): string {
  const stripped = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d|tr|ul|ol)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  );
  return stripped
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type RssItem = {
  title: string;
  link: string;
  pubDate: string;
  description: string;
};

function tagValue(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return "";
  return decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
}

export function parseRssItems(xml: string): RssItem[] {
  return xml
    .split(/<item\b[^>]*>/i)
    .slice(1)
    .map((chunk) => {
      const end = chunk.search(/<\/item>/i);
      const body = end >= 0 ? chunk.slice(0, end) : chunk;
      return {
        title: tagValue(body, "title"),
        link: tagValue(body, "link"),
        pubDate: tagValue(body, "pubDate"),
        description: tagValue(body, "description"),
      };
    })
    .filter((item) => item.title && item.link);
}

export function rssField(description: string, label: string): string {
  const text = htmlToText(description);
  const match = text.match(new RegExp(`${label}:\\s*(.+)`));
  return match?.[1]?.trim() ?? "";
}

export type JobPosting = {
  title: string;
  company: string;
  city: string;
  region: string;
  country: string;
  description: string;
  datePosted: string;
};

export function parseJobPosting(html: string): JobPosting | null {
  const pattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const data = JSON.parse(match[1]) as {
        "@type"?: string;
        title?: string;
        description?: string;
        datePosted?: string;
        hiringOrganization?: { name?: string };
        jobLocation?: { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
      };
      if (data["@type"] !== "JobPosting") continue;
      const address = data.jobLocation?.address;
      return {
        title: data.title?.trim() ?? "",
        company: data.hiringOrganization?.name?.trim() ?? "",
        city: address?.addressLocality?.trim() ?? "",
        region: address?.addressRegion?.trim() ?? "",
        country: address?.addressCountry?.trim() ?? "",
        description: htmlToText(data.description ?? ""),
        datePosted: data.datePosted?.trim() ?? "",
      };
    } catch {
      // следующий блок
    }
  }
  return null;
}

export function extractWorkFormat(html: string): string {
  const index = html.search(/Формат работы/i);
  if (index < 0) return "";
  const slice = html.slice(index, index + 400);
  const end = slice.search(/<\/p>|<div|<span class="noprint"/i);
  const chunk = (end > 0 ? slice.slice(0, end) : slice).replace(/<[^>]*>/g, " ").replace(/<[^>]*$/g, " ");
  const text = decodeEntities(chunk).replace(/\s+/g, " ").trim();
  const match = text.match(/Формат работы:?\s*(.+)/i);
  if (!match) return "";
  return match[1].split(/Сейчас эту|Опыт работы|Занятость|График/)[0].trim().slice(0, 80);
}

export function vacancyIdFromUrl(url: string): string {
  const match = url.match(/\/vacancy\/(\d+)/i) ?? url.match(/\/vacancies\/(\d+)/i);
  return match?.[1] ?? url;
}

const GENERIC_COMPANY = /^(job offer|крупная компания|компания|confidential|работодатель)$/i;

function tidyCompany(name: string): string {
  return name.replace(/,?\s*работа в офисе\s*$/i, "").trim();
}

export function pickCompany(primary: string, fallback: string): string {
  const first = tidyCompany(primary.trim());
  const second = tidyCompany(fallback.trim());
  if (first && !GENERIC_COMPANY.test(first)) return first;
  if (second && !GENERIC_COMPANY.test(second)) return second;
  return first || second;
}

export function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitText(value: string, limit: number): string[] {
  if (value.length <= limit) return [value];
  const parts: string[] = [];
  let rest = value;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.4) cut = limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}
