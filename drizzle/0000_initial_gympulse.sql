CREATE TABLE "app_settings" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"attendance_date" date NOT NULL,
	"status" varchar(16) NOT NULL,
	"reason" varchar(500),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_attendance_date_pk" PRIMARY KEY("attendance_date")
);
--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"measured_on" date NOT NULL,
	"weight_kg" real,
	"waist_cm" real,
	"chest_cm" real,
	"arms_cm" real,
	"hips_cm" real,
	"thighs_cm" real,
	"notes" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_splits" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"muscle_groups" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"exercise_id" integer NOT NULL,
	"set_number" integer NOT NULL,
	"reps" integer NOT NULL,
	"weight_kg" real DEFAULT 0 NOT NULL,
	"rest_seconds" integer
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"weekly_sessions" integer DEFAULT 4 NOT NULL,
	"monthly_attendance_percent" integer DEFAULT 75 NOT NULL,
	"monthly_hours" real DEFAULT 12 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" varchar(80) NOT NULL,
	"workout_date" date NOT NULL,
	"start_time" varchar(5),
	"end_time" varchar(5),
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"workout_type" varchar(80) DEFAULT 'Strength training' NOT NULL,
	"muscle_groups" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"energy" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "body_measurements_measured_on_idx" ON "body_measurements" USING btree ("measured_on");--> statement-breakpoint
CREATE INDEX "exercise_sets_exercise_id_idx" ON "exercise_sets" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "exercises_session_id_idx" ON "exercises" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_sessions_request_id_uidx" ON "workout_sessions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_workout_date_idx" ON "workout_sessions" USING btree ("workout_date");