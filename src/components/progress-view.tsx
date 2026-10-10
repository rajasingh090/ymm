"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, ArrowDownRight, ArrowUpRight, Award, BarChart3, CalendarCheck2, CheckCircle2, Clock3, Dumbbell, Flame, Gauge, Lightbulb, LoaderCircle, Moon, Sparkles, Target, TrendingUp, Zap } from "lucide-react";
import { Bar, Line } from "react-chartjs-2";
import { apiJSON } from "@/lib/client-utils";
import { addDays, dayOfWeek, daysBetween, formatDate, indiaToday, monthStart } from "@/lib/client-utils";
import type { AttendanceRecord, GymData, WorkoutSession } from "@/lib/types";

const COLORS = ["#b8f56a", "#8ccf62", "#83c9ff", "#e5bb70", "#b69aff", "#ff8179", "#75d5bc"];
const MUSCLES = ["Biceps", "Triceps", "Legs", "Shoulders", "Chest", "Back", "Forearms"];
const PERIODS = [
  { key: "7d", label: "7D" }, { key: "30d", label: "30D" }, { key: "90d", label: "90D" },
  { key: "6m", label: "6M" }, { key: "12m", label: "12M" }, { key: "all", label: "All time" }, { key: "custom", label: "Custom" },
] as const;
type Period = (typeof PERIODS)[number]["key"];
type CoachReport = {
  localInsights: string[];
  stats: {
    totalSessions: number; sessionsLast7Days: number; sessionsLast30Days: number; sessionsPrior30Days: number;
    averageDurationLast30: number | null; averageDurationPrior30: number | null; totalHours: number;
    attendancePercent: number | null; currentStreak: number; longestStreak: number; missedDays: number;
    muscles: { muscle: string; sessions: number; lastTrained: string | null; daysSince: number | null }[];
    strengthHighlights: { exercise: string; setsLogged: number; totalVolumeKg: number; estimatedOneRepMaxKg: number | null; bestSet: string | null }[];
  };
  dataQuality: string;
  aiEnabled: boolean;
};

type Props = { data: GymData; today: string; onLog: () => void };
const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 650 },
  plugins: { legend: { display: false }, tooltip: { backgroundColor: "#212820", borderColor: "rgba(255,255,255,.09)", borderWidth: 1, titleColor: "#f1f4ef", bodyColor: "#c0cabd", padding: 10, displayColors: false } },
  scales: {
    x: { grid: { display: false }, border: { display: false }, ticks: { color: "#778176", font: { size: 9, family: "Arial" } } },
    y: { beginAtZero: true, grid: { color: "rgba(224,241,222,.055)" }, border: { display: false }, ticks: { color: "#778176", font: { size: 9, family: "Arial" }, precision: 0 } },
  },
} as const;

