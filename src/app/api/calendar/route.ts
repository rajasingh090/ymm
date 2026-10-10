import { getPanchangam, Observer, tithiNames } from "@ishubhamx/panchangam-js";
import { requireGymPulseAuth } from "@/lib/server/auth";
import { isValidDate } from "@/lib/server/validation";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_LOCATION = { latitude: 28.6139, longitude: 77.209, elevation: 216 };
type CalendarType = "amanta" | "purnimanta";

function shiftDate(date: string, amount: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function panchangFor(date: string, observer: InstanceType<typeof Observer>, calendarType: CalendarType) {
  const result = getPanchangam(new Date(`${date}T12:00:00+05:30`), observer, {
    timezoneOffset: 330,
    calendarType,
  });
  const masa = result.masa as { index: number; name: string; isAdhika?: boolean };
  const tithiIndex = Number(result.tithi);
  return {
    date,
    masa: masa.name,
    masaIndex: masa.index,
    isAdhika: Boolean(masa.isAdhika),
    paksha: String(result.paksha),
    tithi: tithiIndex,
    tithiName: Array.isArray(tithiNames) && tithiIndex > 0 ? String(tithiNames[tithiIndex - 1] ?? `Tithi ${tithiIndex}`) : `Tithi ${tithiIndex}`,
    samvat: result.samvat,
  };
}

export async function GET(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;

  const search = request.nextUrl.searchParams;
  const date = search.get("date");
  if (!isValidDate(date)) return Response.json({ error: "Choose a valid calendar date." }, { status: 400 });
  const convention = search.get("calendarType") === "amanta" ? "amanta" : "purnimanta";
  const latitude = Number(search.get("latitude") ?? DEFAULT_LOCATION.latitude);
  const longitude = Number(search.get("longitude") ?? DEFAULT_LOCATION.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return Response.json({ error: "The calendar location must be valid latitude and longitude." }, { status: 400 });
  }
  const observer = new Observer(latitude, longitude, latitude === DEFAULT_LOCATION.latitude && longitude === DEFAULT_LOCATION.longitude ? DEFAULT_LOCATION.elevation : 0);
  const mode = search.get("mode") === "lunar" ? "lunar" : "gregorian";

  try {
    if (mode === "gregorian") {
      const from = search.get("from") ?? date;
      const to = search.get("to") ?? date;
      if (!isValidDate(from) || !isValidDate(to) || from > to) return Response.json({ error: "Choose a valid calendar range." }, { status: 400 });
      const length = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
      if (length > 45) return Response.json({ error: "Calendar ranges are limited to 45 days." }, { status: 400 });
      const days = Array.from({ length }, (_, index) => panchangFor(shiftDate(from, index), observer, convention));
      const center = panchangFor(date, observer, convention);
      return Response.json({
        mode,
        calendarType: convention,
        location: { latitude, longitude, label: latitude === DEFAULT_LOCATION.latitude && longitude === DEFAULT_LOCATION.longitude ? "Delhi, India" : "Custom location" },
        monthLabel: `${center.masa}${center.isAdhika ? " (Adhika)" : ""}`,
        days,
      });
    }

    const center = panchangFor(date, observer, convention);
    const monthKey = `${center.masa}:${center.isAdhika}`;
    let monthStart = date;
    let monthEnd = date;
    for (let step = 1; step <= 36; step += 1) {
      const candidate = shiftDate(date, -step);
      const point = panchangFor(candidate, observer, convention);
      if (`${point.masa}:${point.isAdhika}` !== monthKey) break;
      monthStart = candidate;
    }
    for (let step = 1; step <= 36; step += 1) {
      const candidate = shiftDate(date, step);
      const point = panchangFor(candidate, observer, convention);
      if (`${point.masa}:${point.isAdhika}` !== monthKey) break;
      monthEnd = candidate;
    }
    const monthLength = Math.round((Date.parse(`${monthEnd}T00:00:00Z`) - Date.parse(`${monthStart}T00:00:00Z`)) / 86_400_000) + 1;
    if (monthLength > 36) return Response.json({ error: "The lunar month could not be resolved for this date." }, { status: 422 });
    const days = Array.from({ length: monthLength }, (_, index) => panchangFor(shiftDate(monthStart, index), observer, convention));
    return Response.json({
      mode,
      calendarType: convention,
      location: { latitude, longitude, label: latitude === DEFAULT_LOCATION.latitude && longitude === DEFAULT_LOCATION.longitude ? "Delhi, India" : "Custom location" },
      monthLabel: `${center.isAdhika ? "Adhika " : ""}${center.masa}`,
      monthStart,
      monthEnd,
      days,
    });
  } catch (error) {
    console.error("GymPulse Panchang calculation failed:", error);
    return Response.json({ error: "The Hindu lunar date could not be calculated. Try another date or calendar convention." }, { status: 500 });
  }
}
