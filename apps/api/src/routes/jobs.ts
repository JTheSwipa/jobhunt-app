import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { indeedSource } from "../jobs/indeed.js";
import type { JobSource, Listing } from "../jobs/base.js";

export const jobsRouter = Router();

const USER_ID = "local";

const SOURCES: Record<string, JobSource> = {
  indeed: indeedSource,
};

jobsRouter.get("/", async (req, res) => {
  const site = req.query.site ? String(req.query.site) : undefined;
  const listings = await prisma.jobListing.findMany({
    where: { userId: USER_ID, ...(site ? { site } : {}) },
    orderBy: { firstSeen: "desc" },
  });
  res.json(listings);
});

const searchSchema = z.object({
  source: z.enum(["indeed"]), // careeros/linkedin join this union once built (Phase 1 remainder / Phase 2)
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
  try {
    const listings = await SOURCES[source].search({ terms, locations, days });
    const result = await persistListings(listings);
    res.json({ source, found: listings.length, ...result });
  } catch (err) {
    res.status(500).json({ error: "search failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

const statusSchema = z.object({ status: z.enum(["new", "shortlist", "skip", "applied"]) });

jobsRouter.patch("/:id", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const listing = await prisma.jobListing.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(listing);
});
