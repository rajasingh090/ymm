import { db } from "@/db";
import { attendanceRecords, exerciseSets, exercises, workoutSessions } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import { parseSessionInput, ValidationError } from "@/lib/server/validation";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  const id = parseId((await context.params).id);
  if (!id) return Response.json({ error: "That workout could not be found." }, { status: 404 });

  try {
    const input = parseSessionInput(await request.json());
    await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.id, id)).limit(1);
      if (!existing) throw new ValidationError("That workout no longer exists. Refresh your history.");

      await tx.update(workoutSessions).set({
        workoutDate: input.workoutDate,
        startTime: input.startTime,
        endTime: input.endTime,
        durationMinutes: input.durationMinutes,
        workoutType: input.workoutType,
        muscleGroups: input.muscleGroups,
        energy: input.energy,
        notes: input.notes || null,
        updatedAt: new Date().toISOString(),
      }).where(eq(workoutSessions.id, id));

      await tx.delete(exercises).where(eq(exercises.sessionId, id));
      if (input.exercises.length) {
        const createdExercises = await tx.insert(exercises).values(input.exercises.map((exercise, index) => ({
          sessionId: id,
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

      await tx.insert(attendanceRecords).values({ attendanceDate: input.workoutDate, status: "went", reason: null, updatedAt: new Date().toISOString() })
        .onConflictDoUpdate({ target: attendanceRecords.attendanceDate, set: { status: "went", reason: null, updatedAt: new Date().toISOString() } });
    });
    return Response.json({ ok: true, id });
  } catch (error) {
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: error.message.includes("no longer") ? 404 : 400 });
    console.error("GymPulse workout update failed:", error);
    return Response.json({ error: "The workout could not be updated. Please try again." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  const id = parseId((await context.params).id);
  if (!id) return Response.json({ error: "That workout could not be found." }, { status: 404 });
  try {
    const [deleted] = await db.delete(workoutSessions).where(eq(workoutSessions.id, id)).returning({ id: workoutSessions.id });
    if (!deleted) return Response.json({ error: "That workout no longer exists." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("GymPulse workout delete failed:", error);
    return Response.json({ error: "The workout could not be deleted. Please try again." }, { status: 500 });
  }
}
