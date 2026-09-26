import { cookies } from "next/headers";

export const STATION_COOKIE = "checkin-station";
export const cleanStation = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 40) : "";

/** The station (check-in point) this device is set to, kept in a cookie so every check-in path records it. */
export async function currentStation() {
  return cleanStation((await cookies()).get(STATION_COOKIE)?.value) || null;
}
