"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, CalendarDays, Check, Download, FileJson, FileSpreadsheet, Globe2, LockKeyhole, LogOut, MapPin, Plus, RotateCcw, Save, ShieldCheck, Trash2, Upload, Weight, X } from "lucide-react";
import { apiJSON, formatDate, indiaToday } from "@/lib/client-utils";
import type { GymData, Muscle } from "@/lib/types";

type Props = {
  data: GymData;
  today: string;
  authProtected: boolean;
  onUpdate: () => Promise<unknown>;
  onNotify: (message: string) => void;
  onLogout: () => void;
};

type SettingsTab = "goals" | "calendar" | "splits" | "measurements" | "data" | "privacy";
const MUSCLES: Muscle[] = ["Biceps", "Triceps", "Legs", "Shoulders", "Chest", "Back", "Forearms"];
const tabItems: { id: SettingsTab; label: string }[] = [
  { id: "goals", label: "Goals" }, { id: "calendar", label: "Calendar" }, { id: "splits", label: "Workout splits" },
  { id: "measurements", label: "Measurements" }, { id: "data", label: "Data & backup" }, { id: "privacy", label: "Privacy" },
];

export default function SettingsView({ data, today, authProtected, onUpdate, onNotify, onLogout }: Props) {
  const [tab, setTab] = useState<SettingsTab>("goals");
  const [weeklySessions, setWeeklySessions] = useState(String(data.goals.weeklySessions));
  const [monthlyAttendancePercent, setMonthlyAttendancePercent] = useState(String(data.goals.monthlyAttendancePercent));
  const [monthlyHours, setMonthlyHours] = useState(String(data.goals.monthlyHours));
  const [calendarConvention, setCalendarConvention] = useState(data.settings.calendarConvention === "amanta" ? "amanta" : "purnimanta");
  const [latitude, setLatitude] = useState(data.settings.latitude || "28.6139");
  const [longitude, setLongitude] = useState(data.settings.longitude || "77.209");
  const [splitName, setSplitName] = useState("");
  const [splitMuscles, setSplitMuscles] = useState<string[]>([]);
  const [measurementDate, setMeasurementDate] = useState(today);
  const [weightKg, setWeightKg] = useState("");
  const [waistCm, setWaistCm] = useState("");
  const [chestCm, setChestCm] = useState("");
  const [armsCm, setArmsCm] = useState("");
  const [hipsCm, setHipsCm] = useState("");
  const [thighsCm, setThighsCm] = useState("");
  const [measurementNotes, setMeasurementNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setWeeklySessions(String(data.goals.weeklySessions));
    setMonthlyAttendancePercent(String(data.goals.monthlyAttendancePercent));
    setMonthlyHours(String(data.goals.monthlyHours));
    setCalendarConvention(data.settings.calendarConvention === "amanta" ? "amanta" : "purnimanta");
    setLatitude(data.settings.latitude || "28.6139");
    setLongitude(data.settings.longitude || "77.209");
  }, [data.goals.weeklySessions, data.goals.monthlyAttendancePercent, data.goals.monthlyHours, data.settings]);

  function fail(problem: unknown) {
    const message = problem instanceof Error ? problem.message : "This change could not be saved.";
    setError(message);
    onNotify(message);
  }

  async function saveGoals(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await apiJSON("/api/goals", { method: "PUT", body: JSON.stringify({ weeklySessions: Number(weeklySessions), monthlyAttendancePercent: Number(monthlyAttendancePercent), monthlyHours: Number(monthlyHours) }) });
      await onUpdate(); onNotify("Your training goals have been updated.");
    } catch (problem) { fail(problem); }
    finally { setBusy(false); }
  }

  async function saveCalendar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await apiJSON<{ settings: Record<string, string> }>("/api/settings", { method: "PUT", body: JSON.stringify({ calendarConvention, latitude: Number(latitude), longitude: Number(longitude) }) });
      await onUpdate();
      onNotify(`Calendar settings saved · ${result.settings.calendarConvention} · ${result.settings.latitude}, ${result.settings.longitude}`);
    } catch (problem) { fail(problem); }
    finally { setBusy(false); }
  }

  async function saveSplit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await apiJSON("/api/splits", { method: "POST", body: JSON.stringify({ name: splitName, muscleGroups: splitMuscles }) });
      setSplitName(""); setSplitMuscles([]);
      await onUpdate(); onNotify("Your custom muscle combination has been saved.");
    } catch (problem) { fail(problem); }
    finally { setBusy(false); }
  }

  async function deleteSplit(id: number, name: string) {
    if (!window.confirm(`Remove the saved split “${name}”? Existing workouts will not change.`)) return;
    try { await apiJSON(`/api/splits/${id}`, { method: "DELETE" }); await onUpdate(); onNotify("Saved split removed."); }
    catch (problem) { fail(problem); }
  }

  async function saveMeasurement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await apiJSON("/api/measurements", { method: "POST", body: JSON.stringify({ measuredOn: measurementDate, weightKg, waistCm, chestCm, armsCm, hipsCm, thighsCm, notes: measurementNotes }) });
      setWeightKg(""); setWaistCm(""); setChestCm(""); setArmsCm(""); setHipsCm(""); setThighsCm(""); setMeasurementNotes("");
      await onUpdate(); onNotify("Measurement added to your private journal.");
    } catch (problem) { fail(problem); }
    finally { setBusy(false); }
  }

  async function deleteMeasurement(id: number) {
    if (!window.confirm("Delete this measurement entry?")) return;
    try { await apiJSON(`/api/measurements/${id}`, { method: "DELETE" }); await onUpdate(); onNotify("Measurement entry deleted."); }
    catch (problem) { fail(problem); }
  }

  async function restoreBackup(file?: File) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error("Backup files are limited to 30 MB.");
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || !("application" in parsed) || (parsed as { application?: unknown }).application !== "GymPulse AI") throw new Error("This does not look like a GymPulse AI backup.");
      if (!window.confirm("Merge this backup into the current database? Existing workout request IDs will not duplicate; data is not deleted.")) return;
      const result = await apiJSON<{ message: string; addedSessions: number }>("/api/backup", { method: "POST", body: JSON.stringify(parsed) });
      await onUpdate(); onNotify(`${result.message} Added ${result.addedSessions} workout sessions.`);
    } catch (problem) { fail(problem); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  function toggleSplit(muscle: string) {
    setSplitMuscles((current) => current.includes(muscle) ? current.filter((item) => item !== muscle) : [...current, muscle]);
  }

  return <div className="page-enter">
    <div className="page-heading"><div><div className="eyebrow"><span className="dot" /> YOUR PERSONAL WORKSPACE</div><h1 className="page-title" style={{ marginTop: 10 }}>Settings</h1><p className="page-description">Set your own targets and calendar assumptions. Nothing here forces a weekly workout split.</p></div><span className="stat-icon" style={{ width: 42, height: 42 }}><ShieldCheck size={19} /></span></div>
    {error && <div className="alert-bar"><AlertTriangle size={14} />{error}</div>}
    <div className="settings-layout"><nav className="settings-nav" aria-label="Settings sections">{tabItems.map((item) => <button type="button" key={item.id} className={tab === item.id ? "active" : ""} onClick={() => { setTab(item.id); setError(""); }}>{item.label}</button>)}</nav>
      <div className="settings-stack">
        {tab === "goals" && <section className="settings-card"><h3>Targets that fit your life</h3><p>Goals are personal reference points, not a required routine. GymPulse never turns an unplanned day into a missed workout.</p><form className="form-stack" onSubmit={(event) => void saveGoals(event)}><div className="settings-form-grid three"><div><label className="field-label" htmlFor="weekly-goal">Sessions per week</label><input className="input" id="weekly-goal" type="number" min="1" max="21" step="1" required value={weeklySessions} onChange={(event) => setWeeklySessions(event.target.value)} /></div><div><label className="field-label" htmlFor="monthly-attendance-goal">Attendance target (%)</label><input className="input" id="monthly-attendance-goal" type="number" min="1" max="100" step="1" required value={monthlyAttendancePercent} onChange={(event) => setMonthlyAttendancePercent(event.target.value)} /></div><div><label className="field-label" htmlFor="monthly-hours-goal">Workout hours per month</label><input className="input" id="monthly-hours-goal" type="number" min="1" max="300" step="0.5" required value={monthlyHours} onChange={(event) => setMonthlyHours(event.target.value)} /></div></div><div className="form-footer"><span className="field-hint">Targets update the weekly overview; they do not change your attendance history.</span><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : <><Save size={13} /> Save goals</>}</button></div></form></section>}

        {tab === "calendar" && <section className="settings-card"><h3>Indian lunar calendar</h3><p>Workout records always use Gregorian dates. Hindu lunar dates are a calculated display layer using the Panchangam library; sunrise-based daily values depend on location and convention.</p><form className="form-stack" onSubmit={(event) => void saveCalendar(event)}><div className="settings-form-grid two"><div><label className="field-label" htmlFor="calendar-convention">Month convention</label><select className="select" id="calendar-convention" value={calendarConvention} onChange={(event) => setCalendarConvention(event.target.value as "amanta" | "purnimanta")}><option value="amanta">Amanta</option><option value="purnimanta">Purnimanta</option></select></div><div><label className="field-label">Time zone</label><input className="input" value="Asia/Kolkata (UTC+05:30)" readOnly /></div></div><div className="settings-form-grid two"><div><label className="field-label" htmlFor="latitude">Latitude</label><input className="input" id="latitude" type="number" min="-90" max="90" step="0.000001" required value={latitude} onChange={(event) => setLatitude(event.target.value)} /></div><div><label className="field-label" htmlFor="longitude">Longitude</label><input className="input" id="longitude" type="number" min="-180" max="180" step="0.000001" required value={longitude} onChange={(event) => setLongitude(event.target.value)} /></div></div><div className="warning-box"><MapPin size={14} />Default assumption: Delhi, India (28.6139° N, 77.2090° E, 216 m). Change to your observance location for local sunrise calculations. The app does not infer your location.</div><div className="form-footer"><span className="field-hint">Library: @ishubhamx/panchangam-js · Amanta/Purnimanta</span><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : <><Save size={13} /> Save calendar</>}</button></div></form></section>}

        {tab === "splits" && <><section className="settings-card"><h3>Flexible workout combinations</h3><p>Save preferred muscle combinations for quick selection in the workout logger. These are shortcuts only; every session can use a different split.</p><form className="form-stack" onSubmit={(event) => void saveSplit(event)}><div><label className="field-label" htmlFor="split-name">Split name</label><input className="input" id="split-name" maxLength={80} required value={splitName} onChange={(event) => setSplitName(event.target.value)} placeholder="e.g. Push day" /></div><div><label className="field-label">Choose muscle groups</label><div className="checkbox-grid">{MUSCLES.map((muscle) => <label className={`check-chip ${splitMuscles.includes(muscle) ? "checked" : ""}`} key={muscle}><input type="checkbox" checked={splitMuscles.includes(muscle)} onChange={() => toggleSplit(muscle)} />{splitMuscles.includes(muscle) && <Check size={12} />}{muscle}</label>)}</div></div><div className="form-footer"><span className="field-hint">Any number of muscle groups is okay.</span><button className="btn btn-primary" type="submit" disabled={busy || !splitMuscles.length}>{busy ? "Saving…" : <><Plus size={13} /> Save split</>}</button></div></form></section><section className="settings-card"><h3>Saved combinations</h3><p>Remove a shortcut without changing any workouts already logged.</p>{data.splits.length ? <div className="settings-stack">{data.splits.map((split) => <div className="split-row" key={split.id}><span className="stat-icon" style={{ width: 31, height: 31 }}><Activity size={14} /></span><span className="split-row-main"><span className="split-row-name">{split.name}</span><span className="split-row-muscles" style={{ display: "block" }}>{split.muscleGroups.join(" · ")}</span></span><button className="icon-btn" aria-label={`Delete ${split.name}`} onClick={() => void deleteSplit(split.id, split.name)}><Trash2 size={14} /></button></div>)}</div> : <div className="history-empty">No custom splits saved yet.</div>}</section></>}

        {tab === "measurements" && <><section className="settings-card"><h3>Optional body measurement journal</h3><p>Store optional measurements to compare your own records. Attendance alone does not demonstrate muscle growth or body composition change.</p><form className="form-stack" onSubmit={(event) => void saveMeasurement(event)}><div><label className="field-label" htmlFor="measurement-date">Measurement date</label><input className="input" id="measurement-date" type="date" max={today} required value={measurementDate} onChange={(event) => setMeasurementDate(event.target.value)} /></div><div className="settings-form-grid three"><MeasurementInput id="weight-kg" label="Weight · kg" value={weightKg} setValue={setWeightKg} /><MeasurementInput id="waist-cm" label="Waist · cm" value={waistCm} setValue={setWaistCm} /><MeasurementInput id="chest-cm" label="Chest · cm" value={chestCm} setValue={setChestCm} /><MeasurementInput id="arms-cm" label="Arms · cm" value={armsCm} setValue={setArmsCm} /><MeasurementInput id="hips-cm" label="Hips · cm" value={hipsCm} setValue={setHipsCm} /><MeasurementInput id="thighs-cm" label="Thighs · cm" value={thighsCm} setValue={setThighsCm} /></div><div><label className="field-label" htmlFor="measurement-notes">Notes</label><textarea className="textarea" id="measurement-notes" maxLength={500} value={measurementNotes} onChange={(event) => setMeasurementNotes(event.target.value)} placeholder="Optional notes" /></div><div className="form-footer"><span className="field-hint">You can record only one or two fields; everything is optional.</span><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : <><Plus size={13} /> Add measurement</>}</button></div></form></section><section className="settings-card"><h3>Measurement history</h3><p>Recent saved entries. Delete any entry you no longer want to keep.</p>{data.measurements.length ? <div className="measurement-history">{data.measurements.slice(0, 12).map((entry) => <div className="measurement-row" key={entry.id}><span>{formatDate(entry.measuredOn, { month: "short", day: "numeric", year: "numeric" })}</span><span style={{ flex: 1, textAlign: "right" }}>{[entry.weightKg !== null ? `${entry.weightKg} kg` : "", entry.waistCm !== null ? `Waist ${entry.waistCm}` : "", entry.chestCm !== null ? `Chest ${entry.chestCm}` : "", entry.armsCm !== null ? `Arms ${entry.armsCm}` : ""].filter(Boolean).join(" · ") || "Measurement"}</span><button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="Delete measurement" onClick={() => void deleteMeasurement(entry.id)}><Trash2 size={12} /></button></div>)}</div> : <div className="history-empty">No body measurements saved.</div>}</section></>}

        {tab === "data" && <><section className="settings-card"><h3>Export your records</h3><p>Download a portable copy of your workout history. JSON includes the data structure and exercise sets; CSV is convenient for spreadsheet analysis.</p><div className="settings-actions"><a className="btn" href="/api/export?format=csv"><FileSpreadsheet size={14} /> Export history CSV</a><a className="btn" href="/api/export?format=json"><FileJson size={14} /> Export history JSON</a><a className="btn btn-primary" href="/api/backup"><Download size={14} /> Download full backup</a></div></section><section className="settings-card"><h3>Restore a GymPulse backup</h3><p>Restoring merges data into your database. Existing sessions with matching idempotency tokens are skipped. Restore never deletes current records; review a copy of your backup before importing.</p><div className="settings-actions"><input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(event) => void restoreBackup(event.target.files?.[0])} /><button className="btn" type="button" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Restoring…" : <><Upload size={14} /> Choose backup file</>}</button></div><div className="field-hint" style={{ marginTop: 11 }}>JSON backup · max 30 MB · merge is transactional. Export a fresh backup before large imports.</div></section><section className="settings-card"><h3>Where your data lives</h3><p>All workout records are stored in the configured PostgreSQL database via Drizzle ORM. Render deployments in the supplied blueprint use a managed PostgreSQL database; the app does not silently change storage backends.</p><div className="success-box"><ShieldCheck size={13} style={{ verticalAlign: -3, marginRight: 6 }} /> Database connection details and AI credentials are never returned to this page.</div></section></>}

        {tab === "privacy" && <><section className="settings-card"><h3>Personal deployment security</h3><p>This is a single-user app. A public hosting URL is not private by itself. Enable the optional shared-password gate in your hosting service before entering sensitive records on a public deployment.</p>{authProtected ? <div className="success-box"><LockKeyhole size={13} style={{ verticalAlign: -3, marginRight: 6 }} /> Access protection is active. Your browser session uses an HttpOnly, SameSite cookie.</div> : <div className="warning-box"><AlertTriangle size={14} /> No access password is configured. The application and its workout API are publicly accessible. Configure GYMPULSE_ACCESS_PASSWORD and GYMPULSE_AUTH_SECRET on your deployment before using this URL privately.</div>}<div className="field-hint" style={{ marginTop: 12 }}>The optional access gate uses a 14-day signed session cookie and timing-safe password comparison. Use a long unique password and a separate signing secret.</div>{authProtected && <button className="btn btn-danger" style={{ marginTop: 12 }} onClick={onLogout}><LogOut size={13} /> Lock this browser session</button>}</section><section className="settings-card"><h3>AI, monitoring, and availability</h3><p>Deterministic analytics stay local and are available without an AI provider. If optional AI is configured, only aggregate stats are sent to the provider; workout notes and the API key are not sent to the browser.</p><div className="warning-box"><Activity size={14} /> Optional self-ping is disabled in source by default. It is for basic health monitoring only—Render free services can still spin down, and self-pinging does not guarantee 24/7 uptime.</div><p style={{ marginTop: 12 }}>The installed PWA caches only static assets. Workout writes always require a live server/database; no offline unsynced records are stored. Installing the PWA is not the same as installing a native Android APK.</p></section></>}
      </div>
    </div>
  </div>;
}

function MeasurementInput({ id, label, value, setValue }: { id: string; label: string; value: string; setValue: (value: string) => void }) {
  return <div><label className="field-label" htmlFor={id}>{label}</label><input className="input" id={id} type="number" min="0.1" max="1000" step="0.1" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Optional" /></div>;
}
