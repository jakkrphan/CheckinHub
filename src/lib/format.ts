// Event days are stored as @db.Date (midnight UTC), so they are formatted in UTC to avoid shifting the calendar day.
// Instants (check-ins, audit, deadlines, session times) are shown in Asia/Bangkok.
const dayLong = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayWeekday = new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayNumber = new Intl.DateTimeFormat("th-TH", { day: "numeric", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("th-TH", { month: "short", year: "numeric", timeZone: "UTC" });
const monthOnly = new Intl.DateTimeFormat("th-TH", { month: "short", timeZone: "UTC" });
const time = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
const dateTime = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
const bangkokDay = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });

export const formatEventDay = (date: Date) => dayLong.format(date);
export const formatEventDayWithWeekday = (date: Date) => dayWeekday.format(date);
export const formatTime = (date: Date) => time.format(date);
export const formatDateTime = (date: Date) => dateTime.format(date);
export const formatDeadlineDay = (date: Date) => bangkokDay.format(date);
export const formatDayNumber = (date: Date) => dayNumber.format(date);
export const formatMonth = (date: Date) => monthOnly.format(date);

export function formatTimeRange(start: Date | null, end: Date | null) {
  if (!start && !end) return null;
  return [start && formatTime(start), end && formatTime(end)].filter(Boolean).join("–");
}

/** Compact list of event days, grouping consecutive days by month: "15, 19, 20 ต.ค. 2569 · 3 พ.ย. 2569". */
export function formatEventDayList(dates: Date[]) {
  const groups = new Map<string, Date[]>();
  for (const date of [...dates].sort((a, b) => a.getTime() - b.getTime())) {
    const key = monthYear.format(date);
    groups.set(key, [...(groups.get(key) ?? []), date]);
  }
  return [...groups.entries()].map(([month, days]) => `${days.map((date) => dayNumber.format(date)).join(", ")} ${month}`).join(" · ");
}
