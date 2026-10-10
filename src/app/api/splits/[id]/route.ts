import { db } from "@/db";
import { customSplits } from "@/db/schema";
import { requireGymPulseAuth } from "@/lib/server/auth";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const denied = requireGymPulseAuth(request);
  if (denied) return denied;
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "Split not found." }, { status: 404 });
  try {
    const [deleted] = await db.delete(customSplits).where(eq(customSplits.id, id)).returning({ id: customSplits.id });
    if (!deleted) return Response.json({ error: "Split not found." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("GymPulse split delete failed:", error);
    return Response.json({ error: "This split could not be deleted." }, { status: 500 });
  }
}
