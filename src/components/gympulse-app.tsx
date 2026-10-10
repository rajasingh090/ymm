"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertCircle, ArrowRight, Award, BarChart3, CalendarCheck2, CalendarDays,
  CheckCircle2, ChevronLeft, ChevronRight, Clock3, Dumbbell, Flame, Gauge, HeartPulse,
  History, Home, Lightbulb, LockKeyhole, LogOut, Moon, Plus, Search, Settings2,
  ShieldCheck, Sparkles, Target, Timer, TrendingUp, X, Zap,
} from "lucide-react";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import {
  ArcElement, BarElement, CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale,
  LineElement, PointElement, Tooltip,
} from "chart.js";
import WorkoutModal from "@/components/workout-modal";
import ProgressView from "@/components/progress-view";
import SettingsView from "@/components/settings-view";
import { ApiError, addDays, apiJSON, attendanceStatusForDate, dayOfWeek, daysBetween, formatDate, indiaToday, monthStart, shortDate } from "@/lib/client-utils";
import type { AttendanceRecord, CalendarResponse, GymData, Muscle, WorkoutSession } from "@/lib/types";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler);

type Page = "home" | "calendar" | "history" | "progress" | "settings";
type AuthState = { protected: boolean; authenticated: boolean };
type Metrics = {
  sessions: WorkoutSession[];
  visitDates: Set<string>;
  missedDates: Set<string>;
  restDates: Set<string>;
  unrecordedDays: number;
  visits: number;
  totalSessions: number;
  weekSessions: number;
  monthSessions: number;
  totalHours: number;
  averageDuration: number;
  sessionsPerWeek: number;
  attendanceRate: number | null;
  currentStreak: number;
  longestStreak: number;
  weekDates: string[];
  weekVisitCount: number;
  weekMissedCount: number;
  monthVisits: number;
  monthMissed: number;
  monthRest: number;
  monthHours: number;
  monthRate: number | null;
};

const MUSCLES: Muscle[] = ["Biceps", "Triceps", "Legs", "Shoulders", "Chest", "Back", "Forearms"];
const EMPTY_DATA: GymData = { sessions: [], attendance: [], goals: { weeklySessions: 4, monthlyAttendancePercent: 75, monthlyHours: 12 }, measurements: [], splits: [], settings: {} };
const COLORS = ["#b8f56a", "#8ccf62", "#83c9ff", "#e5bb70", "#b69aff", "#ff8179", "#75d5bc"];
const navItems: { key: Page; label: string; icon: typeof Home }[] = [
  { key: "home", label: "Home", icon: Home },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "history", label: "History", icon: History },
  { key: "progress", label: "Progress", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: Settings2 },
];
const chartBase = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 650 },
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: "#212820", borderColor: "rgba(255,255,255,.09)", borderWidth: 1, titleColor: "#f1f4ef", bodyColor: "#c0cabd", padding: 10, displayColors: false },
  },
  scales: {
    x: { grid: { display: false }, border: { display: false }, ticks: { color: "#778176", font: { size: 9, family: "Arial" } } },
    y: { beginAtZero: true, grid: { color: "rgba(224,241,222,.055)" }, border: { display: false }, ticks: { color: "#778176", font: { size: 9, family: "Arial" }, precision: 0 } },
  },
} as const;

function isoToday() { return indiaToday(); }
function floorToMonday(date: string) { return addDays(date, -((dayOfWeek(date) + 6) % 7)); }
function countAttendance(sessions: WorkoutSession[], attendance: AttendanceRecord[], today: string, from: string, to: string) {
  const visits = new Set([
    ...sessions.filter((session) => session.workoutDate >= from && session.workoutDate <= to && session.workoutDate <= today).map((session) => session.workoutDate),
    ...attendance.filter((record) => record.status === "went" && record.attendanceDate >= from && record.attendanceDate <= to && record.attendanceDate <= today).map((record) => record.attendanceDate),
  ]);
  const missed = new Set(attendance.filter((record) => record.status === "missed" && record.attendanceDate >= from && record.attendanceDate <= to && record.attendanceDate <= today).map((record) => record.attendanceDate).filter((date) => !visits.has(date)));
  return { visits: visits.size, missed: missed.size, percent: visits.size + missed.size ? Math.round(visits.size / (visits.size + missed.size) * 100) : null };
}

function calculateMetrics(data: GymData, today: string): Metrics {
  const sessions = data.sessions.filter((session) => session.workoutDate <= today);
  const attendance = data.attendance.filter((record) => record.attendanceDate <= today);
  const visitDates = new Set([...sessions.map((session) => session.workoutDate), ...attendance.filter((record) => record.status === "went").map((record) => record.attendanceDate)]);
  const missedDates = new Set(attendance.filter((record) => record.status === "missed").map((record) => record.attendanceDate).filter((date) => !visitDates.has(date)));
  const restDates = new Set(attendance.filter((record) => record.status === "rest").map((record) => record.attendanceDate));
  const recordedDates = new Set([...visitDates, ...missedDates, ...restDates]);
  const firstDate = [...recordedDates].sort()[0];
  const unrecordedDays = firstDate ? Math.max(0, daysBetween(today, firstDate) + 1 - recordedDates.size) : 0;
  const sortedVisits = [...visitDates].sort();
  let currentStreak = 0;
  let cursor = visitDates.has(today) ? today : addDays(today, -1);
  if (visitDates.has(cursor)) {
    currentStreak = 1;
    while (visitDates.has(addDays(cursor, -1))) { cursor = addDays(cursor, -1); currentStreak += 1; }
  }
  let longestStreak = 0;
  let streak = 0;
  let previous = "";
  for (const date of sortedVisits) {
    streak = previous && daysBetween(date, previous) === 1 ? streak + 1 : 1;
    previous = date;
    longestStreak = Math.max(longestStreak, streak);
  }
  const weekStart = floorToMonday(today);
  const monthStartDate = monthStart(today);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
  const weekSessions = sessions.filter((session) => session.workoutDate >= weekStart && session.workoutDate <= today).length;
  const monthSessions = sessions.filter((session) => session.workoutDate.startsWith(today.slice(0, 7))).length;
  const durationRows = sessions.filter((session) => session.durationMinutes > 0);
  const durationTotal = sessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const elapsedWeeks = firstDate ? Math.max(1, Math.ceil((daysBetween(today, firstDate) + 1) / 7)) : 0;
  const monthlyAttendance = countAttendance(data.sessions, data.attendance, today, monthStartDate, today);
  const monthRest = data.attendance.filter((record) => record.status === "rest" && record.attendanceDate.startsWith(today.slice(0, 7)) && record.attendanceDate <= today).length;
  const weekAttendance = countAttendance(data.sessions, data.attendance, today, weekStart, today);
  return {
    sessions,
    visitDates,
    missedDates,
    restDates,
    unrecordedDays,
    visits: visitDates.size,
    totalSessions: sessions.length,
    weekSessions,
    monthSessions,
    totalHours: Math.round(durationTotal / 60 * 10) / 10,
    averageDuration: durationRows.length ? Math.round(durationTotal / durationRows.length) : 0,
    sessionsPerWeek: elapsedWeeks ? Math.round(sessions.length / elapsedWeeks * 10) / 10 : 0,
    attendanceRate: visitDates.size + missedDates.size ? Math.round(visitDates.size / (visitDates.size + missedDates.size) * 100) : null,
    currentStreak,
    longestStreak,
    weekDates,
    weekVisitCount: weekAttendance.visits,
    weekMissedCount: weekAttendance.missed,
    monthVisits: monthlyAttendance.visits,
    monthMissed: monthlyAttendance.missed,
    monthRest,
    monthHours: Math.round(sessions.filter((session) => session.workoutDate.startsWith(today.slice(0, 7))).reduce((sum, session) => sum + session.durationMinutes, 0) / 60 * 10) / 10,
    monthRate: monthlyAttendance.percent,
  };
}

