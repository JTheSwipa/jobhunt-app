import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async () => {
  const { makePrismaMock } = await import("../test/prismaMock.js");
  return { prisma: makePrismaMock() };
});

import { createApp } from "../app.js";
import { prisma } from "../db.js";
import { startTestServer, type TestClient } from "../test/httpTestServer.js";
import { prismaError, type PrismaMock } from "../test/prismaMock.js";

const db = prisma as unknown as PrismaMock;

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

function makeRow(over: Record<string, unknown> = {}) {
  return {
    id: "app-1",
    userId: "local",
    company: "Acme",
    role: "Data Engineer",
    status: "applied",
    dateApplied: new Date("2026-06-01T00:00:00Z"),
    ...over,
  };
}

describe("GET /api/tracker", () => {
  it("returns this user's applications, most recently applied first", async () => {
    db.application.findMany.mockResolvedValue([makeRow()]);

    const res = await client.request("GET", "/api/tracker");

    expect(res.status).toBe(200);
    // The include is what lets the Tracker show which CV actually went out.
    expect(db.application.findMany).toHaveBeenCalledWith({
      where: { userId: "local" },
      orderBy: { dateApplied: "desc" },
      include: {
        cvRender: {
          select: { id: true, profileName: true, filename: true, createdAt: true },
        },
      },
    });
  });
});

describe("POST /api/tracker", () => {
  it("defaults a new row to applied", async () => {
    db.application.create.mockResolvedValue(makeRow());

    const res = await client.request("POST", "/api/tracker", {
      company: "Acme",
      role: "Data Engineer",
    });

    expect(res.status).toBe(201);
    expect(db.application.create).toHaveBeenCalledWith({
      data: { userId: "local", company: "Acme", role: "Data Engineer", status: "applied" },
    });
  });

  it("coerces an ISO date string into a Date", async () => {
    db.application.create.mockResolvedValue(makeRow());

    await client.request("POST", "/api/tracker", {
      company: "Acme",
      role: "Data Engineer",
      dateApplied: "2026-06-01",
    });

    expect(db.application.create.mock.calls[0][0].data.dateApplied).toEqual(new Date("2026-06-01"));
  });

  it("keeps the optional workflow fields", async () => {
    db.application.create.mockResolvedValue(makeRow());

    await client.request("POST", "/api/tracker", {
      company: "Acme",
      role: "Data Engineer",
      location: "Amsterdam",
      source: "linkedin_easy_apply",
      foundVia: "gmail",
      atsPlatform: "greenhouse",
      cvVersion: "Corporate",
      coverLetter: "yes",
      responseType: "interview_invite",
      notes: "referred by Sam",
    });

    expect(db.application.create.mock.calls[0][0].data).toMatchObject({
      location: "Amsterdam",
      source: "linkedin_easy_apply",
      foundVia: "gmail",
      atsPlatform: "greenhouse",
      cvVersion: "Corporate",
      notes: "referred by Sam",
    });
  });

  it("attaches the CV receipt that actually went out", async () => {
    db.application.create.mockResolvedValue(makeRow());

    await client.request("POST", "/api/tracker", {
      company: "Acme",
      role: "Data Engineer",
      cvRenderId: "render-1",
    });

    expect(db.application.create.mock.calls[0][0].data).toMatchObject({ cvRenderId: "render-1" });
  });

  it("lets an application be detached from its receipt again", async () => {
    // null, not absent: absent means "leave it alone", so clearing the link
    // needs an explicit null to reach Prisma.
    db.application.update.mockResolvedValue(makeRow());

    await client.request("PUT", "/api/tracker/app-1", { cvRenderId: null });

    expect(db.application.update.mock.calls[0][0].data).toMatchObject({ cvRenderId: null });
  });

  it.each([
    ["no company", { role: "Data Engineer" }],
    ["no role", { company: "Acme" }],
    ["an empty company", { company: "", role: "Data Engineer" }],
    ["an unknown status", { company: "Acme", role: "Data Engineer", status: "ghosted" }],
    ["an unparseable date", { company: "Acme", role: "Data Engineer", dateApplied: "someday" }],
  ])("rejects a row with %s", async (_label, body) => {
    const res = await client.request("POST", "/api/tracker", body);

    expect(res.status).toBe(400);
    expect(db.application.create).not.toHaveBeenCalled();
  });

  it("accepts shortlist, the status shared with the Job Board", async () => {
    // Widened when the Job Board started materializing Tracker rows: a
    // shortlisted listing is in the Tracker before it's been applied to.
    db.application.create.mockResolvedValue(makeRow({ status: "shortlist" }));

    const res = await client.request("POST", "/api/tracker", {
      company: "Acme",
      role: "Data Engineer",
      status: "shortlist",
    });

    expect(res.status).toBe(201);
    expect(db.application.create.mock.calls[0][0].data.status).toBe("shortlist");
  });

  it.each(["applied", "interview", "offer", "rejected"])("accepts %s", async (status) => {
    db.application.create.mockResolvedValue(makeRow({ status }));

    const res = await client.request("POST", "/api/tracker", {
      company: "Acme",
      role: "Data Engineer",
      status,
    });

    expect(res.status).toBe(201);
  });
});

