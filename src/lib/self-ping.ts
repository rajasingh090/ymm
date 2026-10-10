import {
  ENABLE_SELF_PING,
  SELF_PING_INTERVAL_SECONDS,
  SELF_PING_TIMEOUT_SECONDS,
  SELF_PING_URL,
} from "@/lib/config";

type PingRuntime = typeof globalThis & {
  __gymPulsePingTimer?: ReturnType<typeof setInterval>;
  __gymPulsePingInFlight?: boolean;
};

function healthEndpoint(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /YOUR-APP|your-app|example\.com|placeholder|\.invalid/i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname.endsWith("/api/health")) return parsed.toString();
    if (parsed.pathname.endsWith("/health")) parsed.pathname = `${parsed.pathname.slice(0, -7)}/api/health`;
    else parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/api/health`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function startSelfPing() {
  if (!ENABLE_SELF_PING) return;
  const runtime = globalThis as PingRuntime;
  if (runtime.__gymPulsePingTimer) return;

  const endpoint = healthEndpoint(SELF_PING_URL);
  if (!endpoint) {
    console.warn("[GymPulse AI] Self-ping is enabled but SELF_PING_URL is empty, invalid, or still a placeholder. Monitoring remains disabled.");
    return;
  }

  const intervalSeconds = Math.max(300, Math.floor(SELF_PING_INTERVAL_SECONDS));
  const timeoutSeconds = Math.max(1, Math.min(30, Math.floor(SELF_PING_TIMEOUT_SECONDS)));
  let successCount = 0;
  let lastFailureLog = 0;
  const ping = async () => {
    if (runtime.__gymPulsePingInFlight) return;
    runtime.__gymPulsePingInFlight = true;
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
        headers: { "user-agent": "GymPulse-AI-health-monitor/1.0" },
      });
      if (!response.ok) throw new Error(`health endpoint returned HTTP ${response.status}`);
      successCount += 1;
      if (successCount === 1 || successCount % 30 === 0) console.info(`[GymPulse AI] Health check succeeded (${successCount} checks).`);
    } catch (error) {
      const now = Date.now();
      if (now - lastFailureLog >= intervalSeconds * 1000) {
        const message = error instanceof Error ? error.message : "network request failed";
        console.warn(`[GymPulse AI] Health check failed; it will retry on schedule: ${message}`);
        lastFailureLog = now;
      }
    } finally {
      runtime.__gymPulsePingInFlight = false;
    }
  };

  runtime.__gymPulsePingTimer = setInterval(() => void ping(), intervalSeconds * 1000);
  runtime.__gymPulsePingTimer.unref?.();
  const stop = () => {
    if (runtime.__gymPulsePingTimer) clearInterval(runtime.__gymPulsePingTimer);
    runtime.__gymPulsePingTimer = undefined;
    runtime.__gymPulsePingInFlight = false;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.info(`[GymPulse AI] Health monitoring configured for ${endpoint} every ${intervalSeconds}s. This is monitoring only; it does not guarantee always-on hosting.`);
}
