# GymPulse database migrations

Use `npx drizzle-kit migrate` to apply the checked-in SQL migrations in order. The application schema is defined in `../src/db/schema.ts`. Generate reviewed migrations with `npx drizzle-kit generate --name=change_name`; do not run `drizzle-kit push --force` against production workout data.
