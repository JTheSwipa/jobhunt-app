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

    const res = await client.request("GET", "/api/cv/profiles");

    expect(res.status).toBe(200);
    expect(db.cvProfile.findMany).toHaveBeenCalledWith({
      where: { userId: "local" },
      orderBy: { createdAt: "asc" },
    });
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
    renderPdf.mockResolvedValue({ path: "/tmp/cv-profile-1.pdf" } as never);

    const res = await client.request("POST", "/api/cv/profiles/profile-1/render");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ path: "/tmp/cv-profile-1.pdf" });
    expect(renderPdf).toHaveBeenCalledWith(expect.anything(), "cv-profile-1", {
      order: ["profile"],
      style: "compact",
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
