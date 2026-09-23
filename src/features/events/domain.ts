export const EVENT_TYPES = ["internal", "external", "mixed"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = ["draft", "published", "closed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const ORGANIZER_ROLES = ["full", "checkin_only"] as const;
export type OrganizerRole = (typeof ORGANIZER_ROLES)[number];

export type ConditionalRule = {
  field: string;
  operator: "equals" | "in" | "includes";
  value: string | string[];
};

export type RegistrationField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "email" | "tel" | "date" | "select" | "checkbox" | "file";
  required: boolean;
  options?: string[];
  acceptedFileTypes?: string[];
  maxFileSizeMb?: number;
  conditional?: ConditionalRule;
};
