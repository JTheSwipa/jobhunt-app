import { describe, expect, it } from "vitest";
import { applyVisibility, listToggleNodes, type VisibilityMap } from "./visibility.js";
import { SECTION_KEYS, type CvData } from "./schema.js";
import { DEFAULT_ORDER } from "./render.js";

// ---------------------------------------------------------------------------
// Fixture — one realistic master CV covering every real CvSections key, the
// summary ("profile") pseudo-section, and 2 custom sections. Returns a fresh
// object every call so tests can mutate freely without leaking state.
// ---------------------------------------------------------------------------

function makeMasterCv(): CvData {
  return {
    basics: {
      name: "Alex Rivera",
      headline: "Data & AI",
      location: "Remote",
      email: "alex@example.com",
      phone: "+1 555 0100",
    },
    summary: { content: "<p>Profile summary.</p>", hidden: false },
    sections: {
      profiles: {
        hidden: false,
        items: [
          {
            id: "prof-linkedin",
            network: "LinkedIn",
            website: { label: "linkedin.com/in/alex", url: "https://linkedin.com/in/alex" },
            hidden: false,
          },
        ],
      },
      skills: {
        hidden: false,
        items: [{ id: "skill-1", name: "TypeScript", proficiency: "Expert", hidden: false }],
      },
      experience: {
        hidden: false,
        items: [
          {
            id: "exp-1",
            position: "Engineer",
            company: "Acme",
            location: "Remote",
            period: "2023-2024",
            description: "<p>Did things.</p>",
            hidden: false,
          },
        ],
      },
      projects: {
        hidden: false,
        items: [{ id: "proj-1", name: "Project X", description: "<p>Built X.</p>", hidden: false }],
      },
      education: {
        hidden: false,
        items: [
          {
            id: "edu-1",
            degree: "BSc CS",
            school: "State University",
            location: "Remote",
            period: "2019-2023",
            hidden: false,
          },
        ],
      },
      certifications: {
        hidden: false,
        items: [{ id: "cert-1", title: "Cert A", issuer: "Issuer Co", hidden: false }],
      },
      languages: {
        hidden: false,
        items: [{ id: "lang-1", language: "English", fluency: "Native", hidden: false }],
      },
      awards: {
        hidden: false,
        items: [{ id: "award-1", title: "Award A", awarder: "Org", date: "2022", hidden: false }],
      },
      interests: {
        hidden: false,
        items: [{ id: "interest-1", name: "Reading", hidden: false }],
      },
    },
    customSections: [
      {
        id: "custom-academic",
        title: "Academic Training",
        hidden: false,
        items: [{ id: "acad-1", degree: "Cert", hidden: false }],
      },
      {
        id: "custom-conferences",
        title: "Conferences",
        hidden: false,
        items: [{ id: "conf-1", title: "Talk A", hidden: false }],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. All-sections sweep — every real section type behaves identically.
// ---------------------------------------------------------------------------

const SECTION_TOGGLE_CASES: Array<{
  label: string;
  toggleKey: string;
  setHidden: (cv: CvData, hidden: boolean) => void;
}> = [
  { label: "profile (summary)", toggleKey: "section:profile", setHidden: (cv, h) => { cv.summary.hidden = h; } },
  ...Object.keys(makeMasterCv().sections).map((key) => ({
    label: key,
    toggleKey: `section:${key}`,
    setHidden: (cv: CvData, h: boolean) => {
      const section = cv.sections[key];
      if (section) section.hidden = h;
    },
  })),
  {
    label: "custom:custom-academic",
    toggleKey: "section:custom:custom-academic",
    setHidden: (cv, h) => {
      cv.customSections!.find((cs) => cs.id === "custom-academic")!.hidden = h;
    },
  },
  {
    label: "custom:custom-conferences",
    toggleKey: "section:custom:custom-conferences",
    setHidden: (cv, h) => {
      cv.customSections!.find((cs) => cs.id === "custom-conferences")!.hidden = h;
    },
  },
];

describe("listToggleNodes — hidden flag respected identically across every section type", () => {
  it.each(SECTION_TOGGLE_CASES)("$label", ({ toggleKey, setHidden }) => {
    for (const hidden of [true, false]) {
      const cv = makeMasterCv();
      setHidden(cv, hidden);
      const node = listToggleNodes(cv).find((n) => n.key === toggleKey);
      expect(node, `expected a ToggleNode for ${toggleKey}`).toBeDefined();
      expect(node!.hidden).toBe(hidden);
    }
  });
});

describe("SECTION_KEYS drift guard", () => {
  // SECTION_KEYS mirrors render.ts's fixed DEFAULT_ORDER slots minus the 2
  // custom-title ones (academic_training, conferences) — it intentionally
  // excludes `profiles` (the contact-links section), which render.ts always
  // shows via the header contact line rather than the section-toggle loop.
  // So this is a one-directional subset check, not full equality: it catches
  // "SECTION_KEYS names a section the engine doesn't actually have," without
  // false-flagging `profiles`'s legitimate absence from that particular list.
  it("every name in SECTION_KEYS corresponds to a section the engine can toggle", () => {
    const cv = makeMasterCv();
    const knownSectionNames = new Set<string>(["profile", ...Object.keys(cv.sections)]);
    for (const key of SECTION_KEYS) {
      expect(knownSectionNames.has(key), `SECTION_KEYS has "${key}" but no matching section exists`).toBe(true);
    }
  });
});

describe("DEFAULT_ORDER covers every SECTION_KEYS name", () => {
  // SECTION_KEYS (schema.ts) is the CV data model's section vocabulary.
  // DEFAULT_ORDER (render.ts) is the renderer's closed list of everything it
  // physically knows how to draw: the same 9 names, plus "academic_training"
  // and "conferences" -- two custom sections render.ts finds by hardcoded
  // title-substring match, with no schema representation at all. These two
  // lists were never meant to be equal; this is a one-directional coverage
  // check, not an equality check. It catches the real drift case -- a name
  // added to SECTION_KEYS that the renderer's fixed dispatch table doesn't
  // actually know how to draw -- without false-flagging DEFAULT_ORDER's
  // legitimate extra 2 entries.
  it("every SECTION_KEYS name appears somewhere in DEFAULT_ORDER", () => {
    for (const key of SECTION_KEYS) {
      expect(DEFAULT_ORDER, `SECTION_KEYS has "${key}" but DEFAULT_ORDER doesn't`).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Override precedence matrix — master {true,false,absent} x
//    override {true,false,absent}, for both a section and an item.
// ---------------------------------------------------------------------------

type FlagState = true | false | "absent";

const MATRIX_CASES: Array<{ master: FlagState; override: FlagState; expected: boolean }> = [
  { master: true, override: true, expected: true },
  { master: true, override: false, expected: false },
  { master: true, override: "absent", expected: true },
  { master: false, override: true, expected: true },
  { master: false, override: false, expected: false },
  { master: false, override: "absent", expected: false },
  { master: "absent", override: true, expected: true },
  { master: "absent", override: false, expected: false },
  { master: "absent", override: "absent", expected: false },
];

function setFlag(target: { hidden?: boolean }, state: FlagState): void {
  if (state === "absent") delete target.hidden;
  else target.hidden = state;
}

function buildOverrides(key: string, state: FlagState): VisibilityMap {
  return state === "absent" ? {} : { [key]: state };
}

// NOTE: the matrix below asserts Boolean(...) rather than raw `.toBe(...)`
// on purpose — see "documented contract: absent hidden flags stay absent"
// below for why, and for the passthrough behavior stated directly.

describe("documented contract: absent hidden flags stay absent, not normalized to false", () => {
  // This is intentional, not an oversight: applyVisibility passes an absent
  // master `hidden` flag through untouched (`undefined`) when no override
  // applies — it never coerces it to a definite `false`. That's safe only
  // because every real consumer in this codebase (render.ts, listToggleNodes)
  // reads `hidden` via truthy checks (`!hidden`, `Boolean(hidden)`), never
  // strict equality (`=== false`). A future consumer that used strict
  // equality would break silently on CVs whose flags were never set. This
  // test records that tradeoff as a deliberate decision, not a discovery.
  it("applyVisibility passes an absent hidden flag through as undefined, not false", () => {
    const cv = makeMasterCv();
    delete cv.sections.experience.hidden;
    delete cv.sections.experience.items[0].hidden;

    const result = applyVisibility(cv, {}); // no overrides at all

    // The raw contract: absent stays absent.
    expect(result.sections.experience?.hidden).toBeUndefined();
    expect(result.sections.experience?.items[0]?.hidden).toBeUndefined();

    // Why that's safe: every real consumer treats it as "not hidden."
    expect(Boolean(result.sections.experience?.hidden)).toBe(false);
    const node = listToggleNodes(result).find((n) => n.key === "section:experience");
    expect(node?.hidden).toBe(false);
  });
});

describe("applyVisibility — override precedence matrix (section-level)", () => {
  it.each(MATRIX_CASES)("master=$master, override=$override -> hidden=$expected", ({ master, override, expected }) => {
    const cv = makeMasterCv();
    setFlag(cv.sections.experience, master);
    const result = applyVisibility(cv, buildOverrides("section:experience", override));
    expect(Boolean(result.sections.experience?.hidden)).toBe(expected);
  });
});

describe("applyVisibility — override precedence matrix (item-level)", () => {
  it.each(MATRIX_CASES)("master=$master, override=$override -> hidden=$expected", ({ master, override, expected }) => {
    const cv = makeMasterCv();
    const item = cv.sections.experience.items[0];
    setFlag(item, master);
    const result = applyVisibility(cv, buildOverrides(`item:${item.id}`, override));
    const resultItem = result.sections.experience?.items.find((i) => i.id === item.id);
    expect(Boolean(resultItem?.hidden)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 3. Item-level vs section-level hiding — independence in listToggleNodes.
// ---------------------------------------------------------------------------

describe("listToggleNodes — section and item hidden flags are independent", () => {
  const CASES = [
    { label: "hidden section, visible item", sectionHidden: true, itemHidden: false },
    { label: "visible section, hidden item", sectionHidden: false, itemHidden: true },
    { label: "both hidden", sectionHidden: true, itemHidden: true },
    { label: "both visible", sectionHidden: false, itemHidden: false },
  ];
  it.each(CASES)("$label", ({ sectionHidden, itemHidden }) => {
    const cv = makeMasterCv();
    cv.sections.experience.hidden = sectionHidden;
    cv.sections.experience.items[0].hidden = itemHidden;
    const nodes = listToggleNodes(cv);
    const sectionNode = nodes.find((n) => n.key === "section:experience");
    const itemNode = nodes.find((n) => n.key === `item:${cv.sections.experience.items[0].id}`);
    expect(sectionNode?.hidden).toBe(sectionHidden);
    expect(itemNode?.hidden).toBe(itemHidden);
  });
});

// ---------------------------------------------------------------------------
// 4. Immutability — applyVisibility must never mutate the master.
// ---------------------------------------------------------------------------

describe("applyVisibility — immutability", () => {
  it("never mutates the master CV, regardless of how many overrides are applied", () => {
    const master = makeMasterCv();
    const masterSnapshot = structuredClone(master);

    applyVisibility(master, {
      "section:profile": true,
      "section:experience": true,
      "section:profiles": true,
      "item:skill-1": true,
      "section:custom:custom-academic": true,
      "item:acad-1": true,
    });

    expect(master).toEqual(masterSnapshot);
  });
});

// ---------------------------------------------------------------------------
// 5. Multi-profile — two named variants from one master, independently correct.
// ---------------------------------------------------------------------------

describe("applyVisibility — multiple profiles from one master", () => {
  it("two profiles produce independently-correct, structurally valid variants without touching each other or the master", () => {
    const master = makeMasterCv();

    const corporate = applyVisibility(master, { "section:interests": true, "section:profiles": true });
    const startup = applyVisibility(master, { "section:certifications": true });

    expect(corporate.sections.interests?.hidden).toBe(true);
    expect(corporate.sections.profiles?.hidden).toBe(true);
    expect(corporate.sections.certifications?.hidden).toBe(false); // not in this profile's overrides -> falls back to master

    expect(startup.sections.certifications?.hidden).toBe(true);
    expect(startup.sections.interests?.hidden).toBe(false);
    expect(startup.sections.profiles?.hidden).toBe(false);

    // structurally valid: same section keys as the master, nothing dropped or added
    expect(Object.keys(corporate.sections).sort()).toEqual(Object.keys(master.sections).sort());
    expect(Object.keys(startup.sections).sort()).toEqual(Object.keys(master.sections).sort());

    // master itself was never touched by either profile
    expect(master.sections.interests?.hidden).toBe(false);
    expect(master.sections.certifications?.hidden).toBe(false);
    expect(master.sections.profiles?.hidden).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Malformed / unknown input.
// ---------------------------------------------------------------------------

describe("malformed / unknown input", () => {
  it("a section key entirely absent from the data does not throw, and produces no toggle node for it", () => {
    const cv = makeMasterCv();
    delete (cv.sections as Record<string, unknown>).awards;

    expect(() => listToggleNodes(cv)).not.toThrow();
    expect(() => applyVisibility(cv, {})).not.toThrow();

    const nodes = listToggleNodes(cv);
    expect(nodes.find((n) => n.key === "section:awards")).toBeUndefined();
  });

  it("an unrecognized section key present in the data is still picked up generically", () => {
    const cv = makeMasterCv();
    (cv.sections as Record<string, unknown>).volunteering = {
      hidden: true,
      items: [{ id: "vol-1", hidden: false }],
    };

    const nodes = listToggleNodes(cv);
    expect(nodes.find((n) => n.key === "section:volunteering")?.hidden).toBe(true);
    expect(nodes.find((n) => n.key === "item:vol-1")?.hidden).toBe(false);
  });

  it("an override for a nonexistent section/item id is silently ignored, not an error", () => {
    const cv = makeMasterCv();
    expect(() =>
      applyVisibility(cv, { "section:doesNotExist": true, "item:no-such-id": true }),
    ).not.toThrow();

    const result = applyVisibility(cv, { "section:doesNotExist": true, "item:no-such-id": true });
    expect(result).toEqual(cv); // no observable effect anywhere
  });

  it("a null hidden flag is treated as not-hidden, matching the existing Boolean(...) coercion", () => {
    const cv = makeMasterCv();
    (cv.sections.skills as { hidden: unknown }).hidden = null;
    (cv.sections.skills.items[0] as { hidden: unknown }).hidden = null;

    const nodes = listToggleNodes(cv);
    expect(nodes.find((n) => n.key === "section:skills")?.hidden).toBe(false);
    expect(nodes.find((n) => n.key === `item:${cv.sections.skills.items[0].id}`)?.hidden).toBe(false);
  });
});
