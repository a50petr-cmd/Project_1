import { coverLetter } from "../src/letter.ts";
import { profile } from "../src/profile.ts";
import { findVacancies, selectMatches } from "../src/search.ts";

const now = new Date();
const found = await findVacancies({
  fetch,
  now,
  periodDays: 14,
  enrichLimit: 12,
  superjobKey: process.env.SUPERJOB_API_KEY,
});

console.log("sources:");
for (const report of found.reports) {
  console.log(`- ${report.source}: ${report.ok ? report.count : "error"} ${report.error ?? ""}`);
}

const chosen = selectMatches(found.vacancies, {
  now: now.getTime(),
  periodDays: 14,
  minScore: 78,
  limit: 5,
});

console.log(`\nmatches: ${chosen.length}`);
for (const vacancy of chosen) {
  console.log(`\n[${vacancy.score}] ${vacancy.source} ${vacancy.title} — ${vacancy.company} — ${vacancy.city}`);
  console.log(vacancy.url);
  console.log(coverLetter(vacancy, { telegram: profile.telegram }));
}
