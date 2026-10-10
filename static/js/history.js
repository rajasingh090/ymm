/* GymPulse AI - searchable history, heatmap and personal records */
(function () {
  "use strict";
  if (document.body.dataset.page !== "history") return;

  const results = document.getElementById("h-results");
  const countEl = document.getElementById("h-count");
  let timer = null;
  let year = new Date(GP.today + "T00:00:00").getFullYear();

  function params() {
    const range = document.getElementById("h-range").value;
    const p = new URLSearchParams({ range: range });
    if (range === "custom") {
      p.set("start", document.getElementById("h-start").value || "");
      p.set("end", document.getElementById("h-end").value || "");
    }
    const q = document.getElementById("h-search").value.trim();
    if (q) p.set("q", q);
    const muscle = document.getElementById("h-muscle").value;
    if (muscle) p.set("muscle", muscle);
    const status = document.getElementById("h-status").value;
    if (status) p.set("status", status);
    const dur = document.getElementById("h-duration").value;
    if (dur) p.set("min_duration", dur);
    return p.toString();
  }

  async function load() {
    results.innerHTML = "<p class='muted small'>Loading…</p>";
    try {
      const data = await GP.api("/api/sessions?" + params());
      const list = data.sessions;
      countEl.textContent = list.length + " record(s) · " +
        GP.fmtDuration(list.reduce((a, s) => a + s.duration_min, 0)) + " total";
      if (!list.length) { results.innerHTML = "<div class='card'><p class='muted'>No records match these filters.</p></div>"; return; }
      results.innerHTML = list.map((s) =>
        "<div class='card reveal'><div class='row-between'>" +
          "<div class='grow'><b>" + GP.fmtDate(s.date) + "</b>" +
          "<span class='muted small'><span class='dot " + s.status + "'></span> " + GP.statusLabel(s.status) +
          (s.muscles.length ? " · " + s.muscles.join(" + ") : "") + "</span></div>" +
          "<button class='btn ghost' data-session='" + s.id + "'>Edit</button></div>" +
          (s.status === "went" ?
            "<p class='muted small'>" + GP.fmtDuration(s.duration_min) +
            (s.start_time ? " · " + s.start_time + "–" + s.end_time : "") +
            (s.workout_type ? " · " + GP.escape(s.workout_type) : "") +
            (s.energy ? " · energy " + s.energy + "/10" : "") + "</p>" : "") +
          (s.exercises.length ? "<div class='list'>" + s.exercises.map((e) =>
            "<div class='list-item' style='cursor:default'><div class='grow'><b>" + GP.escape(e.name) + "</b>" +
            "<span class='muted small'>" + e.sets + " sets × " + e.reps + " reps" +
            (e.weight ? " @ " + e.weight + " kg" : "") + "</span></div>" +
            "<span class='pill'>" + Math.round(e.volume) + "</span></div>").join("") + "</div>" : "") +
          (s.notes ? "<p class='muted small'>“" + GP.escape(s.notes) + "”</p>" : "") +
        "</div>").join("");
      GP.reveal(results);
    } catch (e) {
      results.innerHTML = "<p class='form-error'>" + GP.escape(e.message) + "</p>";
    }
  }

  async function loadHeatmap() {
    document.getElementById("hm-year").textContent = year;
    try {
      const data = await GP.api("/api/heatmap?year=" + year);
      const box = document.getElementById("heatmap");
      const start = new Date(year, 0, 1), end = new Date(year, 11, 31);
      let html = "";
      for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        const status = data.statuses[iso];
        const mins = data.minutes[iso] || 0;
        let cls = "hm-day";
        if (status === "went") cls += mins >= 90 ? " l4" : mins >= 60 ? " l3" : mins >= 30 ? " l2" : " l1";
        else if (status === "missed") cls += " miss";
        html += "<div class='" + cls + "' title='" + iso + (status ? " · " + status : "") + "'></div>";
      }
      box.innerHTML = html;
    } catch (e) { /* ignore */ }
  }

  async function loadRecords() {
    try {
      const data = await GP.api("/api/records");
      const box = document.getElementById("records");
      if (!data.records.length) { box.innerHTML = "<p class='muted small'>No weighted exercises recorded yet.</p>"; return; }
      box.innerHTML = "<div class='list'>" + data.records.map((r) =>
        "<div class='list-item' style='cursor:default'><div class='grow'><b>" + GP.escape(r.exercise) + "</b>" +
        "<span class='muted small'>" + r.weight + " kg × " + r.reps + " on " + r.date +
        " · est. 1RM " + r.estimated_1rm + " kg (estimate)</span></div></div>").join("") + "</div>";
    } catch (e) { /* ignore */ }
  }

  ["h-search", "h-duration"].forEach((id) => document.getElementById(id).addEventListener("input", () => {
    clearTimeout(timer); timer = setTimeout(load, 300);
  }));
  ["h-muscle", "h-status", "h-start", "h-end"].forEach((id) =>
    document.getElementById(id).addEventListener("change", load));
  document.getElementById("h-range").addEventListener("change", (e) => {
    document.getElementById("h-custom").hidden = e.target.value !== "custom";
    load();
  });
  document.getElementById("hm-prev").addEventListener("click", () => { year--; loadHeatmap(); });
  document.getElementById("hm-next").addEventListener("click", () => { year++; loadHeatmap(); });
  document.addEventListener("gympulse:changed", () => { load(); loadHeatmap(); loadRecords(); });

  load(); loadHeatmap(); loadRecords();
})();
