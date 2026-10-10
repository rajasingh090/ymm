/* GymPulse AI - workout logger modal (create / edit / delete) */
(function () {
  "use strict";

  const modal = document.getElementById("workout-modal");
  if (!modal) return;

  const form = document.getElementById("workout-form");
  const errorBox = document.getElementById("form-error");
  const exerciseList = document.getElementById("exercise-list");
  const gymFields = document.getElementById("gym-fields");
  const deleteBtn = document.getElementById("delete-session");
  const saveBtn = document.getElementById("save-session");
  let currentStatus = "went";
  let saving = false;

  function setStatus(value) {
    currentStatus = value;
    document.querySelectorAll("#f-status .seg").forEach((b) =>
      b.classList.toggle("active", b.dataset.value === value));
    gymFields.hidden = value !== "went";
  }

  function addExerciseRow(data) {
    data = data || {};
    const row = document.createElement("div");
    row.className = "exercise-row";
    row.innerHTML =
      '<div class="ex-head">' +
        '<input class="ex-name" placeholder="Exercise name" value="' + GP.escape(data.name || "") + '">' +
        '<button type="button" class="icon-btn ghost ex-del" aria-label="Remove">✕</button>' +
      "</div>" +
      '<div class="grid-4" style="margin-top:8px">' +
        '<input class="ex-sets" type="number" min="0" max="100" placeholder="Sets" value="' + (data.sets || "") + '">' +
        '<input class="ex-reps" type="number" min="0" max="1000" placeholder="Reps" value="' + (data.reps || "") + '">' +
        '<input class="ex-weight" type="number" min="0" step="0.5" placeholder="Kg" value="' + (data.weight || "") + '">' +
      "</div>";
    row.querySelector(".ex-del").addEventListener("click", () => row.remove());
    exerciseList.appendChild(row);
  }

  function collectExercises() {
    return Array.from(exerciseList.querySelectorAll(".exercise-row")).map((row) => ({
      name: row.querySelector(".ex-name").value.trim(),
      sets: row.querySelector(".ex-sets").value,
      reps: row.querySelector(".ex-reps").value,
      weight: row.querySelector(".ex-weight").value
    })).filter((e) => e.name);
  }

  function reset() {
    form.reset();
    document.getElementById("f-id").value = "";
    exerciseList.innerHTML = "";
    errorBox.hidden = true;
    deleteBtn.hidden = true;
    document.querySelectorAll("#f-muscles .chip").forEach((c) => c.classList.remove("active"));
    document.getElementById("f-date").value = GP.today;
    document.getElementById("energy-value").textContent = "7";
    setStatus("went");
  }

  function open(session) {
    reset();
    if (session) {
      document.getElementById("modal-title").textContent = "Edit workout";
      document.getElementById("f-id").value = session.id;
      document.getElementById("f-date").value = session.date;
      document.getElementById("f-start").value = session.start_time || "";
      document.getElementById("f-end").value = session.end_time || "";
      document.getElementById("f-duration").value = session.duration_min || "";
      document.getElementById("f-type").value = session.workout_type || "";
      document.getElementById("f-notes").value = session.notes || "";
      if (session.energy) {
        document.getElementById("f-energy").value = session.energy;
        document.getElementById("energy-value").textContent = session.energy;
      }
      setStatus(session.status);
      (session.muscles || []).forEach((m) => {
        const chip = document.querySelector('#f-muscles .chip[data-muscle="' + m + '"]');
        if (chip) chip.classList.add("active");
      });
      (session.exercises || []).forEach(addExerciseRow);
      deleteBtn.hidden = false;
    } else {
      document.getElementById("modal-title").textContent = "Log Today's Workout";
      addExerciseRow();
    }
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    GP.icons();
  }

  function close() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  async function openForDate(dateIso) {
    open(null);
    document.getElementById("f-date").value = dateIso;
    try {
      const data = await GP.api("/api/day/" + dateIso);
      if (data.sessions && data.sessions.length) open(data.sessions[0]);
      document.getElementById("f-date").value = dateIso;
    } catch (e) { /* new day - keep blank form */ }
  }

  async function openForSession(id) {
    try {
      const session = await GP.api("/api/sessions/" + id);
      open(session);
    } catch (e) { GP.toast(e.message, true); }
  }

  // ---- events ----
  document.querySelectorAll("#f-status .seg").forEach((b) =>
    b.addEventListener("click", () => setStatus(b.dataset.value)));

  document.querySelectorAll("#f-muscles .chip").forEach((chip) =>
    chip.addEventListener("click", () => chip.classList.toggle("active")));

  document.getElementById("add-exercise").addEventListener("click", () => { addExerciseRow(); GP.icons(); });
  document.getElementById("modal-close").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("open")) close(); });

  const energy = document.getElementById("f-energy");
  energy.addEventListener("input", () => { document.getElementById("energy-value").textContent = energy.value; });

  ["f-start", "f-end"].forEach((id) => document.getElementById(id).addEventListener("change", () => {
    const s = document.getElementById("f-start").value;
    const e = document.getElementById("f-end").value;
    const dur = document.getElementById("f-duration");
    if (s && e && !dur.dataset.manual) {
      const [sh, sm] = s.split(":").map(Number);
      const [eh, em] = e.split(":").map(Number);
      let diff = (eh * 60 + em) - (sh * 60 + sm);
      if (diff <= 0) diff += 24 * 60;            // overnight session
      dur.value = diff;
    }
  }));
  document.getElementById("f-duration").addEventListener("input", function () {
    this.dataset.manual = this.value ? "1" : "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    errorBox.hidden = true;

    const id = document.getElementById("f-id").value;
    const payload = {
      date: document.getElementById("f-date").value,
      status: currentStatus,
      start_time: document.getElementById("f-start").value,
      end_time: document.getElementById("f-end").value,
      duration_min: document.getElementById("f-duration").value,
      workout_type: document.getElementById("f-type").value,
      energy: document.getElementById("f-energy").value,
      notes: document.getElementById("f-notes").value,
      muscles: Array.from(document.querySelectorAll("#f-muscles .chip.active")).map((c) => c.dataset.muscle),
      exercises: collectExercises()
    };

    try {
      if (id) {
        await GP.api("/api/sessions/" + id, { method: "PUT", body: JSON.stringify(payload) });
        GP.toast("Workout updated");
      } else {
        await GP.api("/api/sessions", { method: "POST", body: JSON.stringify(payload) });
        GP.toast("Workout saved");
      }
      close();
      document.dispatchEvent(new CustomEvent("gympulse:changed"));
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  });

  deleteBtn.addEventListener("click", async () => {
    const id = document.getElementById("f-id").value;
    if (!id || !confirm("Delete this session permanently?")) return;
    try {
      await GP.api("/api/sessions/" + id, { method: "DELETE" });
      GP.toast("Session deleted");
      close();
      document.dispatchEvent(new CustomEvent("gympulse:changed"));
    } catch (err) { GP.toast(err.message, true); }
  });

  ["quick-log", "log-today"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => open(null));
  });

  document.addEventListener("click", (e) => {
    const item = e.target.closest("[data-session]");
    if (item) openForSession(item.dataset.session);
  });

  document.addEventListener("gympulse:changed", () => {
    if (document.body.dataset.page === "home") setTimeout(() => location.reload(), 400);
  });

  window.GPWorkout = { open, openForDate, openForSession, close };
})();
