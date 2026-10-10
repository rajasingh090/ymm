import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import { isRecord, ValidationError } from "@/lib/server/validation";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const keys = ["calendarConvention", "latitude", "longitude"] as const;

export async function PUT(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new ValidationError("Enter valid settings to save.");
    const calendarConvention = body.calendarConvention;
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (calendarConvention !== "amanta" && calendarConvention !== "purnimanta") throw new ValidationError("Choose Amanta or Purnimanta calendar convention.");
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new ValidationError("Latitude must be between -90 and 90.");
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new ValidationError("Longitude must be between -180 and 180.");
    const values: Record<(typeof keys)[number], string> = {
      calendarConvention,
      latitude: String(Math.round(latitude * 1_000_000) / 1_000_000),
      longitude: String(Math.round(longitude * 1_000_000) / 1_000_000),
    };
    for (const key of keys) {
      await db.insert(appSettings).values({ key, value: values[key], updatedAt: new Date().toISOString() })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: values[key], updatedAt: new Date().toISOString() } });
    }
    return Response.json({ ok: true, settings: values });
  } catch (error) {
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
    console.error("GymPulse settings update failed:", error);
    return Response.json({ error: "Settings could not be saved." }, { status: 500 });
  }
}
