// Express 4 does not forward rejected promises from async handlers. A handler
// that throws (or awaits a Prisma call that rejects) produces an unhandled
// rejection, which under Node's default policy kills the process — the client
// never gets a response and every other in-flight request dies with it.
// Verified: one `PATCH /api/jobs/<unknown-id>` (Prisma P2025) exited the API.
//
// Wrapping at the router level rather than per-handler is deliberate. The two
// crashes fixed by hand earlier (POST /profiles, PUT /profiles/:id, both
// P2002) were the same bug found twice, because per-handler guards are
// something you can forget on the next route. Every handler registered
// through here is covered by construction; new routes inherit it for free.
// Express 5 makes this native, at which point this file can go away.

import {
  Router,
  type ErrorRequestHandler,
  type IRouter,
  type NextFunction,
  type RequestHandler,
} from "express";

const METHODS = ["get", "post", "put", "patch", "delete", "all", "use"] as const;

type Method = (typeof METHODS)[number];

// Sync handlers return the Response (from `res.json(...)`) or undefined; only
// a thenable needs its rejection routed on to the error middleware.
function settle(result: unknown, next: NextFunction) {
  if (result instanceof Promise) result.catch(next);
}

// Express identifies error middleware by arity alone (4 parameters), so the
// wrapper has to preserve it — a wrapped 4-arg handler that came back 3-arg
// would quietly demote itself to a normal handler and never see an error.
function forwardRejections(handler: RequestHandler | ErrorRequestHandler) {
  if (handler.length === 4) {
    const errorHandler = handler as ErrorRequestHandler;
    const wrapped: ErrorRequestHandler = (err, req, res, next) => {
      try {
        settle(errorHandler(err, req, res, next), next);
      } catch (thrown) {
        next(thrown);
      }
    };
    return wrapped;
  }

  const requestHandler = handler as RequestHandler;
  const wrapped: RequestHandler = (req, res, next) => {
    try {
      settle(requestHandler(req, res, next), next);
    } catch (thrown) {
      next(thrown);
    }
  };
  return wrapped;
}

export function asyncRouter(): IRouter {
  const router = Router();
  for (const method of METHODS) {
    const original = router[method].bind(router) as (...args: unknown[]) => unknown;
    // Express's per-method overloads (path-first, handler-only, arrays of
    // handlers) don't survive a generic wrapper, so the reassignment is cast.
    // Behavior is unchanged: same arguments, same order, functions wrapped.
    (router as unknown as Record<Method, unknown>)[method] = (...args: unknown[]) =>
      original(...args.map((arg) => (typeof arg === "function" ? forwardRejections(arg as RequestHandler) : arg)));
  }
  return router;
}
