import { db } from "@/db";
import { attendanceRecords, exerciseSets, exercises, goals, bodyMeasurements, customSplits, workoutSessions } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import type { NextRequest } from "next/server";
import { asc, desc, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function exportData() {
  const [sessions, attendance, goalRows, measurements, splits] = await Promise.all([
    db.select().from(workoutSessions).orderBy(desc(workoutSessions.workoutDate), desc(workoutSessions.id)),
    db.select().from(attendanceRecords).orderBy(asc(attendanceRecords.attendanceDate)),
    db.select().from(goals).limit(1),
    db.select().from(bodyMeasurements).orderBy(desc(bodyMeasurements.measuredOn)),
    db.select().from(customSplits).orderBy(asc(customSplits.name)),
  ]);
  const sessionIds = sessions.map((item) => item.id);
  const exerciseRows = sessionIds.length ? await db.select().from(exercises).where(inArray(exercises.sessionId, sessionIds)).orderBy(asc(exercises.sortOrder)) : [];
  const exerciseIds = exerciseRows.map((item) => item.id);
  const setRows = exerciseIds.length ? await db.select().from(exerciseSets).where(inArray(exerciseSets.exerciseId, exerciseIds)).orderBy(asc(exerciseSets.setNumber)) : [];
  const setsByExercise = new Map<number, typeof setRows>();
  for (const set of setRows) setsByExercise.set(set.exerciseId, [...(setsByExercise.get(set.exerciseId) ?? []), set]);
  const exercisesBySession = new Map<number, (typeof exerciseRows[number] & { sets: typeof setRows })[]>();
  for (const exercise of exerciseRows) exercisesBySession.set(exercise.sessionId, [...(exercisesBySession.get(exercise.sessionId) ?? []), { ...exercise, sets: setsByExercise.get(exercise.id) ?? [] }]);
  return {
    version: 1,
    application: "GymPulse AI",
    exportedAt: new Date().toISOString(),
    sessions: sessions.map((session) => ({ ...session, exercises: exercisesBySession.get(session.id) ?? [] })),
    attendance,
    goals: goalRows[0] ?? { weeklySessions: 4, monthlyAttendancePercent: 75, monthlyHours: 12 },
    measurements,
    splits,
  };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("; ") : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  try {
    const data = await exportData();
    if (request.nextUrl.searchParams.get("format") !== "csv") {
      return new Response(JSON.stringify(data, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="gympulse-backup-${new Date().toISOString().slice(0, 10)}.json"`,
          "cache-control": "no-store",
        },
      });
    }
    const rows: unknown[][] = [["date", "session_id", "attendance", "muscles", "duration_minutes", "workout_type", "start_time", "end_time", "exercise", "set", "reps", "weight_kg", "energy_1_to_5", "notes"]];
    const statusByDate = new Map(data.attendance.map((item) => [item.attendanceDate, item.status]));
    for (const session of data.sessions) {
      const exercisesForSession = session.exercises.length ? session.exercises : [{ id: 0, sessionId: session.id, name: "", sortOrder: 0, sets: [] }];
      for (const exercise of exercisesForSession) {
        const sets = exercise.sets.length ? exercise.sets : [{ id: 0, exerciseId: exercise.id, setNumber: 0, reps: 0, weightKg: 0, restSeconds: null }];
        for (const set of sets) rows.push([
          session.workoutDate, session.id, statusByDate.get(session.workoutDate) ?? "went", session.muscleGroups,
          session.durationMinutes, session.workoutType, session.startTime, session.endTime, exercise.name,
          set.setNumber || "", set.reps || "", set.weightKg || "", session.energy, session.notes,
        ]);
      }
    }
    for (const item of data.attendance) {
      if (!data.sessions.some((session) => session.workoutDate === item.attendanceDate)) rows.push([item.attendanceDate, "", item.status, "", "", "", "", "", "", "", "", "", "", item.reason]);
    }
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    return new Response(`\uFEFF${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="gympulse-history-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("GymPulse export failed:", error);
    return Response.json({ error: "Your gym history could not be exported." }, { status: 500 });
  }
}
