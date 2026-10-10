/* GymPulse AI - progress charts, measurements, export / restore */
(function () {
  "use strict";
  if (document.body.dataset.page !== "progress") return;

  let range = "30d";

  function query() {
    if (range !== "custom") return "range=" + range;
    return "range=custom&start=" + (document.getElementById("r-start").value || "") +
           "&end=" + (document.getElementById("r-end").value || "");
  }

  async function load() {
    try {
      const d = await GP.api("/api/charts?" + query());
      document.getElementById("range-info").textContent =
        d.start + " → " + d.end + " · " + d.session_count + " sessions";

      d.weeks.length ? GPCharts.bar("c-weekly", d.weeks.map((w) => w.slice(5)), d.weekly_sessions, "Sessions")
                     : GPCharts.empty("c-weekly");
      d.months.length ? GPCharts.line("c-monthly", d.months, d.monthly_pct, "Attendance %", GPCharts.colors.LIME)
                      : GPCharts.empty("c-monthly");
      d.days.length ? GPCharts.line("c-duration", d.days.map((x) => x.slice(5)), d.duration, "Minutes")
                    : GPCharts.empty("c-duration");
      d.muscle_labels.length ? GPCharts.bar("c-muscles", d.muscle_labels, d.muscle_values, "Sessions", GPCharts.colors.BLUE)
                             : GPCharts.empty("c-muscles");
      d.volume_labels.length ? GPCharts.bar("c-volume", d.volume_labels.map((w) => w.slice(5)), d.volume_values, "Volume", GPCharts.colors.LIME)
                             : GPCharts.empty("c-volume", "Log sets, reps and weight to see volume");
      d.strength.length ? GPCharts.multiLine("c-strength", d.strength)
                        : GPCharts.empty("c-strength", "No weighted exercises in this range");
    } catch (e) { GP.toast(e.message, true); }

    try {
      const m = await GP.api("/api/muscles");
      document.getElementById("muscle-table").innerHTML = "<ul class='kv'>" + m.muscles.map((mu) => {
        const since = m.days_since[mu];
        return "<li><span>" + GP.escape(mu) + "</span><b>" +
          (m.counts["30d"][mu] || 0) + "× / 30d · " +
          (since === null || since === undefined ? "never" : since + "d ago") + "</b></li>";
      }).join("") + "</ul>";
    } catch (e) { /* ignore */ }
  }

  async function loadMeasurements() {
    try {
      const data = await GP.api("/api/measurements");
      const box = document.getElementById("measure-list");
      box.innerHTML = data.measurements.length ? data.measurements.map((m) =>
        "<div class='list-item' style='cursor:default'><div class='grow'><b>" + m.date + "</b>" +
        "<span class='muted small'>" + [
          m.body_weight ? m.body_weight + " kg" : null, m.chest ? "chest " + m.chest : null,
          m.waist ? "waist " + m.waist : null, m.arms ? "arms " + m.arms : null,
          m.thighs ? "thighs " + m.thighs : null
        ].filter(Boolean).join(" · ") + "</span></div>" +
        "<button class='btn ghost m-del' data-id='" + m.id + "'>✕</button></div>").join("")
        : "<p class='muted small'>No measurements recorded. These are optional but they are the only honest way to track physical change.</p>";
      box.querySelectorAll(".m-del").forEach((b) => b.addEventListener("click", async () => {
        await GP.api("/api/measurements/" + b.dataset.id, { method: "DELETE" });
        GP.toast("Measurement deleted"); loadMeasurements();
      }));
    } catch (e) { /* ignore */ }
  }

  document.querySelectorAll("#range-picker .seg").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#range-picker .seg").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    range = b.dataset.value;
    document.getElementById("custom-range").hidden = range !== "custom";
    load();
  }));
  ["r-start", "r-end"].forEach((id) => document.getElementById(id).addEventListener("change", load));

  document.getElementById("measure-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      date: document.getElementById("m-date").value,
      body_weight: document.getElementById("m-weight").value,
      chest: document.getElementById("m-chest").value,
      waist: document.getElementById("m-waist").value,
      arms: document.getElementById("m-arms").value,
      thighs: document.getElementById("m-thighs").value
    };
    try {
      await GP.api("/api/measurements", { method: "POST", body: JSON.stringify(payload) });
      GP.toast("Measurement saved");
      e.target.reset();
      document.getElementById("m-date").value = GP.today;
      loadMeasurements();
    } catch (err) { GP.toast(err.message, true); }
  });

  document.getElementById("restore-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm("Restoring replaces all current records with the backup. Continue?")) { e.target.value = ""; return; }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      parsed.replace = true;
      const res = await GP.api("/api/restore", { method: "POST", body: JSON.stringify(parsed) });
      GP.toast("Restored " + res.imported_sessions + " sessions");
      load(); loadMeasurements();
    } catch (err) { GP.toast("Restore failed: " + err.message, true); }
    e.target.value = "";
  });

  document.getElementById("m-date").value = GP.today;
  document.addEventListener("gympulse:changed", () => { load(); });

  if (window.Chart) { load(); } else { window.addEventListener("load", load); }
  loadMeasurements();
})();
