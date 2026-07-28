import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async () => {
  const { makePrismaMock } = await import("../test/prismaMock.js");
  return { prisma: makePrismaMock() };
});
// buildHtml stays real — it's pure, and running it proves the profile's
// visibility overrides and section order actually reach the renderer. Only
// the PDF step is stubbed, since that shells out to headless Chromium.
vi.mock("../cv/render.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cv/render.js")>();
  return { ...actual, renderToPdf: vi.fn() };
});
vi.mock("../ai/ollamaProvider.js", () => ({
  ollamaProvider: { id: "ollama", suggest: vi.fn() },
}));

import { createApp } from "../app.js";
import { prisma } from "../db.js";
import { DEFAULT_ORDER, renderToPdf } from "../cv/render.js";
import { ollamaProvider } from "../ai/ollamaProvider.js";
import { startTestServer, type TestClient } from "../test/httpTestServer.js";
import { prismaError, type PrismaMock } from "../test/prismaMock.js";
import type { CvData } from "../cv/schema.js";

const db = prisma as unknown as PrismaMock;
const renderPdf = vi.mocked(renderToPdf);
const suggest = vi.mocked(ollamaProvider.suggest);

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

function makeCv(): CvData {
  return {
    basics: {
      name: "Alex Rivera",
      headline: "Data & AI",
      location: "Remote",
      email: "alex@example.com",
      phone: "+1 555 0100",
    },
    summary: { content: "<p>Profile summary.</p>", hidden: false },
    sections: {
      skills: { hidden: false, items: [{ id: "skill-1", name: "TypeScript", proficiency: "Expert" }] },
      experience: {
        hidden: false,
        items: [
          {
            id: "exp-1",
            position: "Engineer",
            company: "Acme",
            location: "Remote",
            period: "2023-2024",
            description: "<p>Did things.</p>",
          },
        ],
      },
      projects: { hidden: false, items: [] },
      education: { hidden: false, items: [] },
      certifications: { hidden: false, items: [] },
      languages: { hidden: false, items: [] },
      awards: { hidden: false, items: [] },
      interests: { hidden: false, items: [] },
    },
  };
}

function makeMasterRow(over: Record<string, unknown> = {}) {
  return { id: "master-1", userId: "local", name: "master", data: makeCv(), ...over };
}

function makeProfileRow(over: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    userId: "local",
    masterCvId: "master-1",
    name: "Corporate",
    visibility: {},
    order: DEFAULT_ORDER,
    style: "default",
    headline: null, // null => inherit the master's
    summary: null,
    ...over,
  };
}

describe("GET /api/cv/master", () => {
  it("defaults to the CV named 'master'", async () => {
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());

    const res = await client.request("GET", "/api/cv/master");

    expect(res.status).toBe(200);
    expect(db.masterCv.findUnique).toHaveBeenCalledWith({
      where: { userId_name: { userId: "local", name: "master" } },
    });
  });

  it("looks up a named CV when ?name is given", async () => {
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow({ name: "academic" }));

    await client.request("GET", "/api/cv/master?name=academic");

    expect(db.masterCv.findUnique).toHaveBeenCalledWith({
      where: { userId_name: { userId: "local", name: "academic" } },
    });
  });

  it("404s before any CV has been uploaded", async () => {
    db.masterCv.findUnique.mockResolvedValue(null);

    const res = await client.request("GET", "/api/cv/master");

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/cv/master", () => {
  it("upserts under the default name and returns the row", async () => {
    const row = makeMasterRow();
    db.masterCv.upsert.mockResolvedValue(row);

    const res = await client.request("PUT", "/api/cv/master", { data: makeCv() });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "master-1" });
    expect(db.masterCv.upsert.mock.calls[0][0].where).toEqual({
      userId_name: { userId: "local", name: "master" },
    });
  });

  it("replaces an existing CV in place on re-upload", async () => {
    db.masterCv.upsert.mockResolvedValue(makeMasterRow());
    const replacement = makeCv();
    replacement.basics.name = "Alex Rivera II";

    await client.request("PUT", "/api/cv/master", { name: "master", data: replacement });

    const call = db.masterCv.upsert.mock.calls[0][0];
    expect(call.update.data).toMatchObject({ basics: { name: "Alex Rivera II" } });
    expect(call.create).toMatchObject({ userId: "local", name: "master" });
  });

  it("rejects a body with no data object", async () => {
    const res = await client.request("PUT", "/api/cv/master", { name: "master" });

    expect(res.status).toBe(400);
    expect(db.masterCv.upsert).not.toHaveBeenCalled();
  });

  it("rejects a non-object payload", async () => {
    const res = await client.request("PUT", "/api/cv/master", { data: "not-a-cv" });

    expect(res.status).toBe(400);
  });

  it("rejects an empty name rather than storing an unaddressable CV", async () => {
    const res = await client.request("PUT", "/api/cv/master", { name: "", data: makeCv() });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/cv/master/:id/toggles", () => {
  it("flattens the CV into toggle nodes", async () => {
    db.masterCv.findFirst.mockResolvedValue(makeMasterRow());

    const res = await client.request<Array<{ key: string; kind: string }>>(
      "GET",
      "/api/cv/master/master-1/toggles",
    );

    expect(res.status).toBe(200);
    const keys = res.body.map((n) => n.key);
    expect(keys).toContain("section:profile");
    expect(keys).toContain("section:experience");
    expect(keys).toContain("item:exp-1");
  });

  it("scopes the lookup to this user", async () => {
    db.masterCv.findFirst.mockResolvedValue(makeMasterRow());

    await client.request("GET", "/api/cv/master/master-1/toggles");

    expect(db.masterCv.findFirst).toHaveBeenCalledWith({
      where: { id: "master-1", userId: "local" },
    });
  });

  it("404s an unknown master CV id", async () => {
    db.masterCv.findFirst.mockResolvedValue(null);

    const res = await client.request("GET", "/api/cv/master/nope/toggles");

    expect(res.status).toBe(404);
  });
});

