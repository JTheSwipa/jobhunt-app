import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { asyncRouter } from "./asyncRouter.js";
import { errorHandler } from "./errors.js";
import { startTestServer, type TestClient } from "../test/httpTestServer.js";
import { prismaError } from "../test/prismaMock.js";

// Everything here is about one property: a handler that fails must produce a
// response. Before this router existed, a rejected promise in an express 4
// handler became an unhandled rejection — the client waited forever and Node
// exited the process, so a single bad id took the whole API down.

const clients: TestClient[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

async function serve(build: (router: ReturnType<typeof asyncRouter>) => void): Promise<TestClient> {
  const router = asyncRouter();
  build(router);
  const app = express();
  app.use(express.json());
  app.use("/t", router);
  app.use(errorHandler);
  const client = await startTestServer(app);
  clients.push(client);
  return client;
}

describe("asyncRouter", () => {
  it("answers normally when the handler resolves", async () => {
    const client = await serve((r) =>
      r.get("/ok", async (_req, res) => {
        await Promise.resolve();
        res.json({ ok: true });
      }),
    );

    const res = await client.request("GET", "/t/ok");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("answers 500 instead of hanging when an async handler rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await serve((r) =>
      r.get("/boom", async () => {
        throw new Error("kaboom");
      }),
    );

    const res = await client.request("GET", "/t/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal error" });
  });

  it("answers when a handler rejects after an await, not just synchronously", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await serve((r) =>
      r.post("/boom-later", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("late kaboom");
      }),
    );

    const res = await client.request("POST", "/t/boom-later", {});

    expect(res.status).toBe(500);
  });

  it("still routes a synchronous throw, which express already handled", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await serve((r) =>
      r.get("/sync-boom", () => {
        throw new Error("kaboom");
      }),
    );

    const res = await client.request("GET", "/t/sync-boom");

    expect(res.status).toBe(500);
  });

  it("wraps middleware mounted with use(), not just method handlers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await serve((r) => {
      r.use(async () => {
        throw new Error("middleware kaboom");
      });
      r.get("/never", (_req, res) => res.json({ reached: true }));
    });

    const res = await client.request("GET", "/t/never");

    expect(res.status).toBe(500);
  });

  it("leaves an explicit next(err) working", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await serve((r) =>
      r.get("/next-err", (_req, _res, next) => {
        next(new Error("handed off"));
      }),
    );

    const res = await client.request("GET", "/t/next-err");

    expect(res.status).toBe(500);
  });

  it("keeps a router-level error middleware recognisable as one", async () => {
    // Express tells error middleware apart by parameter count alone, so a
    // wrapper that flattened arity would silently demote it to a normal
    // handler that never runs.
    const client = await serve((r) => {
      r.get("/boom", async () => {
        throw new Error("kaboom");
      });
      r.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(418).json({ handled: err.message });
      });
    });

    const res = await client.request("GET", "/t/boom");

    expect(res.status).toBe(418);
    expect(res.body).toEqual({ handled: "kaboom" });
  });

  it("forwards a rejection from an async error middleware", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await serve((r) => {
      r.get("/boom", async () => {
        throw new Error("first");
      });
      r.use(async (_err: Error, _req: express.Request, _res: express.Response, _next: express.NextFunction) => {
        throw new Error("error handler failed too");
      });
    });

    const res = await client.request("GET", "/t/boom");

    expect(res.status).toBe(500);
  });

  it("passes multiple handlers through in order", async () => {
    const client = await serve((r) =>
      r.get(
        "/chain",
        (req, _res, next) => {
          (req as express.Request & { seen: string[] }).seen = ["first"];
          next();
        },
        (req, res) => {
          const seen = (req as express.Request & { seen: string[] }).seen;
          seen.push("second");
          res.json({ seen });
        },
      ),
    );

    const res = await client.request("GET", "/t/chain");

    expect(res.body).toEqual({ seen: ["first", "second"] });
  });
});

describe("errorHandler", () => {
  it.each([
    ["P2025", 404, "not found"],
    ["P2002", 409, "already exists"],
    ["P2003", 400, "referenced record does not exist"],
  ])("maps Prisma %s to %i", async (code, status, error) => {
    const client = await serve((r) =>
      r.get("/prisma", async () => {
        throw prismaError(code);
      }),
    );

    const res = await client.request("GET", "/t/prisma");

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error, code });
  });

  it("500s a Prisma code with no mapping rather than guessing a status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await serve((r) =>
      r.get("/prisma", async () => {
        throw prismaError("P1001", "cannot reach database server");
      }),
    );

    const res = await client.request("GET", "/t/prisma");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal error" });
  });

  it("logs the unmapped error so it isn't silently swallowed", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await serve((r) =>
      r.get("/boom", async () => {
        throw new Error("kaboom");
      }),
    );

    await client.request("GET", "/t/boom");

    expect(logged).toHaveBeenCalledWith("unhandled route error:", expect.any(Error));
  });

  it("hands a half-sent response back to express instead of rewriting it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await serve((r) => {
      r.get("/half-sent", async (_req, res) => {
        res.status(200).write("partial");
        throw new Error("failed mid-stream");
      });
      r.get("/after", (_req, res) => res.json({ ok: true }));
    });

    // The status line is already on the wire, so no error body can be sent —
    // express's default handler destroys the connection, which the client
    // sees as a terminated socket rather than a 500.
    await expect(client.request("GET", "/t/half-sent")).rejects.toThrow();

    // The point of the delegation: one broken response, not a dead server.
    const next = await client.request("GET", "/t/after");
    expect(next.status).toBe(200);
  });
});
