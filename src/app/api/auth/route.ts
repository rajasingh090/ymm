import { authStatus, login, logout } from "@/lib/server/auth";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return authStatus(request);
}

export async function POST(request: NextRequest) {
  return login(request);
}

export async function DELETE() {
  return logout();
}
