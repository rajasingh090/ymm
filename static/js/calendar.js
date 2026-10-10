/* GymPulse AI - attendance calendar (Gregorian + Hindu lunar overlay) */
(function () {
  "use strict";
  if (document.body.dataset.page !== "calendar") return;

  const grid = document.getElementById("cal-grid");
  const title = document.getElementById("cal-title");
  const subtitle = document.getElementById("cal-subtitle");
  const note = document.getElementById("cal-note");
  const panel = document.getElementById("day-panel");
  let system = (GP.settings.calendar_system === "hindu") ? "hindu" : "gregorian";
  let cursor = new Date(GP.today + "T00:00:00");
  let current = null;
  let selected = null;

  async function load() {
    grid.innerHTML = "<p class='muted small'>Loading…</p>";
    try {
      current = await GP.api("/api/calendar?year=" + cursor.getFullYear() + "&month=" + (cursor.getMonth() + 1));
      draw();
    } catch (e) {
      grid.innerHTML = "<p class='form-error'>" + GP.escape(e.message) + "</p>";
    }
  }

  function draw() {
    const d = current;
    if (system === "hindu" && d.hindu_available) {
      title.textContent = d.hindu_label;
      subtitle.textContent = d.label + " · " + d.hindu_convention + " convention";
      note.textContent = "Hindu lunar months computed with the " + d.hindu_method +
        ". Workouts are always stored with Gregorian dates.";
    } else {
      title.textContent = d.label;
      subtitle.textContent = d.hindu_available ? ("Hindu: " + d.hindu_label) : "";
      note.textContent = d.hindu_available ? "" :
        "Hindu calendar conversion is not configured, so only the Gregorian calendar is shown.";
    }

    grid.innerHTML = "";
    for (let i = 0; i < d.first_weekday; i++) {
      const blank = document.createElement("div");
      blank.className = "cal-cell empty";
      grid.appendChild(blank);
    }
    d.days.forEach((day) => {
      const cell = document.createElement("button");
      cell.className = "cal-cell " + day.status + (day.date === d.today ? " today" : "");
      const sub = (system === "hindu" && day.hindu)
        ? day.hindu.tithi + (day.hindu.paksha === "Krishna" ? "k" : "s")
        : (day.duration ? day.duration + "m" : "");
      cell.innerHTML = "<b>" + day.day + "</b>" + (sub ? "<span class='sub'>" + GP.escape(sub) + "</span>" : "");
      cell.addEventListener("click", () => showDay(day));
      grid.appendChild(cell);
    });

    const counts = { went: 0, missed: 0, rest: 0, unrecorded: 0, future: 0 };
    let minutes = 0;
    d.days.forEach((day) => { counts[day.status] = (counts[day.status] || 0) + 1; minutes += day.duration; });
    const confirmed = counts.went + counts.missed;
    document.getElementById("month-stats").innerHTML = [
      ["Gym days", counts.went], ["Missed", counts.missed], ["Rest", counts.rest],
      ["Not recorded", counts.unrecorded], ["Hours", (minutes / 60).toFixed(1)],
      ["Attendance", (confirmed ? Math.round(counts.went * 100 / confirmed) : 0) + "%"]
    ].map((s) => "<div class='card stat'><span class='label'>" + s[0] + "</span><b>" + s[1] + "</b></div>").join("");
  }

  function showDay(day) {
    selected = day;
    panel.hidden = false;
    document.getElementById("day-title").textContent = GP.fmtDate(day.date);
    document.getElementById("day-hindu").textContent = day.hindu
      ? (day.hindu.month + " · " + day.hindu.paksha + " " + day.hindu.tithi_name + " · Shaka " + day.hindu.shaka_samvat)
      : "";
    let html = "<p><span class='dot " + day.status + "'></span> <b>" + GP.statusLabel(day.status) + "</b></p>";
    if (day.sessions.length) {
      day.sessions.forEach((s) => {
        html += "<div class='list-item' style='cursor:default'><div class='grow'><b>" +
          (s.muscles.join(" + ") || GP.statusLabel(s.status)) + "</b>" +
          "<span class='muted small'>" + GP.fmtDuration(s.duration_min) +
          (s.start_time ? " · " + s.start_time + "–" + s.end_time : "") +
          (s.workout_type ? " · " + GP.escape(s.workout_type) : "") + "</span>" +
          (s.exercises.length ? "<span class='muted small'>" + s.exercises.map((e) =>
            GP.escape(e.name) + " " + e.sets + "×" + e.reps + (e.weight ? " @" + e.weight + "kg" : "")).join(", ") + "</span>" : "") +
          (s.notes ? "<span class='muted small'>“" + GP.escape(s.notes) + "”</span>" : "") +
          "</div><button class='btn ghost' data-session='" + s.id + "'>Edit</button></div>";
      });
    } else {
      html += "<p class='muted small'>Nothing recorded for this day.</p>";
    }
    document.getElementById("day-body").innerHTML = html;
    panel.scrollIntoView({ behavior: GP.reduceMotion ? "auto" : "smooth", block: "nearest" });
    GP.icons();
  }

  document.getElementById("cal-prev").addEventListener("click", () => { cursor.setMonth(cursor.getMonth() - 1); load(); });
  document.getElementById("cal-next").addEventListener("click", () => { cursor.setMonth(cursor.getMonth() + 1); load(); });
  document.getElementById("day-close").addEventListener("click", () => { panel.hidden = true; });
  document.getElementById("day-log").addEventListener("click", () => {
    if (selected) window.GPWorkout.openForDate(selected.date);
  });
  document.querySelectorAll("#cal-system .seg").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#cal-system .seg").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    system = b.dataset.value;
    draw();
  }));
  document.addEventListener("gympulse:changed", () => { load(); panel.hidden = true; });

  load();
})();