describe("GET /api/cv/render-order", () => {
  it("serves the renderer's section list, so the editor never keeps its own copy", async () => {
    const res = await client.request("GET", "/api/cv/render-order");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULT_ORDER);
  });
});

describe("GET /api/cv/profiles", () => {
  it("returns every profile when no master is specified", async () => {
    db.cvProfile.findMany.mockResolvedValue([makeProfileRow()]);
    db.masterCv.findMany.mockResolvedValue([makeMasterRow()]);

    const res = await client.request("GET", "/api/cv/profiles");

    expect(res.status).toBe(200);
    expect(db.cvProfile.findMany).toHaveBeenCalledWith({
      where: { userId: "local" },
      orderBy: { createdAt: "asc" },
    });
  });

  it("carries a contentHash so the editor can spot two variants that render identically", async () => {
    // Two profiles, different names, identical everything-that-renders. This is
    // the real dead state this feature exists to surface: "Corporate" and
    // "Full CV" both with zero overrides produce the same document.
    db.cvProfile.findMany.mockResolvedValue([
      makeProfileRow({ id: "p-1", name: "Corporate" }),
      makeProfileRow({ id: "p-2", name: "Full CV" }),
    ]);
    db.masterCv.findMany.mockResolvedValue([makeMasterRow()]);

    const res = await client.request("GET", "/api/cv/profiles");

    expect(res.status).toBe(200);
    expect(res.body[0].contentHash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(res.body[0].contentHash).toBe(res.body[1].contentHash);
  });

  it("gives two profiles different hashes once their pitch differs", async () => {
    db.cvProfile.findMany.mockResolvedValue([
      makeProfileRow({ id: "p-1", headline: "Corporate analytics" }),
      makeProfileRow({ id: "p-2", headline: "Ships AI products end to end" }),
    ]);
    db.masterCv.findMany.mockResolvedValue([makeMasterRow()]);

    const res = await client.request("GET", "/api/cv/profiles");

    expect(res.body[0].contentHash).not.toBe(res.body[1].contentHash);
  });

  it("reports override keys the master no longer has, so a fail-open hide is visible", async () => {
    db.cvProfile.findMany.mockResolvedValue([
      makeProfileRow({ visibility: { "item:exp-1": true, "item:deleted-in-rxresume": true } }),
    ]);
    db.masterCv.findMany.mockResolvedValue([makeMasterRow()]);

    const res = await client.request("GET", "/api/cv/profiles");

    expect(res.body[0].orphans).toEqual(["item:deleted-in-rxresume"]);
  });

  it("still lists a profile whose master CV has vanished, without derived state", async () => {
    db.cvProfile.findMany.mockResolvedValue([makeProfileRow()]);
    db.masterCv.findMany.mockResolvedValue([]);

    const res = await client.request("GET", "/api/cv/profiles");

    expect(res.status).toBe(200);
    expect(res.body[0].contentHash).toBeNull();
    expect(res.body[0].orphans).toEqual([]);
  });

  it("narrows to one master CV when asked", async () => {
    db.cvProfile.findMany.mockResolvedValue([]);

    await client.request("GET", "/api/cv/profiles?masterCvId=master-1");

    expect(db.cvProfile.findMany.mock.calls[0][0].where).toEqual({
      userId: "local",
      masterCvId: "master-1",
    });
  });
});

describe("POST /api/cv/profiles", () => {
  it("creates a profile with the renderer's default order and an empty override map", async () => {
    db.cvProfile.create.mockResolvedValue(makeProfileRow());

    const res = await client.request("POST", "/api/cv/profiles", {
      masterCvId: "master-1",
      name: "Corporate",
    });

    expect(res.status).toBe(201);
    expect(db.cvProfile.create).toHaveBeenCalledWith({
      data: {
        userId: "local",
        masterCvId: "master-1",
        name: "Corporate",
        visibility: {},
        order: DEFAULT_ORDER,
        style: "default",
      },
    });
  });

  it("keeps a caller-supplied order and style", async () => {
    db.cvProfile.create.mockResolvedValue(makeProfileRow());

    await client.request("POST", "/api/cv/profiles", {
      masterCvId: "master-1",
      name: "Startup",
      order: ["profile", "skills"],
      style: "compact",
      visibility: { "section:awards": true },
    });

    expect(db.cvProfile.create.mock.calls[0][0].data).toMatchObject({
      order: ["profile", "skills"],
      style: "compact",
      visibility: { "section:awards": true },
    });
  });

  it("rejects an unnamed profile", async () => {
    const res = await client.request("POST", "/api/cv/profiles", { masterCvId: "master-1", name: "" });

    expect(res.status).toBe(400);
    expect(db.cvProfile.create).not.toHaveBeenCalled();
  });

  it("rejects a style the renderer has no stylesheet for", async () => {
    const res = await client.request("POST", "/api/cv/profiles", {
      masterCvId: "master-1",
      name: "Corporate",
      style: "fancy",
    });

    expect(res.status).toBe(400);
  });

  it("409s a duplicate profile name instead of crashing on the unique constraint", async () => {
    db.cvProfile.create.mockRejectedValue(prismaError("P2002"));

    const res = await client.request("POST", "/api/cv/profiles", {
      masterCvId: "master-1",
      name: "Corporate",
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringContaining("Corporate") });
  });

  it("400s a profile pointing at a master CV that doesn't exist", async () => {
    db.cvProfile.create.mockRejectedValue(prismaError("P2003"));

    const res = await client.request("POST", "/api/cv/profiles", {
      masterCvId: "ghost",
      name: "Corporate",
    });

    expect(res.status).toBe(400);
  });
});

describe("PUT /api/cv/profiles/:id", () => {
  it("applies a partial update", async () => {
    db.cvProfile.update.mockResolvedValue(makeProfileRow({ name: "Renamed" }));

    const res = await client.request("PUT", "/api/cv/profiles/profile-1", { name: "Renamed" });

    expect(res.status).toBe(200);
    expect(db.cvProfile.update).toHaveBeenCalledWith({
      where: { id: "profile-1" },
      data: { name: "Renamed" },
    });
  });

  it("accepts a reorder without touching the other fields", async () => {
    db.cvProfile.update.mockResolvedValue(makeProfileRow());

    await client.request("PUT", "/api/cv/profiles/profile-1", { order: ["skills", "profile"] });

    expect(db.cvProfile.update.mock.calls[0][0].data).toEqual({ order: ["skills", "profile"] });
  });

  it("ignores an attempt to repoint the profile at another master CV", async () => {
    // masterCvId is omitted from the update schema: moving a profile between
    // masters would silently invalidate every override key it holds.
    db.cvProfile.update.mockResolvedValue(makeProfileRow());

    await client.request("PUT", "/api/cv/profiles/profile-1", {
      name: "Corporate",
      masterCvId: "master-2",
    });

    expect(db.cvProfile.update.mock.calls[0][0].data).not.toHaveProperty("masterCvId");
  });

  it("409s a rename onto an existing name", async () => {
    // Same unique-constraint crash as POST /profiles, found a second time in
    // review — a rename hits the identical constraint.
    db.cvProfile.update.mockRejectedValue(prismaError("P2002"));

    const res = await client.request("PUT", "/api/cv/profiles/profile-1", { name: "Corporate" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringContaining("Corporate") });
  });

  it("404s an unknown profile id instead of taking the process down", async () => {
    db.cvProfile.update.mockRejectedValue(prismaError("P2025"));

    const res = await client.request("PUT", "/api/cv/profiles/ghost", { name: "Renamed" });

    expect(res.status).toBe(404);
  });

  it("rejects an invalid style on update", async () => {
    const res = await client.request("PUT", "/api/cv/profiles/profile-1", { style: "fancy" });

    expect(res.status).toBe(400);
    expect(db.cvProfile.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/cv/profiles/:id", () => {
  it("returns 204 with no body", async () => {
    db.cvProfile.delete.mockResolvedValue(makeProfileRow());

    const res = await client.request("DELETE", "/api/cv/profiles/profile-1");

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });

  it("404s an unknown profile id instead of taking the process down", async () => {
    db.cvProfile.delete.mockRejectedValue(prismaError("P2025"));

    const res = await client.request("DELETE", "/api/cv/profiles/ghost");

    expect(res.status).toBe(404);
  });
});

describe("GET /api/cv/profiles/:id/preview", () => {
  it("renders HTML for a profile with no overrides", async () => {
    db.cvProfile.findFirst.mockResolvedValue(makeProfileRow());
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());

    const res = await client.request<string>("GET", "/api/cv/profiles/profile-1/preview");

    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.body).toContain("Alex Rivera");
    expect(res.body).toContain("<h2>Experience</h2>");
    expect(res.body).toContain("Acme");
  });

  it("drops a section the profile's overrides hide", async () => {
    db.cvProfile.findFirst.mockResolvedValue(
      makeProfileRow({ visibility: { "section:experience": true } }),
    );
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());

    const res = await client.request<string>("GET", "/api/cv/profiles/profile-1/preview");

    expect(res.status).toBe(200);
    // Heading casing is CSS-only, so assert on the markup the renderer emits.
    expect(res.body).not.toContain("<h2>Experience</h2>");
    expect(res.body).not.toContain("Acme");
    expect(res.body).toContain("Alex Rivera");
  });

  it("drops a single item without dropping its section", async () => {
    db.cvProfile.findFirst.mockResolvedValue(makeProfileRow({ visibility: { "item:exp-1": true } }));
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());

    const res = await client.request<string>("GET", "/api/cv/profiles/profile-1/preview");

    expect(res.body).not.toContain("Acme");
    expect(res.body).toContain("TypeScript");
  });

  it("honours the profile's section order", async () => {
    db.cvProfile.findFirst.mockResolvedValue(makeProfileRow({ order: ["experience", "skills"] }));
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());

    const res = await client.request<string>("GET", "/api/cv/profiles/profile-1/preview");

    expect(res.body.indexOf("<h2>Experience</h2>")).toBeLessThan(
      res.body.indexOf("<h2>Technical Skills</h2>"),
    );
  });

  it("includes a section the master hides but the profile un-hides", async () => {
    const master = makeMasterRow();
    (master.data as CvData).sections.experience!.hidden = true;
    db.cvProfile.findFirst.mockResolvedValue(
      makeProfileRow({ visibility: { "section:experience": false } }),
    );
    db.masterCv.findUnique.mockResolvedValue(master);

    const res = await client.request<string>("GET", "/api/cv/profiles/profile-1/preview");

    expect(res.body).toContain("Acme");
  });

  it("404s an unknown profile", async () => {
    db.cvProfile.findFirst.mockResolvedValue(null);

    const res = await client.request("GET", "/api/cv/profiles/ghost/preview");

    expect(res.status).toBe(404);
    expect(db.masterCv.findUnique).not.toHaveBeenCalled();
  });

  it("404s a profile whose master CV has gone missing", async () => {
    db.cvProfile.findFirst.mockResolvedValue(makeProfileRow());
    db.masterCv.findUnique.mockResolvedValue(null);

    const res = await client.request("GET", "/api/cv/profiles/profile-1/preview");

    expect(res.status).toBe(404);
  });
});

