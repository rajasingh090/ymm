import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: serial("id").primaryKey(),
    requestId: varchar("request_id", { length: 80 }).notNull(),
    workoutDate: date("workout_date", { mode: "string" }).notNull(),
    startTime: varchar("start_time", { length: 5 }),
    endTime: varchar("end_time", { length: 5 }),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    workoutType: varchar("workout_type", { length: 80 }).notNull().default("Strength training"),
    muscleGroups: text("muscle_groups").array().notNull().default(sql`ARRAY[]::text[]`),
    energy: integer("energy"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workout_sessions_request_id_uidx").on(table.requestId),
    index("workout_sessions_workout_date_idx").on(table.workoutDate),
  ],
);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    attendanceDate: date("attendance_date", { mode: "string" }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    reason: varchar("reason", { length: 500 }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.attendanceDate] })],
);

export const exercises = pgTable(
  "exercises",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => workoutSessions.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("exercises_session_id_idx").on(table.sessionId)],
);

export const exerciseSets = pgTable(
  "exercise_sets",
  {
    id: serial("id").primaryKey(),
    exerciseId: integer("exercise_id").notNull().references(() => exercises.id, { onDelete: "cascade" }),
    setNumber: integer("set_number").notNull(),
    reps: integer("reps").notNull(),
    weightKg: real("weight_kg").notNull().default(0),
    restSeconds: integer("rest_seconds"),
  },
  (table) => [index("exercise_sets_exercise_id_idx").on(table.exerciseId)],
);

export const goals = pgTable("goals", {
  id: integer("id").primaryKey().default(1),
  weeklySessions: integer("weekly_sessions").notNull().default(4),
  monthlyAttendancePercent: integer("monthly_attendance_percent").notNull().default(75),
  monthlyHours: real("monthly_hours").notNull().default(12),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const bodyMeasurements = pgTable(
  "body_measurements",
  {
    id: serial("id").primaryKey(),
    measuredOn: date("measured_on", { mode: "string" }).notNull(),
    weightKg: real("weight_kg"),
    waistCm: real("waist_cm"),
    chestCm: real("chest_cm"),
    armsCm: real("arms_cm"),
    hipsCm: real("hips_cm"),
    thighsCm: real("thighs_cm"),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [index("body_measurements_measured_on_idx").on(table.measuredOn)],
);

export const customSplits = pgTable("custom_splits", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  muscleGroups: text("muscle_groups").array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 80 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
