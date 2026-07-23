// The "hidden flag actually works everywhere" engine (plan Feature 1).
//
// render_cv.py's rxresume schema already carries a `hidden` boolean on every
// section and every item, but the original Python renderer only respected
// it for 2 of 11 sections (experience, projects). This module makes it
// respected everywhere: `listToggleNodes` flattens a CV into every
// section/item that can be toggled, the shape a checkbox editor UI needs.

import type { CvData } from "./schema.js";

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
