"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, X, Zap, Clock3, Dumbbell, Check, Sparkles } from "lucide-react";
import { apiJSON, formatDate, getSessionDurationPreview, indiaToday } from "@/lib/client-utils";
import type { CustomSplit, Muscle, WorkoutSession } from "@/lib/types";

const MUSCLES: Muscle[] = ["Biceps", "Triceps", "Legs", "Shoulders", "Chest", "Back", "Forearms"];
type ExerciseDraft = { name: string; sets: { reps: string; weightKg: string; restSeconds: string }[] };
type SaveResponse = { ok: boolean; id: number; duplicate?: boolean };

type Props = {
  session?: WorkoutSession;
  selectedDate?: string;
  splits: CustomSplit[];
  onClose: () => void;
  onSaved: (message: string) => void;
};

function createRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function WorkoutModal({ session, selectedDate, splits, onClose, onSaved }: Props) {
  const today = indiaToday();
  const [workoutDate, setWorkoutDate] = useState(session?.workoutDate ?? selectedDate ?? today);
  const [muscles, setMuscles] = useState<string[]>(session?.muscleGroups ?? []);
  const [startTime, setStartTime] = useState(session?.startTime ?? "");
  const [endTime, setEndTime] = useState(session?.endTime ?? "");
  const [manualDuration, setManualDuration] = useState(session?.durationMinutes ? String(session.durationMinutes) : "");
  const [workoutType, setWorkoutType] = useState(session?.workoutType ?? "Strength training");
  const [energy, setEnergy] = useState<number | null>(session?.energy ?? null);
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [exercises, setExercises] = useState<ExerciseDraft[]>(() => (session?.exercises ?? []).map((exercise) => ({
    name: exercise.name,
    sets: exercise.sets.map((set) => ({ reps: String(set.reps), weightKg: String(set.weightKg), restSeconds: set.restSeconds === null ? "" : String(set.restSeconds) })),
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId] = useState(() => session?.requestId ?? createRequestId());
  const duration = useMemo(() => getSessionDurationPreview(startTime, endTime, manualDuration), [startTime, endTime, manualDuration]);
  const autoDuration = Boolean(startTime && endTime);

  function toggleMuscle(muscle: string) {
    setMuscles((current) => current.includes(muscle) ? current.filter((value) => value !== muscle) : [...current, muscle]);
  }
  function applySplit(split: CustomSplit) {
    setMuscles(split.muscleGroups);
  }
  function addExercise() {
    setExercises((current) => [...current, { name: "", sets: [{ reps: "10", weightKg: "", restSeconds: "" }] }]);
  }
  function updateExercise(index: number, patch: Partial<ExerciseDraft>) {
    setExercises((current) => current.map((exercise, i) => i === index ? { ...exercise, ...patch } : exercise));
  }
  function removeExercise(index: number) {
    setExercises((current) => current.filter((_, i) => i !== index));
  }
  function addSet(index: number) {
    setExercises((current) => current.map((exercise, i) => i === index ? { ...exercise, sets: [...exercise.sets, { reps: "10", weightKg: "", restSeconds: "" }] } : exercise));
  }
  function updateSet(index: number, setIndex: number, key: "reps" | "weightKg" | "restSeconds", value: string) {
    setExercises((current) => current.map((exercise, i) => i === index ? { ...exercise, sets: exercise.sets.map((set, j) => j === setIndex ? { ...set, [key]: value } : set) } : exercise));
  }
  function removeSet(index: number, setIndex: number) {
    setExercises((current) => current.map((exercise, i) => i === index ? { ...exercise, sets: exercise.sets.filter((_, j) => j !== setIndex) } : exercise));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!muscles.length) {
      setError("Choose at least one muscle group for this workout.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        requestId,
        workoutDate,
        muscleGroups: muscles,
        startTime: startTime || null,
        endTime: endTime || null,
        durationMinutes: Number(manualDuration || 0),
        workoutType,
        energy,
        notes,
        exercises: exercises.filter((exercise) => exercise.name.trim()).map((exercise) => ({
          name: exercise.name.trim(),
          sets: exercise.sets.filter((set) => set.reps !== "").map((set) => ({ reps: Number(set.reps), weightKg: Number(set.weightKg || 0), restSeconds: set.restSeconds === "" ? null : Number(set.restSeconds) })),
        })),
      };
      await apiJSON<SaveResponse>(session ? `/api/sessions/${session.id}` : "/api/sessions", {
        method: session ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      onSaved(session ? "Workout updated. Your dashboard is up to date." : "Workout saved. Your progress is up to date.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The workout could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="workout-modal-title">
        <header className="modal-head">
          <div>
            <div className="eyebrow"><span className="dot" /> Workout journal</div>
            <h2 id="workout-modal-title" className="modal-title" style={{ marginTop: 9 }}>{session ? "Edit workout" : "Log today's workout"}</h2>
            <p className="modal-subtitle">{session ? "Update this session. Your reports refresh as soon as it saves." : "Capture the work you actually did—no fixed split, no assumptions."}</p>
          </div>
          <button className="icon-btn" type="button" aria-label="Close workout form" onClick={onClose} disabled={busy}><X size={16} /></button>
        </header>
        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-stack">
            <div className="field-row">
              <div className="field">
                <label className="field-label" htmlFor="workout-date">Workout date</label>
                <input className="input" id="workout-date" type="date" max={today} required value={workoutDate} onChange={(event) => setWorkoutDate(event.target.value)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="workout-type">Workout type</label>
                <select className="select" id="workout-type" value={workoutType} onChange={(event) => setWorkoutType(event.target.value)}>
                  <option>Strength training</option><option>Hypertrophy</option><option>Cardio</option><option>Mobility</option><option>Mixed session</option><option>Other</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label className="field-label">Muscles trained <span style={{ color: "var(--muted-2)", fontWeight: 400 }}>· select any combination</span></label>
              <div className="checkbox-grid">
                {MUSCLES.map((muscle) => (
                  <label key={muscle} className={`check-chip ${muscles.includes(muscle) ? "checked" : ""}`}>
                    <input type="checkbox" checked={muscles.includes(muscle)} onChange={() => toggleMuscle(muscle)} />
                    {muscles.includes(muscle) && <Check size={12} />}{muscle}
                  </label>
                ))}
              </div>
              {splits.length > 0 && <div className="filter-row" style={{ marginTop: 8 }}>
                <span className="field-hint" style={{ margin: 0 }}>Saved splits</span>
                {splits.map((split) => <button type="button" className="btn btn-sm" key={split.id} onClick={() => applySplit(split)}>{split.name}</button>)}
              </div>}
            </div>

            <div className="field">
              <label className="field-label">Workout time <span style={{ color: "var(--muted-2)", fontWeight: 400 }}>· optional</span></label>
              <div className="field-row">
                <div><label className="field-hint" htmlFor="workout-start">Start</label><input className="input" id="workout-start" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></div>
                <div><label className="field-hint" htmlFor="workout-end">End</label><input className="input" id="workout-end" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div>
              </div>
              <div className="field-row" style={{ alignItems: "end", marginTop: 10 }}>
                <div><label className="field-label" htmlFor="workout-duration">Manual duration (minutes)</label><input className="input" id="workout-duration" type="number" min="0" max="1440" step="1" inputMode="numeric" value={manualDuration} onChange={(event) => setManualDuration(event.target.value)} placeholder="e.g. 55" disabled={autoDuration} /></div>
                <div className="success-box" style={{ minHeight: 41, display: "flex", alignItems: "center", gap: 7 }}><Clock3 size={14} /> {duration} min {autoDuration ? "· calculated from times" : "· recorded duration"}</div>
              </div>
              <p className="field-hint">When both times are entered, they take priority. End times before start times are treated as crossing midnight.</p>
            </div>

            <div className="field">
              <div className="panel-head" style={{ marginBottom: 8, alignItems: "center" }}>
                <div><label className="field-label" style={{ marginBottom: 3 }}>Exercises & sets</label><div className="field-hint" style={{ margin: 0 }}>Weight is in kg. Only exercises you add are saved.</div></div>
                <button className="btn btn-sm" type="button" onClick={addExercise}><Plus size={13} /> Add exercise</button>
              </div>
              {exercises.length === 0 ? <button type="button" className="empty-state" style={{ width: "100%", minHeight: 100, border: "1px dashed var(--border-strong)", borderRadius: 13, background: "transparent", cursor: "pointer" }} onClick={addExercise}>
                <span><span className="empty-state-icon"><Dumbbell size={18} /></span><span style={{ display: "block", color: "#c2cbc0", fontSize: 10 }}>Add your first exercise</span><span className="field-hint">Keep an exercise history to compare strength over time.</span></span>
              </button> : exercises.map((exercise, index) => (
                <div className="exercise-box" key={index}>
                  <div className="exercise-top">
                    <input className="input" value={exercise.name} onChange={(event) => updateExercise(index, { name: event.target.value })} placeholder={`Exercise ${index + 1}, e.g. Dumbbell curl`} aria-label={`Exercise ${index + 1} name`} />
                    <button className="icon-btn" type="button" aria-label="Remove exercise" onClick={() => removeExercise(index)}><Trash2 size={14} /></button>
                  </div>
                  <div className="set-head"><span>Set</span><span>Reps</span><span>Weight kg</span><span /></div>
                  {exercise.sets.map((set, setIndex) => <div className="set-row" key={setIndex}>
                    <span className="set-num">{setIndex + 1}</span>
                    <input className="input" type="number" min="1" max="1000" inputMode="numeric" value={set.reps} onChange={(event) => updateSet(index, setIndex, "reps", event.target.value)} placeholder="10" aria-label={`Set ${setIndex + 1} repetitions`} />
                    <input className="input" type="number" min="0" max="2000" step="0.25" inputMode="decimal" value={set.weightKg} onChange={(event) => updateSet(index, setIndex, "weightKg", event.target.value)} placeholder="0" aria-label={`Set ${setIndex + 1} weight in kilograms`} />
                    <button className="icon-btn" type="button" aria-label="Remove set" onClick={() => removeSet(index, setIndex)} disabled={exercise.sets.length <= 1}><X size={13} /></button>
                  </div>)}
                  <button className="add-set" type="button" onClick={() => addSet(index)}><Plus size={11} style={{ verticalAlign: -2 }} /> Add set</button>
                </div>
              ))}
            </div>

            <div className="field">
              <label className="field-label">Energy level <span style={{ color: "var(--muted-2)", fontWeight: 400 }}>· optional</span></label>
              <div className="filter-row">
                {[1, 2, 3, 4, 5].map((level) => <button key={level} type="button" className={`status-button ${energy === level ? "selected went" : ""}`} style={{ width: 48, minHeight: 39 }} aria-label={`Energy level ${level}`} onClick={() => setEnergy(energy === level ? null : level)}><Zap size={12} fill={energy !== null && level <= energy ? "currentColor" : "none"} />{level}</button>)}
                <span className="field-hint" style={{ margin: 0 }}>1 low · 5 high</span>
              </div>
            </div>
            <div className="field"><label className="field-label" htmlFor="workout-notes">Workout notes <span style={{ color: "var(--muted-2)", fontWeight: 400 }}>· optional</span></label><textarea className="textarea" id="workout-notes" maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="How did the session feel? Anything to remember next time?" /></div>
            {error && <div className="alert-bar"><X size={14} />{error}</div>}
          </div>
          <div className="modal-actions">
            <button className="btn" type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? <><span className="spinner" /> Saving…</> : <><Sparkles size={14} />{session ? "Save changes" : "Save workout"}</>}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
