/* GymPulse AI - settings page */
(function () {
  "use strict";
  if (document.body.dataset.page !== "settings") return;

  let splits = [];
  try { splits = JSON.parse(GP.settings.custom_splits || "[]"); } catch (e) { splits = []; }

  function renderSplits() {
    const box = document.getElementById("splits-list");
    box.innerHTML = splits.length ? splits.map((s, i) =>
      "<div class='list-item' style='cursor:default'><div class='grow'><b>" + GP.escape(s.name) + "</b>" +
      "<span class='muted small'>" + GP.escape((s.muscles || []).join(", ")) + "</span></div>" +
      "<button class='btn ghost sp-del' data-i='" + i + "'>✕</button></div>").join("")
      : "<p class='muted small'>No custom splits yet. You are never forced into a fixed weekly schedule.</p>";
    box.querySelectorAll(".sp-del").forEach((b) => b.addEventListener("click", () => {
      splits.splice(parseInt(b.dataset.i, 10), 1); renderSplits();
    }));
  }

  document.getElementById("add-split").addEventListener("click", () => {
    const name = document.getElementById("split-name").value.trim();
    const muscles = document.getElementById("split-muscles").value.split(",")
      .map((m) => m.trim()).filter(Boolean);
    if (!name || !muscles.length) { GP.toast("Enter a split name and muscles", true); return; }
    splits.push({ name: name, muscles: muscles });
    document.getElementById("split-name").value = "";
    document.getElementById("split-muscles").value = "";
    renderSplits();
  });

  document.getElementById("save-settings").addEventListener("click", async () => {
    try {
      await GP.api("/api/settings", { method: "POST", body: JSON.stringify({
        weekly_goal: document.getElementById("s-weekly").value,
        monthly_goal: document.getElementById("s-monthly").value,
        calendar_system: document.getElementById("s-calendar").value,
        hindu_convention: document.getElementById("s-convention").value,
        weight_unit: document.getElementById("s-unit").value,
        custom_splits: JSON.stringify(splits)
      }) });
      GP.toast("Settings saved");
      setTimeout(() => location.reload(), 600);
    } catch (e) { GP.toast(e.message, true); }
  });

  (async function quality() {
    try {
      const data = await GP.api("/api/summary");
      const q = data.quality;
      document.getElementById("quality").innerHTML =
        "<ul class='kv'>" + [
          ["Logged sessions", q.logged_sessions], ["Missing duration", q.missing_duration],
          ["Missing muscle groups", q.missing_muscles], ["Sessions without exercises", q.missing_exercises],
          ["Data completeness", q.completeness_pct + "%"]
        ].map((r) => "<li><span>" + r[0] + "</span><b>" + r[1] + "</b></li>").join("") + "</ul>";
    } catch (e) { /* ignore */ }
  })();

  renderSplits();
})();
