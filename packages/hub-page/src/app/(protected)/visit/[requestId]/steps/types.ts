// Shared types for the visit-card contribution flow's step components
// (hardening spec P2: "large client components... split behind tested
// domain interfaces"). VisitCardFlow.tsx owns all state and handlers; these
// types are the interface each step presents to it.
export type ExperienceOption = { id: string; inputLabel: string; publicLabel: string };
export type NegativeReasonOption = { id: string; label: string };

export type TemplateSnapshot = {
  recommendation_prompt: string;
  negative_reason_options: NegativeReasonOption[];
  party_size_prompt: string;
  item_prompt: string;
  recommendation_item_prompt: string;
  experience_prompt: string | null;
  experience_options: ExperienceOption[];
  max_experience_options: number;
  photo_prompt: string;
  photo_safety_guidance: string;
};

export type Item = { clientItemKey: string; rawLabel: string; isRecommended: boolean };

export type Step =
  | "intro"
  | "recommend"
  | "negativeReason"
  | "partySize"
  | "items"
  | "recommendItems"
  | "experienceTags"
  | "review"
  | "photos"
  | "success";

export type PhotoUpload = {
  localId: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  photoId?: string;
  error?: string;
};

export function interpolate(template: string, merchantName: string): string {
  return template.replace(/\{\{merchantName\}\}/g, merchantName);
}
