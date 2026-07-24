import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { getJobSourceEntry } from "../jobs/registry.js";
import type { Listing } from "../jobs/base.js";

export const jobsRouter = Router();

const USER_ID = "local";

jobsRouter.get("/", async (req, res) => {
  const site = req.query.site ? String(req.query.site) : undefined;
  const listings = await prisma.jobListing.findMany({
    where: { userId: USER_ID, ...(site ? { site } : {}) },
    orderBy: { firstSeen: "desc" },
  });
  res.json(listings);
});

const searchSchema = z.object({
  source: z.enum(["indeed", "careeros"]), // linkedin joins this union once built (Phase 2)
  terms: z.array(z.string()).optional(),
  locations: z.array(z.string()).optional(),
  days: z.number().int().positive().max(30).optional(),
});

async function persistListings(listings: Listing[]): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (const l of listings) {
    try {
      await prisma.jobListing.create({
        data: {
          userId: USER_ID,
          title: l.title,
          company: l.company,
          location: l.location,
          country: l.country,
          site: l.site,
          datePosted: l.datePosted ? new Date(l.datePosted) : undefined,
          jobUrl: l.jobUrl,
          notes: l.notes,
        },
      });
      added++;
    } catch (err) {
      // unique constraint on jobUrl -> already tracked, append-only semantics
      // preserved (manual status edits on existing rows are never touched)
      skipped++;
    }
  }
  return { added, skipped };
}

jobsRouter.post("/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { source, terms, locations, days } = parsed.data;

  const entry = getJobSourceEntry(source);
  if (!entry) return res.status(404).json({ error: `unknown job source "${source}"` });
  if (!entry.available) {
    return res.status(409).json({ error: `${entry.source.displayName} is registered but not available yet` });
  }

  try {
    const listings = await entry.source.search({ terms, locations, days });
    const result = await persistListings(listings);
    res.json({ source, found: listings.length, ...result });
  } catch (err) {
    res.status(500).json({ error: "search failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

const statusSchema = z.object({ status: z.enum(["new", "shortlist", "skip", "applied"]) });

// Statuses the Tracker owns once a listing has entered it — Job Board clicks
// must never clobber progress the user has already recorded there.
const ADVANCED_TRACKER_STATUSES = new Set(["interview", "offer", "rejected"]);

jobsRouter.patch("/:id", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const listing = await prisma.jobListing.update({ where: { id: req.params.id }, data: parsed.data });

  // Shortlisting or applying materializes (or updates) a matching Tracker
  // row — Job Board and Tracker share one status vocabulary from this point
  // in the funnel onward. Reverting to new/skip intentionally does NOT
  // touch an existing Tracker row (never destroy tracked application data
  // from a filter-state change), and a row already past shortlist/applied
  // (interview/offer/rejected) is never downgraded by a Job Board click.
  if (listing.status === "shortlist" || listing.status === "applied") {
    const existing = await prisma.application.findUnique({ where: { jobListingId: listing.id } });
    if (!existing) {
      try {
        await prisma.application.create({
          data: {
            userId: listing.userId,
            jobListingId: listing.id,
            company: listing.company,
            role: listing.title,
            location: listing.location,
            source: listing.site,
            status: listing.status,
            dateApplied: listing.status === "applied" ? new Date() : undefined,
          },
        });
      } catch (err) {
        // Unique constraint on jobListingId -> a concurrent request (e.g. a
        // double-click) already created this row; that write stands, there's
        // nothing more to do here. Mirrors persistListings' identical
        // catch-and-skip convention for JobListing's jobUrl uniqueness.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      }
    } else if (!ADVANCED_TRACKER_STATUSES.has(existing.status)) {
      await prisma.application.update({
        where: { id: existing.id },
        data: {
          status: listing.status,
          // shortlist: clear any dateApplied left over from a prior
          // "applied" state, so status and date never contradict each other.
          dateApplied:
            listing.status === "applied" ? (existing.dateApplied ?? new Date()) : null,
        },
      });
    }
  }

  res.json(listing);
});
