import { db } from "@/db";
import { goals } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import { isRecord, ValidationError } from "@/lib/server/validation";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new ValidationError("Enter your goals to save.");
    const weeklySessions = Number(body.weeklySessions);
    const monthlyAttendancePercent = Number(body.monthlyAttendancePercent);
    const monthlyHours = Number(body.monthlyHours);
    if (!Number.isInteger(weeklySessions) || weeklySessions < 1 || weeklySessions > 21) throw new ValidationError("Weekly session goal must be from 1 to 21.");
    if (!Number.isInteger(monthlyAttendancePercent) || monthlyAttendancePercent < 1 || monthlyAttendancePercent > 100) throw new ValidationError("Attendance goal must be from 1 to 100%.");
    if (!Number.isFinite(monthlyHours) || monthlyHours < 1 || monthlyHours > 300) throw new ValidationError("Monthly hours goal must be between 1 and 300.");
    const values = { weeklySessions, monthlyAttendancePercent, monthlyHours, updatedAt: new Date().toISOString() };
    await db.insert(goals).values({ id: 1, ...values }).onConflictDoUpdate({ target: goals.id, set: values });
    return Response.json({ ok: true, goals: values });
  } catch (error) {
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
    console.error("GymPulse goal update failed:", error);
    return Response.json({ error: "Your goals could not be saved." }, { status: 500 });
  }
}