describe("POST /api/cv/profiles/:id/render", () => {
  it("renders a PDF with the profile's order and style", async () => {
    db.cvProfile.findFirst.mockResolvedValue(makeProfileRow({ style: "compact", order: ["profile"] }));
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());
    renderPdf.mockResolvedValue({ htmlPath: "/tmp/x.html", pdfPath: "/tmp/x.pdf" });
    db.cvRender.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);

    const res = await client.request("POST", "/api/cv/profiles/profile-1/render");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pdfPath: "/tmp/x.pdf", filename: "Rivera_CV_Corporate.pdf" });
    // The basename is now the render id, not the profile id. Keying it on the
    // profile meant every render silently overwrote the last one.
    expect(renderPdf).toHaveBeenCalledWith(expect.anything(), `cv-${res.body.id}`, {
      order: ["profile"],
      style: "compact",
    });
    expect(res.body.id).not.toBe("profile-1");
  });

  it("writes an immutable receipt snapshotting the resolved CV, not a pointer at the profile", async () => {
    db.cvProfile.findFirst.mockResolvedValue(
      makeProfileRow({ headline: "Corporate analytics", visibility: { "item:exp-1": true } }),
    );
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());
    renderPdf.mockResolvedValue({ htmlPath: "/tmp/x.html", pdfPath: "/tmp/x.pdf" });
    db.cvRender.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);

    await client.request("POST", "/api/cv/profiles/profile-1/render");

    const written = db.cvRender.create.mock.calls[0][0].data;
    expect(written.cvProfileId).toBe("profile-1");
    // Denormalized, so the trace survives a rename or a delete of the profile.
    expect(written.profileName).toBe("Corporate");
    expect(written.contentHash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(written.filename).toBe("Rivera_CV_Corporate.pdf");
    // The snapshot carries the applied pitch and the applied hide, so the
    // receipt reproduces the document even after the profile changes.
    const snapshot = written.resolvedData as CvData;
    expect(snapshot.basics.headline).toBe("Corporate analytics");
    expect(snapshot.sections.experience.items[0].hidden).toBe(true);
    // ...and the master is untouched.
    expect(makeCv().basics.headline).toBe("Data & AI");
  });

  it("does not write a receipt when the render itself fails", async () => {
    db.cvProfile.findFirst.mockResolvedValue(makeProfileRow());
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());
    renderPdf.mockRejectedValue(new Error("chromium exploded"));

    const res = await client.request("POST", "/api/cv/profiles/profile-1/render");

    expect(res.status).toBe(500);
    expect(db.cvRender.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The per-profile pitch. This is the whole point of the feature for a CV with
// 2 jobs and 2 projects: there is nothing meaningful to hide, so what makes
// "Corporate" differ from "Startup" is the headline and the summary.
//
// Three states, and they are easy to collapse into two by accident:
//   absent from the PUT body => leave unchanged
//   null                     => inherit the master's value
//   ""                       => render nothing at all
// ---------------------------------------------------------------------------

describe("per-profile pitch override", () => {
  async function preview(over: Record<string, unknown>) {
    db.cvProfile.findFirst.mockResolvedValue(makeProfileRow(over));
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());
    return client.request("GET", "/api/cv/profiles/profile-1/preview");
  }

  it("inherits the master headline and summary when both are null", async () => {
    const res = await preview({ headline: null, summary: null });

    expect(res.body).toContain("Data &amp; AI");
    expect(res.body).toContain("Profile summary.");
  });

  it("replaces the headline for this profile only, leaving the master alone", async () => {
    const res = await preview({ headline: "Ships AI products end to end" });

    expect(res.body).toContain("Ships AI products end to end");
    expect(res.body).not.toContain("Data &amp; AI");
    // The master row object handed to the route is untouched, which is what
    // lets one master back many variants.
    expect(makeCv().basics.headline).toBe("Data & AI");
  });

  it("replaces the summary for this profile only", async () => {
    const res = await preview({ summary: "<p>Corporate framing.</p>" });

    expect(res.body).toContain("Corporate framing.");
    expect(res.body).not.toContain("Profile summary.");
  });

  it("renders no subtitle element at all for an empty-string headline", async () => {
    const res = await preview({ headline: "" });

    // Not merely absent text — the element itself is gone, so its bottom
    // margin does not leave a gap under the name.
    expect(res.body).not.toContain('class="subtitle"');
    expect(res.body).toContain("ALEX RIVERA");
  });

  it("renders no Profile block at all for an empty-string summary", async () => {
    const res = await preview({ summary: "" });

    expect(res.body).not.toContain("<h2>Profile</h2>");
  });

  it("accepts null through PUT, which is how a profile is reset to inherit", async () => {
    db.cvProfile.update.mockResolvedValue(makeProfileRow({ headline: null }));

    const res = await client.request("PUT", "/api/cv/profiles/profile-1", { headline: null });

    expect(res.status).toBe(200);
    expect(db.cvProfile.update.mock.calls[0][0].data).toEqual({ headline: null });
  });

  it("accepts the empty string through PUT rather than rejecting it as too short", async () => {
    // A .min(1) here — copied by reflex from `name` — would collapse "render
    // nothing" into "inherit the master".
    db.cvProfile.update.mockResolvedValue(makeProfileRow({ headline: "" }));

    const res = await client.request("PUT", "/api/cv/profiles/profile-1", { headline: "", summary: "" });

    expect(res.status).toBe(200);
    expect(db.cvProfile.update.mock.calls[0][0].data).toEqual({ headline: "", summary: "" });
  });

  it("leaves the pitch untouched when the PUT body omits it", async () => {
    db.cvProfile.update.mockResolvedValue(makeProfileRow());

    await client.request("PUT", "/api/cv/profiles/profile-1", { name: "Renamed" });

    expect(db.cvProfile.update.mock.calls[0][0].data).toEqual({ name: "Renamed" });
  });

  it("carries the pitch through profile creation", async () => {
    db.cvProfile.create.mockResolvedValue(makeProfileRow());

    await client.request("POST", "/api/cv/profiles", {
      masterCvId: "master-1",
      name: "Startup",
      headline: "Ships AI products end to end",
    });

    expect(db.cvProfile.create.mock.calls[0][0].data).toMatchObject({
      headline: "Ships AI products end to end",
    });
  });
});

// ---------------------------------------------------------------------------
// Render receipts. The trace has to stay true after the profile it came from is
// renamed or deleted, which is why these read profileName off the render row
// rather than joining back to CvProfile.
// ---------------------------------------------------------------------------

describe("GET /api/cv/renders", () => {
  it("lists recent receipts, newest first", async () => {
    db.cvRender.findMany.mockResolvedValue([
      { id: "r-2", profileName: "Startup", filename: "Rivera_CV_Startup.pdf" },
      { id: "r-1", profileName: "Corporate", filename: "Rivera_CV_Corporate.pdf" },
    ]);

    const res = await client.request("GET", "/api/cv/renders");

    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: string }) => r.id)).toEqual(["r-2", "r-1"]);
    expect(db.cvRender.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "desc" });
  });
});

