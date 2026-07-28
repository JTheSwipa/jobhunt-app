import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async () => {
  const { makePrismaMock } = await import("../test/prismaMock.js");
  return { prisma: makePrismaMock() };
});
vi.mock("../jobs/registry.js", () => ({ getJobSourceEntry: vi.fn() }));

import { createApp } from "../app.js";
import { prisma } from "../db.js";
import { getJobSourceEntry } from "../jobs/registry.js";
import { startTestServer, type TestClient } from "../test/httpTestServer.js";
import { prismaError, type PrismaMock } from "../test/prismaMock.js";
import type { Listing } from "../jobs/base.js";

const db = prisma as unknown as PrismaMock;
const registry = vi.mocked(getJobSourceEntry);

let client: TestClient;

beforeAll(async () => {
  client = await startTestServer(createApp());
});

afterAll(async () => {
  await client.close();
});

beforeEach(() => {
  vi.resetAllMocks();
});

function makeListing(over: Partial<Listing> = {}): Listing {
  return {
    title: "Data Engineer",
    company: "Acme",
    location: "Remote",
    country: "NL",
    site: "indeed",
    jobUrl: "https://example.com/job/1",
    ...over,
  };
}

/** A JobListing row as Prisma would hand it back after the status update. */
function makeRow(over: Record<string, unknown> = {}) {
  return {
    id: "listing-1",
    userId: "local",
    status: "new",
    title: "Data Engineer",
    company: "Acme",
    location: "Remote",
    country: "NL",
    site: "indeed",
    jobUrl: "https://example.com/job/1",
    notes: null,
    ...over,
  };
}

describe("GET /api/jobs", () => {
  it("returns this user's listings, newest first", async () => {
    db.jobListing.findMany.mockResolvedValue([makeRow()]);

    const res = await client.request("GET", "/api/jobs");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({ id: "listing-1" })]);
    expect(db.jobListing.findMany).toHaveBeenCalledWith({
      where: { userId: "local" },
      orderBy: { firstSeen: "desc" },
    });
  });

  it("narrows to one site when ?site is given", async () => {
    db.jobListing.findMany.mockResolvedValue([]);

    await client.request("GET", "/api/jobs?site=indeed");

    expect(db.jobListing.findMany).toHaveBeenCalledWith({
      where: { userId: "local", site: "indeed" },
      orderBy: { firstSeen: "desc" },
    });
  });

  it("does not filter by site when the query param is absent", async () => {
    db.jobListing.findMany.mockResolvedValue([]);

    await client.request("GET", "/api/jobs");

    expect(db.jobListing.findMany.mock.calls[0][0].where).not.toHaveProperty("site");
  });
});

