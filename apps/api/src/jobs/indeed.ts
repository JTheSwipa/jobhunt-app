// Indeed adapter — shells out to scripts/indeed_scan.py (python-jobspy).
// jobspy has no real TypeScript/Node equivalent worth reimplementing, so
// this is the one piece of the app that stays Python (see plan's Stack
// decision). Everything else about job sources — the interface, dedup,
// persistence — is TypeScript.

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { JobSource, Listing } from "./base.js";

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "indeed_scan.py");
const VENV_PYTHON = path.join(REPO_ROOT, "scripts", ".venv", "bin", "python");

interface IndeedScanResult {
  results: Array<{
    title: string;
    company: string;
    location: string;
    country: string;
    site: string;
    date_posted: string;
    job_url: string;
  }>;
  errors: string[];
}

export const indeedSource: JobSource = {
  id: "indeed",
  displayName: "Indeed",
  async search({ terms, locations, days = 7 }): Promise<Listing[]> {
    const args = [SCRIPT_PATH, "--days", String(days)];
    for (const t of terms ?? []) args.push("--term", t);
    for (const l of locations ?? []) args.push("--location", l);

    const { stdout } = await execFileAsync(VENV_PYTHON, args, {
      maxBuffer: 20 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    });
    const parsed = JSON.parse(stdout) as IndeedScanResult;
    if (parsed.errors.length) {
      console.warn(`[indeed] ${parsed.errors.length} search error(s):`, parsed.errors);
    }
    return parsed.results.map((r) => ({
      title: r.title,
      company: r.company,
      location: r.location,
      country: r.country,
      site: "indeed",
      datePosted: r.date_posted || undefined,
      jobUrl: r.job_url,
    }));
  },
};
