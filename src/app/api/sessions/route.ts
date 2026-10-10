import { db } from "@/db";
import { attendanceRecords, exerciseSets, exercises, workoutSessions } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import { parseSessionInput, ValidationError } from "@/lib/server/validation";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function readPayload(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("The workout form could not be read. Please try again.");
  }
}

export async function POST(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;

  try {
    const input = parseSessionInput(await readPayload(request));
    const saved = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(workoutSessions)
        .values({
          requestId: input.requestId,
          workoutDate: input.workoutDate,
          startTime: input.startTime,
          endTime: input.endTime,
          durationMinutes: input.durationMinutes,
          workoutType: input.workoutType,
          muscleGroups: input.muscleGroups,
          energy: input.energy,
          notes: input.notes || null,
        })
        .onConflictDoNothing({ target: workoutSessions.requestId })
        .returning();

      if (!inserted) {
        const [existing] = await tx.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.requestId, input.requestId)).limit(1);
        return { id: existing?.id ?? null, duplicate: true };
      }

      if (input.exercises.length) {
        const createdExercises = await tx.insert(exercises).values(input.exercises.map((exercise, index) => ({
          sessionId: inserted.id,
          name: exercise.name,
          sortOrder: index,
        }))).returning({ id: exercises.id });
        const sets = input.exercises.flatMap((exercise, index) => exercise.sets.map((set, setIndex) => ({
          exerciseId: createdExercises[index].id,
          setNumber: setIndex + 1,
          reps: set.reps,
          weightKg: set.weightKg,
          restSeconds: set.restSeconds,
        })));
        if (sets.length) await tx.insert(exerciseSets).values(sets);
      }

      await tx.insert(attendanceRecords).values({
        attendanceDate: input.workoutDate,
        status: "went",
        reason: null,
        updatedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: attendanceRecords.attendanceDate,
        set: { status: "went", reason: null, updatedAt: new Date().toISOString() },
      });
      return { id: inserted.id, duplicate: false };
    });

    if (!saved.id) return Response.json({ error: "This save could not be confirmed. Refresh and check your history." }, { status: 500 });
    return Response.json({ ok: true, id: saved.id, duplicate: saved.duplicate }, { status: saved.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
    console.error("GymPulse workout create failed:", error);
    return Response.json({ error: "The workout was not saved. Please check your database connection and try again." }, { status: 500 });
  }
}
