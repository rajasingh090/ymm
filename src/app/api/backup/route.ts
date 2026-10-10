import { db } from "@/db";
import { appSettings, attendanceRecords, bodyMeasurements, customSplits, exerciseSets, exercises, goals, workoutSessions } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import { parseSessionInput, isRecord, ValidationError, cleanText, isValidDate, indiaToday } from "@/lib/server/validation";
import type { NextRequest } from "next/server";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

async function snapshot() {
  const [sessions, attendance, goalRows, measurements, splits, settings] = await Promise.all([
    db.select().from(workoutSessions).orderBy(desc(workoutSessions.workoutDate), desc(workoutSessions.id)),
    db.select().from(attendanceRecords).orderBy(asc(attendanceRecords.attendanceDate)),
    db.select().from(goals).limit(1),
    db.select().from(bodyMeasurements).orderBy(desc(bodyMeasurements.measuredOn)),
    db.select().from(customSplits).orderBy(asc(customSplits.name)),
    db.select().from(appSettings),
  ]);
  const ids = sessions.map((item) => item.id);
  const exerciseRows = ids.length ? await db.select().from(exercises).where(inArray(exercises.sessionId, ids)) : [];
  const exerciseIds = exerciseRows.map((item) => item.id);
  const setRows = exerciseIds.length ? await db.select().from(exerciseSets).where(inArray(exerciseSets.exerciseId, exerciseIds)) : [];
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
    settings: Object.fromEntries(settings.map((entry) => [entry.key, entry.value])),
  };
}

