import { createHash, randomUUID } from "node:crypto";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { asyncRouter } from "../http/asyncRouter.js";
import { applyVisibility, findOrphans, listToggleNodes } from "../cv/visibility.js";
import { buildHtml, renderToPdf, outputDir, DEFAULT_ORDER } from "../cv/render.js";
import type { CvData } from "../cv/schema.js";
import { ollamaProvider } from "../ai/ollamaProvider.js";

export const cvRouter = asyncRouter();

const USER_ID = "local"; // single-user MVP — see plan Phase 3 for the multi-user path

// --- Master CV ------------------------------------------------------------

cvRouter.get("/master", async (req, res) => {
  const name = String(req.query.name ?? "master");
  const master = await prisma.masterCv.findUnique({ where: { userId_name: { userId: USER_ID, name } } });
  if (!master) return res.status(404).json({ error: "no master CV with that name yet" });
  res.json(master);
});

const upsertMasterSchema = z.object({
  name: z.string().min(1).default("master"),
  data: z.record(z.string(), z.unknown()),
});

cvRouter.put("/master", async (req, res) => {
  const parsed = upsertMasterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, data } = parsed.data;
  const master = await prisma.masterCv.upsert({
    where: { userId_name: { userId: USER_ID, name } },
    update: { data: data as object },
    create: { userId: USER_ID, name, data: data as object },
  });
  res.json(master);
});

cvRouter.get("/master/:id/toggles", async (req, res) => {
  const master = await prisma.masterCv.findFirst({ where: { id: req.params.id, userId: USER_ID } });
  if (!master) return res.status(404).json({ error: "not found" });
  const nodes = listToggleNodes(master.data as unknown as CvData);
  res.json(nodes);
});

// The section keys render.ts's PDF/preview dispatch table actually knows how
// to draw, in render order. Single source of truth for both the default
// order new profiles are created with and which sections the CV Editor
// treats as reorderable — see CvEditor.tsx, which fetches this instead of
// keeping its own copy of the list.
cvRouter.get("/render-order", (_req, res) => {
  res.json(DEFAULT_ORDER);
});

// --- Sector profiles --------------------------------------------------------

// Each profile is returned with two derived fields the CV Editor needs and
// cannot compute itself, because both require the master CV plus buildHtml and
// those are server-side only:
//   contentHash — sha256 of the HTML this profile renders to, so the editor can
//     say "Corporate and Full CV produce an identical document". Deliberately
//     computed on demand rather than read from CvRender.contentHash: a profile
//     that has never been rendered has no receipt, and the dead-identical-
//     variants case is exactly the one where nothing has been rendered yet.
//   orphans — override keys pointing at ids the master no longer has. See
//     findOrphans; applyVisibility fails open, so without this an item you
//     believe is hidden ships silently.
cvRouter.get("/profiles", async (req, res) => {
  const masterCvId = String(req.query.masterCvId ?? "");
  const profiles = await prisma.cvProfile.findMany({
    where: { userId: USER_ID, ...(masterCvId ? { masterCvId } : {}) },
    orderBy: { createdAt: "asc" },
  });

  const masterIds = [...new Set(profiles.map((p) => p.masterCvId))];
  const masters = masterIds.length
    ? await prisma.masterCv.findMany({ where: { id: { in: masterIds } } })
    : [];
  const dataById = new Map(masters.map((m) => [m.id, m.data as unknown as CvData]));

  res.json(
    profiles.map((p) => {
      const master = dataById.get(p.masterCvId);
      // A profile whose master vanished still lists — it just cannot report
      // derived state. Returning null beats 500ing the whole editor.
      if (!master) return { ...p, contentHash: null, orphans: [] };
      const visibility = p.visibility as Record<string, boolean>;
      const resolved = applyPitch(applyVisibility(master, visibility), p.headline, p.summary);
      return {
        ...p,
        contentHash: hashResolved(resolved, p.order as string[], p.style as "default" | "compact"),
        orphans: findOrphans(master, visibility),
      };
    }),
  );
});

const profileSchema = z.object({
  masterCvId: z.string(),
  name: z.string().min(1),
  visibility: z.record(z.string(), z.boolean()).default({}),
  order: z.array(z.string()).default(DEFAULT_ORDER),
  style: z.enum(["default", "compact"]).default("default"),
  // The per-profile pitch. `.nullish()` and NOT `.min(1)`: null means "inherit
  // the master", "" means "render nothing", and absent (via .partial() on the
  // update schema) means "leave unchanged". A .min(1) here would reject the
  // empty string and collapse two of those three states — easy to add by
  // reflex, since `name` above does exactly that.
  headline: z.string().nullish(),
  summary: z.string().nullish(),
});

