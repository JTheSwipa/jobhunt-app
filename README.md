<div align="center">

# jobhunt-app

**One master CV. Many tailored variants. A receipt for every one you send.**

A self-hosted job-hunt tool. Keep one CV, project it into as many
sector-tailored versions as you need without ever editing it by hand per
application, then track where each version actually went.

Runs entirely on your own machine. No account, no API key, no hosted service.

</div>

![CV Editor](docs/screenshots/cv-editor.png)

---

## What is this?

Tailoring a CV per application usually means duplicating the file. Six months
later you have eleven near-identical CVs, a typo fixed in four of them, and no
idea which one you sent to the company that just called you back.

This keeps **one** master CV. A *profile* is a named set of changes layered on
top of it at render time — hide this section, lead with that pitch — and the
master is never touched. Add a twelfth variant and it costs one row, not a
twelfth file to keep in sync. Every PDF you render is frozen into a receipt, so
"which CV did this company get?" stays answerable months later, even after
you've edited the variant that produced it.

There's also a job board (Indeed) and an application tracker, wired together:
shortlisting a listing creates the tracker row for you.

It does **not** auto-apply to anything, and the local AI only ever *suggests*
which sections to hide — a human confirms every change.

---

## Quick start

```bash
# 1. Postgres (host port 5433 — 5432 was already taken locally)
docker compose up -d db

# 2. API — copy apps/api/.env.example to apps/api/.env first
cd apps/api
npm install
npm run prisma:migrate
npm run dev          # tsx watch, http://localhost:4000

# 3. Web, in another terminal
cd apps/web
npm install
npm run dev           # vite, http://localhost:5173

# 4. Local AI tailoring, in another terminal — optional
ollama serve
ollama pull qwen2.5:7b
```

Then open `http://localhost:5173` and upload an rxresume-style CV JSON export.

Run the API test suite with `cd apps/api && npm test` — the visibility engine
plus every HTTP route, exercised over real sockets against a mocked Prisma
client, so no database is needed to run it.

---

## The rest of the app

Screenshots use the fake `example_data/master_cv.json` fixture, not real CV
content.

**Job Board** — Indeed results with per-listing status actions.

![Job Board](docs/screenshots/job-board.png)

**Tracker** — shortlisting or applying on the Job Board materializes (or
updates) a matching row here automatically; manual entries work the same as
before. The "CV sent" column links to the exact PDF that went out.

![Tracker](docs/screenshots/tracker.png)

---

## The CV visibility engine

Every section and item in the CV JSON (rxresume format) already carries a
`hidden` flag. The engine (`apps/api/src/cv/visibility.ts`) makes that flag
actually work everywhere — the original renderer this was ported from only
respected it for 2 of 11 sections, so anything else you'd "hidden" in the
editor still showed up in the PDF.

On top of that base layer sits a second one: a named **profile** carries its
own `visibility` override map, applied at render time on top of whatever the
master already has, without ever mutating the master. One master CV, many
sector-tailored variants, always in sync with the source of truth.

**Worked example.** The master CV has `sections.interests.hidden = false`
and `sections.certifications.hidden = false` — both visible by default. Two
profiles layer different overrides on top of that same, untouched master:

```jsonc
// profile "Corporate"
{ "section:interests": true }

// profile "Startup"
{ "section:certifications": true }
```

```ts
const corporateCv = applyVisibility(master, corporateProfile.visibility);
const startupCv = applyVisibility(master, startupProfile.visibility);
```

`corporateCv` hides interests and keeps certifications; `startupCv` does the
opposite. `master` itself is unchanged after both calls — no hand-cloning,
no risk of the "CV I actually send" drifting from the CV I edit. Add a third
sector tomorrow and it's one more override map, not one more file to keep in
sync by hand. Override keys come in three shapes: `section:<key>` for a
top-level section, `section:custom:<id>` for a custom section, and
`item:<itemId>` for any single item — item ids are unique across the whole
document, so no section prefix is needed there.

A [table-driven test suite](apps/api/src/cv/visibility.test.ts) covers this
engine specifically: every section type, the full master × override
precedence matrix, section/item independence, the master-immutability
invariant, multi-profile isolation, and malformed input. The HTTP layer has
its own suite alongside it ([cv](apps/api/src/routes/cv.test.ts),
[jobs](apps/api/src/routes/jobs.test.ts),
[tracker](apps/api/src/routes/tracker.test.ts)) covering validation, the job
board ↔ tracker sync branches, and the error paths.

### Hiding is not enough — a variant also carries its own pitch

Hiding only differentiates a CV that has something to cut. On an early-career
CV with two roles and two projects, every variant needs everything shown, and
what actually changes between a bank and a seed-stage startup is the *pitch*.
So a profile also carries `headline` and `summary` overrides:

| value | meaning |
|-------|---------|
| `null` | inherit the master's value |
| `""` | render nothing (the element is omitted, not left empty) |
| a string | replace it for this profile only |

These are typed columns rather than more keys in the `visibility` map, because
boolean-presence-override and string-replacement are different semantics and
the override grammar above is worth keeping narrow.

Because overrides key on ids, `applyVisibility` **fails open**: an override
whose target no longer exists does nothing, so an item you thought you had
hidden renders anyway. That is the wrong direction to fail, so
[`findOrphans`](apps/api/src/cv/visibility.ts) reports override keys that match
nothing and the editor warns before you render. The editor also hashes each
profile's resolved HTML, so two variants that produce a byte-identical document
say so instead of quietly being the same CV under two names.