function monday(date: string) { return addDays(date, -((dayOfWeek(date) + 6) % 7)); }
function shiftMonth(date: string, amount: number) {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function monthEnd(date: string) {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
function periodStart(period: Period, today: string, firstRecord: string | null, customFrom: string, customTo: string) {
  if (period === "all") return firstRecord ?? today;
  if (period === "custom") return customFrom || today;
  if (period === "7d") return addDays(today, -6);
  if (period === "30d") return addDays(today, -29);
  if (period === "90d") return addDays(today, -89);
  if (period === "6m") return shiftMonth(monthStart(today), -5);
  return shiftMonth(monthStart(today), -11);
}
function accuracyPeriod(sessions: WorkoutSession[], attendance: AttendanceRecord[], from: string, to: string, today: string) {
  const visits = new Set([
    ...sessions.filter((item) => item.workoutDate >= from && item.workoutDate <= to && item.workoutDate <= today).map((item) => item.workoutDate),
    ...attendance.filter((item) => item.status === "went" && item.attendanceDate >= from && item.attendanceDate <= to && item.attendanceDate <= today).map((item) => item.attendanceDate),
  ]);
  const misses = new Set(attendance.filter((item) => item.status === "missed" && item.attendanceDate >= from && item.attendanceDate <= to && item.attendanceDate <= today).map((item) => item.attendanceDate).filter((date) => !visits.has(date)));
  return { visits: visits.size, missed: misses.size, percent: visits.size + misses.size ? Math.round(visits.size / (visits.size + misses.size) * 100) : null };
}
function formatMinutes(value: number | null) { return value === null ? "—" : `${value} min`; }

export default function ProgressView({ data, today, onLog }: Props) {
  const [tab, setTab] = useState<"analytics" | "coach">("analytics");
  const [period, setPeriod] = useState<Period>("90d");
  const [customFrom, setCustomFrom] = useState(addDays(today, -29));
  const [customTo, setCustomTo] = useState(today);
  const [exerciseFilter, setExerciseFilter] = useState("all");
  const [coach, setCoach] = useState<CoachReport | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const [coachError, setCoachError] = useState("");

  const firstRecord = useMemo(() => [...data.sessions.map((item) => item.workoutDate), ...data.attendance.map((item) => item.attendanceDate)].sort()[0] ?? null, [data.sessions, data.attendance]);
  const from = periodStart(period, today, firstRecord, customFrom, customTo);
  const to = period === "custom" && customTo && customTo < today ? customTo : today;
  const rangeSessions = useMemo(() => data.sessions.filter((session) => session.workoutDate >= from && session.workoutDate <= to && session.workoutDate <= today).sort((a, b) => a.workoutDate.localeCompare(b.workoutDate) || a.id - b.id), [data.sessions, from, to, today]);
  const muscleCounts = MUSCLES.map((muscle) => rangeSessions.filter((session) => session.muscleGroups.includes(muscle)).length);
  const exerciseNames = [...new Set(rangeSessions.flatMap((session) => session.exercises.map((exercise) => exercise.name)))].sort((a, b) => a.localeCompare(b));
  const selectedExercise = exerciseFilter === "all" ? exerciseNames[0] ?? "" : exerciseFilter;
  const strengthPoints = rangeSessions.flatMap((session) => {
    const sets = session.exercises.filter((exercise) => exercise.name.toLowerCase() === selectedExercise.toLowerCase()).flatMap((exercise) => exercise.sets);
    if (!sets.length) return [];
    const best = Math.max(...sets.filter((set) => set.weightKg > 0 && set.reps <= 15).map((set) => set.weightKg * (1 + set.reps / 30)), 0);
    const maxWeight = Math.max(...sets.map((set) => set.weightKg), 0);
    const volume = sets.reduce((sum, set) => sum + set.weightKg * set.reps, 0);
    return [{ date: session.workoutDate, estimated: best || null, maxWeight, volume }];
  });
  const strengthByDate = new Map<string, { estimated: number | null; maxWeight: number; volume: number }>();
  for (const point of strengthPoints) {
    const current = strengthByDate.get(point.date);
    strengthByDate.set(point.date, { estimated: Math.max(current?.estimated ?? 0, point.estimated ?? 0) || null, maxWeight: Math.max(current?.maxWeight ?? 0, point.maxWeight), volume: (current?.volume ?? 0) + point.volume });
  }
  const strengthDates = [...strengthByDate.keys()].sort();
  const volumeByWeek = useMemo(() => {
    const values: { label: string; value: number }[] = [];
    const currentMonday = monday(today);
    for (let offset = 7; offset >= 0; offset -= 1) {
      const start = addDays(currentMonday, -offset * 7);
      const end = addDays(start, 6);
      const rows = rangeSessions.filter((session) => session.workoutDate >= start && session.workoutDate <= end);
      const volume = rows.reduce((sum, session) => sum + session.exercises.reduce((exerciseTotal, exercise) => exerciseTotal + exercise.sets.reduce((setTotal, set) => setTotal + set.weightKg * set.reps, 0), 0), 0);
      values.push({ label: new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(`${start}T12:00:00+05:30`)), value: Math.round(volume) });
    }
    return values;
  }, [rangeSessions, today]);
  const weeklyBars = useMemo(() => Array.from({ length: 8 }, (_, index) => {
    const start = addDays(monday(today), (index - 7) * 7);
    const end = addDays(start, 6);
    const rows = rangeSessions.filter((session) => session.workoutDate >= start && session.workoutDate <= end);
    return { start, label: new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(`${start}T12:00:00+05:30`)), sessions: rows.length, minutes: rows.reduce((sum, row) => sum + row.durationMinutes, 0) };
  }), [rangeSessions, today]);
  const attendanceMonths = useMemo(() => Array.from({ length: 6 }, (_, index) => {
    const start = shiftMonth(monthStart(today), index - 5);
    const end = start.slice(0, 7) === today.slice(0, 7) ? today : monthEnd(start);
    const counted = accuracyPeriod(data.sessions, data.attendance, start, end, today);
    return { label: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "Asia/Kolkata" }).format(new Date(`${start}T12:00:00+05:30`)), percent: counted.percent ?? 0, visits: counted.visits, missed: counted.missed };
  }), [data.sessions, data.attendance, today]);
  const selectedRangeAttendance = accuracyPeriod(data.sessions, data.attendance, from, to, today);
  const durationAverage = rangeSessions.length ? Math.round(rangeSessions.reduce((sum, session) => sum + session.durationMinutes, 0) / rangeSessions.length) : 0;
  const uniqueTrainingWeeks = firstRecord ? Math.max(1, Math.ceil((daysBetween(today, firstRecord) + 1) / 7)) : 0;
  const avgSessionsPerWeek = uniqueTrainingWeeks ? Math.round(data.sessions.filter((session) => session.workoutDate <= today).length / uniqueTrainingWeeks * 10) / 10 : 0;
  const personalRecords = useMemo(() => {
    const records = new Map<string, { display: string; maxWeight: number; bestEstimated: number; bestSet: string; volume: number; count: number }>();
    for (const session of data.sessions.filter((item) => item.workoutDate <= today)) for (const exercise of session.exercises) {
      const key = exercise.name.toLowerCase();
      const record = records.get(key) ?? { display: exercise.name, maxWeight: 0, bestEstimated: 0, bestSet: "—", volume: 0, count: 0 };
      for (const set of exercise.sets) {
        record.volume += set.weightKg * set.reps;
        record.count += 1;
        if (set.weightKg > record.maxWeight) record.maxWeight = set.weightKg;
        if (set.weightKg > 0 && set.reps <= 15) {
          const estimate = set.weightKg * (1 + set.reps / 30);
          if (estimate > record.bestEstimated) { record.bestEstimated = estimate; record.bestSet = `${set.weightKg} kg × ${set.reps}`; }
        }
      }
      records.set(key, record);
    }
    return [...records.values()].sort((a, b) => b.bestEstimated - a.bestEstimated || b.volume - a.volume).slice(0, 10);
  }, [data.sessions, today]);
  const currentMonthStart = monthStart(today);
  const previousMonthStart = shiftMonth(currentMonthStart, -1);
  const previousMonthEnd = monthEnd(previousMonthStart);
  const currentMonthSessions = data.sessions.filter((session) => session.workoutDate.startsWith(today.slice(0, 7)) && session.workoutDate <= today);
  const previousMonthSessions = data.sessions.filter((session) => session.workoutDate >= previousMonthStart && session.workoutDate <= previousMonthEnd);
  const currentMonthDuration = currentMonthSessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const previousMonthDuration = previousMonthSessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const currentMonthRate = accuracyPeriod(data.sessions, data.attendance, currentMonthStart, today, today).percent;
  const previousMonthRate = accuracyPeriod(data.sessions, data.attendance, previousMonthStart, previousMonthEnd, today).percent;
  const exerciseLoggedSessions = new Set(data.sessions.filter((session) => session.workoutDate <= today && session.exercises.length > 0).map((session) => session.id)).size;
  const dataQuality = data.sessions.length >= 20 && exerciseLoggedSessions >= 10 ? "Strong history" : data.sessions.length >= 6 ? "Building history" : "Early history";

  useEffect(() => {
    if (tab !== "coach" || coach) return;
    let active = true;
    setCoachLoading(true);
    setCoachError("");
    void apiJSON<CoachReport>("/api/coach", { cache: "no-store" }).then((result) => { if (active) setCoach(result); }).catch((error) => { if (active) setCoachError(error instanceof Error ? error.message : "Analysis is temporarily unavailable."); }).finally(() => { if (active) setCoachLoading(false); });
    return () => { active = false; };
  }, [tab, coach]);

  async function askAi() {
    setAiLoading(true); setAiMessage(""); setAiText("");
    try {
      const result = await apiJSON<{ aiEnabled: boolean; aiText: string | null; message: string | null }>("/api/coach", { method: "POST", body: JSON.stringify({}) });
      setAiText(result.aiText ?? "");
      setAiMessage(result.message ?? "");
    } catch (error) { setAiMessage(error instanceof Error ? error.message : "AI analysis is unavailable."); }
    finally { setAiLoading(false); }
  }

  const periodButtons = <div className="range-filters" aria-label="Analytics date range">{PERIODS.map((item) => <button type="button" key={item.key} className={period === item.key ? "selected" : ""} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div>;

  function analytics() {
    const sessionsByWeek = weeklyBars.map((item) => item.sessions);
    const durationByWeek = weeklyBars.map((item) => item.minutes);
    const monthlyRateValues = attendanceMonths.map((item) => item.percent);
    return <>
      <section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">Sessions per week</h2><p className="panel-subtitle">Actual logged workouts · most recent eight calendar weeks</p></div></div><div className="chart-box"><Bar data={{ labels: weeklyBars.map((item) => item.label), datasets: [{ label: "Sessions", data: sessionsByWeek, backgroundColor: sessionsByWeek.map((value) => value ? "#9bdd57" : "#2b332d"), borderRadius: 6, borderSkipped: false, maxBarThickness: 35 }] }} options={{ ...baseOptions, scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, suggestedMax: Math.max(3, ...sessionsByWeek) } } }} /></div></section>
      <div className="grid-equal"><section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">Monthly attendance rate</h2><p className="panel-subtitle">Gym visit ÷ (gym visit + confirmed missed). Rest and unrecorded excluded.</p></div></div><div className="chart-box small"><Line data={{ labels: attendanceMonths.map((item) => item.label), datasets: [{ label: "Attendance %", data: monthlyRateValues, borderColor: "#b8f56a", backgroundColor: "rgba(184,245,106,.1)", fill: true, tension: .35, pointRadius: 3, pointBackgroundColor: "#b8f56a", spanGaps: true }] }} options={{ ...baseOptions, scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, max: 100, ticks: { ...baseOptions.scales.y.ticks, callback: (value) => `${value}%` } } } }} /></div></section>
      <section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">Muscle frequency</h2><p className="panel-subtitle">Training sessions in the selected range</p></div></div><div className="muscle-stat-list">{MUSCLES.map((muscle, index) => <div className="muscle-stat" key={muscle}><span className="muscle-stat-name">{muscle}</span><span className="muscle-stat-track"><i style={{ width: muscleCounts[index] ? `${Math.max(8, muscleCounts[index] / Math.max(1, ...muscleCounts) * 100)}%` : "0%", background: COLORS[index] }} /></span><span className="muscle-stat-count">{muscleCounts[index]}</span></div>)}</div></section></div>
      <div className="grid-equal"><section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">Workout duration</h2><p className="panel-subtitle">Weekly logged minutes across your selected range</p></div></div><div className="chart-box small"><Bar data={{ labels: weeklyBars.map((item) => item.label), datasets: [{ label: "Minutes", data: durationByWeek, backgroundColor: "rgba(131,201,255,.68)", borderRadius: 6, borderSkipped: false, maxBarThickness: 35 }] }} options={{ ...baseOptions, scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, ticks: { ...baseOptions.scales.y.ticks, callback: (value) => `${value}m` } } } }} /></div></section>
      <section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">Training volume</h2><p className="panel-subtitle">Σ weight × repetitions per week · recorded working sets</p></div></div><div className="chart-box small"><Line data={{ labels: volumeByWeek.map((item) => item.label), datasets: [{ label: "Volume (kg × reps)", data: volumeByWeek.map((item) => item.value), borderColor: "#d5aefa", backgroundColor: "rgba(182,154,255,.08)", fill: true, tension: .33, pointRadius: 2.5, pointBackgroundColor: "#d5aefa" }] }} options={baseOptions} /></div></section></div>
      <section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">Strength progression</h2><p className="panel-subtitle">Same exercise name · best estimated 1RM per recorded session, where load and reps exist</p></div><select className="select" style={{ width: 185, minHeight: 35, fontSize: 9 }} aria-label="Choose exercise for strength progression" value={exerciseFilter} onChange={(event) => setExerciseFilter(event.target.value)}><option value="all">{exerciseNames[0] ? `Suggested: ${exerciseNames[0]}` : "Select exercise"}</option>{exerciseNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></div>{strengthDates.length ? <div className="chart-box large"><Line data={{ labels: strengthDates.map((date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(`${date}T12:00:00+05:30`))), datasets: [{ label: "Estimated 1RM (kg)", data: strengthDates.map((date) => strengthByDate.get(date)?.estimated ?? null), borderColor: "#b8f56a", backgroundColor: "rgba(184,245,106,.08)", fill: true, tension: .28, spanGaps: true, pointRadius: 4, pointBackgroundColor: "#b8f56a" }, { label: "Heaviest logged set (kg)", data: strengthDates.map((date) => strengthByDate.get(date)?.maxWeight ?? null), borderColor: "#83c9ff", backgroundColor: "transparent", borderDash: [4, 4], tension: .25, spanGaps: true, pointRadius: 3, pointBackgroundColor: "#83c9ff" }] }} options={{ ...baseOptions, plugins: { ...baseOptions.plugins, legend: { display: true, labels: { color: "#929b90", boxWidth: 8, boxHeight: 8, usePointStyle: true, font: { size: 9 } } } } }} /></div> : <div className="empty-state" style={{ minHeight: 125 }}><div><span className="empty-state-icon"><Dumbbell size={18} /></span><h3>Strength data starts with sets</h3><p>Record the same exercise with repetitions and weight to compare estimated performance. These are estimates, not max-lift instructions.</p></div></div>}<p className="field-hint" style={{ marginTop: 9 }}>Estimated 1RM uses the Epley estimate (weight × [1 + reps ÷ 30]) on logged sets up to 15 reps. Compare only when exercise name and conditions are reasonably equivalent.</p></section>
      <div className="grid-equal"><section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">Personal records</h2><p className="panel-subtitle">Best recorded result by exercise · all time</p></div><Award size={16} color="#b8f56a" /></div>{personalRecords.length ? <div style={{ overflowX: "auto" }}><table className="pr-table"><thead><tr><th>Exercise</th><th>Heaviest</th><th>Est. 1RM</th><th>Sets</th></tr></thead><tbody>{personalRecords.map((record) => <tr key={record.display}><td>{record.display}</td><td>{record.maxWeight ? `${record.maxWeight} kg` : "—"}</td><td>{record.bestEstimated ? `${record.bestEstimated.toFixed(1)} kg` : "—"}</td><td>{record.count}</td></tr>)}</tbody></table></div> : <div className="history-empty">No working sets have been recorded yet.</div>}</section>
      <section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">Month over month</h2><p className="panel-subtitle">Current month to date vs previous full month</p></div><TrendingUp size={15} color="#b8f56a" /></div><CompareRow label="Workout sessions" current={currentMonthSessions.length} previous={previousMonthSessions.length} suffix="" /><CompareRow label="Logged workout time" current={Math.round(currentMonthDuration / 60 * 10) / 10} previous={Math.round(previousMonthDuration / 60 * 10) / 10} suffix=" hrs" /><CompareRow label="Attendance rate" current={currentMonthRate} previous={previousMonthRate} suffix="%" /><p className="field-hint" style={{ marginTop: 12 }}>The current month is month-to-date; the comparison month is complete. Percentages use recorded attended and confirmed-missed days only.</p></section></div>
      {data.measurements.some((item) => item.weightKg !== null) && <section className="panel panel-pad" style={{ marginTop: 14 }}><div className="panel-head"><div><h2 className="panel-title">Body weight journal</h2><p className="panel-subtitle">Optional measurements you recorded · attendance alone does not establish physical change</p></div></div><div className="chart-box small"><Line data={{ labels: [...data.measurements].filter((item) => item.weightKg !== null).sort((a, b) => a.measuredOn.localeCompare(b.measuredOn)).map((item) => formatDate(item.measuredOn, { day: "numeric", month: "short" })), datasets: [{ label: "Weight (kg)", data: [...data.measurements].filter((item) => item.weightKg !== null).sort((a, b) => a.measuredOn.localeCompare(b.measuredOn)).map((item) => item.weightKg), borderColor: "#83c9ff", backgroundColor: "rgba(131,201,255,.1)", fill: true, tension: .3, pointRadius: 3 }] }} options={baseOptions} /></div></section>}
    </>;
  }

  function coachPage() {
    const stats = coach?.stats;
    return <>
      <section className="coach-hero"><div className="eyebrow"><Sparkles size={12} /> GYMPULSE AI COACH</div><h2>Your progress, explained by your log.</h2><p>Local analysis describes patterns in records you have actually saved. It does not infer muscle growth from attendance or make recovery or medical predictions. Add exercises, sets, repetitions, and weights to make strength analysis more informative.</p></section>
      {coachError && <div className="alert-bar" style={{ marginTop: 12 }}><AlertCircle size={14} />{coachError}</div>}
      {coachLoading ? <section className="panel panel-pad" style={{ marginTop: 14 }}><div className="loading-header skeleton" style={{ height: 28 }} /><div className="skeleton" style={{ height: 110, marginTop: 14 }} /></section> : <div className="coach-content">
        <section className="panel panel-pad"><div className="panel-head"><div><h3 className="panel-title">What your records say</h3><p className="panel-subtitle">Deterministic analysis from actual saved sessions and attendance</p></div><span className="stat-icon"><Lightbulb size={15} /></span></div><div className="coach-insights">{coach?.localInsights.map((insight, index) => <div className="coach-insight" key={`${insight}-${index}`}><CheckCircle2 className="coach-insight-icon" size={14} /><p>{insight}</p></div>) ?? <div className="history-empty">Analysis is not available yet.</div>}</div><div className="grid-equal" style={{ marginTop: 12 }}><div className="settings-card" style={{ padding: 13 }}><div className="field-hint">Sessions · last 7 days</div><div className="stat-value" style={{ fontSize: 21, marginTop: 7 }}>{stats?.sessionsLast7Days ?? 0}</div></div><div className="settings-card" style={{ padding: 13 }}><div className="field-hint">Confirmed attendance</div><div className="stat-value" style={{ fontSize: 21, marginTop: 7 }}>{stats?.attendancePercent === null || stats?.attendancePercent === undefined ? "—" : `${stats.attendancePercent}%`}</div></div></div></section>
        <div className="settings-stack"><section className="quality-card"><div className="quality-head"><span className="quality-title">Analysis data quality</span><span className="quality-badge">{coach?.dataQuality ?? "Early history"}</span></div><p>Based on {stats?.totalSessions ?? 0} completed sessions. Exercise comparisons use names and saved set details. This is a measure of log completeness, not the accuracy of your body's response.</p><div className="quality-metric"><span>Logged sessions</span><strong>{stats?.totalSessions ?? 0}</strong></div><div className="quality-metric"><span>Average, last 30 days</span><strong>{formatMinutes(stats?.averageDurationLast30 ?? null)}</strong></div><div className="quality-metric"><span>Training history</span><strong>{stats?.totalHours ?? 0} h</strong></div></section>
          <section className="quality-card"><div className="quality-head"><span className="quality-title">Muscle history</span><span className="quality-badge">Log-based</span></div>{stats?.muscles.length ? <div className="recovery-grid" style={{ marginTop: 12 }}>{MUSCLES.map((muscle) => { const entry = stats.muscles.find((item) => item.muscle === muscle); return <div className="recovery-item" key={muscle}><span className="recovery-name">{muscle}</span><span className={`recovery-ago ${entry?.daysSince !== null && entry?.daysSince !== undefined && entry.daysSince <= 7 ? "recent" : ""}`}>{entry ? `${entry.daysSince}d ago · ${entry.sessions}×` : "Not logged"}</span></div>; })}</div> : <p>Log a session with its muscle groups to start this timeline.</p>}<p>This shows the last recorded training date—not an estimate of recovery or a recommendation to train.</p></section></div>
      </div>}
      {stats?.strengthHighlights.length ? <section className="panel panel-pad" style={{ marginTop: 14 }}><div className="panel-head"><div><h3 className="panel-title">Strength signals in your data</h3><p className="panel-subtitle">Estimated values are comparisons only; they are not tested one-rep maximums.</p></div></div><div style={{ overflowX: "auto" }}><table className="pr-table"><thead><tr><th>Exercise</th><th>Sets</th><th>Logged volume</th><th>Estimated 1RM</th></tr></thead><tbody>{stats.strengthHighlights.map((item) => <tr key={item.exercise}><td>{item.exercise}</td><td>{item.setsLogged}</td><td>{item.totalVolumeKg.toLocaleString()} kg × reps</td><td>{item.estimatedOneRepMaxKg === null ? "—" : `${item.estimatedOneRepMaxKg} kg estimate`}</td></tr>)}</tbody></table></div></section> : <section className="panel panel-pad" style={{ marginTop: 14 }}><div className="empty-state" style={{ minHeight: 125 }}><div><span className="empty-state-icon"><Dumbbell size={18} /></span><h3>Strength trends need exercise data</h3><p>Record exercise names with sets, reps, and weight. Attendance records alone cannot show strength or muscle growth.</p><button className="btn btn-sm btn-primary" onClick={onLog}><Dumbbell size={12} /> Log exercises</button></div></div></section>}
      <section className="panel panel-pad" style={{ marginTop: 14 }}><div className="panel-head"><div><h3 className="panel-title">Optional AI explanation</h3><p className="panel-subtitle">When configured, the server sends aggregate stats only. The API key never reaches the browser.</p></div><span className={`quality-badge ${coach?.aiEnabled ? "" : ""}`}>{coach?.aiEnabled ? "Available" : "Off"}</span></div><div className="filter-row"><button className="btn btn-primary" disabled={aiLoading || !coach?.aiEnabled} onClick={() => void askAi()}>{aiLoading ? <><LoaderCircle size={14} className="spin" /> Thinking…</> : <><Sparkles size={14} /> Ask GymPulse AI</>}</button>{!coach?.aiEnabled && <span className="field-hint" style={{ margin: 0 }}>The local coach above works without an AI API key.</span>}</div>{aiMessage && <div className="field-hint" style={{ marginTop: 10 }}>{aiMessage}</div>}{aiText && <div className="ai-output">{aiText}</div>}<p className="field-hint" style={{ marginTop: 12 }}>External AI is optional. It receives summary counts, training trends, and exercise statistics—not your workout notes. Never use generated text as medical advice.</p></section>
    </>;
  }

  return <div className="page-enter"><div className="page-heading"><div><div className="eyebrow"><span className="dot" /> YOUR DATA, YOUR PROGRESS</div><h1 className="page-title" style={{ marginTop: 10 }}>Progress that means something.</h1><p className="page-description">Every chart is calculated from your completed workout and attendance records—never planned workouts or made-up targets.</p></div><div className="heading-actions"><button className="btn btn-primary" onClick={onLog}><Dumbbell size={14} /> Log workout</button></div></div>
    <div className="panel panel-pad" style={{ marginBottom: 13 }}><div className="panel-head" style={{ marginBottom: period === "custom" ? 11 : 0 }}><div><h2 className="panel-title">Analysis window</h2><p className="panel-subtitle">The selected range updates muscle frequency, weekly totals, volume, and exercise progress.</p></div>{periodButtons}</div>{period === "custom" && <div className="filter-row"><label className="field-hint" htmlFor="analytics-from">From</label><input className="input" style={{ width: 170, minHeight: 35 }} id="analytics-from" type="date" max={today} value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /><label className="field-hint" htmlFor="analytics-to">To</label><input className="input" style={{ width: 170, minHeight: 35 }} id="analytics-to" type="date" min={customFrom} max={today} value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></div>}</div>
    <div className="stat-grid"><SmallStat icon={<Dumbbell size={15} />} label="Sessions in range" value={rangeSessions.length} /><SmallStat icon={<Clock3 size={15} />} label="Average session" value={rangeSessions.length ? `${durationAverage} min` : "—"} /><SmallStat icon={<CalendarCheck2 size={15} />} label="Recorded attendance" value={selectedRangeAttendance.percent === null ? "—" : `${selectedRangeAttendance.percent}%`} /><SmallStat icon={<Gauge size={15} />} label="Sessions / week" value={avgSessionsPerWeek} /></div>
    <div className="panel panel-pad" style={{ marginBottom: 13 }}><div className="segmented"><button className={tab === "analytics" ? "selected" : ""} onClick={() => setTab("analytics")}><BarChart3 size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Analytics</button><button className={tab === "coach" ? "selected" : ""} onClick={() => setTab("coach")}><Sparkles size={12} style={{ verticalAlign: -2, marginRight: 4 }} />GymPulse AI Coach</button></div><span className="field-hint" style={{ marginLeft: 10 }}>Selected range: {formatDate(from, { month: "short", day: "numeric", year: "numeric" })} – {formatDate(to, { month: "short", day: "numeric", year: "numeric" })}</span></div>
    {tab === "analytics" ? analytics() : coachPage()}
    <div className="field-hint" style={{ marginTop: 14 }}>Data quality: <strong style={{ color: "var(--text)" }}>{dataQuality}</strong> · {exerciseLoggedSessions} of {data.sessions.length} saved sessions include at least one exercise. Add sets, reps, and weights for strength estimates. No attendance-only record is interpreted as physical progress.</div>
    </div>;
}

function SmallStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) { return <article className="stat-card"><div className="stat-top"><span className="stat-label">{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value" style={{ fontSize: 22 }}>{value}</div></article>; }
function CompareRow({ label, current, previous, suffix }: { label: string; current: number | null; previous: number | null; suffix: string }) {
  const difference = current !== null && previous !== null ? current - previous : null;
  return <div className="compare-row"><span>{label}</span><strong>{current === null ? "—" : `${current}${suffix}`}</strong><span className={`compare-difference ${difference === null ? "" : difference > 0 ? "up" : difference < 0 ? "down" : ""}`}>{difference === null ? "—" : difference === 0 ? "No change" : <>{difference > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(difference)}{suffix}</>}</span><span className="compare-previous">vs {previous === null ? "—" : `${previous}${suffix}`}</span></div>;
}
