import express, { type Express } from "express";
import cors from "cors";
import { cvRouter } from "./routes/cv.js";
import { trackerRouter } from "./routes/tracker.js";
import { jobsRouter } from "./routes/jobs.js";
import { errorHandler } from "./http/errors.js";

// Split from index.ts so tests can mount the real app without binding a port
// or starting a server they'd then have to tear down on a fixed port.
export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/cv", cvRouter);
  app.use("/api/tracker", trackerRouter);
  app.use("/api/jobs", jobsRouter);

  // Must come last: express only treats a 4-arg middleware as the error
  // handler, and only routes to it what was registered before it.
  app.use(errorHandler);

  return app;
}
