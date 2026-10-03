/** Reads a `?page=` value; anything that is not a positive whole number means page 1. */
export function readPage(value: unknown) {
  return typeof value === "string" && /^\d{1,6}$/.test(value) ? Math.max(1, Number(value)) : 1;
}

export type PageWindow = { current: number; pageCount: number; skip: number; take: number; from: number; to: number; total: number };

/**
 * Turns a requested page into query bounds. A page past the end (stale link, or rows deleted meanwhile) falls back
 * to the last page instead of showing an empty list.
 */
export function pageWindow(page: number, pageSize: number, total: number): PageWindow {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const skip = (current - 1) * pageSize;
  return { current, pageCount, skip, take: pageSize, from: total ? skip + 1 : 0, to: Math.min(total, skip + pageSize), total };
}