cvRouter.post("/profiles", async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { masterCvId, name, visibility, order, style, headline, summary } = parsed.data;
  try {
    const profile = await prisma.cvProfile.create({
      data: { userId: USER_ID, masterCvId, name, visibility, order, style, headline, summary },
    });
    res.status(201).json(profile);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: `a profile named "${name}" already exists for this master CV` });
    }
    throw err;
  }
});

const profileUpdateSchema = profileSchema.partial().omit({ masterCvId: true });

cvRouter.put("/profiles/:id", async (req, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const profile = await prisma.cvProfile.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json(profile);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: `a profile named "${parsed.data.name}" already exists for this master CV` });
    }
    throw err;
  }
});

cvRouter.delete("/profiles/:id", async (req, res) => {
  await prisma.cvProfile.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// --- Rendering --------------------------------------------------------------

/**
 * Applies a profile's pitch override on top of an already visibility-resolved
 * CV. Kept separate from applyVisibility on purpose: that engine is about
 * `hidden` booleans, this is string replacement, and folding two different
 * semantics into one override map was rejected in design.
 *
 * null / undefined => inherit the master's value. "" => render nothing at all
 * (buildHtml drops the subtitle element rather than emitting an empty one).
 *
 * Mutates in place. Every caller hands it the fresh clone applyVisibility just
 * made, never the master row itself.
 */
export function applyPitch(data: CvData, headline?: string | null, summary?: string | null): CvData {
  if (headline !== null && headline !== undefined) data.basics.headline = headline;
  if (summary !== null && summary !== undefined) {
    if (!data.summary) data.summary = { content: summary };
    else data.summary.content = summary;
  }
  return data;
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** sha256 of the exact HTML a profile renders to — the duplicate-detection key. */
function hashResolved(data: CvData, order: string[], style: "default" | "compact"): string {
  return sha256(buildHtml(data, { order, style }));
}

/**
 * `<LastName>_CV_<ProfileName>.pdf`. The last whitespace-separated token of
 * basics.name is the surname; everything is reduced to [A-Za-z0-9._-] so the
 * name lands intact in a Content-Disposition header and on any filesystem.
 * Accented characters are transliterated away rather than preserved, which is
 * the tradeoff for not needing a Unicode-safe header encoding.
 *
 * The `<LastName>_<Company>_<Role>.pdf` form is deliberately not built here:
 * the render endpoint takes no company or role, and inventing that plumbing is
 * separate scope.
 */
function sanitizePart(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

export function renderFilename(cvName: string, profileName: string): string {
  const tokens = String(cvName ?? "").trim().split(/\s+/).filter(Boolean);
  const surname = sanitizePart(tokens.length ? tokens[tokens.length - 1] : "") || "CV";
  const variant = sanitizePart(profileName) || "profile";
  return `${surname}_CV_${variant}.pdf`;
}

interface ResolvedProfile {
  profile: { id: string; name: string; masterCvId: string };
  data: CvData;
  order: string[];
  style: "default" | "compact";
}

async function resolveProfileCv(profileId: string): Promise<ResolvedProfile | null> {
  const profile = await prisma.cvProfile.findFirst({ where: { id: profileId, userId: USER_ID } });
  if (!profile) return null;
  const master = await prisma.masterCv.findUnique({ where: { id: profile.masterCvId } });
  if (!master) return null;
  const resolved = applyPitch(
    applyVisibility(master.data as unknown as CvData, profile.visibility as Record<string, boolean>),
    profile.headline,
    profile.summary,
  );
  return {
    profile: { id: profile.id, name: profile.name, masterCvId: profile.masterCvId },
    data: resolved,
    order: profile.order as string[],
    style: profile.style as "default" | "compact",
  };
}

cvRouter.get("/profiles/:id/preview", async (req, res) => {
  const resolved = await resolveProfileCv(req.params.id);
  if (!resolved) return res.status(404).json({ error: "not found" });
  const html = buildHtml(resolved.data, { order: resolved.order, style: resolved.style });
  res.type("html").send(html);
});

// Rendering writes an immutable receipt. The basename is the RENDER id, not the
// profile id: keying it on the profile meant every render silently overwrote the
// previous one, so there was no archive of anything ever sent.
//
// The id is generated here rather than left to @default(cuid()) so the file path
// and the row can be written in a single insert, instead of inserting a row and
// then updating it with the path it just produced.
cvRouter.post("/profiles/:id/render", async (req, res) => {
  const resolved = await resolveProfileCv(req.params.id);
  if (!resolved) return res.status(404).json({ error: "not found" });

  const renderId = randomUUID();
  const filename = renderFilename(resolved.data.basics?.name ?? "", resolved.profile.name);
  try {
    const result = await renderToPdf(resolved.data, `cv-${renderId}`, {
      order: resolved.order,
      style: resolved.style,
    });
    const render = await prisma.cvRender.create({
      data: {
        id: renderId,
        userId: USER_ID,
        cvProfileId: resolved.profile.id,
        profileName: resolved.profile.name,
        masterCvId: resolved.profile.masterCvId,
        resolvedData: resolved.data as unknown as object,
        order: resolved.order,
        style: resolved.style,
        contentHash: hashResolved(resolved.data, resolved.order, resolved.style),
        filename,
        pdfPath: result.pdfPath,
      },
    });
    res.json({ ...result, id: render.id, filename, contentHash: render.contentHash });
  } catch (err) {
    res.status(500).json({ error: "render failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

// --- Render receipts --------------------------------------------------------

cvRouter.get("/renders", async (_req, res) => {
  const renders = await prisma.cvRender.findMany({
    where: { userId: USER_ID },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, profileName: true, filename: true, contentHash: true, style: true, createdAt: true, cvProfileId: true },
  });
  res.json(renders);
});

/**
 * Streams the archived PDF as a download.
 *
 * pdfPath is treated as a cache, not the source of truth: the receipt's truth is
 * resolvedData + order + style in Postgres, which regenerate the document
 * deterministically. So a missing file (cleaned up, moved, never backed up
 * alongside the database) re-renders instead of 404ing, and the regenerated
 * output is checked against the stored hash before being served — if it does not
 * match, something about rendering changed since the CV was sent and silently
 * handing over a different document would be worse than an error.
 *
 * The stored path is also confined to the render outdir rather than trusted, so
 * a bad row cannot turn this into an arbitrary-file read.
 */
cvRouter.get("/renders/:id/pdf", async (req, res) => {
  const render = await prisma.cvRender.findFirst({ where: { id: req.params.id, userId: USER_ID } });
  if (!render) return res.status(404).json({ error: "not found" });

  const outdir = outputDir();
  const stored = path.resolve(render.pdfPath);
  let servePath = stored.startsWith(path.resolve(outdir) + path.sep) ? stored : "";

  if (!servePath || !(await fileExists(servePath))) {
    const data = render.resolvedData as unknown as CvData;
    const order = render.order as string[];
    const style = render.style as "default" | "compact";
    const rehash = hashResolved(data, order, style);
    if (rehash !== render.contentHash) {
      return res.status(409).json({
        error: "archived CV cannot be reproduced",
        detail: "the renderer no longer produces the document this receipt recorded, and the original file is gone",
      });
    }
    try {
      const result = await renderToPdf(data, `cv-${render.id}`, { order, style });
      servePath = result.pdfPath;
    } catch (err) {
      return res.status(500).json({ error: "render failed", detail: err instanceof Error ? err.message : String(err) });
    }
  }

  res.download(servePath, render.filename);
});

// --- AI tailoring suggestions -----------------------------------------------
// Suggestions only — nothing here mutates the profile. The caller applies
// accepted suggestions via the existing PUT /profiles/:id visibility update,
// same as a manual toggle. See plan Feature 7 ("human reviews and confirms").

const suggestSchema = z.object({ targetRole: z.string().min(1) });

cvRouter.post("/profiles/:id/suggest", async (req, res) => {
  const parsed = suggestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const profile = await prisma.cvProfile.findFirst({ where: { id: req.params.id, userId: USER_ID } });
  if (!profile) return res.status(404).json({ error: "not found" });
  const master = await prisma.masterCv.findUnique({ where: { id: profile.masterCvId } });
  if (!master) return res.status(404).json({ error: "master not found" });

  const cv = master.data as unknown as CvData;
  const toggleNodes = listToggleNodes(cv);

  try {
    const suggestions = await ollamaProvider.suggest({ cv, toggleNodes, targetRole: parsed.data.targetRole });
    res.json(suggestions);
  } catch (err) {
    res.status(502).json({
      error: "AI suggestion failed (is Ollama running? OLLAMA_HOST/OLLAMA_MODEL env vars)",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});
