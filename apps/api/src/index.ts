import express from "express";
import cors from "cors";
import { cvRouter } from "./routes/cv.js";
import { trackerRouter } from "./routes/tracker.js";
import { jobsRouter } from "./routes/jobs.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/cv", cvRouter);
app.use("/api/tracker", trackerRouter);
app.use("/api/jobs", jobsRouter);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});