export async function GET(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  try {
    return new Response(JSON.stringify(await snapshot(), null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="gympulse-backup-${indiaToday()}.json"`, "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("GymPulse backup failed:", error);
    return Response.json({ error: "Your backup could not be created." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  try {
    const payload: unknown = await request.json();
    if (!isRecord(payload) || payload.application !== "GymPulse AI" || payload.version !== 1 || !Array.isArray(payload.sessions) || !Array.isArray(payload.attendance)) {
      throw new ValidationError("This file is not a supported GymPulse AI backup.");
    }
    const sessionsToRestore: unknown[] = Array.isArray(payload.sessions) ? payload.sessions : [];
    const attendanceToRestore: unknown[] = Array.isArray(payload.attendance) ? payload.attendance : [];
    if (sessionsToRestore.length > 10_000 || attendanceToRestore.length > 20_000) throw new ValidationError("This backup is larger than the supported import limit.");
    const restored = await db.transaction(async (tx) => {
      let addedSessions = 0;
      let addedAttendance = 0;
      for (const raw of sessionsToRestore) {
        if (!isRecord(raw)) throw new ValidationError("A workout in this backup is invalid.");
        const exercisesRaw = Array.isArray(raw.exercises) ? raw.exercises : [];
        const parsed = parseSessionInput({
          ...raw,
          requestId: typeof raw.requestId === "string" ? raw.requestId : `restore-${randomUUID()}`,
          exercises: exercisesRaw.map((exercise) => {
            if (!isRecord(exercise)) throw new ValidationError("An exercise in this backup is invalid.");
            return { name: exercise.name, sets: Array.isArray(exercise.sets) ? exercise.sets.map((set) => isRecord(set) ? ({ reps: set.reps, weightKg: set.weightKg, restSeconds: set.restSeconds }) : set) : [] };
          }),
        });
        const [inserted] = await tx.insert(workoutSessions).values({
          requestId: parsed.requestId,
          workoutDate: parsed.workoutDate,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          durationMinutes: parsed.durationMinutes,
          workoutType: parsed.workoutType,
          muscleGroups: parsed.muscleGroups,
          energy: parsed.energy,
          notes: parsed.notes || null,
        }).onConflictDoNothing({ target: workoutSessions.requestId }).returning();
        if (!inserted) continue;
        addedSessions += 1;
        if (parsed.exercises.length) {
          const createdExercises = await tx.insert(exercises).values(parsed.exercises.map((exercise, index) => ({ sessionId: inserted.id, name: exercise.name, sortOrder: index }))).returning({ id: exercises.id });
          const sets = parsed.exercises.flatMap((exercise, index) => exercise.sets.map((set, setIndex) => ({ exerciseId: createdExercises[index].id, setNumber: setIndex + 1, reps: set.reps, weightKg: set.weightKg, restSeconds: set.restSeconds })));
          if (sets.length) await tx.insert(exerciseSets).values(sets);
        }
        await tx.insert(attendanceRecords).values({ attendanceDate: parsed.workoutDate, status: "went", reason: null }).onConflictDoUpdate({ target: attendanceRecords.attendanceDate, set: { status: "went", reason: null, updatedAt: new Date().toISOString() } });
      }
      for (const raw of attendanceToRestore) {
        if (!isRecord(raw) || !isValidDate(raw.attendanceDate) || !["went", "missed", "rest"].includes(String(raw.status))) continue;
        if (raw.attendanceDate > indiaToday() && raw.status !== "rest") continue;
        const [existingSession] = await tx.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.workoutDate, raw.attendanceDate)).limit(1);
        const status = existingSession ? "went" : String(raw.status);
        await tx.insert(attendanceRecords).values({ attendanceDate: raw.attendanceDate, status, reason: cleanText(raw.reason, 500, "Reason") || null })
          .onConflictDoNothing({ target: attendanceRecords.attendanceDate });
        addedAttendance += 1;
      }
      if (isRecord(payload.goals)) {
        const weeklySessions = Number(payload.goals.weeklySessions);
        const monthlyAttendancePercent = Number(payload.goals.monthlyAttendancePercent);
        const monthlyHours = Number(payload.goals.monthlyHours);
        if (Number.isInteger(weeklySessions) && weeklySessions >= 1 && weeklySessions <= 21 && Number.isInteger(monthlyAttendancePercent) && monthlyAttendancePercent >= 1 && monthlyAttendancePercent <= 100 && Number.isFinite(monthlyHours) && monthlyHours >= 1 && monthlyHours <= 300) {
          await tx.insert(goals).values({ id: 1, weeklySessions, monthlyAttendancePercent, monthlyHours }).onConflictDoNothing({ target: goals.id });
        }
      }
      if (Array.isArray(payload.measurements)) {
        for (const item of payload.measurements.slice(0, 5000)) {
          if (!isRecord(item) || !isValidDate(item.measuredOn) || item.measuredOn > indiaToday()) continue;
          const keys = ["weightKg", "waistCm", "chestCm", "armsCm", "hipsCm", "thighsCm"] as const;
          const values: Record<(typeof keys)[number], number | null> = { weightKg: null, waistCm: null, chestCm: null, armsCm: null, hipsCm: null, thighsCm: null };
          for (const key of keys) {
            const value = item[key] === null || item[key] === undefined ? null : Number(item[key]);
            if (value !== null && (!Number.isFinite(value) || value <= 0 || value > 1000)) throw new ValidationError("A body measurement in this backup is invalid.");
            values[key] = value;
          }
          const [same] = await tx.select({ id: bodyMeasurements.id }).from(bodyMeasurements).where(eq(bodyMeasurements.measuredOn, item.measuredOn)).limit(1);
          if (!same && Object.values(values).some((value) => value !== null)) await tx.insert(bodyMeasurements).values({ measuredOn: item.measuredOn, ...values, notes: typeof item.notes === "string" ? item.notes.slice(0, 500) : null });
        }
      }
      if (Array.isArray(payload.splits)) {
        const known = new Set((await tx.select({ name: customSplits.name }).from(customSplits)).map((item) => item.name.toLowerCase()));
        for (const item of payload.splits.slice(0, 100)) {
          if (!isRecord(item) || typeof item.name !== "string" || !Array.isArray(item.muscleGroups)) continue;
          const name = cleanText(item.name, 80, "Split name");
          const muscles = item.muscleGroups.filter((value): value is string => typeof value === "string" && ["Biceps", "Triceps", "Legs", "Shoulders", "Chest", "Back", "Forearms"].includes(value));
          if (name && muscles.length && !known.has(name.toLowerCase())) {
            await tx.insert(customSplits).values({ name, muscleGroups: [...new Set(muscles)] });
            known.add(name.toLowerCase());
          }
        }
      }
      if (isRecord(payload.settings)) {
        for (const key of ["calendarConvention", "latitude", "longitude"]) {
          const value = payload.settings[key];
          if (typeof value !== "string") continue;
          await tx.insert(appSettings).values({ key, value: value.slice(0, 100) }).onConflictDoNothing({ target: appSettings.key });
        }
      }
      return { addedSessions, addedAttendance };
    });
    return Response.json({ ok: true, ...restored, message: "Backup merged. Existing workout save tokens were not duplicated." });
  } catch (error) {
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
    console.error("GymPulse backup restore failed:", error);
    return Response.json({ error: "Backup restore could not be completed. No partial transaction was committed." }, { status: 500 });
  }
}
