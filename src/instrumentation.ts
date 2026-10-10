export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSelfPing } = await import("@/lib/self-ping");
    startSelfPing();
  }
}
