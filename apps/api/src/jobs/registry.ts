// Small lookup of every known job source, available or not. Not a plugin
// system — just a map plus one accessor the route uses to tell "unknown
// source" apart from "known source, not available yet."

import { careerosSource } from "./careeros.js";
import { indeedSource } from "./indeed.js";
import type { JobSource } from "./base.js";

export interface JobSourceEntry {
  source: JobSource;
  available: boolean;
}

export const JOB_SOURCES: Record<string, JobSourceEntry> = {
  indeed: { source: indeedSource, available: true },
  careeros: { source: careerosSource, available: false },
};

export function getJobSourceEntry(id: string): JobSourceEntry | undefined {
  return JOB_SOURCES[id];
}
