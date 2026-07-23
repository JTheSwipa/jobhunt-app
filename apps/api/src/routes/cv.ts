import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { listToggleNodes } from "../cv/visibility.js";
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
