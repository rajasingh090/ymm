/* GymPulse AI - dashboard charts + insight */
(function () {
  "use strict";
  if (document.body.dataset.page !== "home") return;

  async function load() {
    try {
      const data = await GP.api("/api/charts?range=90d");
      const weeks = data.weeks.slice(-12);
      const sessions = data.weekly_sessions.slice(-12);
      if (weeks.length) {
        GPCharts.bar("dash-weekly", weeks.map((w) => w.slice(5)), sessions, "Sessions");
      } else {
        GPCharts.empty("dash-weekly", "No sessions logged yet");
      }

      if (data.muscle_labels.length) {
        GPCharts.doughnut("dash-muscles", data.muscle_labels, data.muscle_values);
      } else {
        GPCharts.empty("dash-muscles", "No muscle groups recorded yet");
      }

      if (data.months.length) {
        GPCharts.line("dash-monthly", data.months, data.monthly_pct, "Attendance %");
      } else {
        GPCharts.empty("dash-monthly", "No attendance data yet");
      }
    } catch (e) {
      GP.toast(e.message, true);
    }

    try {
      const res = await GP.api("/api/ai/analyze", { method: "POST", body: "{}" });
      const box = document.getElementById("dash-insight");
      const first = res.insights && res.insights[0];
      box.innerHTML = res.ai.used_ai && res.ai.text
        ? "<p>" + GP.escape(res.ai.text.slice(0, 420)) + "</p>"
        : (first ? "<b>" + GP.escape(first.title) + "</b><p class='muted small'>" + GP.escape(first.body) + "</p>"
                 : "<p class='muted small'>No data yet.</p>");
      box.innerHTML += "<p class='muted small'>Source: " + GP.escape(res.source) + "</p>";
    } catch (e) {
      document.getElementById("dash-insight").innerHTML =
        "<p class='muted small'>Insight unavailable right now.</p>";
    }
  }

  if (window.Chart) load();
  else window.addEventListener("load", load);
})();
