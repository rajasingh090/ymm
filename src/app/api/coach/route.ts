import { db } from "@/db";
import { attendanceRecords, exerciseSets, exercises, workoutSessions } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import { indiaToday } from "@/lib/server/validation";
import type { NextRequest } from "next/server";
import { desc, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

function shiftDate(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
function daysBetween(later: string, earlier: string) {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

async function report() {
  const today = indiaToday();
  const [sessions, attendance] = await Promise.all([
    db.select().from(workoutSessions).where((await import("drizzle-orm")).lte(workoutSessions.workoutDate, today)).orderBy(desc(workoutSessions.workoutDate)),
    db.select().from(attendanceRecords),
  ]);
  const sessionIds = sessions.map((session) => session.id);
  const exerciseRows = sessionIds.length ? await db.select().from(exercises).where(inArray(exercises.sessionId, sessionIds)) : [];
  const exerciseIds = exerciseRows.map((exercise) => exercise.id);
  const setRows = exerciseIds.length ? await db.select().from(exerciseSets).where(inArray(exerciseSets.exerciseId, exerciseIds)) : [];
  const exerciseById = new Map(exerciseRows.map((exercise) => [exercise.id, exercise]));

  const groupFrequency = new Map<string, number>();
  const groupLast = new Map<string, string>();
  const periodCounts = (from: string) => sessions.filter((session) => session.workoutDate >= from).length;
  for (const session of sessions) {
    for (const muscle of session.muscleGroups) {
      groupFrequency.set(muscle, (groupFrequency.get(muscle) ?? 0) + 1);
      if (!groupLast.has(muscle) || session.workoutDate > (groupLast.get(muscle) ?? "")) groupLast.set(muscle, session.workoutDate);
    }
  }
  const last7 = sessions.filter((session) => session.workoutDate >= shiftDate(today, -6));
  const last30 = sessions.filter((session) => session.workoutDate >= shiftDate(today, -29));
  const prior30 = sessions.filter((session) => session.workoutDate >= shiftDate(today, -59) && session.workoutDate < shiftDate(today, -29));
  const average = (rows: typeof sessions) => rows.length ? Math.round(rows.reduce((sum, item) => sum + item.durationMinutes, 0) / rows.length) : null;
  const average30 = average(last30);
  const averagePrior30 = average(prior30);
  const visitDates = new Set([
    ...sessions.map((session) => session.workoutDate),
    ...attendance.filter((item) => item.status === "went" && item.attendanceDate <= today).map((item) => item.attendanceDate),
  ]);
  const missedDates = attendance.filter((item) => item.status === "missed" && item.attendanceDate <= today).map((item) => item.attendanceDate);
  const eligible = visitDates.size + missedDates.filter((date) => !visitDates.has(date)).length;
  const attendancePercent = eligible ? Math.round((visitDates.size / eligible) * 100) : null;
  const orderedDates = [...visitDates].sort();
  let currentStreak = 0;
  let streakAnchor = today;
  if (!visitDates.has(streakAnchor)) streakAnchor = shiftDate(today, -1);
  if (visitDates.has(streakAnchor)) {
    currentStreak = 1;
    while (visitDates.has(shiftDate(streakAnchor, -1))) {
      streakAnchor = shiftDate(streakAnchor, -1);
      currentStreak += 1;
    }
  }
  let longestStreak = 0;
  let run = 0;
  let previous = "";
  for (const date of orderedDates) {
    run = previous && daysBetween(date, previous) === 1 ? run + 1 : 1;
    previous = date;
    longestStreak = Math.max(longestStreak, run);
  }

  const insights: string[] = [];
  if (last7.length) insights.push(`You logged ${last7.length} workout session${last7.length === 1 ? "" : "s"} in the last 7 days.`);
  const musclesThisWeek = new Map<string, number>();
  for (const session of last7) for (const muscle of session.muscleGroups) musclesThisWeek.set(muscle, (musclesThisWeek.get(muscle) ?? 0) + 1);
  for (const [muscle, count] of [...musclesThisWeek.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    insights.push(`You trained ${muscle.toLowerCase()} in ${count} session${count === 1 ? "" : "s"} in the last 7 days.`);
  }
  if (average30 !== null && averagePrior30 !== null && last30.length >= 2 && prior30.length >= 2 && average30 !== averagePrior30) {
    const difference = Math.abs(average30 - averagePrior30);
    insights.push(`Your average logged session ${average30 > averagePrior30 ? "increased" : "decreased"} by ${difference} minute${difference === 1 ? "" : "s"} compared with the previous 30 days.`);
  }
  if (sessions.length >= 4 && attendancePercent !== null) insights.push(`Your recorded attendance rate is ${attendancePercent}% (${visitDates.size} attended days out of ${eligible} attended or confirmed-missed days).`);
  if (sessions.length < 3) insights.push("Your analysis is still building. Log a few more sessions to unlock useful trends; unrecorded days are not treated as missed.");

  const groupedExercises = new Map<string, { sets: number; volume: number; topEstimated1Rm: number; topWeight: number; topReps: number }>();
  for (const set of setRows) {
    const exercise = exerciseById.get(set.exerciseId);
    if (!exercise) continue;
    const current = groupedExercises.get(exercise.name.toLowerCase()) ?? { sets: 0, volume: 0, topEstimated1Rm: 0, topWeight: 0, topReps: 0 };
    current.sets += 1;
    current.volume += set.weightKg * set.reps;
    if (set.weightKg > 0 && set.reps <= 15) {
      const estimate = set.weightKg * (1 + set.reps / 30);
      if (estimate > current.topEstimated1Rm) {
        current.topEstimated1Rm = estimate;
        current.topWeight = set.weightKg;
        current.topReps = set.reps;
      }
    }
    groupedExercises.set(exercise.name.toLowerCase(), current);
  }
  const strengthHighlights = [...groupedExercises.entries()].map(([name, value]) => ({
    exercise: name,
    setsLogged: value.sets,
    totalVolumeKg: Math.round(value.volume),
    estimatedOneRepMaxKg: value.topEstimated1Rm ? Math.round(value.topEstimated1Rm * 10) / 10 : null,
    bestSet: value.topEstimated1Rm ? `${value.topWeight} kg × ${value.topReps}` : null,
  })).sort((a, b) => b.totalVolumeKg - a.totalVolumeKg).slice(0, 8);

  const byFrequency = [...groupFrequency.entries()].sort((a, b) => b[1] - a[1]);
  const distributionNote = sessions.length >= 5 && byFrequency.length >= 2
    ? `Across ${sessions.length} logged sessions, ${byFrequency[0][0]} appears most often (${byFrequency[0][1]} sessions) and ${byFrequency[byFrequency.length - 1][0]} least often (${byFrequency[byFrequency.length - 1][1]}). This describes your log only, not a medical or recovery assessment.`
    : null;
  if (distributionNote) insights.push(distributionNote);

  const totalDuration = sessions.reduce((sum, item) => sum + item.durationMinutes, 0);
  const countWithExercises = new Set(exerciseRows.map((item) => item.sessionId)).size;
  const dataQuality = sessions.length >= 20 && countWithExercises >= 10 ? "Strong history" : sessions.length >= 6 ? "Building history" : "Early history";
  return {
    generatedAt: new Date().toISOString(),
    localInsights: insights,
    stats: {
      totalSessions: sessions.length,
      sessionsLast7Days: last7.length,
      sessionsLast30Days: last30.length,
      sessionsPrior30Days: prior30.length,
      averageDurationLast30: average30,
      averageDurationPrior30: averagePrior30,
      totalHours: Math.round(totalDuration / 60 * 10) / 10,
      attendancePercent,
      currentStreak,
      longestStreak,
      missedDays: missedDates.length,
      muscles: [...groupFrequency.entries()].map(([muscle, sessionsCount]) => ({ muscle, sessions: sessionsCount, lastTrained: groupLast.get(muscle) ?? null, daysSince: groupLast.has(muscle) ? daysBetween(today, groupLast.get(muscle)!) : null })),
      strengthHighlights,
    },
    dataQuality,
    aiEnabled: Boolean(process.env.GYMPULSE_AI_API_KEY),
  };
}

export async function GET(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  try {
    return Response.json(await report());
  } catch (error) {
    console.error("GymPulse progress analysis failed:", error);
    return Response.json({ error: "Progress analysis could not be prepared." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  const apiKey = process.env.GYMPULSE_AI_API_KEY;
  if (!apiKey) return Response.json({ aiEnabled: false, aiText: null, message: "Optional AI is not configured. Your local data-based analysis remains available." });
  try {
    const local = await report();
    const model = process.env.GYMPULSE_AI_MODEL || "gpt-4o-mini";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 450,
        messages: [
          { role: "system", content: "You are GymPulse AI, a careful fitness log analyst. Explain patterns only from the supplied aggregate workout statistics. Distinguish a logged trend from a physiological conclusion. Do not give medical or injury advice, claim muscle growth from attendance, or invent data. Be concise, kind, and specific." },
          { role: "user", content: JSON.stringify({ stats: local.stats, deterministicInsights: local.localInsights, dataQuality: local.dataQuality }) },
        ],
      }),
    });
    if (!response.ok) {
      console.warn("GymPulse optional AI provider returned HTTP", response.status);
      return Response.json({ aiEnabled: true, aiText: null, message: "The AI service is temporarily unavailable. Your local data-based analysis is still available." }, { status: 502 });
    }
    const result: unknown = await response.json();
    const text = typeof result === "object" && result !== null && "choices" in result
      ? (result as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content
      : null;
    return Response.json({ aiEnabled: true, aiText: typeof text === "string" ? text.slice(0, 5000) : null, message: typeof text === "string" ? null : "No analysis was returned. Your local insights remain available." });
  } catch (error) {
    console.error("GymPulse optional AI request failed:", error instanceof Error ? error.name : "unknown error");
    return Response.json({ aiEnabled: true, aiText: null, message: "The AI service timed out or is unavailable. Your local data-based analysis is still available." }, { status: 502 });
  }
}
