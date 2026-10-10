export type Muscle = "Biceps" | "Triceps" | "Legs" | "Shoulders" | "Chest" | "Back" | "Forearms";
export type AttendanceStatus = "went" | "missed" | "rest";

export type WorkoutSet = {
  id: number;
  exerciseId: number;
  setNumber: number;
  reps: number;
  weightKg: number;
  restSeconds: number | null;
};

export type WorkoutExercise = {
  id: number;
  sessionId: number;
  name: string;
  sortOrder: number;
  sets: WorkoutSet[];
};

export type WorkoutSession = {
  id: number;
  requestId: string;
  workoutDate: string;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number;
  workoutType: string;
  muscleGroups: string[];
  energy: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  exercises: WorkoutExercise[];
};

export type AttendanceRecord = {
  attendanceDate: string;
  status: AttendanceStatus;
  reason: string | null;
  updatedAt: string;
};

export type GymGoals = {
  id?: number;
  weeklySessions: number;
  monthlyAttendancePercent: number;
  monthlyHours: number;
};

export type Measurement = {
  id: number;
  measuredOn: string;
  weightKg: number | null;
  waistCm: number | null;
  chestCm: number | null;
  armsCm: number | null;
  hipsCm: number | null;
  thighsCm: number | null;
  notes: string | null;
};

export type CustomSplit = {
  id: number;
  name: string;
  muscleGroups: string[];
};

export type GymData = {
  sessions: WorkoutSession[];
  attendance: AttendanceRecord[];
  goals: GymGoals;
  measurements: Measurement[];
  splits: CustomSplit[];
  settings: Record<string, string>;
};

export type CalendarDay = {
  date: string;
  masa: string;
  masaIndex: number;
  isAdhika: boolean;
  paksha: string;
  tithi: number;
  tithiName: string;
  samvat?: unknown;
};

export type CalendarResponse = {
  mode: "gregorian" | "lunar";
  calendarType: "amanta" | "purnimanta";
  location: { latitude: number; longitude: number; label: string };
  monthLabel: string;
  monthStart?: string;
  monthEnd?: string;
  days: CalendarDay[];
};