describe("GET /api/cv/renders/:id/pdf", () => {
  function makeRenderRow(over: Record<string, unknown> = {}) {
    return {
      id: "r-1",
      userId: "local",
      cvProfileId: "profile-1",
      profileName: "Corporate",
      masterCvId: "master-1",
      resolvedData: makeCv(),
      order: DEFAULT_ORDER,
      style: "default",
      contentHash: "deadbeef",
      filename: "Rivera_CV_Corporate.pdf",
      pdfPath: "/tmp/does-not-exist/cv-r-1.pdf",
      ...over,
    };
  }

  it("404s an unknown receipt", async () => {
    db.cvRender.findFirst.mockResolvedValue(null);

    const res = await client.request("GET", "/api/cv/renders/ghost/pdf");

    expect(res.status).toBe(404);
  });

  it("refuses to serve a receipt it can no longer reproduce", async () => {
    // The stored file is gone AND re-rendering produces different bytes than
    // the receipt recorded. Handing over a document that is not what was sent
    // would be worse than an error, so this is a 409, not a best-effort PDF.
    db.cvRender.findFirst.mockResolvedValue(makeRenderRow({ contentHash: "stale-hash-from-an-older-renderer" }));

    const res = await client.request("GET", "/api/cv/renders/r-1/pdf");

    expect(res.status).toBe(409);
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it("re-renders from the snapshot when the archived file has gone missing", async () => {
    // pdfPath is a cache; resolvedData in Postgres is the source of truth. A
    // file cleaned up or never backed up alongside the DB must not lose the
    // receipt. The hash has to match first, so compute the real one.
    const { createHash } = await import("node:crypto");
    const { buildHtml } = await import("../cv/render.js");
    const data = makeCv();
    const hash = createHash("sha256")
      .update(buildHtml(data, { order: DEFAULT_ORDER, style: "default" }), "utf8")
      .digest("hex");
    db.cvRender.findFirst.mockResolvedValue(makeRenderRow({ contentHash: hash }));
    renderPdf.mockResolvedValue({ htmlPath: "/tmp/x.html", pdfPath: "/tmp/definitely-not-here.pdf" });

    await client.request("GET", "/api/cv/renders/r-1/pdf");

    expect(renderPdf).toHaveBeenCalledWith(expect.anything(), "cv-r-1", {
      order: DEFAULT_ORDER,
      style: "default",
    });
  });

  it("404s an unknown profile without invoking the renderer", async () => {
    db.cvProfile.findFirst.mockResolvedValue(null);

    const res = await client.request("POST", "/api/cv/profiles/ghost/render");

    expect(res.status).toBe(404);
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it("500s with the reason when the PDF step fails", async () => {
    db.cvProfile.findFirst.mockResolvedValue(makeProfileRow());
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());
    renderPdf.mockRejectedValue(new Error("chromium not found"));

    const res = await client.request("POST", "/api/cv/profiles/profile-1/render");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "render failed", detail: "chromium not found" });
  });
});

describe("POST /api/cv/profiles/:id/suggest", () => {
  it("hands the provider the CV, its toggle nodes, and the target role", async () => {
    db.cvProfile.findFirst.mockResolvedValue(makeProfileRow());
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());
    suggest.mockResolvedValue([
      { key: "section:awards", label: "Awards", suggestedHidden: true, reason: "not relevant" },
    ]);

    const res = await client.request("POST", "/api/cv/profiles/profile-1/suggest", {
      targetRole: "Data Engineer",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { key: "section:awards", label: "Awards", suggestedHidden: true, reason: "not relevant" },
    ]);
    const input = suggest.mock.calls[0][0];
    expect(input.targetRole).toBe("Data Engineer");
    expect(input.toggleNodes.map((n) => n.key)).toContain("item:exp-1");
  });

  it("suggests against the master CV, not the profile's already-filtered view", async () => {
    // A section the profile currently hides still has to be offered back, or
    // the model can only ever remove things.
    db.cvProfile.findFirst.mockResolvedValue(
      makeProfileRow({ visibility: { "section:experience": true } }),
    );
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());
    suggest.mockResolvedValue([]);

    await client.request("POST", "/api/cv/profiles/profile-1/suggest", { targetRole: "Data Engineer" });

    const input = suggest.mock.calls[0][0];
    expect(input.toggleNodes.find((n) => n.key === "section:experience")?.hidden).toBe(false);
  });

  it("rejects an empty target role", async () => {
    const res = await client.request("POST", "/api/cv/profiles/profile-1/suggest", { targetRole: "" });

    expect(res.status).toBe(400);
    expect(suggest).not.toHaveBeenCalled();
  });

  it("404s an unknown profile", async () => {
    db.cvProfile.findFirst.mockResolvedValue(null);

    const res = await client.request("POST", "/api/cv/profiles/ghost/suggest", { targetRole: "Data" });

    expect(res.status).toBe(404);
  });

  it("404s a profile whose master CV has gone missing", async () => {
    db.cvProfile.findFirst.mockResolvedValue(makeProfileRow());
    db.masterCv.findUnique.mockResolvedValue(null);

    const res = await client.request("POST", "/api/cv/profiles/profile-1/suggest", { targetRole: "Data" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "master not found" });
  });

  it("502s with a pointer to Ollama when the local model is unreachable", async () => {
    db.cvProfile.findFirst.mockResolvedValue(makeProfileRow());
    db.masterCv.findUnique.mockResolvedValue(makeMasterRow());
    suggest.mockRejectedValue(new Error("fetch failed"));

    const res = await client.request("POST", "/api/cv/profiles/profile-1/suggest", {
      targetRole: "Data Engineer",
    });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: expect.stringContaining("Ollama"), detail: "fetch failed" });
  });
});
