export type SourceId = "hh" | "zarplata" | "trudvsem" | "habr" | "superjob";

export type Vacancy = {
  source: SourceId;
  id: string;
  dedupeKey: string;
  title: string;
  company: string;
  url: string;
  city: string;
  region: string;
  salary: string;
  publishedAt: string;
  workFormat: string;
  employment: string;
  description: string;
};

export type ScoredVacancy = Vacancy & {
  score: number;
  remote: boolean;
};

export type SourceReport = {
  source: string;
  ok: boolean;
  count: number;
  error?: string;
};

export type Contacts = {
  phone?: string;
  email?: string;
  telegram?: string;
};
