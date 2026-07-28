// The "hidden flag actually works everywhere" engine (plan Feature 1).
//
// render_cv.py's rxresume schema already carries a `hidden` boolean on every
// section and every item, but the original Python renderer only respected
// it for 2 of 11 sections (experience, projects). This module makes it
// respected everywhere, and adds a second layer on top: a CvProfile's
// `visibility` map, which *overrides* the master CV's own hidden flags
// without mutating the master — so the same master CV can produce a
// "Corporate" render and a "Startup" render with different sections/items
// shown, purely by swapping which overrides get applied at render time.
//
// Override keys:
//   "section:<key>"        -> hidden boolean for a top-level section
//   "section:custom:<id>"  -> hidden boolean for a customSections entry
//   "item:<itemId>"        -> hidden boolean for any item (ids are unique
//                              across the whole document in the rxresume
//                              export format, so no section prefix needed)

import { DEFAULT_ORDER } from "./render.js";
import type { CvCustomSection, CvData, CvSection } from "./schema.js";

export type VisibilityMap = Record<string, boolean>;

export interface ToggleNode {
  key: string;
  kind: "section" | "item";
  sectionKey: string;
  sectionLabel: string;
  itemLabel?: string;
  hidden: boolean;
}

function itemLabel(sectionKey: string, item: Record<string, unknown>): string {
  switch (sectionKey) {
    case "experience":
      return `${item.position ?? ""} — ${item.company ?? ""}`;
    case "projects":
      return String(item.name ?? "");
    case "education":
      return `${item.degree ?? ""} — ${item.school ?? ""}`;
    case "certifications":
      return String(item.title ?? "");
    case "skills":
      return String(item.name ?? "");
    case "languages":
      return String(item.language ?? "");
    case "awards":
      return String(item.title ?? "");
    case "interests":
      return String(item.name ?? "");
    default:
      return String(item.title ?? item.name ?? item.id ?? "");
  }
}

/** Flattens a master CV into the list of things a checkbox UI can toggle. */
export function listToggleNodes(data: CvData): ToggleNode[] {
  const nodes: ToggleNode[] = [];

  nodes.push({
    key: "section:profile",
    kind: "section",
    sectionKey: "profile",
    sectionLabel: "Profile",
    hidden: Boolean(data.summary?.hidden),
  });

  for (const [key, section] of Object.entries(data.sections)) {
    if (!section) continue;
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    nodes.push({
      key: `section:${key}`,
      kind: "section",
      sectionKey: key,
      sectionLabel: label,
      hidden: Boolean(section.hidden),
    });
    for (const item of section.items as Array<Record<string, unknown> & { id: string; hidden?: boolean }>) {
      nodes.push({
        key: `item:${item.id}`,
        kind: "item",
        sectionKey: key,
        sectionLabel: label,
        itemLabel: itemLabel(key, item),
        hidden: Boolean(item.hidden),
      });
    }
  }

  for (const cs of data.customSections ?? []) {
    nodes.push({
      key: `section:custom:${cs.id}`,
      kind: "section",
      sectionKey: `custom:${cs.id}`,
      sectionLabel: cs.title,
      hidden: Boolean(cs.hidden),
    });
    for (const item of cs.items) {
      nodes.push({
        key: `item:${item.id}`,
        kind: "item",
        sectionKey: `custom:${cs.id}`,
        sectionLabel: cs.title,
        itemLabel: String(item.title ?? item.degree ?? item.name ?? item.id),
        hidden: Boolean(item.hidden),
      });
    }
  }

  return nodes;
}

/**
 * Override keys in `overrides` that match nothing in `data`.
 *
 * This exists because applyVisibility FAILS OPEN by design (see the
 * "silently ignored, not an error" test): an override whose target id no longer
 * exists has no effect, so an item you believed you had hidden renders anyway.
 * That is the dangerous direction to fail for a tool whose job is "do not put
 * this in front of this company", and it happens for real whenever item ids
 * change on a re-export from Reactive Resume.
 *
 * Deliberately a SEPARATE function rather than an extra field on
 * applyVisibility's return value: applyVisibility returns CvData, every one of
 * its tests consumes it as CvData, and cv.ts assigns it straight into
 * `resolved.data`. Widening that return type would break all of them to add
 * a diagnostic none of them asked for.
 *
 * The valid-key set is listToggleNodes' keys UNION every renderable section key.
 * Both halves are needed. listToggleNodes handles the two special shapes
 * ("section:profile", which is special-cased onto summary.hidden, and
 * "section:custom:<id>", which lives in customSections) but it iterates
 * data.sections and so emits nothing for a section that is absent from the CV
 * JSON entirely. A CV with six empty sections may well be exported without
 * them, and "section:awards" against such an export is not a stale id.
 * Suppressing that case is safe: if the section isn't in the data, nothing
 * renders for it, so there is no fail-open exposure — which is the only thing
 * this check exists to catch.
 */
export function findOrphans(data: CvData, overrides: VisibilityMap): string[] {
  const valid = new Set(listToggleNodes(data).map((n) => n.key));
  for (const sectionKey of DEFAULT_ORDER) valid.add(`section:${sectionKey}`);
  return Object.keys(overrides)
    .filter((key) => !valid.has(key))
    .sort();
}

/**
 * Returns a deep-cloned copy of `data` with `overrides` applied on top of
 * whatever hidden flags the master CV already carries. The master itself is
 * never mutated — this is what lets one master produce many named variants.
 */
export function applyVisibility(data: CvData, overrides: VisibilityMap): CvData {
  const clone: CvData = structuredClone(data);

  if ("section:profile" in overrides) {
    clone.summary.hidden = overrides["section:profile"];
  }

  for (const [key, section] of Object.entries(clone.sections)) {
    if (!section) continue;
    const sectionOverrideKey = `section:${key}`;
    if (sectionOverrideKey in overrides) {
      (section as CvSection<{ id: string; hidden?: boolean }>).hidden = overrides[sectionOverrideKey];
    }
    for (const item of section.items as Array<{ id: string; hidden?: boolean }>) {
      const itemOverrideKey = `item:${item.id}`;
      if (itemOverrideKey in overrides) {
        item.hidden = overrides[itemOverrideKey];
      }
    }
  }

  for (const cs of clone.customSections ?? ([] as CvCustomSection[])) {
    const sectionOverrideKey = `section:custom:${cs.id}`;
    if (sectionOverrideKey in overrides) {
      cs.hidden = overrides[sectionOverrideKey];
    }
    for (const item of cs.items) {
      const itemOverrideKey = `item:${item.id}`;
      if (itemOverrideKey in overrides) {
        item.hidden = overrides[itemOverrideKey];
      }
    }
  }

  return clone;
}
