// Default, free, local-first tailoring provider (plan decision: local model
// first, Anthropic API deferred to Phase 3, MCP bridge as the "use my own
// Claude" path). Ollama's HTTP API is OpenAI-adjacent but has its own shape;
// this hits /api/generate directly with format:"json" rather than pulling in
// a client library, since the request/response shape is small.
//
// Structural safety, not just prompt instruction: the model is never asked
// to write new CV content — only to pick `suggestedHidden` for keys we hand
// it. Any key it returns that we didn't offer is dropped before the result
// reaches the human-review UI (see routes/cv.ts's suggest endpoint).

import type { CvData } from "../cv/schema.js";
import type { ToggleNode } from "../cv/visibility.js";
import type { TailoringInput, TailoringProvider, TailoringSuggestion } from "./provider.js";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

function findItemSnippet(cv: CvData, node: ToggleNode): string {
  if (node.kind !== "item") return "";
  const key = node.key.replace(/^item:/, "");
  for (const section of Object.values(cv.sections)) {
    const item = section?.items.find((it) => (it as { id: string }).id === key) as
      | { description?: string; keywords?: string[] }
      | undefined;
    if (item) {
      if (item.description) return item.description.replace(/<[^>]+>/g, " ").slice(0, 220);
      if (item.keywords?.length) return item.keywords.join(", ");
    }
  }
  return "";
}

function buildPrompt(input: TailoringInput): string {
  const lines = input.toggleNodes.map((node) => {
    const snippet = findItemSnippet(input.cv, node);
    const desc = node.kind === "section" ? node.sectionLabel : `${node.itemLabel}${snippet ? ` — ${snippet}` : ""}`;
    return `${node.key} | ${node.kind} | ${node.sectionLabel} | ${desc}`;
  });

  return `You are helping tailor a CV for this target role/sector: "${input.targetRole}"

Below is every toggleable section/item in the CV, one per line, as:
key | kind | section | description

${lines.join("\n")}

For each key, decide whether it should be SHOWN or HIDDEN for this specific target role. Keep items that are directly relevant; hide items that are unrelated or dilute the CV's focus for this role. Do not hide "profile" or more than half of "experience" unless clearly irrelevant. Never invent new content — you are only choosing show/hide for the keys given above.

Respond with ONLY a JSON array, no prose, in this exact shape:
[{"key": "<key>", "suggestedHidden": true|false, "reason": "<one short sentence>"}]

Include every key from the list above exactly once.`;
}

export const ollamaProvider: TailoringProvider = {
  id: "ollama",
  async suggest(input: TailoringInput): Promise<TailoringSuggestion[]> {
    const prompt = buildPrompt(input);
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        format: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              suggestedHidden: { type: "boolean" },
              reason: { type: "string" },
            },
            required: ["key", "suggestedHidden", "reason"],
          },
        },
        stream: false,
        options: { temperature: 0.2 },
      }),
    });
    if (!res.ok) {
      throw new Error(`ollama request failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { response: string };
    let raw: unknown;
    try {
      raw = JSON.parse(body.response);
    } catch {
      throw new Error(`ollama returned non-JSON response: ${body.response.slice(0, 200)}`);
    }
    const list = Array.isArray(raw) ? raw : (raw as { suggestions?: unknown[] }).suggestions;
    if (!Array.isArray(list)) {
      throw new Error("ollama response was not a JSON array of suggestions");
    }

    const validKeys = new Set(input.toggleNodes.map((n) => n.key));
    const labelByKey = new Map(input.toggleNodes.map((n) => [n.key, n.itemLabel ?? n.sectionLabel]));

    const suggestions: TailoringSuggestion[] = [];
    for (const entry of list as Array<Record<string, unknown>>) {
      const key = String(entry.key ?? "");
      if (!validKeys.has(key)) continue; // drop anything hallucinated / out of scope
      suggestions.push({
        key,
        label: labelByKey.get(key) ?? key,
        suggestedHidden: Boolean(entry.suggestedHidden),
        reason: String(entry.reason ?? ""),
      });
    }
    return suggestions;
  },
};