function greet() {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function MiniSession({ session, onEdit }: { session: WorkoutSession; onEdit: (session: WorkoutSession) => void }) {
  return <button type="button" className="workout-row" style={{ width: "100%", textAlign: "left", cursor: "pointer" }} onClick={() => onEdit(session)}>
    <span className="workout-datebox"><strong>{new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(`${session.workoutDate}T12:00:00+05:30`))}</strong><span>{new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "Asia/Kolkata" }).format(new Date(`${session.workoutDate}T12:00:00+05:30`))}</span></span>
    <span className="workout-row-content"><span className="workout-row-title">{session.workoutType || "Gym session"}</span><span className="workout-row-sub"><Clock3 size={11} />{session.durationMinutes} min <span>·</span><Dumbbell size={11} />{session.exercises.length} exercise{session.exercises.length === 1 ? "" : "s"}</span><span className="workout-muscles">{session.muscleGroups.map((muscle) => <span className="muscle-pill" key={muscle}>{muscle}</span>)}</span></span>
    <ChevronRight size={15} color="#778176" />
  </button>;
}

function LoadingScreen() {
  return <div className="loading-screen"><div className="loading-header skeleton" /><div className="loading-hero skeleton" /><div className="loading-cards">{[1, 2, 3, 4].map((item) => <div className="skeleton" key={item} />)}</div></div>;
}

function LoginScreen({ onLogin }: { onLogin: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try { await onLogin(password); } catch (problem) { setError(problem instanceof Error ? problem.message : "Unable to unlock GymPulse."); }
    finally { setBusy(false); }
  }
  return <main className="auth-screen"><section className="auth-card"><div className="brand" style={{ padding: 0 }}><span className="brand-mark"><Activity size={20} strokeWidth={2.5} /></span><span><span className="brand-name">GymPulse AI</span><span className="brand-caption" style={{ display: "block" }}>YOUR TRAINING, MADE VISIBLE</span></span></div><h1>Your gym data is protected</h1><p>Enter the personal access password configured for this deployment.</p><form className="form-stack" onSubmit={submit}><div><label className="field-label" htmlFor="access-password">Access password</label><input className="input" id="access-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>{error && <div className="field-error">{error}</div>}<button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Checking…" : <><LockKeyhole size={14} /> Unlock GymPulse</>}</button></form><p style={{ marginTop: 18, marginBottom: 0, fontSize: 8 }}>Sessions use a secure, HttpOnly browser cookie.</p></section></main>;
}

