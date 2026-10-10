import { db } from "@/db";
import { attendanceRecords, workoutSessions } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import { isValidDate, isRecord, indiaToday, cleanText, ValidationError } from "@/lib/server/validation";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;

  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || !isValidDate(body.date)) throw new ValidationError("Choose a valid attendance date.");
    const status = body.status;
    if (status !== "went" && status !== "missed" && status !== "rest" && status !== "clear") {
      throw new ValidationError("Choose went, missed, planned rest, or clear the date.");
    }
    if (body.date > indiaToday() && status !== "rest" && status !== "clear") {
      throw new ValidationError("Future dates can only be marked as planned rest or left unrecorded.");
    }
    const reason = cleanText(body.reason, 500, "Reason");
    const [session] = await db.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.workoutDate, body.date)).limit(1);
    if (session && status !== "went" && status !== "clear") {
      throw new ValidationError("This date already has a completed workout. Edit or remove its sessions before changing attendance.");
    }
    if (status === "clear") {
      await db.delete(attendanceRecords).where(and(eq(attendanceRecords.attendanceDate, body.date), session ? eq(attendanceRecords.status, "went") : undefined));
      return Response.json({ ok: true, status: session ? "went" : "unrecorded" });
    }
    await db.insert(attendanceRecords).values({
      attendanceDate: body.date,
      status,
      reason: reason || null,
      updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: attendanceRecords.attendanceDate,
      set: { status, reason: reason || null, updatedAt: new Date().toISOString() },
    });
    return Response.json({ ok: true, status });
  } catch (error) {
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
    console.error("GymPulse attendance update failed:", error);
    return Response.json({ error: "Attendance could not be updated. Please try again." }, { status: 500 });
  }
}
