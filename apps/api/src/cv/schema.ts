// Lightweight typing for the rxresume-style CV JSON this app reads/writes.
// Only the fields the renderer and visibility engine actually touch are
// typed here — the full rxresume export carries a large `metadata` block
// (template/layout/design/typography) that render_cv.py never used either.

export interface CvItemBase {
  id: string;
  hidden?: boolean;
}

export interface CvSkillItem extends CvItemBase {
  name: string;
  proficiency: string;
  keywords?: string[];
}

export interface CvExperienceItem extends CvItemBase {
  position: string;
  company: string;
  location: string;
  period: string;
  description: string; // trusted rich HTML from the source JSON
}

export interface CvProjectItem extends CvItemBase {
  name: string;
  website?: { label?: string; url?: string };
  description: string;
}

export interface CvEducationItem extends CvItemBase {
  degree: string;
  school: string;
  location: string;
  period: string;
  grade?: string;
}

export interface CvCertificationItem extends CvItemBase {
  title: string;
  issuer: string;
  date?: string;
  description?: string;
}

export interface CvLanguageItem extends CvItemBase {
  language: string;
  fluency: string;
}

export interface CvAwardItem extends CvItemBase {
  title: string;
  awarder: string;
  date: string;
}

export interface CvInterestItem extends CvItemBase {
  name: string;
  keywords?: string[];
}

export interface CvProfileItem extends CvItemBase {
  network: string;
  website?: { label?: string; url?: string };
}

export interface CvSection<T> {
  title?: string;
  hidden?: boolean;
  items: T[];
}

export interface CvCustomItem extends CvItemBase {
  [key: string]: unknown;
}

export interface CvCustomSection {
  id: string;
  title: string;
  hidden?: boolean;
  items: CvCustomItem[];
}

export interface CvBasics {
  name: string;
  headline: string;
  location: string;
  email: string;
  phone: string;
  website?: { label?: string; url?: string };
}

export interface CvSections {
  profiles?: CvSection<CvProfileItem>;
  skills: CvSection<CvSkillItem>;
  experience: CvSection<CvExperienceItem>;
  projects: CvSection<CvProjectItem>;
  education: CvSection<CvEducationItem>;
  certifications: CvSection<CvCertificationItem>;
  languages: CvSection<CvLanguageItem>;
  awards: CvSection<CvAwardItem>;
  interests: CvSection<CvInterestItem>;
  [key: string]: CvSection<CvItemBase> | undefined;
}

export interface CvData {
  basics: CvBasics;
  summary: { content: string; hidden?: boolean };
  sections: CvSections;
  customSections?: CvCustomSection[];
}

export const SECTION_KEYS = [
  "profile",
  "skills",
  "experience",
  "projects",
  "education",
  "certifications",
  "languages",
  "awards",
  "interests",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];