describe("PUT /api/tracker/:id", () => {
  it("applies a partial update without touching other fields", async () => {
    db.application.update.mockResolvedValue(makeRow({ notes: "phone screen booked" }));

    const res = await client.request("PUT", "/api/tracker/app-1", { notes: "phone screen booked" });

    expect(res.status).toBe(200);
    expect(db.application.update).toHaveBeenCalledWith({
      where: { id: "app-1" },
      data: { notes: "phone screen booked" },
    });
  });

  it("clears a leftover applied date when moving back to shortlist", async () => {
    // Otherwise the row reads "not yet applied" next to a real applied date.
    db.application.update.mockResolvedValue(makeRow({ status: "shortlist", dateApplied: null }));

    await client.request("PUT", "/api/tracker/app-1", { status: "shortlist" });

    expect(db.application.update.mock.calls[0][0].data).toEqual({
      status: "shortlist",
      dateApplied: null,
    });
  });

  it("keeps an explicitly supplied date even when moving to shortlist", async () => {
    db.application.update.mockResolvedValue(makeRow({ status: "shortlist" }));

    await client.request("PUT", "/api/tracker/app-1", {
      status: "shortlist",
      dateApplied: "2026-06-01",
    });

    expect(db.application.update.mock.calls[0][0].data.dateApplied).toEqual(new Date("2026-06-01"));
  });

  it("leaves the date alone when advancing past applied", async () => {
    db.application.update.mockResolvedValue(makeRow({ status: "interview" }));

    await client.request("PUT", "/api/tracker/app-1", { status: "interview" });

    expect(db.application.update.mock.calls[0][0].data).not.toHaveProperty("dateApplied");
  });

  it("leaves the date alone when the update carries no status", async () => {
    db.application.update.mockResolvedValue(makeRow());

    await client.request("PUT", "/api/tracker/app-1", { notes: "nudged them" });

    expect(db.application.update.mock.calls[0][0].data).not.toHaveProperty("dateApplied");
  });

  it("rejects an unknown status", async () => {
    const res = await client.request("PUT", "/api/tracker/app-1", { status: "ghosted" });

    expect(res.status).toBe(400);
    expect(db.application.update).not.toHaveBeenCalled();
  });

  it("turns an explicit null date into the epoch — known wart, not a decision", async () => {
    // z.coerce.date() runs `new Date(null)`, which is 1970-01-01 rather than
    // a rejection, so `{"dateApplied": null}` silently backdates the row.
    // Clearing a date is only reachable via the shortlist rule above. Pinned
    // here so the behaviour is visible; the fix is z.coerce.date().nullable()
    // plus passing null through, which is an API change, not a test change.
    db.application.update.mockResolvedValue(makeRow());

    await client.request("PUT", "/api/tracker/app-1", { dateApplied: null });

    expect(db.application.update.mock.calls[0][0].data.dateApplied).toEqual(new Date(0));
  });

  it("404s an unknown id instead of taking the process down", async () => {
    db.application.update.mockRejectedValue(prismaError("P2025"));

    const res = await client.request("PUT", "/api/tracker/ghost", { notes: "x" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/tracker/:id", () => {
  it("returns 204 with no body", async () => {
    db.application.delete.mockResolvedValue(makeRow());

    const res = await client.request("DELETE", "/api/tracker/app-1");

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(db.application.delete).toHaveBeenCalledWith({ where: { id: "app-1" } });
  });

  it("404s an unknown id instead of taking the process down", async () => {
    db.application.delete.mockRejectedValue(prismaError("P2025"));

    const res = await client.request("DELETE", "/api/tracker/ghost");

    expect(res.status).toBe(404);
  });
});

describe("the API stays up under database failure", () => {
  it("500s a connection error and keeps serving the next request", async () => {
    db.application.findMany.mockRejectedValue(prismaError("P1001", "cannot reach database server"));

    const failed = await client.request("GET", "/api/tracker");
    const health = await client.request("GET", "/health");

    expect(failed.status).toBe(500);
    expect(failed.body).toMatchObject({ error: "internal error" });
    expect(health.status).toBe(200);
  });
});
