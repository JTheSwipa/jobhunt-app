// Ported from goodwillhuntingv2/workflow/render_cv.py.
//
// The one behavioral change from the original: every section here checks
// `hidden` (both at the section level and per-item), not just experience
// and projects — see visibility.ts for why. Everything else (the two CSS
// styles, the Chromium-headless PDF step, the section-order mechanism) is a
// direct port.

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CvCustomSection, CvData } from "./schema.js";

const execFileAsync = promisify(execFile);

const DOT = "·"; // middle dot

const STYLE = `
  @page { size: A4; margin: 15mm 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9.9pt; line-height: 1.36; color: #111; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 2px 0; letter-spacing: .5px; }
  .subtitle { font-size: 11pt; margin: 0 0 4px 0; color: #222; }
  .contact { font-size: 9.5pt; color: #333; margin-bottom: 8px; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #999; padding-bottom: 2px; margin: 11px 0 5px 0; }
  .entry { margin-bottom: 6px; }
  .entry-head { font-weight: bold; }
  .entry-sub { color: #333; font-size: 9.6pt; }
  ul { margin: 3px 0 0 0; padding-left: 16px; }
  li { margin-bottom: 2px; }
  p { margin: 4px 0; }
`;

const STYLE_COMPACT = `
  @page { size: A4; margin: 12mm 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9.3pt; line-height: 1.28; color: #111; margin: 0; }
  h1 { font-size: 19pt; margin: 0 0 2px 0; letter-spacing: .5px; text-align: center; }
  .subtitle { font-size: 10.5pt; margin: 0 0 3px 0; color: #222; text-align: center; }
  .contact { font-size: 8.8pt; color: #333; margin-bottom: 6px; text-align: center; }
  h2 {
    display: flex; align-items: center; text-align: center;
    font-size: 10pt; font-weight: bold; letter-spacing: .3px; color: #222;
    margin: 8px 0 4px 0; border-bottom: none;
  }
  h2::before, h2::after { content: ""; flex: 1 1 auto; border-bottom: 1px solid #999; margin: 0 8px; }
  .entry { margin-bottom: 4px; }
  .entry-head { font-weight: bold; }
  .entry-sub { color: #333; font-size: 9pt; font-style: italic; }
  ul { margin: 2px 0 0 0; padding-left: 15px; }
  li { margin-bottom: 1px; }
  p { margin: 3px 0; }
`;

function e(s?: string | null): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rich(s?: string | null): string {
  // Rich-text fields already carry trusted HTML from the source JSON —
  // pass through unescaped, same trust boundary as the Python original.
  return s ?? "";
}

function stripP(s?: string | null): string {
  return (s ?? "").replaceAll("<p>", "").replaceAll("</p>", "");
}

function secProfile(d: CvData): string {
  if (d.summary?.hidden || !d.summary?.content) return "";
  return `<h2>Profile</h2>\n${rich(d.summary.content)}`;
}

function secSkills(d: CvData): string {
  const section = d.sections.skills;
  if (!section || section.hidden) return "";
  const lis = section.items
    .filter((it) => !it.hidden)
    .map((it) => {
      const head = `${e(it.name)} — ${e(it.proficiency)}`;
      const kws = (it.keywords ?? []).map((k) => e(k)).join(", ");
      return kws ? `<li><strong>${head}:</strong> ${kws}</li>` : `<li><strong>${head}</strong></li>`;
    });
  if (!lis.length) return "";
  return `<h2>Technical Skills</h2><ul>\n${lis.join("\n")}\n</ul>`;
}

function secExperience(d: CvData): string {
  const section = d.sections.experience;
  if (!section || section.hidden) return "";
  const items = section.items.filter((it) => !it.hidden);
  if (!items.length) return "";
  const out = ["<h2>Experience</h2>"];
  for (const it of items) {
    out.push('<div class="entry">');
    out.push(`<div class="entry-head">${e(it.position)} — ${e(it.company)}</div>`);
    out.push(`<div class="entry-sub">${e(it.location)} ${DOT} ${e(it.period)}</div>`);
    out.push(rich(it.description));
    out.push("</div>");
  }
  return out.join("\n");
}