describe("POST /api/jobs/search", () => {
  it("rejects a source outside the supported set", async () => {
    const res = await client.request("POST", "/api/jobs/search", { source: "monster" });

    expect(res.status).toBe(400);
    expect(registry).not.toHaveBeenCalled();
  });

  it("rejects a lookback window longer than 30 days", async () => {
    const res = await client.request("POST", "/api/jobs/search", { source: "indeed", days: 31 });

    expect(res.status).toBe(400);
  });

  it("rejects a non-positive lookback window", async () => {
    const res = await client.request("POST", "/api/jobs/search", { source: "indeed", days: 0 });

    expect(res.status).toBe(400);
  });

  it("404s a source that passes validation but isn't in the registry", async () => {
    // Guard for the registry and the zod enum drifting apart: today every
    // enum member is registered, so this branch is only reachable when
    // someone adds a source to one list and forgets the other.
    registry.mockReturnValue(undefined);

    const res = await client.request("POST", "/api/jobs/search", { source: "careeros" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.stringContaining("careeros") });
  });

  it("409s a registered but not-yet-available source", async () => {
    const search = vi.fn();
    registry.mockReturnValue({
      source: { id: "careeros", displayName: "CareerOS", search },
      available: false,
    });

    const res = await client.request("POST", "/api/jobs/search", { source: "careeros" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringContaining("CareerOS") });
    expect(search).not.toHaveBeenCalled();
  });

  it("persists what the source found and reports added/skipped", async () => {
    const search = vi.fn().mockResolvedValue([
      makeListing({ jobUrl: "https://example.com/job/1" }),
      makeListing({ jobUrl: "https://example.com/job/2" }),
    ]);
    registry.mockReturnValue({ source: { id: "indeed", displayName: "Indeed", search }, available: true });
    db.jobListing.create.mockResolvedValue(makeRow());

    const res = await client.request("POST", "/api/jobs/search", {
      source: "indeed",
      terms: ["data engineer"],
      locations: ["Amsterdam"],
      days: 7,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ source: "indeed", found: 2, added: 2, skipped: 0 });
    expect(search).toHaveBeenCalledWith({ terms: ["data engineer"], locations: ["Amsterdam"], days: 7 });
    expect(db.jobListing.create).toHaveBeenCalledTimes(2);
  });

  it("counts an already-tracked listing as skipped instead of failing the search", async () => {
    // Append-only semantics: the unique jobUrl constraint is the dedup, and a
    // rejected insert must not abort the rest of the batch.
    const search = vi.fn().mockResolvedValue([makeListing(), makeListing({ jobUrl: "https://example.com/job/2" })]);
    registry.mockReturnValue({ source: { id: "indeed", displayName: "Indeed", search }, available: true });
    db.jobListing.create
      .mockRejectedValueOnce(prismaError("P2002"))
      .mockResolvedValueOnce(makeRow());

    const res = await client.request("POST", "/api/jobs/search", { source: "indeed" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ source: "indeed", found: 2, added: 1, skipped: 1 });
  });

  it("maps a date string from the source onto a Date, and omits it when absent", async () => {
    const search = vi.fn().mockResolvedValue([
      makeListing({ datePosted: "2026-07-01" }),
      makeListing({ jobUrl: "https://example.com/job/2" }),
    ]);
    registry.mockReturnValue({ source: { id: "indeed", displayName: "Indeed", search }, available: true });
    db.jobListing.create.mockResolvedValue(makeRow());

    await client.request("POST", "/api/jobs/search", { source: "indeed" });

    expect(db.jobListing.create.mock.calls[0][0].data.datePosted).toEqual(new Date("2026-07-01"));
    expect(db.jobListing.create.mock.calls[1][0].data.datePosted).toBeUndefined();
  });

  it("500s with the reason when the source itself fails", async () => {
    const search = vi.fn().mockRejectedValue(new Error("python scan exited 1"));
    registry.mockReturnValue({ source: { id: "indeed", displayName: "Indeed", search }, available: true });

    const res = await client.request("POST", "/api/jobs/search", { source: "indeed" });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "search failed", detail: "python scan exited 1" });
  });
});

