// Minimal HTTP harness for route tests: boots the real express app on an
// ephemeral port and talks to it with fetch. Deliberately not supertest —
// this is ~40 lines and keeps the dependency list of a public repo shorter.
//
// Real sockets rather than a fake req/res matter here: the bug these tests
// were written for (express 4 dropping async rejections) shows up as "the
// client never gets a response", which an in-process invoke can't observe.

import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";

export interface TestResponse<T = unknown> {
  status: number;
  body: T;
  text: string;
  contentType: string;
}

export interface TestClient {
  request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<TestResponse<T>>;
  close(): Promise<void>;
}

export async function startTestServer(app: Express): Promise<TestClient> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  return {
    async request<T>(method: string, path: string, body?: unknown, options?: { timeoutMs?: number }) {
      // A handler that never responds would otherwise hang the whole suite,
      // so every request carries a deadline and surfaces as a failed assertion
      // instead of a timed-out run.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 3000);
      try {
        const res = await fetch(`${base}${path}`, {
          method,
          signal: controller.signal,
          ...(body === undefined
            ? {}
            : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        });
        const text = await res.text();
        const contentType = res.headers.get("content-type") ?? "";
        return {
          status: res.status,
          text,
          contentType,
          body: (contentType.includes("application/json") && text ? JSON.parse(text) : text) as T,
        };
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      return new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
