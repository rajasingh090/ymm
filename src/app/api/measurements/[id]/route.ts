import { db } from "@/db";
import { bodyMeasurements } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "Measurement not found." }, { status: 404 });
  try {
    const [deleted] = await db.delete(bodyMeasurements).where(eq(bodyMeasurements.id, id)).returning({ id: bodyMeasurements.id });
    if (!deleted) return Response.json({ error: "Measurement not found." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("GymPulse measurement delete failed:", error);
    return Response.json({ error: "Measurement could not be deleted." }, { status: 500 });
  }
}
