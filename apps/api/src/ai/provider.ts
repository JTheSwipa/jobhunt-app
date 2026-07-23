import type { CvData } from "../cv/schema.js";
import type { ToggleNode } from "../cv/visibility.js";

export interface TailoringSuggestion {
  key: string; // matches a ToggleNode.key (section:x / item:x)
  label: string;
  suggestedHidden: boolean;
  reason: string;
}

export interface TailoringInput {
  cv: CvData;
  toggleNodes: ToggleNode[];
  targetRole: string;
}

export interface TailoringProvider {
  id: string;
  suggest(input: TailoringInput): Promise<TailoringSuggestion[]>;
}
