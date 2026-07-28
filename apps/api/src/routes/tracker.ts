import { z } from "zod";
import { prisma } from "../db.js";
import { asyncRouter } from "../http/asyncRouter.js";

export const trackerRouter = asyncRouter();

const USER_ID = "local";

// Includes the CV receipt so the Tracker can show which variant actually went
// out. profileName and filename live on the render itself, so the column still
// reads correctly after the source profile is renamed or deleted.
trackerRouter.get("/", async (req, res) => {
  const applications = await prisma.application.findMany({
    where: { userId: USER_ID },
    orderBy: { dateApplied: "desc" },
    include: {
      cvRender: {
        select: { id: true, profileName: true, filename: true, createdAt: true },
      },
    },
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
  cvVersion: z.string().optional(), // legacy free-text label; superseded by cvRenderId below
  // Which archived CV went out. Nullable so an application can be detached from
  // a render again; `.nullish()` rather than `.optional()` for the same
  // absent-vs-explicitly-cleared distinction the CV pitch fields need.
  cvRenderId: z.string().nullish(),
  coverLetter: z.string().optional(),
  status: z.enum(["shortlist", "applied", "interview", "offer", "rejected"]).default("applied"),
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
  // Reverting to "shortlist" without an explicit dateApplied clears any date
  // left over from a prior "applied" state — otherwise the row shows a
  // self-contradictory "not yet applied" status next to a real applied date.
  const data: Omit<typeof parsed.data, "dateApplied"> & { dateApplied?: Date | null } = { ...parsed.data };
  if (data.status === "shortlist" && data.dateApplied === undefined) {
    data.dateApplied = null;
  }
  const application = await prisma.application.update({ where: { id: req.params.id }, data });
  res.json(application);
});

trackerRouter.delete("/:id", async (req, res) => {
  await prisma.application.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
