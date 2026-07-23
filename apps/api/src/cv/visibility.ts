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
