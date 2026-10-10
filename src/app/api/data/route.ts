import { db } from "@/db";
import { attendanceRecords, bodyMeasurements, customSplits, exerciseSets, exercises, goals, workoutSessions } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import { NextRequest } from "next/server";
import { asc, desc, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;

  try {
    const [sessionRows, attendance, goalRows, measurements, splits, settingsRows] = await Promise.all([
      db.select().from(workoutSessions).orderBy(desc(workoutSessions.workoutDate), desc(workoutSessions.id)),
      db.select().from(attendanceRecords).orderBy(asc(attendanceRecords.attendanceDate)),
      db.select().from(goals).limit(1),
      db.select().from(bodyMeasurements).orderBy(desc(bodyMeasurements.measuredOn), desc(bodyMeasurements.id)),
      db.select().from(customSplits).orderBy(asc(customSplits.name)),
      db.select().from((await import("@/db/schema")).appSettings),
    ]);

    const sessionIds = sessionRows.map((session) => session.id);
    const exerciseRows = sessionIds.length
      ? await db.select().from(exercises).where(inArray(exercises.sessionId, sessionIds)).orderBy(asc(exercises.sortOrder), asc(exercises.id))
      : [];
    const exerciseIds = exerciseRows.map((exercise) => exercise.id);
    const setRows = exerciseIds.length
      ? await db.select().from(exerciseSets).where(inArray(exerciseSets.exerciseId, exerciseIds)).orderBy(asc(exerciseSets.setNumber), asc(exerciseSets.id))
      : [];

    const setsByExercise = new Map<number, typeof setRows>();
    for (const set of setRows) setsByExercise.set(set.exerciseId, [...(setsByExercise.get(set.exerciseId) ?? []), set]);
    const exercisesBySession = new Map<number, (typeof exerciseRows[number] & { sets: typeof setRows })[]>();
    for (const exercise of exerciseRows) {
      exercisesBySession.set(exercise.sessionId, [
        ...(exercisesBySession.get(exercise.sessionId) ?? []),
        { ...exercise, sets: setsByExercise.get(exercise.id) ?? [] },
      ]);
    }

    return Response.json({
      sessions: sessionRows.map((session) => ({ ...session, exercises: exercisesBySession.get(session.id) ?? [] })),
      attendance,
      goals: goalRows[0] ?? { weeklySessions: 4, monthlyAttendancePercent: 75, monthlyHours: 12 },
      measurements,
      splits,
      settings: Object.fromEntries(settingsRows.map((item) => [item.key, item.value])),
    });
  } catch (error) {
    console.error("GymPulse data load failed:", error);
    return Response.json({ error: "We couldn't load your gym records. Check the database setup and try again." }, { status: 500 });
  }
}
