import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";

export const trackerRouter = Router();

const USER_ID = "local";

trackerRouter.get("/", async (req, res) => {
  const applications = await prisma.application.findMany({
    where: { userId: USER_ID },
    orderBy: { dateApplied: "desc" },
  });
  res.json(applications);
});

const applicationSchema = z.object({
  dateApplied: z.coerce.date().optional(),
  company: z.string().min(1),
  role: z.string().min(1),
  location: z.string().optional(),
  source: z.string().optional(),
  foundVia: z.string().optional(),
  atsPlatform: z.string().optional(),
  cvVersion: z.string().optional(),
  coverLetter: z.string().optional(),
  status: z.enum(["applied", "interview", "offer", "rejected"]).default("applied"),
  responseDate: z.coerce.date().optional(),
  responseType: z.string().optional(),
  notes: z.string().optional(),
});

trackerRouter.post("/", async (req, res) => {
  const parsed = applicationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const application = await prisma.application.create({ data: { userId: USER_ID, ...parsed.data } });
  res.status(201).json(application);
});

trackerRouter.put("/:id", async (req, res) => {
  const parsed = applicationSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const application = await prisma.application.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(application);
});

trackerRouter.delete("/:id", async (req, res) => {
  await prisma.application.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
