export const MUSCLE_GROUPS = ["Biceps", "Triceps", "Legs", "Shoulders", "Chest", "Back", "Forearms"] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];
export type AttendanceStatus = "went" | "missed" | "rest";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function indiaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function cleanText(value: unknown, maxLength: number, label: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ValidationError(`${label} must be text.`);
  const result = value.trim();
  if (result.length > maxLength) throw new ValidationError(`${label} must be ${maxLength} characters or fewer.`);
  return result;
}

function parseTime(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new ValidationError(`${label} must use 24-hour HH:MM time.`);
  }
  return value;
}

function parseNonNegative(value: unknown, label: string, max: number, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) throw new ValidationError(`${label} must be between 0 and ${max}.`);
  return parsed;
}

export type ExerciseInput = {
  name: string;
  sets: { reps: number; weightKg: number; restSeconds: number | null }[];
};

export type SessionInput = {
  requestId: string;
  workoutDate: string;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number;
  workoutType: string;
  muscleGroups: MuscleGroup[];
  energy: number | null;
  notes: string;
  exercises: ExerciseInput[];
};

export function parseSessionInput(body: unknown): SessionInput {
  if (!isRecord(body)) throw new ValidationError("The workout details are missing.");
  const workoutDate = body.workoutDate;
  if (!isValidDate(workoutDate)) throw new ValidationError("Choose a valid workout date.");
  if (workoutDate > indiaToday()) throw new ValidationError("Completed workouts cannot be logged in the future.");

  const musclesValue = body.muscleGroups;
  if (!Array.isArray(musclesValue)) throw new ValidationError("Choose at least one muscle group.");
  const muscleGroups = [...new Set(musclesValue.filter((value): value is MuscleGroup => typeof value === "string" && MUSCLE_GROUPS.includes(value as MuscleGroup)))];
  if (muscleGroups.length === 0 || muscleGroups.length !== new Set(musclesValue).size) {
    throw new ValidationError("Choose one or more valid muscle groups.");
  }

  const startTime = parseTime(body.startTime, "Start time");
  const endTime = parseTime(body.endTime, "End time");
  let durationMinutes: number;
  if (startTime && endTime) {
    const [startHour, startMinute] = startTime.split(":").map(Number);
    const [endHour, endMinute] = endTime.split(":").map(Number);
    const start = startHour * 60 + startMinute;
    let finish = endHour * 60 + endMinute;
    if (finish <= start) finish += 24 * 60;
    durationMinutes = finish - start;
    if (durationMinutes <= 0 || durationMinutes > 24 * 60) throw new ValidationError("Workout duration must be between 1 minute and 24 hours.");
  } else {
    const manual = parseNonNegative(body.durationMinutes, "Duration", 1440, 0);
    durationMinutes = Math.round(manual);
  }

  const energyValue = body.energy === undefined || body.energy === null || body.energy === "" ? null : Number(body.energy);
  if (energyValue !== null && (!Number.isInteger(energyValue) || energyValue < 1 || energyValue > 5)) {
    throw new ValidationError("Energy level must be from 1 to 5.");
  }

  const requestId = cleanText(body.requestId, 80, "Request ID") || crypto.randomUUID();
  if (!/^[\w-]+$/.test(requestId)) throw new ValidationError("Invalid save token. Please try again.");

  const exercisesRaw = body.exercises ?? [];
  if (!Array.isArray(exercisesRaw) || exercisesRaw.length > 40) throw new ValidationError("Add no more than 40 exercises to a session.");
  const exercises = exercisesRaw.map((exercise, index) => {
    if (!isRecord(exercise)) throw new ValidationError(`Exercise ${index + 1} is invalid.`);
    const name = cleanText(exercise.name, 120, `Exercise ${index + 1}`);
    if (!name) throw new ValidationError(`Give exercise ${index + 1} a name.`);
    const setsRaw = exercise.sets ?? [];
    if (!Array.isArray(setsRaw) || setsRaw.length > 20) throw new ValidationError(`${name} can have up to 20 sets.`);
    const sets = setsRaw.map((set, setIndex) => {
      if (!isRecord(set)) throw new ValidationError(`Set ${setIndex + 1} for ${name} is invalid.`);
      const reps = parseNonNegative(set.reps, "Repetitions", 1000, 0);
      const weightKg = parseNonNegative(set.weightKg, "Weight", 2000, 0);
      const rest = set.restSeconds === undefined || set.restSeconds === null || set.restSeconds === "" ? null : parseNonNegative(set.restSeconds, "Rest time", 3600, 0);
      if (!Number.isInteger(reps) || reps < 1) throw new ValidationError(`Repetitions for ${name} must be at least 1.`);
      return { reps, weightKg: Math.round(weightKg * 100) / 100, restSeconds: rest === null ? null : Math.round(rest) };
    });
    return { name, sets };
  });

  return {
    requestId,
    workoutDate,
    startTime,
    endTime,
    durationMinutes,
    workoutType: cleanText(body.workoutType || "Strength training", 80, "Workout type") || "Strength training",
    muscleGroups,
    energy: energyValue,
    notes: cleanText(body.notes, 2000, "Notes"),
    exercises,
  };
}

export function parseAttendanceInput(body: unknown) {
  if (!isRecord(body) || !isValidDate(body.date)) throw new ValidationError("Choose a valid attendance date.");
  if (body.status !== "went" && body.status !== "missed" && body.status !== "rest" && body.status !== "clear") {
    throw new ValidationError("Choose went, missed, planned rest, or clear the date.");
  }
  if (body.date > indiaToday() && body.status !== "rest" && body.status !== "clear") {
    throw new ValidationError("Future dates can only be marked as planned rest or left unrecorded.");
  }
  return { date: body.date, status: body.status as AttendanceStatus | "clear", reason: cleanText(body.reason, 500, "Reason") };
}
