import type { AttendanceRecord, WorkoutSession } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export async function apiJSON<T = Record<string, unknown>>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : "Something went wrong. Please try again.";
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export function indiaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function daysBetween(later: string, earlier: string) {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

export function dayOfWeek(date: string) {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

export function formatDate(date: string, options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-IN", { ...options, timeZone: "Asia/Kolkata" }).format(new Date(`${date}T12:00:00+05:30`));
}

export function shortDate(date: string) {
  return formatDate(date, { weekday: "short", month: "short", day: "numeric" });
}

export function attendanceStatusForDate(date: string, sessions: WorkoutSession[], attendance: AttendanceRecord[]) {
  if (sessions.some((session) => session.workoutDate === date)) return "went";
  return attendance.find((record) => record.attendanceDate === date)?.status ?? "unrecorded";
}

export function getSessionDurationPreview(startTime: string, endTime: string, manual: string) {
  if (startTime && endTime) {
    const [startHour, startMin] = startTime.split(":").map(Number);
    const [endHour, endMin] = endTime.split(":").map(Number);
    const start = startHour * 60 + startMin;
    let finish = endHour * 60 + endMin;
    if (finish <= start) finish += 1440;
    return Math.min(1440, finish - start);
  }
  const parsed = Number(manual);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(1440, Math.round(parsed)) : 0;
}