describe("PATCH /api/jobs/:id — status and Tracker sync", () => {
  it("rejects a status outside the Job Board vocabulary", async () => {
    const res = await client.request("PATCH", "/api/jobs/listing-1", { status: "interview" });

    expect(res.status).toBe(400);
    expect(db.jobListing.update).not.toHaveBeenCalled();
  });

  it.each(["new", "skip"])("leaves the Tracker untouched when moving to %s", async (status) => {
    db.jobListing.update.mockResolvedValue(makeRow({ status }));

    const res = await client.request("PATCH", "/api/jobs/listing-1", { status });

    expect(res.status).toBe(200);
    expect(db.application.findUnique).not.toHaveBeenCalled();
    expect(db.application.create).not.toHaveBeenCalled();
    expect(db.application.update).not.toHaveBeenCalled();
  });

  it("materializes a Tracker row on shortlist, with no applied date", async () => {
    db.jobListing.update.mockResolvedValue(makeRow({ status: "shortlist" }));
    db.application.findUnique.mockResolvedValue(null);
    db.application.create.mockResolvedValue({ id: "app-1" });

    const res = await client.request("PATCH", "/api/jobs/listing-1", { status: "shortlist" });

    expect(res.status).toBe(200);
    expect(db.application.create).toHaveBeenCalledWith({
      data: {
        userId: "local",
        jobListingId: "listing-1",
        company: "Acme",
        role: "Data Engineer",
        location: "Remote",
        source: "indeed",
        status: "shortlist",
        dateApplied: undefined,
      },
    });
  });

  it("stamps an applied date when the listing goes straight to applied", async () => {
    db.jobListing.update.mockResolvedValue(makeRow({ status: "applied" }));
    db.application.findUnique.mockResolvedValue(null);
    db.application.create.mockResolvedValue({ id: "app-1" });

    await client.request("PATCH", "/api/jobs/listing-1", { status: "applied" });

    expect(db.application.create.mock.calls[0][0].data).toMatchObject({
      status: "applied",
      dateApplied: expect.any(Date),
    });
  });

  it("promotes an existing shortlist row to applied and dates it", async () => {
    db.jobListing.update.mockResolvedValue(makeRow({ status: "applied" }));
    db.application.findUnique.mockResolvedValue({ id: "app-1", status: "shortlist", dateApplied: null });
    db.application.update.mockResolvedValue({ id: "app-1" });

    await client.request("PATCH", "/api/jobs/listing-1", { status: "applied" });

    expect(db.application.create).not.toHaveBeenCalled();
    expect(db.application.update.mock.calls[0][0]).toMatchObject({
      where: { id: "app-1" },
      data: { status: "applied", dateApplied: expect.any(Date) },
    });
  });

  it("keeps the original applied date when re-applying", async () => {
    const original = new Date("2026-06-01T10:00:00Z");
    db.jobListing.update.mockResolvedValue(makeRow({ status: "applied" }));
    db.application.findUnique.mockResolvedValue({ id: "app-1", status: "applied", dateApplied: original });
    db.application.update.mockResolvedValue({ id: "app-1" });

    await client.request("PATCH", "/api/jobs/listing-1", { status: "applied" });

    expect(db.application.update.mock.calls[0][0].data.dateApplied).toEqual(original);
  });

  it("clears a stale applied date when demoting to shortlist", async () => {
    // Otherwise the Tracker shows "not yet applied" next to a real date.
    db.jobListing.update.mockResolvedValue(makeRow({ status: "shortlist" }));
    db.application.findUnique.mockResolvedValue({
      id: "app-1",
      status: "applied",
      dateApplied: new Date("2026-06-01T10:00:00Z"),
    });
    db.application.update.mockResolvedValue({ id: "app-1" });

    await client.request("PATCH", "/api/jobs/listing-1", { status: "shortlist" });

    expect(db.application.update.mock.calls[0][0].data).toEqual({ status: "shortlist", dateApplied: null });
  });

  it.each(["interview", "offer", "rejected"])(
    "never downgrades a Tracker row already at %s",
    async (status) => {
      db.jobListing.update.mockResolvedValue(makeRow({ status: "shortlist" }));
      db.application.findUnique.mockResolvedValue({ id: "app-1", status, dateApplied: new Date() });

      const res = await client.request("PATCH", "/api/jobs/listing-1", { status: "shortlist" });

      expect(res.status).toBe(200);
      expect(db.application.update).not.toHaveBeenCalled();
      expect(db.application.create).not.toHaveBeenCalled();
    },
  );

  it("survives the create losing a race with a concurrent request", async () => {
    // findUnique-then-create is a TOCTOU window: two clicks can both see "no
    // row" and both try to insert against the unique jobListingId. The loser
    // must treat the winner's row as the answer, not crash.
    db.jobListing.update.mockResolvedValue(makeRow({ status: "shortlist" }));
    db.application.findUnique.mockResolvedValue(null);
    db.application.create.mockRejectedValue(prismaError("P2002"));

    const res = await client.request("PATCH", "/api/jobs/listing-1", { status: "shortlist" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "listing-1", status: "shortlist" });
  });

  it("does not swallow a create failure that isn't the unique-constraint race", async () => {
    db.jobListing.update.mockResolvedValue(makeRow({ status: "shortlist" }));
    db.application.findUnique.mockResolvedValue(null);
    db.application.create.mockRejectedValue(prismaError("P2003"));

    const res = await client.request("PATCH", "/api/jobs/listing-1", { status: "shortlist" });

    expect(res.status).toBe(400);
  });

  it("404s an unknown listing id instead of taking the process down", async () => {
    // Regression: express 4 drops async rejections, so this un-caught P2025
    // used to kill the API — no response to this client, and every other
    // in-flight request died with the process.
    db.jobListing.update.mockRejectedValue(prismaError("P2025"));

    const res = await client.request("PATCH", "/api/jobs/does-not-exist", { status: "shortlist" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not found" });
  });

  it("stays up and keeps serving after a route error", async () => {
    db.jobListing.update.mockRejectedValue(prismaError("P2025"));
    await client.request("PATCH", "/api/jobs/does-not-exist", { status: "shortlist" });

    const health = await client.request("GET", "/health");

    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true });
  });
});
