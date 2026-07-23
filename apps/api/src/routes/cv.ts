import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { applyVisibility, listToggleNodes } from "../cv/visibility.js";
import { buildHtml, renderToPdf, DEFAULT_ORDER } from "../cv/render.js";
import type { CvData } from "../cv/schema.js";

export const cvRouter = Router();

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

// --- Sector profiles --------------------------------------------------------

cvRouter.get("/profiles", async (req, res) => {
  const masterCvId = String(req.query.masterCvId ?? "");
  const profiles = await prisma.cvProfile.findMany({
    where: { userId: USER_ID, ...(masterCvId ? { masterCvId } : {}) },
    orderBy: { createdAt: "asc" },
  });
  res.json(profiles);
});

const profileSchema = z.object({
  masterCvId: z.string(),
  name: z.string().min(1),
  visibility: z.record(z.string(), z.boolean()).default({}),
  order: z.array(z.string()).default(DEFAULT_ORDER),
  style: z.enum(["default", "compact"]).default("default"),
});

cvRouter.post("/profiles", async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { masterCvId, name, visibility, order, style } = parsed.data;
  const profile = await prisma.cvProfile.create({
    data: { userId: USER_ID, masterCvId, name, visibility, order, style },
  });
  res.status(201).json(profile);
});

const profileUpdateSchema = profileSchema.partial().omit({ masterCvId: true });

cvRouter.put("/profiles/:id", async (req, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const profile = await prisma.cvProfile.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json(profile);
});

cvRouter.delete("/profiles/:id", async (req, res) => {
  await prisma.cvProfile.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// --- Rendering --------------------------------------------------------------

async function resolveProfileCv(profileId: string): Promise<{ data: CvData; order: string[]; style: "default" | "compact" } | null> {
  const profile = await prisma.cvProfile.findFirst({ where: { id: profileId, userId: USER_ID } });
  if (!profile) return null;
  const master = await prisma.masterCv.findUnique({ where: { id: profile.masterCvId } });
  if (!master) return null;
  const resolved = applyVisibility(
    master.data as unknown as CvData,
    profile.visibility as Record<string, boolean>,
  );
  return { data: resolved, order: profile.order as string[], style: profile.style as "default" | "compact" };
}

cvRouter.get("/profiles/:id/preview", async (req, res) => {
  const resolved = await resolveProfileCv(req.params.id);
  if (!resolved) return res.status(404).json({ error: "not found" });
  const html = buildHtml(resolved.data, { order: resolved.order, style: resolved.style });
  res.type("html").send(html);
});

cvRouter.post("/profiles/:id/render", async (req, res) => {
  const resolved = await resolveProfileCv(req.params.id);
  if (!resolved) return res.status(404).json({ error: "not found" });
  try {
    const result = await renderToPdf(resolved.data, `cv-${req.params.id}`, {
      order: resolved.order,
      style: resolved.style,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "render failed", detail: err instanceof Error ? err.message : String(err) });
  }
});
