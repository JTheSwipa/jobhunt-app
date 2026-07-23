// Shared shape for every job source adapter. Mirrors the plugin contract
// used by career-ops's providers/_types.js ({ id, fetch() }) — a genuinely
// clean pattern worth reusing even though this is a different language and
// entirely original code.

export interface Listing {
  title: string;
  company: string;
  location?: string;
  country?: string;
  site: string; // "indeed" | "careeros" | "linkedin"
  datePosted?: string; // ISO date string, if known
  jobUrl: string;
  notes?: string;
}

export interface JobSource {
  id: string;
  search(params: { terms?: string[]; locations?: string[]; days?: number }): Promise<Listing[]>;
}
