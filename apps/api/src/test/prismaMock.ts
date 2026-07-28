// Stand-in for src/db.ts's PrismaClient. Route tests are about routing:
// status codes, validation, and which writes each branch performs. Those are
// the parts that broke in review (a sync branch firing when it shouldn't, an
// error code mapping to the wrong status), and none of them need a database.
//
// What this deliberately does NOT cover: that the unique constraints actually
// exist in Postgres. Tests here assert "when Prisma reports P2002, the route
// does X" — the constraints themselves live in prisma/schema.prisma and are
// the migration's job to guarantee.

import { vi } from "vitest";
import { Prisma } from "@prisma/client";

export function makePrismaMock() {
  return {
    jobListing: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    application: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    masterCv: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    cvProfile: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

export type PrismaMock = ReturnType<typeof makePrismaMock>;

/** A real Prisma error instance, so routes' `instanceof` checks behave. */
export function prismaError(code: string, message = `simulated ${code}`) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}
