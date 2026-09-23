export const REGISTRANT_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "waitlisted",
  "cancelled",
] as const;

export type RegistrantStatus = (typeof REGISTRANT_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ["email", "line", "both"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