function secProjects(d: CvData): string {
  const section = d.sections.projects;
  if (!section || section.hidden) return "";
  const items = section.items.filter((it) => !it.hidden);
  if (!items.length) return "";
  const out = ["<h2>Projects</h2>"];
  for (const it of items) {
    const label = e(it.name);
    const site = it.website?.label;
    const head = site ? `${label} (${e(site)})` : label;
    out.push('<div class="entry">');
    out.push(`<div class="entry-head">${head}</div>`);
    out.push(rich(it.description));
    out.push("</div>");
  }
  return out.join("\n");
}

function secEducation(d: CvData): string {
  const section = d.sections.education;
  if (!section || section.hidden) return "";
  const items = section.items.filter((it) => !it.hidden);
  if (!items.length) return "";
  const out = ["<h2>Education</h2>"];
  for (const it of items) {
    out.push('<div class="entry">');
    out.push(`<div class="entry-head">${e(it.degree)} — ${e(it.school)}</div>`);
    let sub = `${e(it.location)} ${DOT} ${e(it.period)}`;
    if (it.grade) sub += ` ${DOT} ${e(it.grade)}`;
    out.push(`<div class="entry-sub">${sub}</div>`);
    out.push("</div>");
  }
  return out.join("\n");
}

function secCertifications(d: CvData): string {
  const section = d.sections.certifications;
  if (!section || section.hidden) return "";
  const lis = section.items
    .filter((it) => !it.hidden)
    .map((it) => {
      const title = e(it.title);
      const issuer = e(it.issuer);
      const date = e(it.date ?? "");
      const issuerBit = date ? `${issuer} (${date})` : issuer;
      const desc = stripP(rich(it.description));
      let line = `<strong>${title}</strong> — ${issuerBit}`;
      if (desc) line += `: ${desc}`;
      return `<li>${line}</li>`;
    });
  if (!lis.length) return "";
  return `<h2>Certifications</h2><ul>\n${lis.join("\n")}\n</ul>`;
}

function secLanguages(d: CvData): string {
  const section = d.sections.languages;
  if (!section || section.hidden) return "";
  const lis = section.items.filter((it) => !it.hidden).map((it) => `<li>${e(it.language)} — ${e(it.fluency)}</li>`);
  if (!lis.length) return "";
  return `<h2>Languages</h2><ul>\n${lis.join("\n")}\n</ul>`;
}

function secAwards(d: CvData): string {
  const section = d.sections.awards;
  if (!section || section.hidden) return "";
  const items = section.items.filter((it) => !it.hidden);
  if (!items.length) return "";
  const out = ["<h2>Awards</h2>"];
  for (const it of items) {
    out.push('<div class="entry">');
    out.push(`<div class="entry-head">${e(it.title)}</div>`);
    out.push(`<div class="entry-sub">${e(it.awarder)} ${DOT} ${e(it.date)}</div>`);
    out.push("</div>");
  }
  return out.join("\n");
}

function secInterests(d: CvData): string {
  const section = d.sections.interests;
  if (!section || section.hidden) return "";
  const lis = section.items
    .filter((it) => !it.hidden)
    .map((it) => {
      const kws = (it.keywords ?? []).map((k) => e(k)).join(", ");
      return kws ? `<li>${e(it.name)} (${kws})</li>` : `<li>${e(it.name)}</li>`;
    });
  if (!lis.length) return "";
  return `<h2>Interests</h2><ul>\n${lis.join("\n")}\n</ul>`;
}

function findCustom(d: CvData, titleSubstr: string): CvCustomSection | undefined {
  return d.customSections?.find((cs) => cs.title.toLowerCase().includes(titleSubstr.toLowerCase()));
}

