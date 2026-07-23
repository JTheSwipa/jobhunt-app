// CareerOS adapter — deliberately NOT implemented.
//
// Their job board (app.thecareeros.com/app/jobs) is Algolia-backed: the page
// calls Algolia client-side with a public, search-only API key, and returns
// clean structured listing JSON directly (title, company, location, full
// description, posted date). That's a legitimate, safe-by-design Algolia key
// tier, not a security issue — but Jovan is actively applying to CareerOS,
// and reaching into their backend directly instead of going through their
// own UI is a judgment call specific to that relationship, not a technical
// one. Whether to build this adapter at all — hit Algolia directly, drive
// their UI instead, or skip it entirely — is an open question pending a
// direct conversation with them, not a decision made unilaterally here.
//
// This file exists only to prove the registry accommodates a disabled
// source cleanly. No HTTP call to their endpoint, no credentials, no
// working search — see registry.ts, where this is registered with
// `available: false`.

import type { JobSource, Listing } from "./base.js";

export const careerosSource: JobSource = {
  id: "careeros",
  displayName: "CareerOS",
  async search(): Promise<Listing[]> {
    throw new Error(
      "CareerOS adapter is not implemented (pending a direct decision on consuming their board's Algolia backend — see the comment at the top of this file)",
    );
  },
};