export default function GymPulseApp() {
  const [page, setPage] = useState<Page>("home");
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [data, setData] = useState<GymData>(EMPTY_DATA);
  const [hasData, setHasData] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [fatalError, setFatalError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [today, setToday] = useState("");
  const [notice, setNotice] = useState("");
  const [workoutModal, setWorkoutModal] = useState<{ session?: WorkoutSession; date?: string } | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [calendarMode, setCalendarMode] = useState<"gregorian" | "lunar">("gregorian");
  const [calendarMonth, setCalendarMonth] = useState("");
  const [lunarAnchor, setLunarAnchor] = useState("");
  const [calendarData, setCalendarData] = useState<CalendarResponse | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [calendarMuscle, setCalendarMuscle] = useState("all");
  const [calendarStatus, setCalendarStatus] = useState("all");
  const [attendanceReason, setAttendanceReason] = useState("");
  const [topPanchang, setTopPanchang] = useState<CalendarResponse | null>(null);
  const [searchText, setSearchText] = useState("");
  const [historyMuscle, setHistoryMuscle] = useState("all");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyMinDuration, setHistoryMinDuration] = useState("");
  const [historyMaxDuration, setHistoryMaxDuration] = useState("");
  const [historyExercise, setHistoryExercise] = useState("");
  const [password, setPassword] = useState("");

  const metrics = useMemo(() => calculateMetrics(data, today || isoToday()), [data, today]);
  const settings = data.settings;
  const convention = settings.calendarConvention === "amanta" ? "amanta" : "purnimanta";
  const latitude = settings.latitude || "28.6139";
  const longitude = settings.longitude || "77.209";

  const notify = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? "" : current), 3400);
  }, []);

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await apiJSON<GymData>("/api/data", { cache: "no-store" });
      setData(result);
      setHasData(true);
      setFatalError("");
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setAuth({ protected: true, authenticated: false });
      setFatalError(error instanceof Error ? error.message : "Could not load your gym data.");
      throw error;
    } finally {
      setRefreshing(false);
      setDataLoading(false);
    }
  }, []);

  const authenticate = useCallback(async () => {
    try {
      const status = await apiJSON<AuthState>("/api/auth", { cache: "no-store" });
      setAuth(status);
      if (status.authenticated) await refreshData();
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "GymPulse could not connect to the server.");
      setDataLoading(false);
    } finally {
      setAuthLoading(false);
    }
  }, [refreshData]);

  useEffect(() => {
    setToday(isoToday());
    const current = isoToday();
    setSelectedDate(current);
    setCalendarMonth(monthStart(current));
    setLunarAnchor(current);
    setAttendanceReason("");
    void authenticate();
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, [authenticate]);

  async function loginUser(value: string) {
    await apiJSON<AuthState>("/api/auth", { method: "POST", body: JSON.stringify({ password: value }) });
    setAuth({ protected: true, authenticated: true });
    setPassword("");
    await refreshData();
  }

  async function logoutUser() {
    await apiJSON("/api/auth", { method: "DELETE" });
    setAuth({ protected: true, authenticated: false });
    setData(EMPTY_DATA);
    setHasData(false);
  }

  useEffect(() => {
    if (!today || !hasData || (page !== "home" && page !== "calendar") || topPanchang) return;
    const params = new URLSearchParams({ date: today, mode: "lunar", calendarType: convention, latitude, longitude });
    let active = true;
    void apiJSON<CalendarResponse>(`/api/calendar?${params}`, { cache: "no-store" }).then((result) => { if (active) setTopPanchang(result); }).catch(() => undefined);
    return () => { active = false; };
  }, [today, hasData, page, convention, latitude, longitude, topPanchang]);

  useEffect(() => {
    if (!today || !hasData || page !== "calendar") return;
    let active = true;
    setCalendarLoading(true);
    setCalendarError("");
    const params = new URLSearchParams({ mode: calendarMode, calendarType: convention, latitude, longitude });
    if (calendarMode === "lunar") {
      params.set("date", lunarAnchor || today);
    } else {
      const first = calendarMonth || monthStart(today);
      const start = addDays(first, -dayOfWeek(first));
      params.set("date", first);
      params.set("from", start);
      params.set("to", addDays(start, 41));
    }
    void apiJSON<CalendarResponse>(`/api/calendar?${params}`, { cache: "no-store" }).then((result) => {
      if (active) setCalendarData(result);
    }).catch((error) => {
      if (active) setCalendarError(error instanceof Error ? error.message : "Calendar data could not be loaded.");
    }).finally(() => { if (active) setCalendarLoading(false); });
    return () => { active = false; };
  }, [page, calendarMode, calendarMonth, lunarAnchor, today, hasData, convention, latitude, longitude]);

  async function handleSaved(message: string) {
    setWorkoutModal(null);
    setTopPanchang(null);
    try { await refreshData(); notify(message); } catch { /* The save has already completed; the page shows its reload error. */ }
  }

  async function setDayAttendance(date: string, status: "went" | "missed" | "rest" | "clear") {
    try {
      await apiJSON("/api/attendance", { method: "PUT", body: JSON.stringify({ date, status, reason: status === "missed" ? attendanceReason : "" }) });
      await refreshData();
      notify(status === "clear" ? "That date is now unrecorded." : status === "rest" ? "Planned rest day saved." : status === "missed" ? "Attendance updated. This date is counted as confirmed missed." : "Attendance marked as a gym visit.");
    } catch (error) { notify(error instanceof Error ? error.message : "Attendance could not be saved."); }
  }

  async function deleteSession(session: WorkoutSession) {
    if (!window.confirm(`Delete the workout from ${formatDate(session.workoutDate)}? This also removes its exercise sets.`)) return;
    try {
      await apiJSON(`/api/sessions/${session.id}`, { method: "DELETE" });
      await refreshData();
      notify("Workout deleted. Related analytics have been recalculated.");
    } catch (error) { notify(error instanceof Error ? error.message : "Workout could not be deleted."); }
  }

  if (authLoading || dataLoading && !auth) return <LoadingScreen />;
  if (auth?.protected && !auth.authenticated) return <LoginScreen onLogin={loginUser} />;
  if (!hasData && !dataLoading) return <div className="auth-screen"><div className="auth-card"><div className="brand" style={{ padding: 0 }}><span className="brand-mark"><Activity size={20} /></span><span className="brand-name">GymPulse AI</span></div><h1>Database connection needed</h1><p>{fatalError || "The gym database is not ready."}</p><div className="warning-box"><AlertCircle size={15} /> Configure DATABASE_URL, apply the Drizzle schema, then reload this page.</div><button className="btn btn-primary" style={{ width: "100%", marginTop: 15 }} onClick={() => void authenticate()}>Try again</button></div></div>;
  if (!hasData || !today) return <LoadingScreen />;

  const pageLabels: Record<Page, string> = { home: "Home", calendar: "Calendar", history: "Workout history", progress: "Progress & Coach", settings: "Settings" };
  const pageSummaries: Record<Page, string> = { home: "Your training, at a glance", calendar: "Every day, exactly as you recorded it", history: "A complete record of the work you did", progress: "Patterns, not guesswork", settings: "Make GymPulse yours" };
  const activeTitle = pageLabels[page];

  function statusFor(date: string) { return attendanceStatusForDate(date, data.sessions, data.attendance); }
  function sessionsForDate(date: string) { return data.sessions.filter((session) => session.workoutDate === date).sort((a, b) => a.id - b.id); }
  function startEdit(session: WorkoutSession) { setWorkoutModal({ session }); }
  function handleOpenCalendar(date?: string) {
    setPage("calendar");
    if (date) { setSelectedDate(date); setCalendarMonth(monthStart(date)); setLunarAnchor(date); }
  }

  const customPanchang = topPanchang?.days.find((item) => item.date === today);
  const todayIsRecorded = metrics.visitDates.has(today);
  const weekDays = metrics.weekDates.map((date) => ({ date, sessions: data.sessions.filter((session) => session.workoutDate === date).length, today: date === today, visit: metrics.visitDates.has(date) }));
  const last30From = addDays(today, -29);
  const currentWeekSessions = data.sessions.filter((session) => session.workoutDate >= floorToMonday(today) && session.workoutDate <= today).length;
  const previousWeekFrom = addDays(floorToMonday(today), -7);
  const previousWeekTo = addDays(floorToMonday(today), -1);
  const previousWeekSessions = data.sessions.filter((session) => session.workoutDate >= previousWeekFrom && session.workoutDate <= previousWeekTo).length;
  const insightItems: string[] = [];
  if (currentWeekSessions > 0) insightItems.push(`You completed ${currentWeekSessions} workout session${currentWeekSessions === 1 ? "" : "s"} this week.`);
  const last7 = data.sessions.filter((session) => session.workoutDate >= addDays(today, -6) && session.workoutDate <= today);
  const last7Muscles = MUSCLES.map((muscle) => ({ muscle, count: last7.filter((session) => session.muscleGroups.includes(muscle)).length })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
  if (last7Muscles[0]) insightItems.push(`You trained ${last7Muscles[0].muscle.toLowerCase()} in ${last7Muscles[0].count} session${last7Muscles[0].count === 1 ? "" : "s"} in the last 7 days.`);
  if (currentWeekSessions > 0 && previousWeekSessions > 0 && currentWeekSessions !== previousWeekSessions) insightItems.push(`You logged ${Math.abs(currentWeekSessions - previousWeekSessions)} ${currentWeekSessions > previousWeekSessions ? "more" : "fewer"} sessions this week than last week.`);
  const previous30 = data.sessions.filter((session) => session.workoutDate >= addDays(today, -59) && session.workoutDate < last30From);
  const current30 = data.sessions.filter((session) => session.workoutDate >= last30From && session.workoutDate <= today);
  if (current30.length >= 2 && previous30.length >= 2) {
    const currentAvg = current30.reduce((sum, item) => sum + item.durationMinutes, 0) / current30.length;
    const previousAvg = previous30.reduce((sum, item) => sum + item.durationMinutes, 0) / previous30.length;
    if (Math.abs(currentAvg - previousAvg) >= 5) insightItems.push(`Your average session duration ${currentAvg > previousAvg ? "increased" : "decreased"} by ${Math.round(Math.abs(currentAvg - previousAvg))} minutes compared with the previous 30 days.`);
  }
  if (insightItems.length === 0) insightItems.push("Log a workout or attendance record to unlock insights based on your own history.");

  function dashboard() {
    const monthlyMuscle = MUSCLES.map((muscle) => data.sessions.filter((session) => session.workoutDate >= last30From && session.workoutDate <= today && session.muscleGroups.includes(muscle)).length);
    const recent = [...metrics.sessions].sort((a, b) => b.workoutDate.localeCompare(a.workoutDate) || b.id - a.id).slice(0, 4);
    const weekLabels = weekDays.map((day) => new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" }).format(new Date(`${day.date}T12:00:00+05:30`)));
    const monthStartISO = monthStart(today);
    const monthEvents = new Set([...metrics.visitDates, ...metrics.missedDates, ...metrics.restDates].filter((date) => date.startsWith(today.slice(0, 7))));
    const monthDaysElapsed = Number(today.slice(8, 10));
    const monthUnrecorded = Math.max(0, monthDaysElapsed - monthEvents.size);
    return <div className="page-enter">
      {fatalError && <div className="alert-bar"><AlertCircle size={14} />{fatalError}</div>}
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="hero-date"><CalendarDays size={13} />{formatDate(today, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase()}</div>
          <div className="eyebrow"><span className="dot" /> YOUR PERSONAL TRAINING SPACE</div>
          <h1>{greet()}. Ready to move?</h1>
          <p>Every session you log brings your real progress into focus. Start with the work you did today.</p>
          <div className="hero-actions"><button className="btn btn-primary" onClick={() => setWorkoutModal({ date: today })}><Plus size={15} /> Log today's workout</button><button className="btn btn-subtle" onClick={() => setPage("progress")}>View progress <ArrowRight size={13} /></button></div>
        </div>
        <div className="hero-art" aria-hidden="true"><span className="hero-orbit" /><span className="hero-pulse"><Activity size={104} strokeWidth={1.1} /></span><span className="hero-metric"><strong>{metrics.currentStreak}<span className="stat-unit">days</span></strong><span>current streak</span></span></div>
      </section>

      <section className="stat-grid" aria-label="Your training totals">
        <StatCard icon={<Dumbbell size={16} />} label="Gym visits" value={metrics.visits} foot={`${metrics.totalSessions} logged workout sessions`} />
        <StatCard icon={<CalendarCheck2 size={16} />} label="This week" value={metrics.weekSessions} foot={`Goal: ${data.goals.weeklySessions} sessions`} accent={metrics.weekSessions >= data.goals.weeklySessions ? "positive" : ""} />
        <StatCard icon={<Clock3 size={16} />} label="Training time" value={metrics.totalHours} unit="hrs" foot={`Average ${metrics.averageDuration} min per session`} />
        <StatCard icon={<Flame size={16} />} label="Current streak" value={metrics.currentStreak} unit="days" foot={`Longest ${metrics.longestStreak} days`} accent={metrics.currentStreak ? "positive" : ""} />
      </section>

      <div className="grid-two">
        <section className="panel panel-pad">
          <div className="panel-head"><div><h2 className="panel-title">Your week, in motion</h2><p className="panel-subtitle">Sessions you logged over the last seven days</p></div><button className="panel-action" onClick={() => setPage("calendar")}>Open calendar <ArrowRight size={12} /></button></div>
          <div className="week-chart"><Bar data={{ labels: weekLabels, datasets: [{ data: weekDays.map((day) => day.sessions), backgroundColor: weekDays.map((day) => day.today ? "#d0ff91" : day.sessions ? "#93d84f" : "#303831"), borderRadius: 7, borderSkipped: false, maxBarThickness: 30 }] }} options={{ ...chartBase, scales: { ...chartBase.scales, y: { ...chartBase.scales.y, suggestedMax: Math.max(3, ...weekDays.map((day) => day.sessions)) } } }} /></div>
          <div className="week-footer">{weekDays.map((day, index) => <div key={day.date} className={`week-day ${day.sessions ? "active" : ""} ${day.today ? "today" : ""}`}><strong>{weekLabels[index]}</strong>{day.sessions > 0 ? <><i className="week-dot" />{day.sessions}</> : day.today ? "Today" : "—"}</div>)}</div>
        </section>
        <section className="panel panel-pad">
          <div className="panel-head"><div><h2 className="panel-title">Attendance snapshot</h2><p className="panel-subtitle">Confirmed days only · unrecorded days excluded</p></div><button className="icon-btn" aria-label="Open calendar" onClick={() => setPage("calendar")}><ArrowRight size={15} /></button></div>
          <div className="attendance-summary"><div className="attendance-ring" style={{ "--rate": metrics.attendanceRate ?? 0 } as React.CSSProperties}><div className="attendance-ring-content"><strong>{metrics.attendanceRate === null ? "—" : `${metrics.attendanceRate}%`}</strong><span>attendance</span></div></div><div className="attendance-legend"><div className="legend-line"><i className="legend-dot" /> Gym visits <strong>{metrics.monthVisits}</strong></div><div className="legend-line"><i className="legend-dot red" /> Missed <strong>{metrics.monthMissed}</strong></div><div className="legend-line"><i className="legend-dot gray" /> Planned rest <strong>{metrics.monthRest}</strong></div></div></div>
          <div className="field-hint" style={{ textAlign: "center", marginTop: 5 }}>This month · {metrics.monthSessions} logged sessions · {metrics.monthHours} workout hours</div>
        </section>
      </div>

      <div className="grid-two">
        <section className="panel panel-pad">
          <div className="panel-head"><div><h2 className="panel-title">Muscle distribution</h2><p className="panel-subtitle">Logged sessions in the past 30 days</p></div><button className="panel-action" onClick={() => setPage("progress")}>See analysis <ArrowRight size={12} /></button></div>
          {monthlyMuscle.some((count) => count > 0) ? <div style={{ display: "grid", gridTemplateColumns: "minmax(125px,.8fr) minmax(150px,1fr)", alignItems: "center", gap: 17 }}><div className="chart-box small"><Doughnut data={{ labels: MUSCLES, datasets: [{ data: monthlyMuscle, backgroundColor: COLORS, borderColor: "#141815", borderWidth: 4, hoverOffset: 5 }] }} options={{ responsive: true, maintainAspectRatio: false, cutout: "72%", plugins: { legend: { display: false }, tooltip: chartBase.plugins.tooltip } }} /></div><div className="muscle-stat-list">{MUSCLES.map((muscle, index) => <div className="muscle-stat" key={muscle}><span className="muscle-stat-name">{muscle}</span><span className="muscle-stat-track"><i style={{ width: `${monthlyMuscle[index] ? Math.max(10, monthlyMuscle[index] / Math.max(...monthlyMuscle) * 100) : 0}%`, background: COLORS[index] }} /></span><span className="muscle-stat-count">{monthlyMuscle[index]}</span></div>)}</div></div> : <EmptyState icon={<Dumbbell size={19} />} title="No muscle records yet" description="Choose the muscles you train when you save a workout. Your distribution chart will grow from your real sessions." action={<button className="btn btn-sm btn-primary" onClick={() => setWorkoutModal({ date: today })}><Plus size={12} /> Log a workout</button>} />}
        </section>
        <section className="panel panel-pad">
          <div className="panel-head"><div><h2 className="panel-title">Recent workouts</h2><p className="panel-subtitle">Your latest logged sessions</p></div><button className="panel-action" onClick={() => setPage("history")}>Full history <ArrowRight size={12} /></button></div>
          {recent.length ? <div className="workout-list">{recent.map((session) => <MiniSession key={session.id} session={session} onEdit={startEdit} />)}</div> : <EmptyState icon={<Activity size={18} />} title="Your story starts here" description="Log your first session to see it reflected across your calendar and analytics." action={<button className="btn btn-sm btn-primary" onClick={() => setWorkoutModal({ date: today })}><Plus size={12} /> Log first workout</button>} />}
        </section>
      </div>

      <div className="insight-strip">
        {insightItems.slice(0, 3).map((item, index) => <div className="insight-card" key={`${item}-${index}`}><span className="insight-icon">{index === 0 ? <Lightbulb size={14} /> : index === 1 ? <Target size={14} /> : <TrendingUp size={14} />}</span><p>{item}</p></div>)}
      </div>

      <div className="grid-two">
        <section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">The month so far</h2><p className="panel-subtitle">Recorded activity through {formatDate(today, { month: "long", day: "numeric" })}</p></div><span className="eyebrow">{formatDate(today, { month: "long", year: "numeric" })}</span></div><div className="month-stats-grid"><MonthMetric icon={<CalendarCheck2 size={15} />} label="Visits" value={metrics.monthVisits} /><MonthMetric icon={<Dumbbell size={15} />} label="Sessions" value={metrics.monthSessions} /><MonthMetric icon={<Clock3 size={15} />} label="Hours" value={metrics.monthHours} /><MonthMetric icon={<Moon size={15} />} label="Rest days" value={metrics.monthRest} /><MonthMetric icon={<AlertCircle size={15} />} label="Confirmed missed" value={metrics.monthMissed} /><MonthMetric icon={<Gauge size={15} />} label="Unrecorded" value={monthUnrecorded} /></div><div className="field-hint" style={{ marginTop: 12 }}>Attendance rate = recorded gym-visit days ÷ (gym-visit days + confirmed missed days). Rest, unrecorded, and future days are excluded.</div></section>
        <section className="panel panel-pad"><div className="panel-head"><div><h2 className="panel-title">Your calendar, both ways</h2><p className="panel-subtitle">Hindu lunar labels calculated for the selected convention</p></div><span className="stat-icon"><Moon size={15} /></span></div><div className="calendar-teaser"><div className="calendar-teaser-month">{topPanchang?.monthLabel ?? "Panchang calendar"}</div><div className="calendar-teaser-copy">{customPanchang ? `${customPanchang.paksha} Paksha · ${customPanchang.tithiName}` : "Amanta/Purnimanta month mapping · sunrise convention"}</div><div className="calendar-teaser-meta">{convention === "amanta" ? "Amanta" : "Purnimanta"} · {settings.latitude ? "Custom location" : "Delhi, India"} · Asia/Kolkata</div><button className="btn btn-sm" style={{ marginTop: 15 }} onClick={() => setPage("calendar")}>Explore calendar <ArrowRight size={12} /></button></div></section>
      </div>
    </div>;
  }

  function calendarPage() {
    const monthFirst = calendarMonth || monthStart(today);
    const gregorianStart = addDays(monthFirst, -dayOfWeek(monthFirst));
    const gregorianDates = Array.from({ length: 42 }, (_, index) => addDays(gregorianStart, index));
    const lunarDates = calendarData?.days ?? [];
    const dates = calendarMode === "lunar" ? lunarDates.map((item) => item.date) : gregorianDates;
    const panchangByDate = new Map((calendarData?.days ?? []).map((item) => [item.date, item]));
    const monthTitle = calendarMode === "lunar" ? calendarData?.monthLabel ?? "Hindu lunar month" : formatDate(monthFirst, { month: "long", year: "numeric" });
    const offset = calendarMode === "lunar" && lunarDates.length ? dayOfWeek(lunarDates[0].date) : 0;
    const displayCells: (string | null)[] = calendarMode === "lunar" ? [...Array.from({ length: offset }, () => null), ...dates] : dates;
    const selectedStatus = selectedDate ? statusFor(selectedDate) : "unrecorded";
    const selectedSessions = selectedDate ? sessionsForDate(selectedDate) : [];
    const selectedAttendance = data.attendance.find((item) => item.attendanceDate === selectedDate);
    const selectedFuture = Boolean(selectedDate && selectedDate > today);
    const filteredDates = new Set(dates.filter((date) => {
      if (!date) return false;
      const status = statusFor(date);
      const muscleOk = calendarMuscle === "all" || data.sessions.some((session) => session.workoutDate === date && session.muscleGroups.includes(calendarMuscle));
      const statusOk = calendarStatus === "all" || status === calendarStatus;
      return muscleOk && statusOk;
    }));
    const weeks = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const canMarkMissed = !selectedFuture && !selectedSessions.length;
    function moveCalendar(direction: -1 | 1) {
      if (calendarMode === "gregorian") {
        const [year, month] = monthFirst.split("-").map(Number);
        const next = new Date(Date.UTC(year, month - 1 + direction, 1));
        setCalendarMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`);
      } else if (calendarData?.monthStart && calendarData.monthEnd) {
        setLunarAnchor(addDays(direction < 0 ? calendarData.monthStart : calendarData.monthEnd, direction < 0 ? -1 : 1));
      } else setLunarAnchor(addDays(lunarAnchor || today, direction * 30));
      setSelectedDate("");
    }
    const labelStatus = (status: string) => status === "went" ? "Gym visit" : status === "missed" ? "Did not go" : status === "rest" ? "Planned rest" : "Not recorded";
    return <div className="page-enter">
      <div className="page-heading"><div><div className="eyebrow"><span className="dot" /> YOUR TRAINING CALENDAR</div><h1 className="page-title" style={{ marginTop: 10 }}>Every day counts.</h1><p className="page-description">See your actual attendance and workouts. Future dates are never counted as missed; planned rest stays separate.</p></div><div className="heading-actions"><button className="btn btn-primary" onClick={() => setWorkoutModal({ date: selectedDate || today })}><Plus size={14} /> Log workout</button></div></div>
      <section className="panel panel-pad">
        <div className="calendar-toolbar">
          <div className="calendar-period"><button className="icon-btn" aria-label="Previous month" onClick={() => moveCalendar(-1)}><ChevronLeft size={16} /></button><div className="calendar-period-title">{monthTitle}</div><button className="icon-btn" aria-label="Next month" onClick={() => moveCalendar(1)}><ChevronRight size={16} /></button><button className="btn btn-sm" onClick={() => { setCalendarMonth(monthStart(today)); setLunarAnchor(today); setSelectedDate(today); }}>Today</button></div>
          <div className="filter-row"><div className="segmented" aria-label="Calendar system"><button className={calendarMode === "gregorian" ? "selected" : ""} onClick={() => { setCalendarMode("gregorian"); setCalendarMonth(monthStart(selectedDate || today)); }}>Gregorian</button><button className={calendarMode === "lunar" ? "selected" : ""} onClick={() => { setCalendarMode("lunar"); setLunarAnchor(selectedDate || today); }}>Hindu lunar</button></div>
            <select className="select" style={{ width: 127, minHeight: 36, fontSize: 9 }} aria-label="Filter calendar by muscle" value={calendarMuscle} onChange={(event) => setCalendarMuscle(event.target.value)}><option value="all">All muscles</option>{MUSCLES.map((muscle) => <option key={muscle}>{muscle}</option>)}</select>
            <select className="select" style={{ width: 138, minHeight: 36, fontSize: 9 }} aria-label="Filter calendar by attendance" value={calendarStatus} onChange={(event) => setCalendarStatus(event.target.value)}><option value="all">All attendance</option><option value="went">Gym visit</option><option value="missed">Did not go</option><option value="rest">Planned rest</option><option value="unrecorded">Not recorded</option></select>
          </div>
        </div>
        {calendarMode === "lunar" && <div className="warning-box" style={{ marginBottom: 13 }}><Moon size={14} />Calculated with the <strong>{convention === "amanta" ? "Amanta" : "Purnimanta"}</strong> convention for {calendarData?.location.label ?? "Delhi, India"} ({latitude}° N, {longitude}° E), using local sunrise day fields and Asia/Kolkata (UTC+05:30). Month boundaries come from the Panchangam library; this is a display layer over Gregorian records.</div>}
        {calendarError && <div className="alert-bar"><AlertCircle size={14} />{calendarError}</div>}
        <div className="calendar-grid" aria-label={calendarMode === "lunar" ? `${monthTitle} lunar month` : `${monthTitle} calendar`}>
          {weeks.map((week) => <div className="calendar-weekday" key={week}>{week}</div>)}
          {displayCells.map((date, index) => {
            if (!date) return <div aria-hidden="true" className="calendar-cell outside" key={`empty-${index}`} style={{ borderColor: "transparent", background: "transparent" }} />;
            const status = statusFor(date);
            const sessions = sessionsForDate(date);
            const muscles = [...new Set(sessions.flatMap((session) => session.muscleGroups))];
            const panchang = panchangByDate.get(date);
            const outside = calendarMode === "gregorian" && date.slice(0, 7) !== monthFirst.slice(0, 7);
            const visible = filteredDates.has(date);
            return <button type="button" key={date} className={`calendar-cell ${outside ? "outside" : ""} ${date === today ? "today" : ""} ${date === selectedDate ? "selected" : ""}`} onClick={() => { setSelectedDate(date); setAttendanceReason(data.attendance.find((record) => record.attendanceDate === date)?.reason ?? ""); }} style={visible ? undefined : { opacity: .22 }} aria-label={`${formatDate(date)}: ${labelStatus(status)}${muscles.length ? `, ${muscles.join(", ")}` : ""}`}>
              <span className="calendar-day-num">{Number(date.slice(8, 10))}</span>
              <span className="calendar-status"><i className={`calendar-indicator ${status}`} />{labelStatus(status)}</span>
              {muscles.length > 0 && <span className="calendar-muscle">{muscles.slice(0, 2).join(" · ")}{muscles.length > 2 ? ` +${muscles.length - 2}` : ""}</span>}
              {calendarMode === "gregorian" && panchang && <span className="lunar-date">{panchang.paksha === "Krishna" ? "K" : "S"} · {panchang.tithiName}</span>}
              {calendarMode === "lunar" && panchang && <span className="lunar-date">{panchang.paksha === "Krishna" ? "K" : "S"} · {panchang.tithiName}</span>}
            </button>;
          })}
        </div>
        {calendarLoading && <div className="field-hint" style={{ marginTop: 9 }}>Calculating local Panchang dates…</div>}
        <div className="legend-row"><div className="legend-line"><i className="legend-dot" />Gym visit</div><div className="legend-line"><i className="legend-dot red" />Confirmed missed</div><div className="legend-line"><i className="legend-dot gray" />Planned rest</div><div className="legend-line"><i className="calendar-indicator" style={{ border: "1px solid #687268", background: "transparent" }} />Not recorded</div></div>
      </section>

      {selectedDate && <div className="calendar-selected-panel">
        <section className="day-info"><div className="day-info-top"><div><div className="eyebrow"><span className="dot" /> SELECTED DAY</div><h2 className="day-info-title" style={{ marginTop: 8 }}>{formatDate(selectedDate)}</h2><p className="day-info-sub">{selectedStatus === "unrecorded" ? "No attendance status has been saved for this day." : `${labelStatus(selectedStatus)}${selectedAttendance?.reason ? ` · ${selectedAttendance.reason}` : ""}`}</p>{panchangByDate.get(selectedDate) && <p className="day-info-sub" style={{ marginTop: 7 }}><Moon size={11} style={{ display: "inline", verticalAlign: -2, marginRight: 4 }} />{panchangByDate.get(selectedDate)?.masa}{panchangByDate.get(selectedDate)?.isAdhika ? " (Adhika)" : ""} · {panchangByDate.get(selectedDate)?.paksha} Paksha · {panchangByDate.get(selectedDate)?.tithiName} · {convention}</p>}</div><button className="btn btn-sm btn-primary" onClick={() => setWorkoutModal({ date: selectedDate })}><Plus size={12} /> Log session</button></div>
          {!selectedFuture && <><div className="attendance-actions"><button className={`status-button ${selectedStatus === "went" ? "selected went" : ""}`} disabled={Boolean(selectedSessions.length)} onClick={() => void setDayAttendance(selectedDate, "went")}><CheckCircle2 size={13} /> Went to gym</button><button className={`status-button ${selectedStatus === "missed" ? "selected missed" : ""}`} disabled={!canMarkMissed} onClick={() => void setDayAttendance(selectedDate, "missed")}><X size={13} /> Did not go</button><button className={`status-button ${selectedStatus === "rest" ? "selected rest" : ""}`} disabled={Boolean(selectedSessions.length)} onClick={() => void setDayAttendance(selectedDate, "rest")}><Moon size={13} /> Planned rest</button><button className="status-button" onClick={() => void setDayAttendance(selectedDate, "clear")}><X size={13} /> Not recorded</button></div>
            {canMarkMissed && <div style={{ marginTop: 10 }}><label className="field-label" htmlFor="missed-reason">Optional note for a missed day</label><input className="input" id="missed-reason" maxLength={500} value={attendanceReason} onChange={(event) => setAttendanceReason(event.target.value)} placeholder="e.g. Travel, schedule, personal choice" /></div>}</>}
          {selectedFuture && <div className="field-hint" style={{ marginTop: 12 }}>Future dates are not attendance records. You may mark a planned rest day, or leave the date unrecorded.</div>}
          <div className="field-hint" style={{ marginTop: 10 }}>Only completed sessions contribute to exercise and muscle analytics. A gym visit may be recorded separately from a workout session.</div>
        </section>
        <section className="day-info"><div className="panel-head" style={{ marginBottom: 10 }}><div><h3 className="panel-title">Sessions on this date</h3><p className="panel-subtitle">Multiple sessions on one day are supported</p></div><span className="eyebrow">{selectedSessions.length} session{selectedSessions.length === 1 ? "" : "s"}</span></div>{selectedSessions.length ? <div className="workout-list">{selectedSessions.map((session) => <div key={session.id}><MiniSession session={session} onEdit={startEdit} /><div className="filter-row" style={{ margin: "5px 0 5px 55px" }}><button className="btn btn-sm" onClick={() => startEdit(session)}>Edit session</button><button className="btn btn-sm btn-danger" onClick={() => void deleteSession(session)}>Delete</button></div>{session.notes && <p className="field-hint" style={{ margin: "6px 0 11px 55px" }}>{session.notes}</p>}</div>)}</div> : <div className="empty-state" style={{ minHeight: 100 }}><div><span className="empty-state-icon"><Dumbbell size={18} /></span><span style={{ color: "#b9c2b7", fontSize: 10 }}>No workout sessions recorded</span></div></div>}</section>
      </div>}
    </div>;
  }

  function historyPage() {
    const sessions = [...metrics.sessions].sort((a, b) => b.workoutDate.localeCompare(a.workoutDate) || b.id - a.id).filter((session) => {
      const query = searchText.trim().toLowerCase();
      const hasSearch = !query || [session.workoutType, session.notes ?? "", ...session.muscleGroups, ...session.exercises.map((exercise) => exercise.name)].some((value) => value.toLowerCase().includes(query));
      const dateOk = (!historyFrom || session.workoutDate >= historyFrom) && (!historyTo || session.workoutDate <= historyTo);
      const muscleOk = historyMuscle === "all" || session.muscleGroups.includes(historyMuscle);
      const status = statusFor(session.workoutDate);
      const statusOk = historyStatus === "all" || status === historyStatus;
      const minOk = !historyMinDuration || session.durationMinutes >= Number(historyMinDuration);
      const maxOk = !historyMaxDuration || session.durationMinutes <= Number(historyMaxDuration);
      const exerciseOk = !historyExercise || session.exercises.some((exercise) => exercise.name.toLowerCase().includes(historyExercise.toLowerCase()));
      return hasSearch && dateOk && muscleOk && statusOk && minOk && maxOk && exerciseOk;
    });
    const attendanceEvents = [...data.attendance].filter((record) => {
      if (record.attendanceDate > today || data.sessions.some((session) => session.workoutDate === record.attendanceDate)) return false;
      const statusOk = historyStatus === "all" || record.status === historyStatus;
      const dateOk = (!historyFrom || record.attendanceDate >= historyFrom) && (!historyTo || record.attendanceDate <= historyTo);
      const text = `${record.status} ${record.reason ?? ""}`.toLowerCase();
      const searchOk = !searchText.trim() || text.includes(searchText.trim().toLowerCase());
      const otherFiltersOk = historyMuscle === "all" && !historyMinDuration && !historyMaxDuration && !historyExercise;
      return statusOk && dateOk && searchOk && otherFiltersOk;
    }).sort((a, b) => b.attendanceDate.localeCompare(a.attendanceDate)).slice(0, 30);
    return <div className="page-enter"><div className="page-heading"><div><div className="eyebrow"><span className="dot" /> THE WORK YOU PUT IN</div><h1 className="page-title" style={{ marginTop: 10 }}>Workout history</h1><p className="page-description">Search and refine your actual sessions. Edit old records whenever your log needs a correction.</p></div><div className="heading-actions"><a className="btn" href="/api/export?format=csv"><ArrowRight size={13} /> Export CSV</a><button className="btn btn-primary" onClick={() => setWorkoutModal({ date: today })}><Plus size={14} /> Log workout</button></div></div>
      <div className="history-controls"><div className="search-field" style={{ position: "relative" }}><Search size={14} style={{ position: "absolute", left: 12, top: 13, color: "#768076" }} /><input className="input" style={{ paddingLeft: 35 }} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search exercises, notes, type…" aria-label="Search workouts" /></div><select className="select" aria-label="Filter muscle" value={historyMuscle} onChange={(event) => setHistoryMuscle(event.target.value)}><option value="all">All muscles</option>{MUSCLES.map((muscle) => <option key={muscle}>{muscle}</option>)}</select><select className="select" aria-label="Filter attendance" value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)}><option value="all">All attendance</option><option value="went">Gym visit</option><option value="missed">Confirmed missed</option><option value="rest">Planned rest</option></select><input className="input" type="date" aria-label="From date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} /><input className="input" type="date" aria-label="To date" value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} /><input className="input" type="number" min="0" placeholder="Min min" aria-label="Minimum duration in minutes" value={historyMinDuration} onChange={(event) => setHistoryMinDuration(event.target.value)} /><input className="input" type="number" min="0" placeholder="Max min" aria-label="Maximum duration in minutes" value={historyMaxDuration} onChange={(event) => setHistoryMaxDuration(event.target.value)} /><input className="input" placeholder="Exercise name" aria-label="Filter exercise name" value={historyExercise} onChange={(event) => setHistoryExercise(event.target.value)} /></div>
      <div className="filter-row" style={{ justifyContent: "space-between", marginBottom: 11 }}><span className="field-hint">Showing <strong style={{ color: "var(--text)" }}>{sessions.length}</strong> sessions · <strong style={{ color: "var(--text)" }}>{attendanceEvents.length}</strong> attendance-only days.</span><button className="btn btn-sm btn-subtle" onClick={() => { setSearchText(""); setHistoryMuscle("all"); setHistoryStatus("all"); setHistoryFrom(""); setHistoryTo(""); setHistoryMinDuration(""); setHistoryMaxDuration(""); setHistoryExercise(""); }}>Clear filters</button></div>
      {attendanceEvents.length > 0 && <section className="panel panel-pad" style={{ marginBottom: 12 }}><div className="panel-head"><div><h2 className="panel-title">Attendance-only days</h2><p className="panel-subtitle">These are attendance records, not completed workout sessions.</p></div><span className="eyebrow">{attendanceEvents.length} days</span></div><div className="attendance-history-list">{attendanceEvents.map((record) => <div className="attendance-history-row" key={record.attendanceDate}><div><strong>{formatDate(record.attendanceDate, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</strong><span>{record.reason || "No workout session logged"}</span></div><span className={`attendance-event-status ${record.status}`}>{record.status === "missed" ? "Did not go" : record.status === "rest" ? "Planned rest" : "Gym visit"}</span><button className="btn btn-sm" onClick={() => { setSelectedDate(record.attendanceDate); setCalendarMonth(monthStart(record.attendanceDate)); setLunarAnchor(record.attendanceDate); setPage("calendar"); }}>Correct</button></div>)}</div></section>}
      {sessions.length || attendanceEvents.length ? sessions.map((session) => <HistoryCard key={session.id} session={session} status={statusFor(session.workoutDate)} onEdit={startEdit} onDelete={() => void deleteSession(session)} />) : <section className="panel"><EmptyState icon={<Search size={18} />} title={metrics.totalSessions ? "No sessions match those filters" : "No workouts recorded yet"} description={metrics.totalSessions ? "Try broadening your search or clearing some filters." : "Your sessions will appear here after you log a workout. Attendance-only days are still kept in the calendar."} action={metrics.totalSessions ? <button className="btn btn-sm" onClick={() => { setSearchText(""); setHistoryMuscle("all"); setHistoryStatus("all"); setHistoryFrom(""); setHistoryTo(""); setHistoryMinDuration(""); setHistoryMaxDuration(""); setHistoryExercise(""); }}>Clear filters</button> : <button className="btn btn-sm btn-primary" onClick={() => setWorkoutModal({ date: today })}><Plus size={12} /> Log first workout</button>} /></section>}
    </div>;
  }

  const pageContent = page === "home" ? dashboard() : page === "calendar" ? calendarPage() : page === "history" ? historyPage() : page === "progress" ? <ProgressView data={data} today={today} onLog={() => setWorkoutModal({ date: today })} /> : <SettingsView data={data} today={today} authProtected={auth?.protected ?? false} onUpdate={async () => { setTopPanchang(null); await refreshData(); }} onNotify={notify} onLogout={() => void logoutUser()} />;

  return <div className="app-frame">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Activity size={20} strokeWidth={2.6} /></span><span className="brand-copy"><span className="brand-name">GymPulse AI</span><span className="brand-caption">TRAIN WITH CLARITY</span></span></div>
      <div className="nav-label">Workspace</div><nav className="side-nav" aria-label="Main navigation">{navItems.map(({ key, label, icon: Icon }) => <button type="button" className={`nav-link ${page === key ? "active" : ""}`} key={key} onClick={() => setPage(key)} aria-current={page === key ? "page" : undefined}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="side-goal"><div className="side-goal-title"><span>This week</span><Target size={14} /></div><div className="side-goal-copy">{metrics.weekSessions} of {data.goals.weeklySessions} sessions logged</div><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(100, metrics.weekSessions / Math.max(1, data.goals.weeklySessions) * 100)}%` }} /></div><div className="side-goal-foot"><span>Weekly goal</span><span>{Math.round(metrics.weekSessions / Math.max(1, data.goals.weeklySessions) * 100)}%</span></div></div>
      <div className="sidebar-profile"><span className="profile-avatar">GP</span><span><span className="profile-name">Personal space</span><span className="profile-sub" style={{ display: "block" }}>Single-user journal</span></span></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><div className="topbar-left"><div className="mobile-brand"><span className="brand-mark"><Activity size={17} strokeWidth={2.6} /></span><span><span className="brand-name">GymPulse AI</span><span className="brand-caption" style={{ display: "block" }}>TRAIN WITH CLARITY</span></span></div><div className="topbar-title-wrap"><div className="topbar-title">{activeTitle}</div><div className="topbar-crumb">{pageSummaries[page]}</div></div></div><div className="topbar-actions"><span className="today-chip"><CalendarDays size={13} />{formatDate(today, { weekday: "short", month: "short", day: "numeric" })}</span>{auth?.protected && <button className="icon-btn" title="Lock this app" aria-label="Lock this app" onClick={() => void logoutUser()}><LogOut size={15} /></button>}<button className="btn btn-primary" onClick={() => setWorkoutModal({ date: today })}><Plus size={15} /> Log workout</button></div></header>
      <main className="main-content">{pageContent}</main>
    </div>
    <nav className="bottom-nav" aria-label="Mobile navigation">{navItems.map(({ key, label, icon: Icon }) => <button key={key} type="button" className={page === key ? "active" : ""} onClick={() => setPage(key)} aria-current={page === key ? "page" : undefined}><Icon size={19} strokeWidth={page === key ? 2.1 : 1.8} /><span>{label}</span></button>)}</nav>
    {workoutModal && <WorkoutModal key={workoutModal.session ? `session-${workoutModal.session.id}` : `new-${workoutModal.date ?? today}`} session={workoutModal.session} selectedDate={workoutModal.date} splits={data.splits} onClose={() => setWorkoutModal(null)} onSaved={(message) => void handleSaved(message)} />}
    {notice && <div className="toast" role="status"><CheckCircle2 size={15} />{notice}</div>}
  </div>;
}

function StatCard({ icon, label, value, unit, foot, accent }: { icon: React.ReactNode; label: string; value: number | string; unit?: string; foot: string; accent?: string }) {
  return <article className="stat-card"><div className="stat-top"><span className="stat-label">{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{value}<span className="stat-unit">{unit}</span></div><div className="stat-foot"><span className={accent}>{foot}</span></div></article>;
}
function MonthMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) { return <div className="month-metric"><span className="month-metric-icon">{icon}</span><span><span className="month-metric-value">{value}</span><span className="month-metric-label">{label}</span></span></div>; }
function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) { return <div className="empty-state"><div><span className="empty-state-icon">{icon}</span><h3>{title}</h3><p>{description}</p>{action}</div></div>; }
function HistoryCard({ session, status, onEdit, onDelete }: { session: WorkoutSession; status: string; onEdit: (session: WorkoutSession) => void; onDelete: () => void }) {
  const statusLabel = status === "went" ? "Gym visit" : status === "missed" ? "Did not go" : status === "rest" ? "Planned rest" : "Not recorded";
  return <article className="history-session"><div className="history-session-top"><div><h2 className="history-session-title">{session.workoutType}</h2><div className="history-session-date">{formatDate(session.workoutDate)} · {statusLabel}</div></div><div className="history-session-actions"><button className="btn btn-sm" onClick={() => onEdit(session)}>Edit</button><button className="btn btn-sm btn-danger" onClick={onDelete}>Delete</button></div></div><div className="workout-muscles" style={{ marginTop: 10 }}>{session.muscleGroups.map((muscle) => <span key={muscle} className="muscle-pill">{muscle}</span>)}</div><div className="history-meta"><span><Clock3 size={12} />{session.durationMinutes} minutes</span>{session.startTime && <span><Timer size={12} />{session.startTime}{session.endTime ? ` – ${session.endTime}` : ""}</span>}<span><Dumbbell size={12} />{session.exercises.length} exercise{session.exercises.length === 1 ? "" : "s"}</span>{session.energy && <span><Zap size={12} />Energy {session.energy}/5</span>}</div>{session.exercises.length > 0 && <div className="history-exercises">{session.exercises.map((exercise) => <span className="exercise-tag" key={exercise.id}>{exercise.name}{exercise.sets.length ? ` · ${exercise.sets.length} sets` : ""}</span>)}</div>}{session.notes && <p className="history-notes">{session.notes}</p>}</article>;
}