function secAcademicTraining(d: CvData): string {
  const cs = findCustom(d, "Academic Training");
  if (!cs || cs.hidden) return "";
  const items = cs.items.filter((it) => !it.hidden);
  if (!items.length) return "";
  const out = [`<h2>${e(cs.title)}</h2>`];
  for (const it of items) {
    out.push('<div class="entry">');
    out.push(`<div class="entry-head">${e(String(it.degree ?? ""))} — ${e(String(it.school ?? ""))}</div>`);
    out.push(`<div class="entry-sub">${e(String(it.location ?? ""))} ${DOT} ${e(String(it.period ?? ""))}</div>`);
    out.push("</div>");
  }
  return out.join("\n");
}

function secConferences(d: CvData): string {
  const cs = findCustom(d, "Conferences");
  if (!cs || cs.hidden) return "";
  const items = cs.items.filter((it) => !it.hidden);
  if (!items.length) return "";
  const out = [`<h2>${e(cs.title)}</h2>`];
  for (const it of items) {
    out.push('<div class="entry">');
    out.push(`<div class="entry-head">${e(String(it.title ?? ""))}</div>`);
    out.push(`<div class="entry-sub">${e(String(it.publisher ?? ""))} ${DOT} ${e(String(it.date ?? ""))}</div>`);
    out.push("</div>");
  }
  return out.join("\n");
}

const SECTIONS: Record<string, (d: CvData) => string> = {
  profile: secProfile,
  skills: secSkills,
  experience: secExperience,
  projects: secProjects,
  education: secEducation,
  certifications: secCertifications,
  languages: secLanguages,
  awards: secAwards,
  academic_training: secAcademicTraining,
  conferences: secConferences,
  interests: secInterests,
};

export const DEFAULT_ORDER = [
  "profile",
  "skills",
  "experience",
  "projects",
  "education",
  "certifications",
  "languages",
  "awards",
  "academic_training",
  "conferences",
  "interests",
];

export interface RenderOptions {
  order?: string[];
  style?: "default" | "compact";
}

export function buildHtml(d: CvData, opts: RenderOptions = {}): string {
  const { basics } = d;
  const contactBits = [basics.location, basics.email, basics.phone, basics.website?.label];
  for (const p of d.sections.profiles?.items ?? []) {
    if (p.network === "LinkedIn" && !p.hidden && p.website?.label) contactBits.push(p.website.label);
  }
  const contact = contactBits
    .filter((b): b is string => Boolean(b))
    .map((b) => e(b))
    .join(` ${DOT} `);

  const style = opts.style ?? "default";
  const name = style === "compact" ? e(basics.name) : e(basics.name).toUpperCase();
  const body = [`<h1>${name}</h1>`, `<p class="subtitle">${e(basics.headline)}</p>`, `<p class="contact">${contact}</p>`];

  const order = opts.order ?? DEFAULT_ORDER;
  for (const key of order) {
    const fn = SECTIONS[key];
    if (!fn) continue;
    const rendered = fn(d);
    if (rendered) body.push(rendered);
  }

  const css = style === "compact" ? STYLE_COMPACT : STYLE;
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">\n' +
    `<title>${e(basics.name)} - CV</title>\n<style>${css}</style>` +
    "</head><body>\n" +
    body.join("\n") +
    "\n</body></html>"
  );
}

export interface RenderResult {
  htmlPath: string;
  pdfPath: string;
}

/**
 * Chromium (snap-confined, same as the Python original) refuses to write
 * outside $HOME — outdir must resolve to a path under $HOME.
 */
export async function renderToPdf(d: CvData, outBasename: string, opts: RenderOptions & { outdir?: string } = {}): Promise<RenderResult> {
  const outdir = opts.outdir ?? path.join(process.env.HOME ?? ".", "jobhunt-cv-output");
  await mkdir(outdir, { recursive: true });

  const htmlDoc = buildHtml(d, opts);
  const htmlPath = path.join(outdir, `${outBasename}.html`);
  const pdfPath = path.join(outdir, `${outBasename}.pdf`);
  await writeFile(htmlPath, htmlDoc, "utf-8");

  const chromiumBin = process.env.CHROMIUM_BIN ?? "chromium";
  await execFileAsync(chromiumBin, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, htmlPath]);

  return { htmlPath, pdfPath };
}