### Every rendered CV leaves a receipt

`POST /api/cv/profiles/:id/render` writes a `CvRender` row that snapshots the
**resolved** CV — not a pointer at the profile it came from. A profile is
mutable, so a foreign key would start lying the next time you edited it; the
snapshot means "which CV did I send to Acme?" stays answerable after that
profile is renamed or deleted. `Application.cvRenderId` links an application to
its receipt, and the Tracker's "CV sent" column downloads the exact file.

`resolvedData` + `order` + `style` regenerate the PDF deterministically, so the
receipt's truth lives in Postgres and `pdfPath` is only a cache — if the file
is gone, `GET /api/cv/renders/:id/pdf` re-renders it and checks the result
against the stored `contentHash` before serving. Files are named per render
(`Jezdic_CV_Corporate.pdf`), so renders no longer overwrite each other.

## AI tailoring — suggests, never applies

The tailoring endpoint calls a local model (Ollama, `qwen2.5:7b` by default)
to suggest which sections and items to hide for a given target role. This is
a deliberate constraint, not a current limitation: the model only ever
returns `{ key, suggestedHidden, reason }` for keys it was explicitly handed
from the CV's own toggle list, anything it hallucinates outside that set is
dropped before a human ever sees it, and nothing is applied automatically.
Every suggestion goes through the same manual toggle-and-save path a person
uses — there is no code path from "model responds" to "profile changes."

## Architecture

![Architecture](docs/architecture.png)

_Source: [`docs/architecture.mmd`](docs/architecture.mmd) (Mermaid).
Regenerate the PNG and SVG with `npm run docs:diagram` — it drives whatever
Chromium `CHROMIUM_BIN` points at, the same one the CV renderer uses._

**It all runs on one machine.** Clone it, start Postgres and two dev servers,
and you have the whole thing. There is no account to create, no API key to
paste, and no hosted service in the loop. Exactly one call leaves your
machine: the Indeed search. Your CV never does.

**Two dependencies are optional and fail honestly.** Without Ollama the AI
tailoring endpoint returns a 502 that names the missing piece, and everything
else keeps working. Without the Python venv the Indeed adapter is the only
thing that breaks. Neither is load-bearing for the CV engine, which is the
part worth looking at.

**The PDF renderer is whatever Chromium you already have.** It shells out to a
headless browser to print the CV, resolved via `CHROMIUM_BIN`, so Chrome,
Chromium, or a snap install all work without a bundled 100 MB binary in the
repo.

**Two invariants hold the design up.** The master CV is never mutated — a
variant is a set of overrides applied to a copy at render time, so adding a
tenth variant costs one row, not a tenth duplicate to keep in sync. And every
render writes an immutable receipt, so "which CV did I send to this company?"
stays answerable after the variant that produced it has been edited, renamed,
or deleted.

**Job sources are an adapter behind a small registry**
(`apps/api/src/jobs/`), not a plugin system — just a `JobSource` interface
(`id`, `displayName`, `search()`) and a lookup that tracks availability per
source, so a registered-but-not-ready source (like `careeros.ts`) answers
with a clear "not available yet" instead of a stack trace or a wall pretending
it doesn't exist. Indeed is the one real implementation, shelling out to
`scripts/indeed_scan.py` (see below).

**Inference is local-first.** Tailoring calls Ollama on localhost, not a
metered API — no per-request cost to iterate on prompts, and the CV data
never leaves the machine for this path.

**One deliberate subprocess boundary.** Indeed search goes through
`scripts/indeed_scan.py`, a Python script using `python-jobspy`, invoked from
the Node API via `execFile`. jobspy has no real TypeScript/Node equivalent
worth reimplementing, so this is the one piece of the app that stays Python;
everything else — the source interface, dedup, persistence — is TypeScript.
The script does no file I/O or persistence of its own, it only prints JSON to
stdout; dedup is the Node side's job, via Postgres's unique constraint on
`jobUrl`.

## Stack

- **API**: Node, TypeScript, Express, Prisma, Postgres.
- **Web**: React, TypeScript, Vite.
- **Adapters**: TypeScript, with one Python subprocess for the Indeed search
  (`python-jobspy`).
- **AI**: Ollama, local, `qwen2.5:7b` by default.

## Status

**Built**: the CV visibility engine and per-profile overrides, sector
profiles with reorderable sections (drives both the editor and the PDF
render order), local AI tailoring (suggest-then-review), the Indeed adapter,
a design system ([`DESIGN.md`](DESIGN.md)), and an application tracker that's
now linked to the job board — shortlisting or applying to a listing
materializes a matching tracker row automatically, without ever clobbering
progress you've already logged there (interview/offer/rejected).

**Not built, on purpose:**
- **LinkedIn adapter** — deferred. LinkedIn is aggressive about rate-limiting
  and blocking automated access to search/scrape; not worth the account risk
  for what this app needs.
- **CareerOS adapter** — registered in the job-source registry as disabled
  (see Architecture, above), not implemented. Their board turns out to be
  Algolia-backed with a public, search-only key — technically fine to query
  directly, but reaching into a company's backend instead of using their own
  UI while actively applying there is a judgment call for a direct
  conversation, not something to decide unilaterally by shipping code.
