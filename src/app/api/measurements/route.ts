import { db } from "@/db";
import { bodyMeasurements } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import { cleanText, indiaToday, isRecord, isValidDate, ValidationError } from "@/lib/server/validation";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const fields = ["weightKg", "waistCm", "chestCm", "armsCm", "hipsCm", "thighsCm"] as const;

export async function POST(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || !isValidDate(body.measuredOn)) throw new ValidationError("Choose a valid measurement date.");
    if (body.measuredOn > indiaToday()) throw new ValidationError("Measurements cannot be dated in the future.");
    const values: Record<(typeof fields)[number], number | null> = {
      weightKg: null, waistCm: null, chestCm: null, armsCm: null, hipsCm: null, thighsCm: null,
    };
    for (const field of fields) {
      const raw = body[field];
      if (raw === undefined || raw === null || raw === "") continue;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) throw new ValidationError(`${field.replace(/([A-Z])/g, " $1")} must be between 0 and 1000.`);
      values[field] = Math.round(parsed * 100) / 100;
    }
    if (Object.values(values).every((value) => value === null)) throw new ValidationError("Enter at least one body measurement.");
    const [saved] = await db.insert(bodyMeasurements).values({
      measuredOn: body.measuredOn,
      ...values,
      notes: cleanText(body.notes, 500, "Notes") || null,
    }).returning();
    return Response.json({ ok: true, measurement: saved }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
    console.error("GymPulse measurement save failed:", error);
    return Response.json({ error: "This measurement could not be saved." }, { status: 500 });
  }
}
