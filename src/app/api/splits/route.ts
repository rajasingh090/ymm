import { db } from "@/db";
import { customSplits } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import { MUSCLE_GROUPS, cleanText, isRecord, ValidationError } from "@/lib/server/validation";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new ValidationError("Enter a split name and choose muscle groups.");
    const name = cleanText(body.name, 80, "Split name");
    if (!name) throw new ValidationError("Enter a name for this split.");
    if (!Array.isArray(body.muscleGroups)) throw new ValidationError("Choose one or more muscle groups.");
    const muscleGroups = [...new Set(body.muscleGroups.filter((muscle): muscle is (typeof MUSCLE_GROUPS)[number] => typeof muscle === "string" && MUSCLE_GROUPS.includes(muscle as (typeof MUSCLE_GROUPS)[number])))];
    if (!muscleGroups.length) throw new ValidationError("Choose one or more valid muscle groups.");
    const [split] = await db.insert(customSplits).values({ name, muscleGroups }).returning();
    return Response.json({ ok: true, split }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
    console.error("GymPulse split save failed:", error);
    return Response.json({ error: "This workout split could not be saved. A split with that name may already exist." }, { status: 500 });
  }
}
