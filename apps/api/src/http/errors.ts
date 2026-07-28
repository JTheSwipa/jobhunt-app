// Last-resort error middleware. Routes still handle the errors they can
// describe better than a generic mapping can (cv.ts's P2002 -> "a profile
// named X already exists"); this catches everything else so a database error
// becomes a status code instead of a dead process.

import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";

// Prisma error codes worth translating. Everything else is a 500 — inventing
// a friendlier status for an error we don't understand would just hide it.
const STATUS_BY_PRISMA_CODE: Record<string, { status: number; error: string }> = {
  // "An operation failed because it depends on one or more records that were
  // required but not found" — an update/delete against an id that isn't there.
  P2025: { status: 404, error: "not found" },
  P2002: { status: 409, error: "already exists" },
  // Foreign key constraint failed, e.g. a profile pointing at a masterCvId
  // that doesn't exist. The caller sent bad data, so 400 rather than 500.
  P2003: { status: 400, error: "referenced record does not exist" },
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // Something already started writing a response (a streamed render, say) —
  // express's default handler is the only safe thing left.
  if (res.headersSent) return next(err);

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = STATUS_BY_PRISMA_CODE[err.code];
    if (mapped) return res.status(mapped.status).json({ error: mapped.error, code: err.code });
  }

  console.error("unhandled route error:", err);
  res.status(500).json({ error: "internal error" });
};
