import React, { useState, useEffect, useCallback, useRef, useContext, createContext } from "react";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { db, QUESTS_COLLECTION } from "./firebase.js";
import {
  BookOpen, Dumbbell, Coins, ShieldCheck, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Mountain, Check, Minus, Plus, Save, Trophy, Crown, Lock, RotateCcw, Home, MoreVertical,
  CheckCircle2, CloudOff, Loader2, KeyRound, Copy, Sun, Moon, Sparkles, Calendar, Trash2,
  Utensils, ListTodo, ArrowRightToLine, Pencil, Users, UserPlus, History,
  Briefcase, Plane, Tag, EyeOff, Eye,
  Rocket, TrendingUp, Building2, Shuffle, Gem, Globe,
} from "lucide-react";

const SYNC_ENABLED = true;

const LOCAL_STATE_KEY = "life-rpg-local-state";

/* ---------------------------------------------------------------
   THEME TOKENS
   C is a map of CSS custom-property references. The actual colors
   live in THEME_CSS below, scoped under .theme-dark / .theme-light
   classes applied to the outer app shell — so every component below
   can keep using C.xxx unchanged while the whole app re-themes.
--------------------------------------------------------------- */
const C = {
  surface: "var(--surface)",
  surfaceLow: "var(--surface-low)",
  container: "var(--container)",
  containerHigh: "var(--container-high)",
  containerHighest: "var(--container-highest)",
  outline: "var(--outline)",
  outlineVariant: "var(--outline-variant)",
  onSurface: "var(--on-surface)",
  onSurfaceVariant: "var(--on-surface-variant)",
  faint: "var(--faint)",
  danger: "var(--danger)",
  dangerContainer: "var(--danger-container)",
  wisdom: "var(--wisdom)",
  vitality: "var(--vitality)",
  wealth: "var(--wealth)",
  resolve: "var(--resolve)",
  accent: "var(--accent)",
  glow: "var(--glow)",
};

const THEME_CSS = `
.theme-dark {
  --surface: #070912;
  --surface-low: #0B0E1A;
  --container: #10131F;
  --container-high: #161B2C;
  --container-highest: #1E2438;
  --outline: #2A3350;
  --outline-variant: #1A2035;
  --on-surface: #E7ECFF;
  --on-surface-variant: #8891B0;
  --faint: #545C7A;
  --danger: #FF6B7A;
  --danger-container: #3A1620;
  --wisdom: #A88CFF;
  --vitality: #FF6B4A;
  --wealth: #FFC24B;
  --resolve: #3FE0C5;
  --accent: #4F8EFF;
  --glow: rgba(79,142,255,0.35);
  --shell-shadow: 0 20px 48px rgba(0,0,0,0.55);
  --ripple: rgba(255,255,255,0.22);
}
.theme-light {
  --surface: #EEF3FB;
  --surface-low: #E3EAF7;
  --container: #FFFFFF;
  --container-high: #F3F6FC;
  --container-highest: #E7EDF9;
  --outline: #C7D2E8;
  --outline-variant: #DCE4F3;
  --on-surface: #16203A;
  --on-surface-variant: #5B6683;
  --faint: #93A0BE;
  --danger: #D6394A;
  --danger-container: #FBE3E5;
  --wisdom: #6A46D6;
  --vitality: #D8541F;
  --wealth: #B37800;
  --resolve: #0E8E7D;
  --accent: #2F6FEF;
  --glow: rgba(47,111,239,0.22);
  --shell-shadow: 0 20px 48px rgba(30,50,100,0.18);
  --ripple: rgba(20,40,90,0.12);
}
`;

const sans = "'Roboto', 'Google Sans Text', system-ui, -apple-system, sans-serif";
const mono = "'Roboto Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const NAV_H = 72;
const FONT_IMPORT = "@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&family=Roboto+Mono:wght@400;500;700&display=swap');";

const QUEST_START = new Date(2026, 7, 2); // 2 Aug 2026
const QUEST_END = new Date(2026, 9, 31); // 31 Oct 2026
const TOTAL_DAYS = 91;
const MT_START = new Date(2026, 7, 3);
const MT_END = new Date(2026, 9, 30);

const CODE_STORAGE_KEY = "life-rpg-code";
const THEME_STORAGE_KEY = "life-rpg-theme";
const MAIN_DOC_ID = "main";
const AUTH_DOC_ID = "_auth_";
const READER_LOG_DOC_ID = "_reader_log_";
const ReadOnlyContext = createContext(false);

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function dayIndex(d) {
  return Math.floor((d - QUEST_START) / 86400000) + 1;
}
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
/* Relative-time label for reader activity ("Priya · 2h ago"). */
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function dateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/* Our theme colors are CSS var() references (e.g. "var(--wisdom)") so a
   trailing hex alpha suffix like `${color}66` — which worked when C.* held
   literal hex strings — is invalid CSS on a var() and silently drops the
   whole value. color-mix() is the correct way to add alpha to a custom
   property at use-site. */
function mix(colorVar, pct) {
  return `color-mix(in srgb, ${colorVar} ${pct}%, transparent)`;
}
/* Blends two theme colors together (rather than fading toward
   transparent, like mix() does) — used to give a category its own
   distinct hue when the 5-color theme palette runs short, e.g. US
   Stocks = accent+wisdom so it doesn't look identical to Flexi Cap's
   plain accent. */
function blend(colorA, colorB, pctA = 50) {
  return `color-mix(in srgb, ${colorA} ${pctA}%, ${colorB})`;
}
function weekdayCount(start, end) {
  let n = 0;
  let d = new Date(start);
  while (d <= end) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}
function weekRange(weekNum) {
  const start = new Date(QUEST_START);
  start.setDate(start.getDate() + (weekNum - 1) * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  if (end > QUEST_END) end.setTime(QUEST_END.getTime());
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}
function weekdayDates(start, end) {
  const out = [];
  let d = new Date(start);
  while (d <= end) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) out.push(fmtDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
const MT_TOTAL = weekdayCount(MT_START, MT_END); // 65
const MT_DATES = weekdayDates(MT_START, MT_END);
const MT_WEEKS = Array.from({ length: 13 }, (_, w) => {
  const startDay = w * 7 + 1;
  const endDay = Math.min(startDay + 6, TOTAL_DAYS);
  return MT_DATES.filter((ds) => {
    const n = dayIndex(new Date(ds + "T00:00:00"));
    return n >= startDay && n <= endDay;
  });
});

/* ---------------------------------------------------------------
   RANK / XP — cosmetic HUD layer derived from the four raw stat scores.
   totalXP is just wScore + vScore + weScore + rScore, so it ranges 0-400
   (each stat maxes at 100) — no separate number to track. Rank bands get
   incrementally wider (20/40/60/80/100 XP) so early ranks come quickly
   and S stays a real reach. The XP bar fills toward the *next* rank,
   resetting each time you cross a threshold.
--------------------------------------------------------------- */
const RANK_BANDS = [
  { rank: "E", from: 0, to: 20 },
  { rank: "D", from: 20, to: 60 },
  { rank: "C", from: 60, to: 120 },
  { rank: "B", from: 120, to: 200 },
  { rank: "A", from: 200, to: 300 },
  { rank: "S", from: 300, to: 380 },
  { rank: "SS", from: 380, to: 400 },
];
function rankInfo(totalXP) {
  const xp = clamp(totalXP, 0, 400);
  const band = RANK_BANDS.find((b) => xp < b.to) || RANK_BANDS[RANK_BANDS.length - 1];
  const progress = band.to > band.from ? (xp - band.from) / (band.to - band.from) : 1;
  return { rank: band.rank, progress: clamp(progress, 0, 1), bandFrom: band.from, bandTo: band.to, xp };
}
/* Real hex values (not CSS vars) per rank per theme, so the card can tint
   its glow/border/text with alpha-suffixed colors (e.g. `${mix(c, 33)}`), which
   only works with concrete hex — CSS var() references can't take a
   trailing alpha suffix like that. */
const RANK_COLORS = {
  dark: { E: "#8A93B8", D: "#4ADE80", C: "#4F8EFF", B: "#FB6F92", A: "#FF9F45", S: "#FF4D67", SS: "#F5FAFF" },
  light: { E: "#6E7997", D: "#16A34A", C: "#2F6FEF", B: "#BE185D", A: "#C05F0F", S: "#9F1239", SS: "#111827" },
};
function rankColor(rank, mode) {
  return (RANK_COLORS[mode] || RANK_COLORS.dark)[rank] || (RANK_COLORS[mode] || RANK_COLORS.dark).C;
}
/* ---------------------------------------------------------------
   SECRET CODE HELPERS
--------------------------------------------------------------- */
function sanitizeCode(raw) {
  return raw.trim().replace(/[\/\s]+/g, "-").slice(0, 80);
}

/* Named readers replaced the single shared read code. Profiles created
   before that change only have a flat `readCodeHash` — surface it here
   as a synthetic "legacy" reader so those devices keep working until
   the owner retires it or removes it from the Readers panel. */
function normalizeReaders(authConfig) {
  const list = Array.isArray(authConfig?.readers) ? authConfig.readers : [];
  if (authConfig?.readCodeHash) {
    return [{ id: "legacy", name: "Shared (old code)", codeHash: authConfig.readCodeHash, legacy: true }, ...list];
  }
  return list;
}

/* Appends a reader open-event to the shared session log (owner-visible
   only, via the Readers panel). Best-effort — a failed write here should
   never block the reader from getting into the app. */
async function logReaderSession(readerId, name) {
  if (!SYNC_ENABLED) return;
  try {
    const ref = doc(db, QUESTS_COLLECTION, READER_LOG_DOC_ID);
    const snap = await getDoc(ref);
    const existing = snap.exists() && Array.isArray(snap.data().sessions) ? snap.data().sessions : [];
    const next = [...existing, { readerId, name, at: new Date().toISOString() }].slice(-40);
    await setDoc(ref, { sessions: next });
  } catch {}
}

/* Small id generator for diet plans/items — no external uuid dep needed. */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------------------------------------------------------
   DEFAULT STATE

   NOTE: armWeeks / abWeeks are stored as an OBJECT keyed by week index
   (0-12) rather than an array of arrays. Firestore's setDoc() rejects
   documents containing an array nested directly inside another array
   ("Nested arrays are not supported"), which armWeeks/abWeeks used to
   be (an array of 13 arrays). An object of arrays is fine — numeric
   keys still iterate in ascending order, so existing indexing code
   (armWeeks[wi][si]) keeps working unchanged.
--------------------------------------------------------------- */
const STATUS_OPTIONS = [
  { value: "home", label: "Home", icon: Home },
  { value: "office", label: "Office", icon: Briefcase },
  { value: "trekking", label: "Trekking", icon: Mountain },
  { value: "muaythai", label: "Muay Thai", icon: Dumbbell },
  { value: "traveling", label: "Traveling", icon: Plane },
  { value: "off", label: "Off", icon: Moon },
];

function defaultState() {
  return {
    profile: {
      name: "",
      status: "",
      statusEnabled: true,
    },
    wisdom: {
      laws: Array(48).fill(false),
      lawsFinished: false,
      rdpd: Array(10).fill(false),
      alchemist: false,
    },
    vitality: {
      muayThai: {},
      armWeeks: Object.fromEntries(
        Array.from({ length: 13 }, (_, i) => [i, Array(i < 4 ? 1 : 2).fill(false)])
      ),
      abWeeks: Object.fromEntries(
        Array.from({ length: 13 }, (_, i) => [i, Array(i < 4 ? 1 : 2).fill(false)])
      ),
      treks: 0,
    },
    wealth: {
      invest: [emptyInvestMonth(), emptyInvestMonth(), emptyInvestMonth()],
      save: [0, 0, 0],
      saveAllowance: [0, 0, 0], // in units of ₹1,000, drawn from a shared ₹5,000 pool across the 3 months
    },
    resolve: {
      dailyLogs: {},
      weeklyLogs: {},
      bedsheets: 0,
      junkFood: 0,
      mtLeaves: 0,
      wakeBreaks: 0,
      bonusTasks: [], // [{ id, title, description, completed }] — each completed task is worth +1 point
    },
    // Diet tracker — entirely separate from the Level 1 quest. Nothing here
    // ever feeds wisdomScore/vitalityScore/wealthScore/resolveScore, so it
    // never contributes points or XP; it's just a food/protein log.
    diet: {
      plans: [], // [{ id, name, items: [{ id, name, protein }] }]
      logs: {}, // { "YYYY-MM-DD": { planId, completed: { [itemId]: true } } }
    },
    // Day planner — also separate from the Level 1 quest / scoring.
    planner: {
      days: {}, // { "YYYY-MM-DD": [{ id, title, completed }] }
      unlisted: [], // [{ id, title }] — backlog tasks not yet assigned to a day
    },
  };
}

function migrateState(parsed) {
  const base = defaultState();
  const next = { ...base, ...parsed };
  if (!next.profile) next.profile = { name: "", status: "", statusEnabled: true };
  if (next.profile.status === undefined) next.profile.status = "";
  if (next.profile.statusEnabled === undefined) next.profile.statusEnabled = true;
  if (typeof next.vitality?.muayThai === "number") {
    const n = next.vitality.muayThai;
    const map = {};
    MT_DATES.slice(0, n).forEach((ds) => { map[ds] = true; });
    next.vitality = { ...next.vitality, muayThai: map };
  }
  if (!next.vitality) next.vitality = base.vitality;
  // Migrate any legacy array-of-arrays shape (or missing data) into the
  // object-keyed-by-week-index shape Firestore can actually store.
  if (Array.isArray(next.vitality.armWeeks)) {
    next.vitality = {
      ...next.vitality,
      armWeeks: Object.fromEntries(next.vitality.armWeeks.map((w, i) => [i, w])),
    };
  }
  if (!next.vitality.armWeeks) next.vitality.armWeeks = base.vitality.armWeeks;
  if (Array.isArray(next.vitality.abWeeks)) {
    next.vitality = {
      ...next.vitality,
      abWeeks: Object.fromEntries(next.vitality.abWeeks.map((w, i) => [i, w])),
    };
  }
  if (!next.vitality.abWeeks) next.vitality.abWeeks = base.vitality.abWeeks;
  if (!next.wisdom) next.wisdom = base.wisdom;
  if (!next.wealth) next.wealth = base.wealth;
  if (!Array.isArray(next.wealth.saveAllowance)) next.wealth = { ...next.wealth, saveAllowance: [0, 0, 0] };
  if (!next.resolve) next.resolve = base.resolve;
  if (!Array.isArray(next.resolve.bonusTasks)) next.resolve = { ...next.resolve, bonusTasks: [] };
  if (!next.diet) next.diet = base.diet;
  if (!Array.isArray(next.diet.plans)) next.diet = { ...next.diet, plans: [] };
  if (!next.diet.logs || typeof next.diet.logs !== "object") next.diet = { ...next.diet, logs: {} };
  if (!next.planner) next.planner = base.planner;
  if (!next.planner.days || typeof next.planner.days !== "object") next.planner = { ...next.planner, days: {} };
  if (!Array.isArray(next.planner.unlisted)) next.planner = { ...next.planner, unlisted: [] };
  return next;
}

/* ---------------------------------------------------------------
   SCORING
--------------------------------------------------------------- */
function wisdomScore(s) {
  const laws = s.laws.filter(Boolean).length * 1 + (s.lawsFinished ? 2 : 0);
  const rdpd = s.rdpd.filter(Boolean).length * 3;
  const alch = s.alchemist ? 20 : 0;
  return clamp(laws + rdpd + alch, 0, 100);
}
function vitalityScore(s) {
  const mt = Object.values(s.muayThai).filter(Boolean).length;
  const armPts = Object.entries(s.armWeeks).reduce(
    (sum, [i, week]) => sum + week.filter(Boolean).length * (Number(i) < 4 ? 1 : 0.5),
    0
  );
  const abPts = Object.entries(s.abWeeks).reduce(
    (sum, [i, week]) => sum + week.filter(Boolean).length * (Number(i) < 4 ? 1 : 0.5),
    0
  );
  const treks = s.treks * 1;
  return clamp(mt + armPts + abPts + treks, 0, 100);
}
/* Investment allocation — 20 pts/month split across categories by the
   real portfolio weighting (25/25/15/15/10/10), so points = pct/5.
   Each category also gets a color + icon so the mission card reads as
   a real portfolio breakdown instead of a flat checklist. */
const INVEST_CATEGORIES = [
  { key: "smallCap", label: "Small Cap MF", pct: 25, pts: 5, color: C.vitality, icon: Rocket },
  { key: "midCap", label: "Mid Cap MF", pct: 25, pts: 5, color: C.wisdom, icon: TrendingUp },
  { key: "largeCap", label: "Large Cap MF", pct: 15, pts: 3, color: C.resolve, icon: Building2 },
  { key: "flexiCap", label: "Flexi Cap MF", pct: 15, pts: 3, color: C.accent, icon: Shuffle },
  { key: "gold", label: "Gold", pct: 10, pts: 2, color: C.wealth, icon: Gem },
  { key: "usStocks", label: "US Stocks", pct: 10, pts: 2, color: blend(C.accent, C.wisdom, 55), icon: Globe },
];
function emptyInvestMonth() {
  return Object.fromEntries(INVEST_CATEGORIES.map((c) => [c.key, null]));
}
/* Each category entry is either null (unchecked) or an ISO date string
   recording when it was marked — so the UI can show "Marked Aug 5".
   s.wealth.invest used to be a plain boolean per month, and each month
   object used to hold booleans per category (no date); these helpers
   accept all three shapes so old saved state keeps working until the
   person re-checks that month's categories. */
function investMonthPoints(month) {
  if (typeof month === "boolean") return month ? 20 : 0;
  if (!month) return 0;
  return INVEST_CATEGORIES.reduce((sum, c) => sum + (month[c.key] ? c.pts : 0), 0);
}
function investMonthAny(month) {
  if (typeof month === "boolean") return month;
  if (!month) return false;
  return INVEST_CATEGORIES.some((c) => month[c.key]);
}
function investMonthComplete(month) {
  if (typeof month === "boolean") return month;
  if (!month) return false;
  return INVEST_CATEGORIES.every((c) => month[c.key]);
}
/* Renders a category's stored value as a short date label ("Aug 5"),
   whether it's an ISO string (new format) or a plain `true` (old
   format, no date on record). */
function investMarkedLabel(value) {
  if (!value) return null;
  if (value === true) return "Marked";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Marked";
  return `Marked ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
function savePoints(amt) {
  if (amt >= 15000) return 12;
  return Math.max(0, 12 - Math.floor((15000 - amt) / 1000));
}
const SAVE_ALLOWANCE_POOL = 5; // ₹5,000 total, in units of ₹1,000
function effSave(s, i) {
  return s.save[i] + (s.saveAllowance?.[i] || 0) * 1000;
}
function wealthScore(s) {
  const inv = s.invest.reduce((sum, m) => sum + investMonthPoints(m), 0);
  const sav = s.save.reduce((sum, _a, i) => sum + savePoints(effSave(s, i)), 0);
  const bonus = s.save.every((_a, i) => effSave(s, i) >= 15000) ? 4 : 0;
  return clamp(inv + sav + bonus, 0, 100);
}
function resolveScore(s) {
  let daily = 0;
  Object.values(s.dailyLogs).forEach((log) => {
    daily += (log.wake ? 0.2 : 0) + (log.plan ? 0.2 : 0) + (log.hair ? 0.2 : 0) + (log.teeth ? 0.2 : 0);
  });
  let weekly = 0;
  Object.values(s.weeklyLogs).forEach((log) => {
    weekly += (log.laundry ? 1 : 0) + (log.iron ? 1 : 0);
  });
  const bedsheets = s.bedsheets * 0.4;
  const deductions =
    Math.max(0, s.junkFood - 8) + Math.max(0, s.mtLeaves - 6) + Math.max(0, s.wakeBreaks - 20);
  const bonusPoints = (s.bonusTasks || []).filter((t) => t.completed).length;
  const netDeductions = Math.max(0, deductions - bonusPoints);
  return clamp(daily + weekly + bedsheets - netDeductions, 0, 100);
}

/* ---------------------------------------------------------------
   AUTOMATIC LEAVE COVERAGE (Wake-up / Muay Thai)
   Every missed day — whether checked "Wake up by 7:00 AM" once its
   7 AM has passed, or a Muay Thai class once that class day is over —
   is treated as covered for scoring, full stop: it always reads as
   done, so you never lose the underlying 0.2 (wake) or per-class
   (Muay Thai) credit for it. The cost of "using a leave" lives
   entirely in the Discipline Allowance deduction (1 pt per miss
   beyond the 20 wake / 6 MT allowance) — which bonusTasks can offset,
   so someone with enough bonus points can miss beyond the cap and
   still land on a perfect score. This only adjusts SCORING (via the
   "effective" copies below); the raw dailyLogs/muayThai booleans are
   never modified, so achievements that care about real attendance
   (fed the same effective state) still reflect covered days as done,
   consistent with what the score shows.
--------------------------------------------------------------- */
const WAKE_CUTOFF_HOUR = 7;
const WAKE_LEAVE_ALLOWANCE = 20;
const MT_LEAVE_ALLOWANCE = 6;
const QUEST_DATES = (() => {
  const out = [];
  let d = new Date(QUEST_START);
  while (d <= QUEST_END) {
    out.push(fmtDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
})();

function wakeAutoStats(dailyLogs, now) {
  const nowKey = fmtDate(now);
  const cutoffPassedToday = now.getHours() >= WAKE_CUTOFF_HOUR;
  const missedDates = [];
  for (const ds of QUEST_DATES) {
    if (ds > nowKey) break;
    if (ds === nowKey && !cutoffPassedToday) continue;
    if (!dailyLogs[ds]?.wake) missedDates.push(ds);
  }
  return { misses: missedDates.length, missedDates };
}

function mtAutoStats(muayThai, now) {
  const nowKey = fmtDate(now);
  const missedDates = [];
  for (const ds of MT_DATES) {
    if (ds >= nowKey) break;
    if (!muayThai[ds]) missedDates.push(ds);
  }
  return { misses: missedDates.length, missedDates };
}

/* Returns a resolve slice for SCORING/DISPLAY where every past wake
   miss reads as done (see header comment), and mtLeaves/wakeBreaks
   reflect the live auto miss count that drives the deduction. Also
   carries wakeMissedDates so the UI can show which specific days were
   auto-covered, and which of those were within the free allowance vs.
   past it (costing a deduction point). Never persisted — build fresh
   from raw state each render. */
function effectiveResolve(resolveState, vitalityState, now) {
  const wake = wakeAutoStats(resolveState.dailyLogs, now);
  const mt = mtAutoStats(vitalityState.muayThai, now);
  let dailyLogs = resolveState.dailyLogs;
  if (wake.misses > 0) {
    dailyLogs = { ...dailyLogs };
    wake.missedDates.forEach((ds) => {
      dailyLogs[ds] = { ...(dailyLogs[ds] || {}), wake: true };
    });
  }
  return {
    ...resolveState,
    dailyLogs,
    wakeBreaks: wake.misses,
    mtLeaves: mt.misses,
    wakeMissedDates: wake.missedDates,
  };
}

/* Same rule as wake-up: every missed Muay Thai class always reads as
   attended for scoring — the underlying per-class Vitality credit is
   never lost. The only cost of going past the 6-class allowance is the
   Resolve-side mtLeaves deduction (1 pt per excess miss, offsettable
   by bonusTasks) computed in effectiveResolve. */
function effectiveVitality(vitalityState, now) {
  const mt = mtAutoStats(vitalityState.muayThai, now);
  if (mt.misses === 0) return vitalityState;
  const muayThai = { ...vitalityState.muayThai };
  mt.missedDates.forEach((ds) => { muayThai[ds] = true; });
  return { ...vitalityState, muayThai, mtMissedDates: mt.missedDates };
}

/* Achievements must judge the same "leave-adjusted" picture the score
   screens show, not the raw logs — otherwise a leave-covered day that
   reads as full credit on the Resolve/Vitality tabs (and in the score
   used to unlock "reach 100" achievements) wouldn't count toward
   achievements like Iron Will / Perfect Day / Disciplined at all. */
function achievementState(state, effVitality, effResolve) {
  return { ...state, vitality: effVitality, resolve: effResolve };
}

/* ---------------------------------------------------------------
   ACHIEVEMENTS
--------------------------------------------------------------- */
function perfectDaysCount(dailyLogs) {
  return Object.values(dailyLogs).filter((l) => l.wake && l.plan && l.hair && l.teeth).length;
}
function fullWeeksCount(weeklyLogs) {
  return Object.values(weeklyLogs).filter((w) => w.laundry && w.iron).length;
}

const ACHIEVEMENTS = [
  { id: "w1", attr: "wisdom", label: "First Page", desc: "Check off your first Law of Power.", check: (s) => s.wisdom.laws.some(Boolean) },
  { id: "w2", attr: "wisdom", label: "Power Scholar", desc: "Finish The 48 Laws of Power.", check: (s) => s.wisdom.lawsFinished },
  { id: "w3", attr: "wisdom", label: "Financial Mind", desc: "Finish all of Rich Dad Poor Dad.", check: (s) => s.wisdom.rdpd.every(Boolean) },
  { id: "w4", attr: "wisdom", label: "The Alchemist", desc: "Finish The Alchemist.", check: (s) => s.wisdom.alchemist },
  { id: "w5", attr: "wisdom", label: "Wisdom Master", desc: "Reach 100/100 Wisdom.", check: (s) => wisdomScore(s.wisdom) >= 100 },
  { id: "v1", attr: "vitality", label: "First Class", desc: "Attend your first Muay Thai class.", check: (s) => Object.values(s.vitality.muayThai).some(Boolean) },
  { id: "v2", attr: "vitality", label: "Halfway There", desc: "Attend 33+ Muay Thai classes.", check: (s) => Object.values(s.vitality.muayThai).filter(Boolean).length >= 33 },
  { id: "v3", attr: "vitality", label: "Iron Will", desc: "Attend every Muay Thai class (leaves count).", check: (s) => Object.values(s.vitality.muayThai).filter(Boolean).length >= MT_TOTAL },
  { id: "v4", attr: "vitality", label: "Arm Day", desc: "Complete every Arm Training session.", check: (s) => Object.values(s.vitality.armWeeks).every((w) => w.every(Boolean)) },
  { id: "v5", attr: "vitality", label: "Core Strength", desc: "Complete every Ab Training session.", check: (s) => Object.values(s.vitality.abWeeks).every((w) => w.every(Boolean)) },
  { id: "v6", attr: "vitality", label: "Trailblazer", desc: "Complete your first trek.", check: (s) => s.vitality.treks >= 1 },
  { id: "v7", attr: "vitality", label: "Summit Seeker", desc: "Complete all 9 treks.", check: (s) => s.vitality.treks >= 9 },
  { id: "v8", attr: "vitality", label: "Vitality Master", desc: "Reach 100/100 Vitality.", check: (s) => vitalityScore(s.vitality) >= 100 },
  { id: "we1", attr: "wealth", label: "First Investment", desc: "Log your first month's investment allocation.", check: (s) => s.wealth.invest.some(investMonthAny) },
  { id: "we2", attr: "wealth", label: "Investor", desc: "Hit the full allocation 3 months running.", check: (s) => s.wealth.invest.every(investMonthComplete) },
  { id: "we3", attr: "wealth", label: "Saver", desc: "Hit the ₹15,000 save target in a month.", check: (s) => s.wealth.save.some((a, i) => effSave(s.wealth, i) >= 15000) },
  { id: "we4", attr: "wealth", label: "Consistency Bonus", desc: "Hit the save target all 3 months.", check: (s) => s.wealth.save.every((a, i) => effSave(s.wealth, i) >= 15000) },
  { id: "we5", attr: "wealth", label: "Wealth Master", desc: "Reach 100/100 Wealth.", check: (s) => wealthScore(s.wealth) >= 100 },
  { id: "r1", attr: "resolve", label: "Perfect Day", desc: "Complete all 4 daily missions in one day.", check: (s) => perfectDaysCount(s.resolve.dailyLogs) >= 1 },
  { id: "r2", attr: "resolve", label: "Steady Streak", desc: "Log 14 perfect days.", check: (s) => perfectDaysCount(s.resolve.dailyLogs) >= 14 },
  { id: "r3", attr: "resolve", label: "Perfect Week", desc: "Laundry and iron done in the same week.", check: (s) => fullWeeksCount(s.resolve.weeklyLogs) >= 1 },
  { id: "r4", attr: "resolve", label: "Fresh Linen", desc: "Change bedsheets all 3 times.", check: (s) => s.resolve.bedsheets >= 3 },
  { id: "r5", attr: "resolve", label: "Disciplined", desc: "Reach 100/100 Resolve.", check: (s) => resolveScore(s.resolve) >= 100 }, // s.resolve is leave-adjusted, see achievementState()
  { id: "o1", attr: "overall", label: "Quarter Quest", desc: "Reach 25 overall average.", check: (s, o) => o >= 25 },
  { id: "o2", attr: "overall", label: "Halfway Hero", desc: "Reach 50 overall average.", check: (s, o) => o >= 50 },
  { id: "o3", attr: "overall", label: "Home Stretch", desc: "Reach 75 overall average.", check: (s, o) => o >= 75 },
  { id: "o4", attr: "overall", label: "Level 1 Complete", desc: "Max all four attributes.", check: (s, o) => o >= 100 },
];

/* ---------------------------------------------------------------
   RIPPLE — a small, real Material touch response (state-layer + ripple)
--------------------------------------------------------------- */
function Touchable({ children, onClick, style, className, disabled, rippleColor, writeAction = false }) {
  const readOnly = useContext(ReadOnlyContext);
  const effectiveDisabled = disabled || (writeAction && readOnly);
  const ref = useRef(null);
  const fire = (e) => {
    if (effectiveDisabled) return;
    const el = ref.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.6;
      const span = document.createElement("span");
      span.style.position = "absolute";
      span.style.borderRadius = "50%";
      span.style.background = rippleColor || "var(--ripple)";
      span.style.width = span.style.height = size + "px";
      span.style.left = (e.clientX - rect.left - size / 2) + "px";
      span.style.top = (e.clientY - rect.top - size / 2) + "px";
      span.style.transform = "scale(0)";
      span.style.animation = "md-ripple 500ms ease-out forwards";
      span.style.pointerEvents = "none";
      el.appendChild(span);
      setTimeout(() => span.remove(), 520);
    }
    onClick?.(e);
  };
  return (
    <div
      ref={ref}
      onClick={fire}
      style={{ position: "relative", overflow: "hidden", cursor: effectiveDisabled ? "default" : "pointer", ...style }}
      className={className}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------
   SMALL UI PRIMITIVES
--------------------------------------------------------------- */
function Ring({ value, max, color, size = 52, stroke = 5, children, glow = false }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = clamp(value / max, 0, 1);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0, filter: glow ? `drop-shadow(0 0 6px ${color})` : "none" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.outlineVariant} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

/* Icon slot — no shape, no border. Just the icon itself, centered in a
   fixed-size box so layout/spacing stays identical to the old badge.
   `glow` adds a soft drop-shadow in the icon's own color instead of a
   background ring. */
function Hex({ size = 44, color, glow = false, children }) {
  return (
    <div
      style={{
        width: size, height: size, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        filter: glow ? `drop-shadow(0 0 7px ${mix(color, 60)})` : "none",
      }}
    >
      {children}
    </div>
  );
}

/* Diamond — quest-strip day marker (rotated square) */
function Diamond({ size = 6, color, glow = false }) {
  return (
    <div
      style={{
        width: size, height: size, background: color, transform: "rotate(45deg)",
        borderRadius: 1, boxShadow: glow ? `0 0 6px ${color}` : "none", flexShrink: 0,
      }}
    />
  );
}

function Check2({ checked, onClick, color }) {
  const readOnly = useContext(ReadOnlyContext);
  return (
    <Touchable onClick={onClick} writeAction rippleColor={`${mix(color, 20)}`} style={{ borderRadius: "50%", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: readOnly ? 0.7 : 1 }}>
      <div
        style={{
          width: 20, height: 20, borderRadius: 4,
          border: `2px solid ${checked ? color : C.faint}`,
          background: checked ? color : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.12s ease",
        }}
      >
        {checked && <Check size={13} color={C.surface} strokeWidth={3.5} />}
      </div>
    </Touchable>
  );
}

function Counter({ value, max, onChange, color }) {
  const readOnly = useContext(ReadOnlyContext);
  return (
    <div className="flex items-center gap-1" style={{ opacity: readOnly ? 0.7 : 1 }}>
      <Touchable writeAction onClick={() => onChange(clamp(value - 1, 0, max))} style={{ color: C.onSurfaceVariant, border: `1px solid ${C.outline}`, width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Minus size={14} />
      </Touchable>
      <span style={{ fontFamily: mono, color: C.onSurface, minWidth: 52, textAlign: "center", fontSize: 14 }}>
        {value} / {max}
      </span>
      <Touchable writeAction onClick={() => onChange(clamp(value + 1, 0, max))} style={{ color, border: `1px solid ${color}`, width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }} rippleColor={`${mix(color, 20)}`}>
        <Plus size={14} />
      </Touchable>
    </div>
  );
}

/* ---------------------------------------------------------------
   QUEST STRIP — horizontal scroll of week diamonds, HUD tracker feel
--------------------------------------------------------------- */
function QuestStrip({ today }) {
  const idx = clamp(dayIndex(today), 1, TOTAL_DAYS);
  const weeks = Array.from({ length: 13 }, (_, w) => {
    const startDay = w * 7 + 1;
    return Array.from({ length: 7 }, (_, d) => startDay + d).filter((n) => n <= TOTAL_DAYS);
  });
  return (
    <div className="w-full overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
      <div className="flex gap-2.5 px-4 py-3" style={{ minWidth: 560 }}>
        {weeks.map((week, wi) => {
          const isCurrent = idx >= week[0] && idx <= week[week.length - 1];
          return (
            <div
              key={wi}
              className="flex flex-col items-center gap-1.5 flex-shrink-0"
              style={{
                padding: "6px 10px",
                borderRadius: 12,
                background: isCurrent ? `${mix(C.accent, 13)}` : "transparent",
                border: isCurrent ? `1px solid ${mix(C.accent, 33)}` : "1px solid transparent",
                boxShadow: isCurrent ? `0 0 10px ${C.glow}` : "none",
              }}
            >
              <div className="flex gap-[4px]">
                {week.map((n) => {
                  const state = n < idx ? "past" : n === idx ? "now" : "future";
                  return (
                    <Diamond
                      key={n}
                      size={n === idx ? 7 : 6}
                      color={state === "past" ? C.resolve : state === "now" ? C.accent : C.outlineVariant}
                      glow={state === "now"}
                    />
                  );
                })}
              </div>
              <span style={{ fontFamily: mono, fontSize: 9.5, fontWeight: isCurrent ? 700 : 500, color: isCurrent ? C.accent : C.faint, letterSpacing: 0.5 }}>
                W{wi + 1}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   ATTRIBUTE ROW — HUD stat card with hex emblem
--------------------------------------------------------------- */
function AttrRow({ icon: Icon, label, score, color, onClick, tagline }) {
  return (
    <Touchable
      onClick={onClick}
      style={{
        background: `linear-gradient(120deg, var(--container-high), var(--container))`,
        border: `1px solid ${C.outlineVariant}`,
        borderRadius: 18, display: "block", marginBottom: 10,
      }}
    >
      <div
        style={{
          position: "absolute", inset: 0, borderRadius: 18,
          background: `linear-gradient(90deg, ${mix(color, 15)}, transparent 34%)`,
          pointerEvents: "none",
        }}
      />
      <div className="flex items-center gap-4 p-4">
        <Hex size={46} color={color}>
          <Icon size={24} color={color} />
        </Hex>
        <div className="flex-1 min-w-0">
          <span style={{ fontFamily: sans, fontWeight: 700, color: C.onSurface, fontSize: 14.5, letterSpacing: 0.3 }}>{label.toUpperCase()}</span>
          <p style={{ color: C.onSurfaceVariant, fontSize: 11.5, marginTop: 2 }}>{tagline}</p>
          <div style={{ height: 4, background: C.outlineVariant, borderRadius: 3, marginTop: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${clamp(score, 0, 100)}%`, background: color, borderRadius: 3, boxShadow: `0 0 6px ${mix(color, 60)}`, transition: "width 0.4s ease" }} />
          </div>
        </div>
        <Ring value={score} max={100} color={color} size={44} stroke={4}>
          <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: C.onSurface }}>{Math.round(score)}</span>
        </Ring>
        <ChevronRight size={18} color={C.faint} />
      </div>
    </Touchable>
  );
}

/* ---------------------------------------------------------------
   SECTION HEADER
--------------------------------------------------------------- */
function ScreenHeader({ title, sub, color, score }) {
  return (
    <div className="px-4 pt-5 pb-4 flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <Diamond size={7} color={color} glow />
          <div style={{ fontFamily: sans, fontWeight: 900, color: C.onSurface, fontSize: 22, letterSpacing: 0.3 }}>{title.toUpperCase()}</div>
        </div>
        <p style={{ color: C.onSurfaceVariant, fontSize: 12.5, marginTop: 2, marginLeft: 15 }}>{sub}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <div style={{ fontFamily: mono, color, fontSize: 20, fontWeight: 700, textShadow: `0 0 10px ${mix(color, 40)}` }}>{score.toFixed(1)}</div>
        <div style={{ fontFamily: mono, color: C.faint, fontSize: 10.5 }}>/ 100</div>
      </div>
    </div>
  );
}

/* Compact card for 2-up dashboard entries (Diet / Planner) — both use only
   the theme accent color, but at different strengths/directions so the
   pair reads as related without being identical. "solid" is the stronger
   fill (Diet); the default is a lighter, reversed gradient (Planner). */
function DashDuoCard({ icon: Icon, label, metric, sub, onClick, variant = "subtle", locked = false }) {
  const solid = variant === "solid";
  return (
    <Touchable
      onClick={onClick}
      disabled={locked}
      style={{
        position: "relative", overflow: "hidden", display: "block",
        background: solid
          ? `linear-gradient(150deg, ${mix(C.accent, 72)}, ${mix(C.accent, 44)})`
          : `linear-gradient(-20deg, ${mix(C.accent, 8)}, ${mix(C.accent, 2)})`,
        border: `1px solid ${mix(C.accent, solid ? 80 : 14)}`,
        borderRadius: 8,
        boxShadow: solid ? `0 4px 18px ${mix(C.accent, 44)}` : `0 3px 10px ${mix(C.accent, 4)}`,
      }}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <Hex size={22} color={solid ? "#fff" : C.accent}>
          <Icon size={13} color={solid ? "#fff" : C.accent} />
        </Hex>
        <span style={{ color: solid ? "#fff" : C.onSurface, fontFamily: sans, fontWeight: 700, fontSize: 12, letterSpacing: 0.2, flex: 1 }}>{label}</span>
        <div className="text-right flex-shrink-0">
          <div style={{ color: solid ? "#fff" : C.accent, fontFamily: mono, fontSize: 12.5, fontWeight: 700, lineHeight: 1.2 }}>{metric}</div>
          {sub && <div style={{ color: solid ? mix("#fff", 65) : C.faint, fontFamily: mono, fontSize: 9, lineHeight: 1.2 }}>{sub}</div>}
        </div>
      </div>
    </Touchable>
  );
}

/* Shown instead of DietTab/PlannerTab when a read-only session tries to
   open one of them directly (e.g. stale tab state) — keeps them from
   ever rendering plan/task detail for read-only viewers. */
function RestrictedTab({ label, Icon }) {
  return (
    <div className="pb-4">
      <div className="px-4 pt-16 flex flex-col items-center text-center" style={{ gap: 10 }}>
        <Hex size={44} color={C.faint}>
          <Lock size={20} color={C.faint} />
        </Hex>
        <div style={{ fontFamily: sans, fontWeight: 700, color: C.onSurfaceVariant, fontSize: 14 }}>
          {label} isn't available in read-only mode
        </div>
        <p style={{ color: C.faint, fontSize: 12, maxWidth: 260, lineHeight: 1.4 }}>
          Sign in with the write code on this device to view details here.
        </p>
      </div>
    </div>
  );
}

function Mission({ title, points, earned, children, color, defaultOpen = false, rightLabel, locked = false }) {
  const [open, setOpen] = useState(locked ? false : defaultOpen);
  return (
    <div style={{ position: "relative", background: C.container, borderRadius: 10 }} className="mx-4 mb-3 overflow-hidden">
      <div
        style={{
          position: "absolute", left: 0, top: "22%", bottom: "22%", width: 3, borderRadius: 3,
          background: `linear-gradient(180deg, transparent, ${color}, transparent)`,
          boxShadow: `0 0 8px ${mix(color, 60)}`,
        }}
      />
      <Touchable onClick={() => { if (!locked) setOpen((o) => !o); }} disabled={locked} style={{ display: "block" }}>
        <div className="w-full flex items-center justify-between p-4">
          <div style={{ fontFamily: sans, fontWeight: 500, color: C.onSurface, fontSize: 14.5, minWidth: 0, flex: 1 }}>{title}</div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span style={{ fontFamily: mono, color, fontSize: 11.5 }}>
              {rightLabel !== undefined
                ? rightLabel
                : (earned !== undefined ? `${Math.round(earned * 10) / 10} / ${points} pts` : `${points} pts`)}
            </span>
            {!locked && (open ? <ChevronUp size={16} color={C.onSurfaceVariant} /> : <ChevronDown size={16} color={C.onSurfaceVariant} />)}
          </div>
        </div>
      </Touchable>
      {!locked && open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------
   WISDOM TAB
--------------------------------------------------------------- */
function WisdomTab({ s, set }) {
  const score = wisdomScore(s);
  return (
    <div className="pb-4">
      <ScreenHeader title="Wisdom" sub="Knowledge, learning and decision-making." color={C.wisdom} score={score} />
      <Mission title="The 48 Laws of Power" points={50} earned={s.laws.filter(Boolean).length + (s.lawsFinished ? 2 : 0)} color={C.wisdom}>
        <div className="grid grid-cols-6 gap-2 mb-3">
          {s.laws.map((v, i) => (
            <Touchable
              key={i}
              writeAction
              onClick={() => set((d) => { d.wisdom.laws[i] = !d.wisdom.laws[i]; })}
              rippleColor={`${mix(C.wisdom, 20)}`}
              style={{
                fontFamily: mono, fontSize: 11, height: 32, borderRadius: 10,
                background: v ? C.wisdom : C.containerHigh, color: v ? C.surface : C.onSurfaceVariant,
                display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500,
              }}
            >
              {i + 1}
            </Touchable>
          ))}
        </div>
        <label className="flex items-center gap-1">
          <Check2 checked={s.lawsFinished} color={C.wisdom} onClick={() => set((d) => { d.wisdom.lawsFinished = !d.wisdom.lawsFinished; })} />
          <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Finished the book (+2)</span>
        </label>
      </Mission>
      <Mission title="Rich Dad Poor Dad" points={30} earned={s.rdpd.filter(Boolean).length * 3} color={C.wisdom}>
        <div className="flex flex-col">
          {s.rdpd.map((v, i) => (
            <label key={i} className="flex items-center gap-1">
              <Check2 checked={v} color={C.wisdom} onClick={() => set((d) => { d.wisdom.rdpd[i] = !d.wisdom.rdpd[i]; })} />
              <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Chapter {i + 1}</span>
            </label>
          ))}
        </div>
      </Mission>
      <Mission title="The Alchemist" points={20} earned={s.alchemist ? 20 : 0} color={C.wisdom}>
        <label className="flex items-center gap-1">
          <Check2 checked={s.alchemist} color={C.wisdom} onClick={() => set((d) => { d.wisdom.alchemist = !d.wisdom.alchemist; })} />
          <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Finished the book</span>
        </label>
      </Mission>
    </div>
  );
}

/* ---------------------------------------------------------------
   VITALITY TAB
--------------------------------------------------------------- */
function shortDay(ds) {
  const d = new Date(ds + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
}

function currentWeekNum() {
  const t = new Date();
  const idx = clamp(dayIndex(t), 1, TOTAL_DAYS);
  return clamp(Math.ceil(idx / 7), 1, 13);
}

/* Muay Thai attendance, grouped into a per-week dropdown/accordion so the
   list doesn't dump all 65 dates on screen at once. */
function MuayThaiGrid({ value, onToggle, color, freeCovered, costlyCovered }) {
  const [openWeeks, setOpenWeeks] = useState(() => {
    const arr = Array(13).fill(false);
    arr[currentWeekNum() - 1] = true;
    return arr;
  });
  const toggleWeek = (wi) => setOpenWeeks((prev) => prev.map((v, i) => (i === wi ? !v : v)));

  return (
    <div className="flex flex-col gap-2">
      {MT_WEEKS.map((dates, wi) => {
        if (dates.length === 0) return null;
        const done = dates.filter((ds) => value[ds]).length;
        const open = openWeeks[wi];
        return (
          <div key={wi} style={{ background: C.containerHigh, borderRadius: 12 }} className="overflow-hidden">
            <Touchable onClick={() => toggleWeek(wi)} style={{ display: "block" }}>
              <div className="flex items-center justify-between px-3 py-2.5">
                <span style={{ fontFamily: mono, fontSize: 11, color: C.onSurfaceVariant }}>
                  Week {wi + 1} <span style={{ color: C.faint }}>({weekRange(wi + 1)})</span>
                </span>
                <div className="flex items-center gap-2">
                  <span style={{ fontFamily: mono, fontSize: 10.5, color: done === dates.length ? color : C.faint }}>
                    {done} / {dates.length}
                  </span>
                  {open ? <ChevronUp size={14} color={C.onSurfaceVariant} /> : <ChevronDown size={14} color={C.onSurfaceVariant} />}
                </div>
              </div>
            </Touchable>
            {open && (
              <div className="flex gap-2 flex-wrap px-3 pb-3">
                {dates.map((ds) => {
                  const free = !value[ds] && freeCovered?.has(ds);
                  const costly = !value[ds] && costlyCovered?.has(ds);
                  return (
                    <label key={ds} className="flex items-center gap-0.5">
                      <Check2 checked={!!value[ds]} color={color} onClick={() => onToggle(ds)} />
                      <span style={{ fontFamily: mono, fontSize: 9.5, color: free ? color : costly ? C.danger : C.faint }}>
                        {shortDay(ds)}{free ? "*" : costly ? "†" : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* weeks is now an object keyed by week index ("0".."12"), each value an
   array of session booleans — Object.entries keeps them in order. */
function WeekSessionGrid({ weeks, onToggle, color }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Object.entries(weeks).map(([wi, week]) => (
        <div key={wi} className="flex items-center gap-2 flex-wrap">
          <span style={{ fontFamily: mono, fontSize: 10.5, color: C.faint, width: 110 }}>
            Week {Number(wi) + 1}
          </span>
          <div className="flex gap-1">
            {week.map((v, si) => (
              <Check2 key={si} checked={v} color={color} onClick={() => onToggle(wi, si)} />
            ))}
          </div>
          <span style={{ fontFamily: mono, fontSize: 9.5, color: C.faint }}>
            {Number(wi) < 4 ? "1 pt" : "0.5 pt"}
          </span>
        </div>
      ))}
    </div>
  );
}

function LockWrap({ locked, color, children }) {
  if (!locked) return <>{children}</>;
  return (
    <div>
      <div style={{ position: "relative", background: C.container, borderRadius: 16, overflow: "hidden" }} className="p-4 mx-4 mb-3 flex items-center gap-3">
        <div
          style={{
            position: "absolute", left: 0, top: "22%", bottom: "22%", width: 3, borderRadius: 3,
            background: `linear-gradient(180deg, transparent, ${color}, transparent)`,
            boxShadow: `0 0 8px ${mix(color, 60)}`,
          }}
        />
        <Lock size={18} color={color} />
        <div>
          <div style={{ fontFamily: sans, fontWeight: 500, color: C.onSurface, fontSize: 14 }}>Locked until the quest starts</div>
          <p style={{ color: C.onSurfaceVariant, fontSize: 12 }}>Opens 2 August 2026 — nothing here can be logged yet.</p>
        </div>
      </div>
      <div style={{ pointerEvents: "none", opacity: 0.6 }}>{children}</div>
    </div>
  );
}

function VitalityTab({ s, effective, set, locked }) {
  const eff = effective || s;
  const score = vitalityScore(eff);
  const missedDates = eff.mtMissedDates || [];
  const freeCovered = new Set(missedDates.slice(0, MT_LEAVE_ALLOWANCE));
  const costlyCovered = new Set(missedDates.slice(MT_LEAVE_ALLOWANCE));
  return (
    <div className="pb-4">
      <ScreenHeader title="Vitality" sub="Physical strength, endurance and health." color={C.vitality} score={score} />
      <LockWrap locked={locked} color={C.vitality}>
        <Mission title="Muay Thai" points={65} earned={Object.values(eff.muayThai).filter(Boolean).length} color={C.vitality}>
          <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 10 }}>
            Weekday classes, 3 Aug – 30 Oct.{" "}
            <span style={{ fontFamily: mono, color: C.vitality }}>
              {Object.values(eff.muayThai).filter(Boolean).length} / {MT_TOTAL}
            </span>
            {freeCovered.size > 0 && (
              <span style={{ color: C.faint }}> · {freeCovered.size} covered by leave</span>
            )}
            {costlyCovered.size > 0 && (
              <span style={{ color: C.danger }}> · {costlyCovered.size} leave used (−1 pt each)</span>
            )}
          </p>
          <MuayThaiGrid value={s.muayThai} freeCovered={freeCovered} costlyCovered={costlyCovered} color={C.vitality} onToggle={(ds) => set((d) => { d.vitality.muayThai[ds] = !d.vitality.muayThai[ds]; })} />
        </Mission>
        <Mission
          title="Arm Training"
          points={13}
          earned={Object.entries(s.armWeeks).reduce((sum, [i, week]) => sum + week.filter(Boolean).length * (Number(i) < 4 ? 1 : 0.5), 0)}
          color={C.vitality}
        >
          <WeekSessionGrid weeks={s.armWeeks} color={C.vitality} onToggle={(wi, si) => set((d) => { d.vitality.armWeeks[wi][si] = !d.vitality.armWeeks[wi][si]; })} />
        </Mission>
        <Mission
          title="Ab Training"
          points={13}
          earned={Object.entries(s.abWeeks).reduce((sum, [i, week]) => sum + week.filter(Boolean).length * (Number(i) < 4 ? 1 : 0.5), 0)}
          color={C.vitality}
        >
          <WeekSessionGrid weeks={s.abWeeks} color={C.vitality} onToggle={(wi, si) => set((d) => { d.vitality.abWeeks[wi][si] = !d.vitality.abWeeks[wi][si]; })} />
        </Mission>
        <Mission title="Treks" points={9} earned={s.treks} color={C.vitality}>
          <div className="flex items-center gap-2">
            <Mountain size={16} color={C.vitality} />
            <Counter value={s.treks} max={9} color={C.vitality} onChange={(v) => set((d) => { d.vitality.treks = v; })} />
          </div>
        </Mission>
      </LockWrap>
    </div>
  );
}

/* ---------------------------------------------------------------
   INVEST MONTH CARD — a per-month accordion for the investment
   allocation. Each category row is its own touch target with a
   colored icon badge, a stacked allocation bar in the header shows
   the real portfolio shape at a glance, and a marked category shows
   the date it was checked. */
function InvestMonthCard({ label, monthState, defaultOpen, onToggleCategory }) {
  const [open, setOpen] = useState(defaultOpen);
  const pts = investMonthPoints(monthState);
  const complete = pts >= 20;
  return (
    <div
      style={{
        background: `linear-gradient(160deg, var(--container-high), var(--container))`,
        border: `1px solid ${complete ? mix(C.wealth, 45) : C.outlineVariant}`,
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: complete ? `0 0 16px ${mix(C.wealth, 20)}` : "none",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease",
      }}
    >
      <Touchable onClick={() => setOpen((o) => !o)} style={{ display: "block" }}>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between" style={{ marginBottom: 7 }}>
              <span style={{ fontFamily: sans, fontWeight: 700, color: C.onSurface, fontSize: 14 }}>{label}</span>
              <span style={{ fontFamily: mono, fontSize: 12, color: complete ? C.wealth : C.onSurfaceVariant, fontWeight: 700 }}>
                {pts} <span style={{ color: C.faint, fontWeight: 500 }}>/ 20 pts</span>
              </span>
            </div>
            {/* Stacked allocation bar — segment widths mirror the real
                25/25/15/15/10/10 portfolio split; a segment lights up in
                its category color once that slice is marked. */}
            <div className="flex" style={{ height: 8, borderRadius: 4, overflow: "hidden", background: C.outlineVariant, gap: 1.5 }}>
              {INVEST_CATEGORIES.map((c) => {
                const checked = typeof monthState === "object" && !!monthState?.[c.key];
                return (
                  <div
                    key={c.key}
                    style={{
                      width: `${c.pct}%`,
                      background: checked ? c.color : "transparent",
                      boxShadow: checked ? `0 0 5px ${mix(c.color, 60)}` : "none",
                      transition: "background 0.2s ease",
                    }}
                  />
                );
              })}
            </div>
          </div>
          {open ? <ChevronUp size={16} color={C.onSurfaceVariant} /> : <ChevronDown size={16} color={C.onSurfaceVariant} />}
        </div>
      </Touchable>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-1.5">
          {INVEST_CATEGORIES.map((c) => {
            const checked = typeof monthState === "object" && !!monthState?.[c.key];
            const markedLabel = checked ? investMarkedLabel(monthState[c.key]) : null;
            const Icon = c.icon;
            return (
              <Touchable
                key={c.key}
                writeAction
                onClick={() => onToggleCategory(c.key)}
                rippleColor={mix(c.color, 20)}
                style={{
                  display: "block", borderRadius: 12,
                  background: checked ? mix(c.color, 12) : C.container,
                  border: `1px solid ${checked ? mix(c.color, 35) : C.outlineVariant}`,
                  transition: "background 0.15s ease, border-color 0.15s ease",
                }}
              >
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div
                    style={{
                      width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                      background: checked ? c.color : mix(c.color, 14),
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: checked ? `0 0 8px ${mix(c.color, 50)}` : "none",
                      transition: "background 0.15s ease",
                    }}
                  >
                    <Icon size={16} color={checked ? C.surface : c.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 13, color: C.onSurface }}>{c.label}</span>
                      <span style={{ fontFamily: mono, fontSize: 10.5, color: c.color, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>
                        {c.pct}% · {c.pts}pt
                      </span>
                    </div>
                    <span style={{ fontFamily: mono, fontSize: 10, color: C.faint, display: "block", marginTop: 1 }}>
                      {markedLabel || "Not marked yet"}
                    </span>
                  </div>
                  <div
                    style={{
                      width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                      border: `2px solid ${checked ? c.color : C.faint}`,
                      background: checked ? c.color : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.12s ease",
                    }}
                  >
                    {checked && <Check size={12} color={C.surface} strokeWidth={3} />}
                  </div>
                </div>
              </Touchable>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   WEALTH TAB
--------------------------------------------------------------- */
function WealthTab({ s, set, locked }) {
  const readOnly = useContext(ReadOnlyContext);
  const score = wealthScore(s);
  const months = ["August", "September", "October"];
  // Default-open whichever month is current (Aug/Sep/Oct 2026); falls
  // back to August outside that window.
  const now = new Date();
  const defaultMonthIdx = now.getFullYear() === 2026 && now.getMonth() >= 7 && now.getMonth() <= 9
    ? now.getMonth() - 7
    : 0;
  return (
    <div className="pb-4">
      <ScreenHeader title="Wealth" sub="Financial discipline through investing and saving." color={C.wealth} score={score} />
      <LockWrap locked={locked} color={C.wealth}>
        <Mission title="Invest — Monthly Allocation" points={60} earned={s.invest.reduce((sum, m) => sum + investMonthPoints(m), 0)} color={C.wealth}>
          <div className="flex flex-col gap-3">
            {months.map((m, i) => (
              <InvestMonthCard
                key={m}
                label={m}
                monthState={s.invest[i]}
                defaultOpen={i === defaultMonthIdx}
                onToggleCategory={(key) => set((d) => {
                  const cur = d.wealth.invest[i];
                  const obj = cur && typeof cur === "object" ? { ...cur } : emptyInvestMonth();
                  obj[key] = obj[key] ? null : new Date().toISOString();
                  d.wealth.invest[i] = obj;
                })}
              />
            ))}
          </div>
        </Mission>
        <Mission
          title="Save — ₹15,000 / month"
          points={40}
          earned={s.save.reduce((sum, _a, i) => sum + savePoints(effSave(s, i)), 0) + (s.save.every((_a, i) => effSave(s, i) >= 15000) ? 4 : 0)}
          color={C.wealth}
        >
          <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 10 }}>
            Up to 12 pts/month; −1 per ₹1,000 short. +4 bonus for all three months.
          </p>
          <div className="flex flex-col gap-3">
            {months.map((m, i) => (
              <div key={m} className="flex items-center gap-3">
                <span style={{ color: C.onSurfaceVariant, fontSize: 13, width: 76 }}>{m}</span>
                <input
                  type="number"
                  value={s.save[i]}
                  disabled={readOnly}
                  onChange={(e) => {
                    const v = clamp(Number(e.target.value) || 0, 0, 15000);
                    set((d) => { d.wealth.save[i] = v; });
                  }}
                  style={{
                    background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, color: C.onSurface,
                    fontFamily: mono, fontSize: 13, borderRadius: 10, padding: "8px 10px", width: 96,
                    opacity: readOnly ? 0.7 : 1,
                  }}
                />
                <span style={{ fontFamily: mono, fontSize: 12, color: C.wealth }}>{savePoints(effSave(s, i))} pts</span>
              </div>
            ))}
            <span style={{ fontFamily: mono, fontSize: 11.5, color: s.save.every((_a, i) => effSave(s, i) >= 15000) ? C.wealth : C.faint }}>
              Consistency bonus: {s.save.every((_a, i) => effSave(s, i) >= 15000) ? "+4 earned" : "0 / 4"}
            </span>
          </div>
        </Mission>
      </LockWrap>
    </div>
  );
}

/* ---------------------------------------------------------------
   RESOLVE TAB
--------------------------------------------------------------- */
function ResolveTab({ s, effective, set, locked, wealth }) {
  const eff = effective || s;
  const score = resolveScore(eff);
  const [viewDate, setViewDate] = useState(() => {
    const t = dateOnly(new Date());
    return t >= QUEST_START && t <= QUEST_END ? t : QUEST_START;
  });
  const key = fmtDate(viewDate);
  const log = s.dailyLogs[key] || { wake: false, plan: false, hair: false, teeth: false };
  const wakeMissRank = eff.wakeMissedDates ? eff.wakeMissedDates.indexOf(key) : -1;
  const wakeLeaveCovered = wakeMissRank !== -1;
  const wakeLeaveFree = wakeLeaveCovered && wakeMissRank < WAKE_LEAVE_ALLOWANCE;
  const idx = dayIndex(viewDate);
  const weekNum = clamp(Math.ceil(idx / 7), 1, 13);
  const wlog = s.weeklyLogs[weekNum] || { laundry: false, iron: false };

  const shiftDay = (n) => {
    const nd = new Date(viewDate);
    nd.setDate(nd.getDate() + n);
    if (dateOnly(nd) >= QUEST_START && dateOnly(nd) <= QUEST_END) setViewDate(nd);
  };

  const dailyItems = [
    ["wake", "Wake up by 7:00 AM"],
    ["plan", "Create the day's plan"],
    ["hair", "Hair care routine"],
    ["teeth", "Brush teeth before bed"],
  ];

  const allowanceItems = [
    ["junkFood", "Junk food", 8],
    ["mtLeaves", "Muay Thai leaves", 6],
    ["wakeBreaks", "Wake-up breaks", 20],
  ];
  const autoAllowanceKeys = ["mtLeaves", "wakeBreaks"];
  const totalDeduction = allowanceItems.reduce((sum, [k, , allow]) => sum + Math.max(0, eff[k] - allow), 0);
  const bonusTasks = s.bonusTasks || [];
  const bonusPoints = bonusTasks.filter((t) => t.completed).length;
  const netDeduction = Math.max(0, totalDeduction - bonusPoints);

  const dailyEarned = Object.values(eff.dailyLogs).reduce(
    (sum, l) => sum + (l.wake ? 0.2 : 0) + (l.plan ? 0.2 : 0) + (l.hair ? 0.2 : 0) + (l.teeth ? 0.2 : 0),
    0
  );
  const weeklyEarned = Object.values(s.weeklyLogs).reduce((sum, w) => sum + (w.laundry ? 1 : 0) + (w.iron ? 1 : 0), 0);
  const months = ["August", "September", "October"];

  return (
    <div className="pb-4">
      <ScreenHeader title="Resolve" sub="Consistency, discipline and self-control." color={C.resolve} score={score} />
      <LockWrap locked={locked} color={C.resolve}>
        <Mission title="Daily Missions" points={72.8} earned={dailyEarned} color={C.resolve} defaultOpen>
          <div className="flex items-center justify-between mb-3">
            <Touchable onClick={() => shiftDay(-1)} style={{ color: C.onSurfaceVariant, width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ChevronLeft size={18} />
            </Touchable>
            <div className="text-center">
              <div style={{ fontFamily: sans, fontWeight: 500, color: C.onSurface, fontSize: 14 }}>
                Day {clamp(idx, 1, 91)} · Week {weekNum}
              </div>
              <div style={{ fontFamily: mono, color: C.faint, fontSize: 10.5 }}>{key}</div>
            </div>
            <Touchable onClick={() => shiftDay(1)} style={{ color: C.onSurfaceVariant, width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ChevronRight size={18} />
            </Touchable>
          </div>
          <div className="flex flex-col">
            {dailyItems.map(([k, label]) => (
              <label key={k} className="flex items-center gap-1">
                <Check2
                  checked={!!log[k]}
                  color={C.resolve}
                  onClick={() => set((d) => {
                    if (!d.resolve.dailyLogs[key]) d.resolve.dailyLogs[key] = { wake: false, plan: false, hair: false, teeth: false };
                    d.resolve.dailyLogs[key][k] = !d.resolve.dailyLogs[key][k];
                  })}
                />
                <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>{label} (0.2)</span>
                {k === "wake" && wakeLeaveCovered && (
                  <span style={{
                    fontFamily: mono, fontSize: 9.5, color: wakeLeaveFree ? C.faint : C.danger,
                    background: C.containerHigh, borderRadius: 6, padding: "1px 6px", marginLeft: 2,
                  }}>
                    {wakeLeaveFree ? "covered by leave" : "leave used (−1 pt)"}
                  </span>
                )}
              </label>
            ))}
          </div>
        </Mission>

        <Mission title="Weekly Missions" points={26} earned={weeklyEarned} color={C.resolve}>
          <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 6 }}>
            Week {weekNum} <span style={{ color: C.faint }}>({weekRange(weekNum)})</span>
          </p>
          <label className="flex items-center gap-1">
            <Check2
              checked={!!wlog.laundry}
              color={C.resolve}
              onClick={() => set((d) => {
                if (!d.resolve.weeklyLogs[weekNum]) d.resolve.weeklyLogs[weekNum] = { laundry: false, iron: false };
                d.resolve.weeklyLogs[weekNum].laundry = !d.resolve.weeklyLogs[weekNum].laundry;
              })}
            />
            <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Laundry (1 pt)</span>
          </label>
          <label className="flex items-center gap-1">
            <Check2
              checked={!!wlog.iron}
              color={C.resolve}
              onClick={() => set((d) => {
                if (!d.resolve.weeklyLogs[weekNum]) d.resolve.weeklyLogs[weekNum] = { laundry: false, iron: false };
                d.resolve.weeklyLogs[weekNum].iron = !d.resolve.weeklyLogs[weekNum].iron;
              })}
            />
            <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Iron clothes (1 pt)</span>
          </label>
        </Mission>

        <Mission title="Bedsheets" points={1.2} earned={s.bedsheets * 0.4} color={C.resolve}>
          <Counter value={s.bedsheets} max={3} color={C.resolve} onChange={(v) => set((d) => { d.resolve.bedsheets = v; })} />
        </Mission>

        <Mission title="Discipline Allowance" points="—" color={C.resolve}>
          <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 10 }}>
            Each occurrence past the allowance costs 1 point. Muay Thai leaves and wake-up breaks are tracked automatically.
          </p>
          <div className="flex flex-col gap-3">
            {allowanceItems.map(([k, label, allow]) => {
              const auto = autoAllowanceKeys.includes(k);
              const deduction = Math.max(0, eff[k] - allow);
              return (
                <div key={k} className="flex items-center justify-between">
                  <span style={{ color: C.onSurfaceVariant, fontSize: 12.5 }}>
                    {label} <span style={{ color: C.faint, fontFamily: mono, fontSize: 10.5 }}>(allowed {allow})</span>
                  </span>
                  <div className="flex items-center gap-2">
                    {deduction > 0 && (
                      <span style={{ fontFamily: mono, fontSize: 11, color: C.danger, fontWeight: 600 }}>
                        −{deduction} pt{deduction === 1 ? "" : "s"}
                      </span>
                    )}
                    {auto ? (
                      <span
                        style={{
                          fontFamily: mono, fontSize: 13, fontWeight: 700, minWidth: 28, textAlign: "center",
                          color: deduction > 0 ? C.danger : C.resolve,
                        }}
                      >
                        {eff[k]}
                      </span>
                    ) : (
                      <Counter value={s[k]} max={allow + 20} color={deduction > 0 ? C.danger : C.resolve} onChange={(v) => set((d) => { d.resolve[k] = v; })} />
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${C.outlineVariant}` }}>
              <span style={{ fontFamily: sans, fontWeight: 500, color: C.onSurfaceVariant, fontSize: 12.5 }}>Negative points</span>
              <span style={{ fontFamily: mono, fontSize: 13.5, color: totalDeduction > 0 ? C.danger : C.faint, fontWeight: 700 }}>
                −{totalDeduction} pt{totalDeduction === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: C.onSurfaceVariant, fontSize: 12.5 }}>Bonus points available</span>
              <span style={{ fontFamily: mono, fontSize: 13.5, color: bonusPoints > 0 ? C.resolve : C.faint, fontWeight: 700 }}>
                +{bonusPoints} pt{bonusPoints === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${C.outlineVariant}` }}>
              <span style={{ fontFamily: sans, fontWeight: 500, color: C.onSurfaceVariant, fontSize: 12.5 }}>Net after bonus</span>
              <span style={{ fontFamily: mono, fontSize: 13.5, color: netDeduction > 0 ? C.danger : C.faint, fontWeight: 700 }}>
                {netDeduction > 0 ? `−${netDeduction} pt${netDeduction === 1 ? "" : "s"}` : "0 pts"}
              </span>
            </div>

            <div className="pt-3" style={{ borderTop: `1px solid ${C.outlineVariant}` }}>
              <p style={{ fontFamily: sans, fontWeight: 600, color: C.onSurfaceVariant, fontSize: 12, marginBottom: 2 }}>
                Savings top-up
              </p>
              <p style={{ color: C.faint, fontSize: 11, marginBottom: 10, lineHeight: 1.4 }}>
                A shared ₹5,000 pool, in ₹1,000 steps, to cover a short month's savings toward the ₹15,000 target.
              </p>
              {months.map((m, i) => {
                const shortfall = Math.max(0, 15000 - wealth.save[i]);
                const used = wealth.saveAllowance.reduce((sum, u) => sum + u, 0);
                const remaining = SAVE_ALLOWANCE_POOL - used;
                const maxForMonth = wealth.saveAllowance[i] + Math.max(0, remaining);
                return (
                  <div key={m} className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                    <div>
                      <span style={{ color: C.onSurfaceVariant, fontSize: 12.5 }}>{m}</span>
                      <div style={{ fontFamily: mono, fontSize: 10.5, color: C.faint }}>
                        {shortfall > 0 ? `short ₹${shortfall.toLocaleString("en-IN")}` : "target met"}
                        {wealth.saveAllowance[i] > 0 && ` · using ₹${(wealth.saveAllowance[i] * 1000).toLocaleString("en-IN")}`}
                      </div>
                    </div>
                    <Counter
                      value={wealth.saveAllowance[i]}
                      max={maxForMonth}
                      color={C.resolve}
                      onChange={(v) => set((d) => { d.wealth.saveAllowance[i] = v; })}
                    />
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${C.outlineVariant}` }}>
                <span style={{ fontFamily: sans, fontWeight: 500, color: C.onSurfaceVariant, fontSize: 12.5 }}>Allowance remaining</span>
                <span style={{ fontFamily: mono, fontSize: 13.5, color: (SAVE_ALLOWANCE_POOL - wealth.saveAllowance.reduce((sum, u) => sum + u, 0)) > 0 ? C.resolve : C.faint, fontWeight: 700 }}>
                  ₹{((SAVE_ALLOWANCE_POOL - wealth.saveAllowance.reduce((sum, u) => sum + u, 0)) * 1000).toLocaleString("en-IN")} / ₹{(SAVE_ALLOWANCE_POOL * 1000).toLocaleString("en-IN")}
                </span>
              </div>
            </div>
          </div>
        </Mission>

        <BonusTasksMission s={s} set={set} />
      </LockWrap>
    </div>
  );
}

/* ---------------------------------------------------------------
   BONUS TASKS — freeform tasks worth +1 point each; completed ones
   offset the Discipline Allowance's negative points in Resolve.
--------------------------------------------------------------- */
function BonusTasksMission({ s, set }) {
  const readOnly = useContext(ReadOnlyContext);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const tasks = s.bonusTasks || [];
  const bonusPoints = tasks.filter((t) => t.completed).length;

  const addTask = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    set((d) => {
      if (!d.resolve.bonusTasks) d.resolve.bonusTasks = [];
      d.resolve.bonusTasks.push({
        id: `bt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: trimmed,
        description: desc.trim(),
        completed: false,
      });
    });
    setTitle("");
    setDesc("");
    setAdding(false);
  };

  const cancelAdd = () => {
    setTitle("");
    setDesc("");
    setAdding(false);
  };

  return (
    <Mission title="Bonus Tasks" points={bonusPoints} color={C.resolve}>
      <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 12 }}>
        Each completed task is worth +1 point, and can offset negative points above.
      </p>

      <div style={{ marginBottom: 14 }}>
        {readOnly ? null : !adding ? (
          <Touchable
            writeAction
            onClick={() => setAdding(true)}
            style={{
              background: C.resolve, borderRadius: 10, padding: "9px 0",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            <Plus size={14} color="#fff" />
            <span style={{ color: "#fff", fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Add Task</span>
          </Touchable>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              style={{
                background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, color: C.onSurface,
                fontFamily: sans, fontSize: 13, borderRadius: 10, padding: "9px 12px", outline: "none",
              }}
            />
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              style={{
                background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, color: C.onSurface,
                fontFamily: sans, fontSize: 12.5, borderRadius: 10, padding: "9px 12px", outline: "none", resize: "none",
              }}
            />
            <div className="flex items-center gap-2">
              <Touchable
                onClick={cancelAdd}
                style={{
                  flex: 1, borderRadius: 10, padding: "9px 0", border: `1px solid ${C.outlineVariant}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <span style={{ color: C.onSurfaceVariant, fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Cancel</span>
              </Touchable>
              <Touchable
                writeAction
                onClick={addTask}
                style={{
                  flex: 1, background: C.resolve, borderRadius: 10, padding: "9px 0",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                <Plus size={14} color="#fff" />
                <span style={{ color: "#fff", fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Add Task</span>
              </Touchable>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {tasks.length === 0 ? (
          <p style={{ color: C.faint, fontSize: 12.5 }}>No bonus tasks yet.</p>
        ) : (
          tasks.map((t) => (
            <div
              key={t.id}
              style={{ background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, borderRadius: 12, padding: "10px 12px" }}
            >
              <div className="flex items-start gap-2">
                <Check2
                  checked={!!t.completed}
                  color={C.resolve}
                  onClick={() => set((d) => {
                    const task = d.resolve.bonusTasks.find((x) => x.id === t.id);
                    if (task) task.completed = !task.completed;
                  })}
                />
                <div className="flex-1 min-w-0">
                  <span style={{
                    color: t.completed ? C.faint : C.onSurface, fontSize: 13.5, fontWeight: 600,
                    textDecoration: t.completed ? "line-through" : "none",
                  }}>
                    {t.title}
                  </span>
                  {t.description && (
                    <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginTop: 2 }}>{t.description}</p>
                  )}
                </div>
                <Touchable
                  writeAction
                  onClick={() => set((d) => { d.resolve.bonusTasks = d.resolve.bonusTasks.filter((x) => x.id !== t.id); })}
                  style={{ padding: 4, flexShrink: 0, opacity: readOnly ? 0.5 : 1 }}
                >
                  <Trash2 size={15} color={C.faint} />
                </Touchable>
              </div>
            </div>
          ))
        )}
      </div>
    </Mission>
  );
}

/* ---------------------------------------------------------------
   ACHIEVEMENTS TAB
--------------------------------------------------------------- */
function AchievementsTab({ state, overall }) {
  // `state` here is already the leave-adjusted achievement state (see
  // achievementState() / the caller in App), so checks like "Iron Will"
  // or "Disciplined" correctly count leave-covered days.
  const unlockedIds = new Set(ACHIEVEMENTS.filter((a) => a.check(state, overall)).map((a) => a.id));
  const groups = [
    { key: "wisdom", label: "Wisdom", color: C.wisdom },
    { key: "vitality", label: "Vitality", color: C.vitality },
    { key: "wealth", label: "Wealth", color: C.wealth },
    { key: "resolve", label: "Resolve", color: C.resolve },
    { key: "overall", label: "Overall", color: C.accent },
  ];
  return (
    <div className="pb-4">
      <ScreenHeader
        title="Achievements"
        sub={`${unlockedIds.size} of ${ACHIEVEMENTS.length} unlocked`}
        color={C.accent}
        score={(unlockedIds.size / ACHIEVEMENTS.length) * 100}
      />
      {groups.map((g) => {
        const items = ACHIEVEMENTS.filter((a) => a.attr === g.key);
        return (
          <div key={g.key} className="mb-2">
            <h3 style={{ fontFamily: sans, fontWeight: 700, color: g.color, fontSize: 12.5, margin: "4px 20px 8px", letterSpacing: 0.6 }}>{g.label.toUpperCase()}</h3>
            <div className="px-4 flex flex-col gap-2 mb-3">
              {items.map((a) => {
                const unlocked = unlockedIds.has(a.id);
                const Icon = unlocked ? (a.id.startsWith("o") ? Crown : Trophy) : Lock;
                return (
                  <div
                    key={a.id}
                    style={{
                      background: unlocked ? `linear-gradient(120deg, var(--container-high), var(--container))` : C.surfaceLow,
                      opacity: unlocked ? 1 : 0.55, borderRadius: 14,
                      border: unlocked ? `1px solid ${mix(g.color, 27)}` : `1px solid ${C.outlineVariant}`,
                      boxShadow: unlocked ? `0 0 12px ${mix(g.color, 13)}` : "none",
                    }}
                    className="p-3.5 flex items-center gap-3"
                  >
                    <Hex size={36} color={g.color} glow={unlocked}>
                      <Icon size={18} color={unlocked ? g.color : C.faint} />
                    </Hex>
                    <div>
                      <div style={{ fontFamily: sans, fontWeight: 500, color: unlocked ? C.onSurface : C.onSurfaceVariant, fontSize: 13.5 }}>{a.label}</div>
                      <p style={{ color: C.faint, fontSize: 11.5 }}>{a.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------
   DIET TAB — standalone protein tracker. This is deliberately NOT
   part of the Level 1 quest: nothing here is read by wisdomScore /
   vitalityScore / wealthScore / resolveScore, so nothing you do in
   this tab ever earns points or XP. It's just a food log.
--------------------------------------------------------------- */
function DietTab({ s, set }) {
  const plans = s.plans || [];
  const today = fmtDate(new Date());
  const log = s.logs?.[today] || { planId: null, completed: {} };
  const activePlan = plans.find((p) => p.id === log.planId) || null;
  const [dietsOpen, setDietsOpen] = useState(false);

  const totalProtein = activePlan
    ? activePlan.items.reduce((sum, i) => sum + (Number(i.protein) || 0), 0)
    : 0;
  const consumedProtein = activePlan
    ? activePlan.items.filter((i) => log.completed?.[i.id]).reduce((sum, i) => sum + (Number(i.protein) || 0), 0)
    : 0;

  return (
    <div className="pb-4">
      <div className="px-4 pt-5 pb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Diamond size={7} color={C.accent} glow />
            <div style={{ fontFamily: sans, fontWeight: 900, color: C.onSurface, fontSize: 22, letterSpacing: 0.3 }}>DIET</div>
          </div>
          <p style={{ color: C.onSurfaceVariant, fontSize: 12.5, marginTop: 2, marginLeft: 15 }}>
            Protein tracker — doesn't affect your quest score.
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <div style={{ fontFamily: mono, color: C.accent, fontSize: 20, fontWeight: 700, textShadow: `0 0 10px ${mix(C.accent, 40)}` }}>
            {Math.round(consumedProtein)}g
          </div>
          <div style={{ fontFamily: mono, color: C.faint, fontSize: 10.5 }}>today</div>
        </div>
      </div>

      <DietTodayCard s={s} set={set} today={today} log={log} plans={plans} activePlan={activePlan} totalProtein={totalProtein} consumedProtein={consumedProtein} />

      <Touchable
        onClick={() => setDietsOpen((o) => !o)}
        style={{
          background: C.container, border: `1px solid ${C.outlineVariant}`, borderRadius: 10,
          display: "block",
        }}
        className="mx-4 mb-3"
      >
        <div className="flex items-center justify-between px-4 py-3">
          <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: C.faint, letterSpacing: 0.4 }}>
            YOUR DIETS{" "}
            <span style={{ fontFamily: mono, color: C.onSurfaceVariant, fontWeight: 500 }}>
              ({plans.length})
            </span>
          </span>
          {dietsOpen ? <ChevronUp size={16} color={C.onSurfaceVariant} /> : <ChevronDown size={16} color={C.onSurfaceVariant} />}
        </div>
      </Touchable>

      {dietsOpen && (
        <>
          {plans.length === 0 && (
            <p style={{ color: C.faint, fontSize: 12.5, margin: "0 16px 12px" }}>No diets created yet — add one below.</p>
          )}
          {plans.map((plan) => (
            <DietPlanCard key={plan.id} plan={plan} set={set} />
          ))}
        </>
      )}

      <CreateDietCard set={set} onCreate={() => setDietsOpen(true)} />
    </div>
  );
}

function DietTodayCard({ s, set, today, log, plans, activePlan, totalProtein, consumedProtein }) {
  const readOnly = useContext(ReadOnlyContext);
  const [picking, setPicking] = useState(false);

  const chooseDiet = (planId) => {
    set((d) => {
      if (!d.diet.logs[today]) d.diet.logs[today] = { planId: null, completed: {} };
      d.diet.logs[today].planId = planId;
      d.diet.logs[today].completed = {};
    });
    setPicking(false);
  };

  return (
    <Mission
      title="Today"
      points={activePlan ? Math.round(totalProtein) : 0}
      earned={activePlan ? consumedProtein : undefined}
      color={C.accent}
      defaultOpen
    >
      {plans.length === 0 ? (
        <p style={{ color: C.faint, fontSize: 12.5 }}>Create a diet below, then pick it here each day.</p>
      ) : !activePlan || picking ? (
        <div className="flex flex-col gap-2">
          <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 2 }}>Which diet are you following today?</p>
          {plans.map((p) => (
            <Touchable
              key={p.id}
              writeAction
              onClick={() => chooseDiet(p.id)}
              style={{
                background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, borderRadius: 10,
                padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
              }}
            >
              <span style={{ color: C.onSurface, fontFamily: sans, fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
              <span style={{ color: C.faint, fontFamily: mono, fontSize: 11.5 }}>{p.items.length} items</span>
            </Touchable>
          ))}
          {activePlan && (
            <Touchable onClick={() => setPicking(false)} style={{ alignSelf: "flex-end", padding: "4px 2px" }}>
              <span style={{ color: C.onSurfaceVariant, fontFamily: sans, fontSize: 12 }}>Cancel</span>
            </Touchable>
          )}
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
            <span style={{ color: C.onSurface, fontFamily: sans, fontSize: 13.5, fontWeight: 700 }}>{activePlan.name}</span>
            {!readOnly && (
              <Touchable onClick={() => setPicking(true)}>
                <span style={{ color: C.accent, fontFamily: sans, fontSize: 12, fontWeight: 600 }}>Change</span>
              </Touchable>
            )}
          </div>
          {activePlan.items.length === 0 ? (
            <p style={{ color: C.faint, fontSize: 12.5 }}>This diet has no items yet — add some below.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {activePlan.items.map((item) => {
                const checked = !!log.completed?.[item.id];
                return (
                  <div
                    key={item.id}
                    style={{ background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, borderRadius: 12, padding: "8px 12px" }}
                    className="flex items-center gap-2"
                  >
                    <Check2
                      checked={checked}
                      color={C.accent}
                      onClick={() => set((d) => {
                        if (!d.diet.logs[today]) d.diet.logs[today] = { planId: activePlan.id, completed: {} };
                        d.diet.logs[today].completed[item.id] = !d.diet.logs[today].completed[item.id];
                      })}
                    />
                    <span
                      style={{
                        flex: 1, color: checked ? C.faint : C.onSurface, fontFamily: sans, fontSize: 13.5,
                        textDecoration: checked ? "line-through" : "none",
                      }}
                    >
                      {item.name}
                    </span>
                    <span style={{ color: C.faint, fontFamily: mono, fontSize: 11.5 }}>{item.protein}g</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Mission>
  );
}

function DietPlanCard({ plan, set }) {
  const readOnly = useContext(ReadOnlyContext);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [protein, setProtein] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editProtein, setEditProtein] = useState("");
  const [editingPlanName, setEditingPlanName] = useState(false);
  const [planNameDraft, setPlanNameDraft] = useState(plan.name);

  const totalProtein = plan.items.reduce((sum, i) => sum + (Number(i.protein) || 0), 0);

  const startEditPlanName = () => {
    setPlanNameDraft(plan.name);
    setEditingPlanName(true);
  };

  const cancelEditPlanName = () => {
    setEditingPlanName(false);
    setPlanNameDraft(plan.name);
  };

  const saveEditPlanName = () => {
    const trimmed = planNameDraft.trim();
    if (!trimmed) { cancelEditPlanName(); return; }
    set((d) => {
      const dp = d.diet.plans.find((x) => x.id === plan.id);
      if (dp) dp.name = trimmed;
    });
    setEditingPlanName(false);
  };

  const addItem = () => {
    const trimmed = name.trim();
    const p = Number(protein);
    if (!trimmed || !Number.isFinite(p) || p < 0) return;
    set((d) => {
      const dp = d.diet.plans.find((x) => x.id === plan.id);
      if (dp) dp.items.push({ id: uid(), name: trimmed, protein: p });
    });
    setName("");
    setProtein("");
    setAdding(false);
  };

  const removeItem = (itemId) => {
    set((d) => {
      const dp = d.diet.plans.find((x) => x.id === plan.id);
      if (dp) dp.items = dp.items.filter((i) => i.id !== itemId);
    });
  };

  const startEdit = (item) => {
    setAdding(false);
    setEditingId(item.id);
    setEditName(item.name);
    setEditProtein(String(item.protein));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditProtein("");
  };

  const saveEdit = () => {
    const trimmed = editName.trim();
    const p = Number(editProtein);
    if (!trimmed || !Number.isFinite(p) || p < 0) return;
    set((d) => {
      const dp = d.diet.plans.find((x) => x.id === plan.id);
      const it = dp?.items.find((i) => i.id === editingId);
      if (it) { it.name = trimmed; it.protein = p; }
    });
    cancelEdit();
  };

  const deletePlan = () => {
    set((d) => {
      d.diet.plans = d.diet.plans.filter((p) => p.id !== plan.id);
      Object.values(d.diet.logs).forEach((l) => {
        if (l.planId === plan.id) { l.planId = null; l.completed = {}; }
      });
    });
  };

  const planNameTitle = editingPlanName ? (
    <div
      className="flex items-center gap-1.5"
      style={{ minWidth: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="text"
        autoFocus
        value={planNameDraft}
        onChange={(e) => setPlanNameDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") saveEditPlanName();
          if (e.key === "Escape") cancelEditPlanName();
        }}
        style={{
          background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, color: C.onSurface,
          fontFamily: sans, fontWeight: 500, fontSize: 13.5, borderRadius: 8, padding: "5px 8px",
          outline: "none", width: "100%", minWidth: 0,
        }}
      />
      <Touchable onClick={(e) => { e.stopPropagation(); saveEditPlanName(); }} style={{ padding: 4, flexShrink: 0 }}>
        <Check size={15} color={C.accent} />
      </Touchable>
      <Touchable onClick={(e) => { e.stopPropagation(); cancelEditPlanName(); }} style={{ padding: 4, flexShrink: 0 }}>
        <span style={{ color: C.faint, fontSize: 15, fontFamily: sans, lineHeight: 1 }}>×</span>
      </Touchable>
    </div>
  ) : (
    <div className="flex items-center gap-1.5" style={{ minWidth: 0 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{plan.name}</span>
      {!readOnly && (
        <Touchable
          writeAction
          onClick={(e) => { e.stopPropagation(); startEditPlanName(); }}
          style={{ padding: 3, flexShrink: 0 }}
        >
          <Pencil size={12} color={C.faint} />
        </Touchable>
      )}
    </div>
  );

  return (
    <Mission title={planNameTitle} points={Math.round(totalProtein)} color={C.accent}>
      <div className="flex flex-col gap-2" style={{ marginBottom: 10 }}>
        {plan.items.length === 0 ? (
          <p style={{ color: C.faint, fontSize: 12.5 }}>No items yet.</p>
        ) : (
          plan.items.map((item) =>
            editingId === item.id ? (
              <div
                key={item.id}
                style={{ background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, borderRadius: 10, padding: 10 }}
                className="flex flex-col gap-2"
              >
                <input
                  type="text"
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Item name"
                  style={{
                    background: C.container, border: `1px solid ${C.outlineVariant}`, color: C.onSurface,
                    fontFamily: sans, fontSize: 13, borderRadius: 10, padding: "9px 12px", outline: "none",
                  }}
                />
                <input
                  type="number"
                  value={editProtein}
                  onChange={(e) => setEditProtein(e.target.value)}
                  placeholder="Protein (g)"
                  style={{
                    background: C.container, border: `1px solid ${C.outlineVariant}`, color: C.onSurface,
                    fontFamily: mono, fontSize: 13, borderRadius: 10, padding: "9px 12px", outline: "none",
                  }}
                />
                <div className="flex items-center gap-2">
                  <Touchable
                    onClick={cancelEdit}
                    style={{ flex: 1, borderRadius: 10, padding: "9px 0", border: `1px solid ${C.outlineVariant}`, display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <span style={{ color: C.onSurfaceVariant, fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Cancel</span>
                  </Touchable>
                  <Touchable
                    writeAction
                    onClick={saveEdit}
                    style={{ flex: 1, background: C.accent, borderRadius: 10, padding: "9px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    <Save size={14} color="#fff" />
                    <span style={{ color: "#fff", fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Save</span>
                  </Touchable>
                </div>
              </div>
            ) : (
              <div
                key={item.id}
                style={{ background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, borderRadius: 10, padding: "8px 12px" }}
                className="flex items-center gap-2"
              >
                <span style={{ flex: 1, color: C.onSurface, fontFamily: sans, fontSize: 13 }}>{item.name}</span>
                <span style={{ color: C.faint, fontFamily: mono, fontSize: 11.5 }}>{item.protein}g</span>
                {!readOnly && (
                  <>
                    <Touchable writeAction onClick={() => startEdit(item)} style={{ padding: 4 }}>
                      <Pencil size={14} color={C.faint} />
                    </Touchable>
                    <Touchable writeAction onClick={() => removeItem(item.id)} style={{ padding: 4 }}>
                      <Trash2 size={14} color={C.faint} />
                    </Touchable>
                  </>
                )}
              </div>
            )
          )
        )}
      </div>

      {!readOnly && (
        !adding ? (
          <div className="flex items-center gap-2">
            <Touchable
              writeAction
              onClick={() => setAdding(true)}
              style={{ flex: 1, background: C.accent, borderRadius: 10, padding: "9px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <Plus size={14} color="#fff" />
              <span style={{ color: "#fff", fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Add Item</span>
            </Touchable>
            <Touchable
              writeAction
              onClick={deletePlan}
              rippleColor={mix(C.danger, 20)}
              style={{ padding: "9px 12px", borderRadius: 10, border: `1px solid ${mix(C.danger, 30)}`, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <Trash2 size={14} color={C.danger} />
            </Touchable>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Item name (e.g. Paneer 100g)"
              style={{
                background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, color: C.onSurface,
                fontFamily: sans, fontSize: 13, borderRadius: 10, padding: "9px 12px", outline: "none",
              }}
            />
            <input
              type="number"
              value={protein}
              onChange={(e) => setProtein(e.target.value)}
              placeholder="Protein (g)"
              style={{
                background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, color: C.onSurface,
                fontFamily: mono, fontSize: 13, borderRadius: 10, padding: "9px 12px", outline: "none",
              }}
            />
            <div className="flex items-center gap-2">
              <Touchable
                onClick={() => { setAdding(false); setName(""); setProtein(""); }}
                style={{ flex: 1, borderRadius: 10, padding: "9px 0", border: `1px solid ${C.outlineVariant}`, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <span style={{ color: C.onSurfaceVariant, fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Cancel</span>
              </Touchable>
              <Touchable
                writeAction
                onClick={addItem}
                style={{ flex: 1, background: C.accent, borderRadius: 10, padding: "9px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Plus size={14} color="#fff" />
                <span style={{ color: "#fff", fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Add</span>
              </Touchable>
            </div>
          </div>
        )
      )}
    </Mission>
  );
}

function CreateDietCard({ set, onCreate }) {
  const readOnly = useContext(ReadOnlyContext);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  if (readOnly) return null;

  const createPlan = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((d) => {
      d.diet.plans.push({ id: uid(), name: trimmed, items: [] });
    });
    onCreate?.();
    setName("");
    setAdding(false);
  };

  return (
    <div className="mx-4 mb-3">
      {!adding ? (
        <Touchable
          writeAction
          onClick={() => setAdding(true)}
          style={{
            background: C.container, border: `1px dashed ${C.outline}`, borderRadius: 10, padding: "12px 0",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <Plus size={15} color={C.accent} />
          <span style={{ color: C.accent, fontFamily: sans, fontWeight: 700, fontSize: 13 }}>Create Diet</span>
        </Touchable>
      ) : (
        <div style={{ background: C.container, borderRadius: 10, padding: 14 }} className="flex flex-col gap-2">
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createPlan(); }}
            placeholder="Diet name (e.g. High Protein Day)"
            style={{
              background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, color: C.onSurface,
              fontFamily: sans, fontSize: 13, borderRadius: 10, padding: "9px 12px", outline: "none",
            }}
          />
          <div className="flex items-center gap-2">
            <Touchable
              onClick={() => { setAdding(false); setName(""); }}
              style={{ flex: 1, borderRadius: 10, padding: "9px 0", border: `1px solid ${C.outlineVariant}`, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <span style={{ color: C.onSurfaceVariant, fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Cancel</span>
            </Touchable>
            <Touchable
              writeAction
              onClick={createPlan}
              style={{ flex: 1, background: C.accent, borderRadius: 10, padding: "9px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <Plus size={14} color="#fff" />
              <span style={{ color: "#fff", fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Create</span>
            </Touchable>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   PLANNER TAB — a per-day task list, plus a global "unlisted"
   backlog of tasks not yet assigned to any day. Entirely separate
   from the Level 1 quest / scoring, same as Diet.
--------------------------------------------------------------- */
/* ---------------------------------------------------------------
   PLANNER DATE PICKER — tapping the date opens a themed month-grid
   dropdown so you can jump to any date directly, instead of only
   stepping one day at a time via the arrows. Days with tasks get a
   small dot so you can spot them at a glance; a "Jump to Today"
   shortcut sits at the bottom for snapping back after jumping far. */
function PlannerDatePicker({ selected, onSelect, hasTasks }) {
  const [open, setOpen] = useState(false);
  const selDate = new Date(selected + "T00:00:00");
  const [viewYear, setViewYear] = useState(selDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(selDate.getMonth());
  const wrapRef = useRef(null);
  const isToday = selected === fmtDate(new Date());

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const openPicker = () => {
    setViewYear(selDate.getFullYear());
    setViewMonth(selDate.getMonth());
    setOpen((o) => !o);
  };

  const shiftMonth = (delta) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  };

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(viewYear, viewMonth, day));
  const monthLabel = firstOfMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const todayStr = fmtDate(new Date());

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <Touchable
        onClick={openPicker}
        style={{
          borderRadius: 12, padding: "4px 12px",
          display: "flex", flexDirection: "column", alignItems: "center",
          background: open ? mix(C.accent, 12) : "transparent",
        }}
      >
        <div className="flex items-center gap-1.5">
          <Calendar size={12} color={C.accent} />
          <span style={{ fontFamily: sans, fontWeight: 700, color: C.onSurface, fontSize: 15 }}>
            {selDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          </span>
          {open ? <ChevronUp size={13} color={C.onSurfaceVariant} /> : <ChevronDown size={13} color={C.onSurfaceVariant} />}
        </div>
        {isToday && (
          <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: C.accent, letterSpacing: 0.5 }}>TODAY</span>
        )}
      </Touchable>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
            zIndex: 40, width: 280,
            background: C.containerHighest, border: `1px solid ${C.outlineVariant}`,
            borderRadius: 16, padding: 14, boxShadow: "0 12px 28px rgba(0,0,0,0.4)",
          }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
            <Touchable onClick={() => shiftMonth(-1)} style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ChevronLeft size={16} color={C.onSurfaceVariant} />
            </Touchable>
            <span style={{ fontFamily: sans, fontWeight: 700, color: C.onSurface, fontSize: 13.5 }}>{monthLabel}</span>
            <Touchable onClick={() => shiftMonth(1)} style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ChevronRight size={16} color={C.onSurfaceVariant} />
            </Touchable>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAY_LETTERS.map((w, i) => (
              <div key={i} style={{ textAlign: "center", fontFamily: mono, fontSize: 9.5, color: C.faint }}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const ds = fmtDate(d);
              const isSel = ds === selected;
              const isTodayCell = ds === todayStr;
              const dotted = !!hasTasks?.(ds);
              return (
                <Touchable
                  key={i}
                  onClick={() => { onSelect(ds); setOpen(false); }}
                  style={{
                    aspectRatio: "1", borderRadius: 10,
                    background: isSel ? C.accent : "transparent",
                    border: isTodayCell && !isSel ? `1px solid ${C.accent}` : "1px solid transparent",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                  }}
                >
                  <span style={{ fontFamily: mono, fontSize: 11, color: isSel ? C.surface : C.onSurface, fontWeight: isTodayCell ? 800 : 500 }}>
                    {d.getDate()}
                  </span>
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: dotted ? (isSel ? C.surface : C.accent) : "transparent" }} />
                </Touchable>
              );
            })}
          </div>
          <Touchable
            onClick={() => { onSelect(todayStr); setOpen(false); }}
            style={{
              marginTop: 10, width: "100%", padding: "8px 0", borderRadius: 10,
              border: `1px solid ${C.outlineVariant}`,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            <Calendar size={13} color={C.accent} />
            <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 12.5, color: C.accent }}>Jump to Today</span>
          </Touchable>
        </div>
      )}
    </div>
  );
}

function PlannerTab({ s, set }) {
  const [selected, setSelected] = useState(() => fmtDate(new Date()));

  const selDate = new Date(selected + "T00:00:00");
  const dayTasks = s.days?.[selected] || [];
  const unlisted = s.unlisted || [];

  const shiftDay = (delta) => {
    const d = new Date(selDate);
    d.setDate(d.getDate() + delta);
    setSelected(fmtDate(d));
  };

  return (
    <div className="pb-4">
      <div className="px-4 pt-5 pb-4 flex items-center gap-2">
        <Diamond size={7} color={C.accent} glow />
        <div style={{ fontFamily: sans, fontWeight: 900, color: C.onSurface, fontSize: 22, letterSpacing: 0.3 }}>PLANNER</div>
      </div>

      <div className="mx-4 mb-3 flex items-center justify-between">
        <Touchable
          onClick={() => shiftDay(-1)}
          style={{ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <ChevronLeft size={18} color={C.onSurfaceVariant} />
        </Touchable>
        <PlannerDatePicker
          selected={selected}
          onSelect={setSelected}
          hasTasks={(ds) => (s.days?.[ds] || []).length > 0}
        />
        <Touchable
          onClick={() => shiftDay(1)}
          style={{ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <ChevronRight size={18} color={C.onSurfaceVariant} />
        </Touchable>
      </div>

      <DayPlanCard
        set={set}
        selected={selected}
        dayTasks={dayTasks}
      />

      <div className="px-4 pt-3 pb-1">
        <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: C.faint, letterSpacing: 0.4 }}>UNLISTED TASKS</span>
      </div>

      <UnlistedTasksCard set={set} selected={selected} unlisted={unlisted} />
    </div>
  );
}

function DayPlanCard({ set, selected, dayTasks }) {
  const readOnly = useContext(ReadOnlyContext);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const addTask = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    set((d) => {
      if (!d.planner.days[selected]) d.planner.days[selected] = [];
      d.planner.days[selected].push({ id: uid(), title: trimmed, completed: false });
    });
    setTitle("");
    setAdding(false);
  };

  const toggleTask = (taskId) => {
    set((d) => {
      const task = d.planner.days[selected]?.find((t) => t.id === taskId);
      if (task) task.completed = !task.completed;
    });
  };

  const deleteTask = (taskId) => {
    set((d) => {
      if (d.planner.days[selected]) {
        d.planner.days[selected] = d.planner.days[selected].filter((t) => t.id !== taskId);
      }
    });
  };

  const doneCount = dayTasks.filter((t) => t.completed).length;

  return (
    <Mission title="Day Plan" points={dayTasks.length} earned={doneCount} color={C.accent} defaultOpen>
      <div className="flex flex-col gap-2" style={{ marginBottom: 10 }}>
        {dayTasks.length === 0 ? (
          <p style={{ color: C.faint, fontSize: 12.5 }}>No tasks for this day yet — add one below.</p>
        ) : (
          dayTasks.map((task) => (
            <div
              key={task.id}
              style={{ background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, borderRadius: 12, padding: "8px 10px" }}
              className="flex items-center gap-2"
            >
              <Check2 checked={task.completed} color={C.accent} onClick={() => toggleTask(task.id)} />
              <span
                style={{
                  flex: 1, color: task.completed ? C.faint : C.onSurface, fontFamily: sans, fontSize: 13.5,
                  textDecoration: task.completed ? "line-through" : "none",
                }}
              >
                {task.title}
              </span>
              {!readOnly && (
                <Touchable writeAction onClick={() => deleteTask(task.id)} style={{ padding: 4 }}>
                  <Trash2 size={14} color={C.faint} />
                </Touchable>
              )}
            </div>
          ))
        )}
      </div>

      {!readOnly && (
        !adding ? (
          <Touchable
            writeAction
            onClick={() => setAdding(true)}
            style={{ background: C.accent, borderRadius: 10, padding: "9px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Plus size={14} color="#fff" />
            <span style={{ color: "#fff", fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Add Task</span>
          </Touchable>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
              placeholder="Task name"
              style={{
                background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, color: C.onSurface,
                fontFamily: sans, fontSize: 13, borderRadius: 10, padding: "9px 12px", outline: "none",
              }}
            />
            <div className="flex items-center gap-2">
              <Touchable
                onClick={() => { setAdding(false); setTitle(""); }}
                style={{ flex: 1, borderRadius: 10, padding: "9px 0", border: `1px solid ${C.outlineVariant}`, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <span style={{ color: C.onSurfaceVariant, fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Cancel</span>
              </Touchable>
              <Touchable
                writeAction
                onClick={addTask}
                style={{ flex: 1, background: C.accent, borderRadius: 10, padding: "9px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Plus size={14} color="#fff" />
                <span style={{ color: "#fff", fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Add</span>
              </Touchable>
            </div>
          </div>
        )
      )}
    </Mission>
  );
}

function UnlistedTasksCard({ set, selected, unlisted }) {
  const readOnly = useContext(ReadOnlyContext);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const addUnlisted = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    set((d) => {
      d.planner.unlisted.push({ id: uid(), title: trimmed });
    });
    setTitle("");
    setAdding(false);
  };

  const deleteUnlisted = (taskId) => {
    set((d) => {
      d.planner.unlisted = d.planner.unlisted.filter((t) => t.id !== taskId);
    });
  };

  const addToDay = (task) => {
    set((d) => {
      if (!d.planner.days[selected]) d.planner.days[selected] = [];
      d.planner.days[selected].push({ id: uid(), title: task.title, completed: false });
      d.planner.unlisted = d.planner.unlisted.filter((t) => t.id !== task.id);
    });
  };

  return (
    <div className="mx-4 mb-3" style={{ background: C.container, border: `1px solid ${C.outlineVariant}`, borderRadius: 10, padding: 14 }}>
      <div className="flex flex-col gap-2" style={{ marginBottom: 10 }}>
        {unlisted.length === 0 ? (
          <p style={{ color: C.faint, fontSize: 12.5 }}>No unlisted tasks — add some below to keep as a backlog.</p>
        ) : (
          unlisted.map((task) => (
            <div
              key={task.id}
              style={{ background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, borderRadius: 12, padding: "8px 10px" }}
              className="flex items-center gap-2"
            >
              <span style={{ flex: 1, color: C.onSurface, fontFamily: sans, fontSize: 13.5 }}>{task.title}</span>
              {!readOnly && (
                <>
                  <Touchable
                    writeAction
                    onClick={() => addToDay(task)}
                    rippleColor={mix(C.accent, 20)}
                    style={{ padding: "5px 8px", borderRadius: 8, border: `1px solid ${mix(C.accent, 40)}`, display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <ArrowRightToLine size={12} color={C.accent} />
                    <span style={{ color: C.accent, fontFamily: sans, fontWeight: 600, fontSize: 11 }}>Add to day</span>
                  </Touchable>
                  <Touchable writeAction onClick={() => deleteUnlisted(task.id)} style={{ padding: 4 }}>
                    <Trash2 size={14} color={C.faint} />
                  </Touchable>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {!readOnly && (
        !adding ? (
          <Touchable
            writeAction
            onClick={() => setAdding(true)}
            style={{
              background: C.container, border: `1px dashed ${C.outline}`, borderRadius: 10, padding: "12px 0",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            <Plus size={16} color={C.onSurfaceVariant} />
            <span style={{ color: C.onSurfaceVariant, fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Add Unlisted Task</span>
          </Touchable>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addUnlisted(); }}
              placeholder="Task name"
              style={{
                background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, color: C.onSurface,
                fontFamily: sans, fontSize: 13, borderRadius: 10, padding: "9px 12px", outline: "none",
              }}
            />
            <div className="flex items-center gap-2">
              <Touchable
                onClick={() => { setAdding(false); setTitle(""); }}
                style={{ flex: 1, borderRadius: 10, padding: "9px 0", border: `1px solid ${C.outlineVariant}`, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <span style={{ color: C.onSurfaceVariant, fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Cancel</span>
              </Touchable>
              <Touchable
                writeAction
                onClick={addUnlisted}
                style={{ flex: 1, background: C.accent, borderRadius: 10, padding: "9px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Plus size={14} color="#fff" />
                <span style={{ color: "#fff", fontFamily: sans, fontWeight: 600, fontSize: 13 }}>Add</span>
              </Touchable>
            </div>
          </div>
        )
      )}
    </div>
  );
}


const CAL_MONTHS = [
  { label: "August", year: 2026, month: 7 },
  { label: "September", year: 2026, month: 8 },
  { label: "October", year: 2026, month: 9 },
];
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const RESOLVE_DAILY_ITEMS = [
  ["wake", "Wake up by 7:00 AM"],
  ["plan", "Create the day's plan"],
  ["hair", "Hair care routine"],
  ["teeth", "Brush teeth before bed"],
];

function calDayStatus(state, ds) {
  const d = new Date(ds + "T00:00:00");
  if (d < QUEST_START || d > QUEST_END) return null;

  const dlog = state.diet.logs[ds];
  const dplan = dlog?.planId ? state.diet.plans.find((p) => p.id === dlog.planId) : null;
  let dietFrac = null;
  let dietGrams = 0;
  if (dplan) {
    const doneItems = dplan.items.filter((i) => dlog.completed?.[i.id]);
    dietGrams = doneItems.reduce((sum, i) => sum + (Number(i.protein) || 0), 0);
    dietFrac = dplan.items.length > 0 ? doneItems.length / dplan.items.length : 0;
  }

  const isMtDay = MT_DATES.includes(ds);
  const vitalityFrac = isMtDay ? (state.vitality.muayThai[ds] ? 1 : 0) : null;

  const rlog = state.resolve.dailyLogs[ds];
  const resolveFrac = rlog
    ? RESOLVE_DAILY_ITEMS.filter(([k]) => rlog[k]).length / RESOLVE_DAILY_ITEMS.length
    : 0;

  return { dietFrac, dietGrams, vitalityFrac, resolveFrac };
}

function LegendDot({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 5px ${mix(color, 60)}` }} />
      <span style={{ fontFamily: sans, fontSize: 10.5, color: C.onSurfaceVariant }}>{label}</span>
    </div>
  );
}

/* Dot intensity now scales continuously with frac (25% → 100% color mix)
   instead of a single flat "partial" shade, so e.g. 1/4 Resolve items
   reads visibly lighter than 3/4 — not identical. Full completion also
   gets a glow so "done" is unambiguous at a glance. */
function StatusDot({ frac, color }) {
  if (frac === null || frac === undefined) {
    return <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.outlineVariant }} />;
  }
  const pct = clamp(frac, 0, 1);
  if (pct <= 0) {
    return <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.outlineVariant }} />;
  }
  const intensity = Math.round(30 + pct * 70); // 30% → 100% as frac goes 0 → 1
  return (
    <div
      style={{
        width: 5, height: 5, borderRadius: "50%",
        background: mix(color, intensity),
        boxShadow: pct >= 1 ? `0 0 4px ${mix(color, 70)}` : "none",
      }}
    />
  );
}

function weekTaskCounts(state, weekNum) {
  const weekIdx = weekNum - 1;
  const wlog = state.resolve.weeklyLogs[weekNum] || { laundry: false, iron: false };
  const armWeek = state.vitality.armWeeks[weekIdx] || [];
  const abWeek = state.vitality.abWeeks[weekIdx] || [];
  const armDone = armWeek.length > 0 && armWeek.every(Boolean);
  const abDone = abWeek.length > 0 && abWeek.every(Boolean);
  const resolveDone = (wlog.laundry ? 1 : 0) + (wlog.iron ? 1 : 0);
  const vitalityDone = (armDone ? 1 : 0) + (abDone ? 1 : 0);
  return { resolveDone, vitalityDone };
}

/* 0/2 tasks → hollow (faint outline); 1/2 → colored outline only, no fill;
   2/2 → filled + glow. Lets a single glance tell "started" from "done". */
function DualDot({ done, color }) {
  if (done <= 0) {
    return <div style={{ width: 7, height: 7, borderRadius: "50%", border: `1.5px solid ${C.outlineVariant}`, background: "transparent" }} />;
  }
  if (done === 1) {
    return <div style={{ width: 7, height: 7, borderRadius: "50%", border: `1.5px solid ${color}`, background: "transparent" }} />;
  }
  return (
    <div style={{ width: 7, height: 7, borderRadius: "50%", border: `1.5px solid ${color}`, background: color, boxShadow: `0 0 5px ${mix(color, 70)}` }} />
  );
}

function CalendarDropdown({ label, color, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-4" style={{ background: C.container, border: `1px solid ${C.outlineVariant}`, borderRadius: 14, overflow: "hidden" }}>
      <Touchable onClick={() => setOpen((o) => !o)} style={{ display: "block" }}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 5px ${mix(color, 60)}` }} />
            <span style={{ fontFamily: sans, fontWeight: 600, color: C.onSurface, fontSize: 13.5 }}>{label}</span>
          </div>
          {open ? <ChevronUp size={16} color={C.onSurfaceVariant} /> : <ChevronDown size={16} color={C.onSurfaceVariant} />}
        </div>
      </Touchable>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

function CalendarTab({ state, set }) {
  const today = dateOnly(new Date());
  const defaultMonthIdx = (() => {
    const i = CAL_MONTHS.findIndex((m) => today.getFullYear() === m.year && today.getMonth() === m.month);
    return i >= 0 ? i : 0;
  })();
  const [monthIdx, setMonthIdx] = useState(defaultMonthIdx);
  const [selected, setSelected] = useState(() =>
    fmtDate(today >= QUEST_START && today <= QUEST_END ? today : QUEST_START)
  );
  const [selectedWeek, setSelectedWeek] = useState(() => currentWeekNum());
  const [view, setView] = useState("daily");

  const { label: monthLabel, year, month } = CAL_MONTHS[monthIdx];
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));

  const selDate = new Date(selected + "T00:00:00");
  const selInRange = selDate >= QUEST_START && selDate <= QUEST_END;

  return (
    <div className="pb-4">
      <div className="px-4 pt-5 pb-4 flex items-center gap-2">
        <Diamond size={7} color={C.accent} glow />
        <div style={{ fontFamily: sans, fontWeight: 900, color: C.onSurface, fontSize: 22, letterSpacing: 0.3 }}>CALENDAR</div>
      </div>

      <div className="mx-4 mb-4 flex items-center" style={{ background: C.container, border: `1px solid ${C.outlineVariant}`, borderRadius: 12, padding: 3 }}>
        {[{ id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }].map((v) => {
          const active = view === v.id;
          return (
            <Touchable
              key={v.id}
              onClick={() => setView(v.id)}
              style={{
                flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 9,
                background: active ? mix(C.accent, 20) : "transparent",
              }}
            >
              <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 13, color: active ? C.accent : C.onSurfaceVariant }}>
                {v.label}
              </span>
            </Touchable>
          );
        })}
      </div>

      {view === "daily" && (
        <>
          <div className="mx-4 mb-3 flex items-center justify-between">
            <Touchable
              onClick={() => setMonthIdx((m) => clamp(m - 1, 0, CAL_MONTHS.length - 1))}
              style={{ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", opacity: monthIdx === 0 ? 0.3 : 1, pointerEvents: monthIdx === 0 ? "none" : "auto" }}
            >
              <ChevronLeft size={18} color={C.onSurfaceVariant} />
            </Touchable>
            <span style={{ fontFamily: sans, fontWeight: 700, color: C.onSurface, fontSize: 15 }}>
              {monthLabel} {year}
            </span>
            <Touchable
              onClick={() => setMonthIdx((m) => clamp(m + 1, 0, CAL_MONTHS.length - 1))}
              style={{ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", opacity: monthIdx === CAL_MONTHS.length - 1 ? 0.3 : 1, pointerEvents: monthIdx === CAL_MONTHS.length - 1 ? "none" : "auto" }}
            >
              <ChevronRight size={18} color={C.onSurfaceVariant} />
            </Touchable>
          </div>

          <div className="mx-4 mb-2 flex items-center justify-center gap-4">
            <div className="flex items-center gap-1.5">
              <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: C.accent }}>42g</span>
              <span style={{ fontFamily: sans, fontSize: 10.5, color: C.onSurfaceVariant }}>Protein</span>
            </div>
            <LegendDot color={C.vitality} label="Vitality" />
            <LegendDot color={C.resolve} label="Resolve" />
          </div>

          <div className="mx-4" style={{ background: C.container, border: `1px solid ${C.outlineVariant}`, borderRadius: 16, padding: 12 }}>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAY_LETTERS.map((w, i) => (
                <div key={i} style={{ textAlign: "center", fontFamily: mono, fontSize: 9.5, color: C.faint }}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (!d) return <div key={i} />;
                const ds = fmtDate(d);
                const status = calDayStatus(state, ds);
                const isToday = fmtDate(today) === ds;
                const isSel = selected === ds;
                const inRange = d >= QUEST_START && d <= QUEST_END;
                return (
                  <Touchable
                    key={i}
                    onClick={() => { if (inRange) setSelected(ds); }}
                    style={{
                      aspectRatio: "1", borderRadius: 10,
                      background: isSel ? mix(C.accent, 18) : "transparent",
                      border: isToday ? `1px solid ${C.accent}` : "1px solid transparent",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                      opacity: inRange ? 1 : 0.28, pointerEvents: inRange ? "auto" : "none",
                    }}
                  >
                    <span style={{ fontFamily: mono, fontSize: 11, color: isSel ? C.accent : C.onSurface, fontWeight: isToday ? 800 : 500 }}>
                      {d.getDate()}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 8, lineHeight: "9px", fontWeight: 700, color: status?.dietGrams ? C.accent : "transparent" }}>
                      {status?.dietGrams ? `${Math.round(status.dietGrams)}g` : "0g"}
                    </span>
                    <div className="flex items-center gap-[2px]">
                      <StatusDot frac={status?.vitalityFrac} color={C.vitality} />
                      <StatusDot frac={status?.resolveFrac} color={C.resolve} />
                    </div>
                  </Touchable>
                );
              })}
            </div>
          </div>

          <div className="pt-4">
            <CalendarDropdown
              label={selInRange ? `Day details — ${selDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Day details"}
              color={C.accent}
            >
              {!selInRange ? (
                <p style={{ color: C.faint, fontSize: 12.5, padding: "0 16px 12px" }}>Outside the quest window (2 Aug – 31 Oct 2026).</p>
              ) : (
                <CalendarDayDetail date={selected} state={state} set={set} />
              )}
            </CalendarDropdown>
          </div>
        </>
      )}

      {/* Separate weekly calendar — laundry/iron + arm/ab training aren't
          daily, so they get their own week-picker grid rather than being
          tied to whichever day happens to be selected above. */}
      {view === "weekly" && (
        <div>
          <div className="mx-4 mb-2 flex items-center justify-center gap-4">
            <LegendDot color={C.vitality} label="Vitality" />
            <LegendDot color={C.resolve} label="Resolve" />
          </div>

          <div className="mx-4" style={{ background: C.container, border: `1px solid ${C.outlineVariant}`, borderRadius: 16, padding: 12 }}>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 13 }, (_, i) => i + 1).map((wn) => {
                const { resolveDone, vitalityDone } = weekTaskCounts(state, wn);
                const active = selectedWeek === wn;
                return (
                  <Touchable
                    key={wn}
                    onClick={() => setSelectedWeek(wn)}
                    style={{
                      aspectRatio: "1", borderRadius: 10,
                      background: active ? mix(C.resolve, 18) : "transparent",
                      border: active ? `1px solid ${C.resolve}` : "1px solid transparent",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                    }}
                  >
                    <span style={{ fontFamily: mono, fontSize: 11, color: active ? C.resolve : C.onSurface, fontWeight: active ? 800 : 500 }}>
                      W{wn}
                    </span>
                    <div className="flex items-center gap-[3px]">
                      <DualDot done={vitalityDone} color={C.vitality} />
                      <DualDot done={resolveDone} color={C.resolve} />
                    </div>
                  </Touchable>
                );
              })}
              {Array.from({ length: (7 - (13 % 7)) % 7 }, (_, i) => <div key={`pad-${i}`} />)}
            </div>
          </div>

          <div className="pt-3">
            <CalendarDropdown label={`Week ${selectedWeek} details`} color={C.resolve}>
              <CalendarWeeklyCard weekNum={selectedWeek} state={state} set={set} />
            </CalendarDropdown>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarDayDetail({ date, state, set }) {
  const readOnly = useContext(ReadOnlyContext);
  const [picking, setPicking] = useState(false);

  const d = new Date(date + "T00:00:00");
  const idx = dayIndex(d);
  const weekNum = clamp(Math.ceil(idx / 7), 1, 13);
  const label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const plans = state.diet.plans || [];
  const dlog = state.diet.logs[date] || { planId: null, completed: {} };
  const activePlan = plans.find((p) => p.id === dlog.planId) || null;
  const dietTotalProtein = activePlan
    ? activePlan.items.reduce((sum, i) => sum + (Number(i.protein) || 0), 0)
    : 0;
  const dietConsumedProtein = activePlan
    ? activePlan.items.filter((i) => dlog.completed?.[i.id]).reduce((sum, i) => sum + (Number(i.protein) || 0), 0)
    : 0;

  const isMtDay = MT_DATES.includes(date);
  const mtDone = !!state.vitality.muayThai[date];

  const rlog = state.resolve.dailyLogs[date] || { wake: false, plan: false, hair: false, teeth: false };

  return (
    <div>
      <div className="px-5 pb-2 flex items-baseline gap-2">
        <span style={{ fontFamily: sans, fontWeight: 700, color: C.onSurface, fontSize: 14 }}>{label}</span>
        <span style={{ fontFamily: mono, color: C.faint, fontSize: 11 }}>Day {clamp(idx, 1, TOTAL_DAYS)} · Week {weekNum}</span>
      </div>

      <Mission
        title="Diet"
        rightLabel={`${Math.round(dietConsumedProtein)} / ${Math.round(dietTotalProtein)}g`}
        color={C.accent}
        defaultOpen
      >
        {plans.length === 0 ? (
          <p style={{ color: C.faint, fontSize: 12.5 }}>No diets created yet — add one from the Diet tab.</p>
        ) : !activePlan || picking ? (
          <div className="flex flex-col gap-2">
            <p style={{ color: C.onSurfaceVariant, fontSize: 12 }}>Which diet was this?</p>
            {plans.map((p) => (
              <Touchable
                key={p.id}
                writeAction
                onClick={() => {
                  set((dr) => {
                    if (!dr.diet.logs[date]) dr.diet.logs[date] = { planId: null, completed: {} };
                    dr.diet.logs[date].planId = p.id;
                    dr.diet.logs[date].completed = {};
                  });
                  setPicking(false);
                }}
                style={{
                  background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, borderRadius: 10,
                  padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
                }}
              >
                <span style={{ color: C.onSurface, fontFamily: sans, fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: C.faint, fontFamily: mono, fontSize: 11.5 }}>{p.items.length} items</span>
              </Touchable>
            ))}
            {activePlan && (
              <Touchable onClick={() => setPicking(false)} style={{ alignSelf: "flex-end", padding: "4px 2px" }}>
                <span style={{ color: C.onSurfaceVariant, fontFamily: sans, fontSize: 12 }}>Cancel</span>
              </Touchable>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <span style={{ color: C.onSurface, fontFamily: sans, fontSize: 13.5, fontWeight: 700 }}>{activePlan.name}</span>
              {!readOnly && (
                <Touchable onClick={() => setPicking(true)}>
                  <span style={{ color: C.accent, fontFamily: sans, fontSize: 12, fontWeight: 600 }}>Change</span>
                </Touchable>
              )}
            </div>
            {activePlan.items.length === 0 ? (
              <p style={{ color: C.faint, fontSize: 12.5 }}>This diet has no items yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {activePlan.items.map((item) => {
                  const checked = !!dlog.completed?.[item.id];
                  return (
                    <div
                      key={item.id}
                      style={{ background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, borderRadius: 12, padding: "8px 12px" }}
                      className="flex items-center gap-2"
                    >
                      <Check2
                        checked={checked}
                        color={C.accent}
                        onClick={() => set((dr) => {
                          if (!dr.diet.logs[date]) dr.diet.logs[date] = { planId: activePlan.id, completed: {} };
                          dr.diet.logs[date].completed[item.id] = !dr.diet.logs[date].completed[item.id];
                        })}
                      />
                      <span
                        style={{
                          flex: 1, color: checked ? C.faint : C.onSurface, fontFamily: sans, fontSize: 13.5,
                          textDecoration: checked ? "line-through" : "none",
                        }}
                      >
                        {item.name}
                      </span>
                      <span style={{ color: C.faint, fontFamily: mono, fontSize: 11.5 }}>{item.protein}g</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Mission>

      {isMtDay && (
        <Mission title="Vitality" points={1} earned={mtDone ? 1 : 0} color={C.vitality}>
          <label className="flex items-center gap-1">
            <Check2 checked={mtDone} color={C.vitality} onClick={() => set((dr) => { dr.vitality.muayThai[date] = !dr.vitality.muayThai[date]; })} />
            <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Muay Thai class attended</span>
          </label>
        </Mission>
      )}

      <Mission title="Resolve" points={RESOLVE_DAILY_ITEMS.length} earned={RESOLVE_DAILY_ITEMS.filter(([k]) => rlog[k]).length} color={C.resolve}>
        <div className="flex flex-col">
          {RESOLVE_DAILY_ITEMS.map(([k, lbl]) => (
            <label key={k} className="flex items-center gap-1">
              <Check2
                checked={!!rlog[k]}
                color={C.resolve}
                onClick={() => set((dr) => {
                  if (!dr.resolve.dailyLogs[date]) dr.resolve.dailyLogs[date] = { wake: false, plan: false, hair: false, teeth: false };
                  dr.resolve.dailyLogs[date][k] = !dr.resolve.dailyLogs[date][k];
                })}
              />
              <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>{lbl}</span>
            </label>
          ))}
        </div>
      </Mission>
    </div>
  );
}

/* Weekly tasks (Resolve laundry/iron + Vitality arm/ab training sessions)
   don't belong to a single day, but every day in the calendar falls in
   exactly one quest week (weeks run Sun–Sat, same as the grid columns),
   so the day-detail panel shows the whole week's weekly tasks alongside
   that day's daily ones. */
function CalendarWeeklyCard({ weekNum, state, set }) {
  const weekIdx = weekNum - 1;
  const wlog = state.resolve.weeklyLogs[weekNum] || { laundry: false, iron: false };
  const armWeek = state.vitality.armWeeks[weekIdx] || [];
  const abWeek = state.vitality.abWeeks[weekIdx] || [];
  const weeklyDone =
    (wlog.laundry ? 1 : 0) + (wlog.iron ? 1 : 0) +
    armWeek.filter(Boolean).length + abWeek.filter(Boolean).length;
  const weeklyTotal = 2 + armWeek.length + abWeek.length;

  return (
    <div className="px-4 pb-3 pt-1">
      <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 10 }}>
        {weeklyDone} / {weeklyTotal} pts · applies to the whole week ({weekRange(weekNum)}), not just one day.
      </p>
      <div className="flex flex-col" style={{ marginBottom: 12 }}>
        <label className="flex items-center gap-1">
          <Check2
            checked={!!wlog.laundry}
            color={C.resolve}
            onClick={() => set((dr) => {
              if (!dr.resolve.weeklyLogs[weekNum]) dr.resolve.weeklyLogs[weekNum] = { laundry: false, iron: false };
              dr.resolve.weeklyLogs[weekNum].laundry = !dr.resolve.weeklyLogs[weekNum].laundry;
            })}
          />
          <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Laundry (1 pt)</span>
        </label>
        <label className="flex items-center gap-1">
          <Check2
            checked={!!wlog.iron}
            color={C.resolve}
            onClick={() => set((dr) => {
              if (!dr.resolve.weeklyLogs[weekNum]) dr.resolve.weeklyLogs[weekNum] = { laundry: false, iron: false };
              dr.resolve.weeklyLogs[weekNum].iron = !dr.resolve.weeklyLogs[weekNum].iron;
            })}
          />
          <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Iron clothes (1 pt)</span>
        </label>
      </div>

      {armWeek.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 8 }}>
          <span style={{ fontFamily: mono, fontSize: 10.5, color: C.faint, width: 110 }}>Arm Training</span>
          <div className="flex gap-1">
            {armWeek.map((v, si) => (
              <Check2
                key={si}
                checked={v}
                color={C.vitality}
                onClick={() => set((dr) => { dr.vitality.armWeeks[weekIdx][si] = !dr.vitality.armWeeks[weekIdx][si]; })}
              />
            ))}
          </div>
          <span style={{ fontFamily: mono, fontSize: 9.5, color: C.faint }}>{weekIdx < 4 ? "1 pt" : "0.5 pt"}</span>
        </div>
      )}
      {abWeek.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ fontFamily: mono, fontSize: 10.5, color: C.faint, width: 110 }}>Ab Training</span>
          <div className="flex gap-1">
            {abWeek.map((v, si) => (
              <Check2
                key={si}
                checked={v}
                color={C.vitality}
                onClick={() => set((dr) => { dr.vitality.abWeeks[weekIdx][si] = !dr.vitality.abWeeks[weekIdx][si]; })}
              />
            ))}
          </div>
          <span style={{ fontFamily: mono, fontSize: 9.5, color: C.faint }}>{weekIdx < 4 ? "1 pt" : "0.5 pt"}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   TODAY'S QUESTS — HUD checklist card
--------------------------------------------------------------- */
function QuestBar({ state, set, today }) {
  const idx = dayIndex(today);
  const inRange = idx >= 1 && idx <= TOTAL_DAYS;
  const key = fmtDate(today);
  const weekNum = inRange ? clamp(Math.ceil(idx / 7), 1, 13) : 1;
  const weekIdx = weekNum - 1;
  const log = (inRange && state.resolve.dailyLogs[key]) || {};
  const wlog = (inRange && state.resolve.weeklyLogs[weekNum]) || {};
  const wd = today.getDay();
  const isWeekday = wd !== 0 && wd !== 6;
  const mtDone = !!state.vitality.muayThai[key];
  const [open, setOpen] = useState(false);

  const dailyItemDefs = !inRange ? [] : [
    ["wake", "Wake up by 7:00 AM"],
    ["plan", "Create the day's plan"],
    ["hair", "Hair care routine"],
    ["teeth", "Brush teeth before bed"],
  ].filter(([k]) => !log[k]);

  const weeklyItemDefs = !inRange ? [] : [
    ["laundry", "Laundry"],
    ["iron", "Iron clothes"],
  ].filter(([k]) => !wlog[k]);

  const armSessions = (inRange && state.vitality.armWeeks[weekIdx]) || [];
  const abSessions = (inRange && state.vitality.abWeeks[weekIdx]) || [];
  const armPending = armSessions.map((v, si) => ({ v, si })).filter((x) => !x.v);
  const abPending = abSessions.map((v, si) => ({ v, si })).filter((x) => !x.v);
  const mtPending = inRange && isWeekday && MT_DATES.includes(key) && !mtDone;

  const daily = [
    ...(mtPending ? [{ id: "mt", label: "Muay Thai class", color: C.vitality, onClick: () => set((d) => { d.vitality.muayThai[key] = true; }) }] : []),
    ...dailyItemDefs.map(([k, label]) => ({
      id: k, label, color: C.resolve,
      onClick: () => set((d) => {
        if (!d.resolve.dailyLogs[key]) d.resolve.dailyLogs[key] = { wake: false, plan: false, hair: false, teeth: false };
        d.resolve.dailyLogs[key][k] = true;
      }),
    })),
  ];

  const weekly = [
    ...weeklyItemDefs.map(([k, label]) => ({
      id: k, label, color: C.resolve,
      onClick: () => set((d) => {
        if (!d.resolve.weeklyLogs[weekNum]) d.resolve.weeklyLogs[weekNum] = { laundry: false, iron: false };
        d.resolve.weeklyLogs[weekNum][k] = true;
      }),
    })),
    ...armPending.map(({ si }) => ({ id: `arm-${si}`, label: "Arm Training", color: C.vitality, onClick: () => set((d) => { d.vitality.armWeeks[weekIdx][si] = true; }) })),
    ...abPending.map(({ si }) => ({ id: `ab-${si}`, label: "Ab Training", color: C.vitality, onClick: () => set((d) => { d.vitality.abWeeks[weekIdx][si] = true; }) })),
  ];

  const bonus = (state.resolve.bonusTasks || [])
    .filter((t) => !t.completed)
    .map((t) => ({
      id: t.id, label: t.title, color: C.resolve,
      onClick: () => set((d) => {
        const task = d.resolve.bonusTasks.find((x) => x.id === t.id);
        if (task) task.completed = true;
      }),
    }));

  const groups = [
    { key: "daily", label: "Daily", color: C.resolve, items: daily },
    { key: "weekly", label: "Weekly", color: C.vitality, items: weekly },
    { key: "bonus", label: "Bonus", color: C.wealth, items: bonus },
  ];

  return (
    <div className="mb-3" style={{ background: `linear-gradient(120deg, var(--container-high), var(--container))`, borderRadius: 14, border: `1px solid ${C.outlineVariant}`, overflow: "hidden" }}>
      <Touchable onClick={() => setOpen((o) => !o)} style={{ display: "block", width: "100%" }}>
        <div className="flex items-center">
          {groups.map((g, i) => (
            <div
              key={g.key}
              className="flex-1 flex items-center justify-center gap-1.5"
              style={{ padding: "8px 4px", borderLeft: i > 0 ? `1px solid ${C.outlineVariant}` : "none" }}
            >
              <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 14, color: g.items.length > 0 ? g.color : C.faint }}>
                {g.items.length}
              </span>
              <span style={{ fontFamily: sans, fontWeight: 500, fontSize: 10.5, color: C.onSurfaceVariant, letterSpacing: 0.2 }}>
                {g.label}
              </span>
            </div>
          ))}
          <div className="flex items-center" style={{ paddingRight: 10 }}>
            {open ? <ChevronUp size={13} color={C.faint} /> : <ChevronDown size={13} color={C.faint} />}
          </div>
        </div>
      </Touchable>
      {open && (
        <div className="px-3 pb-3" style={{ borderTop: `1px solid ${C.outlineVariant}` }}>
          {groups.map((g) => {
            const noneMsg = g.key === "bonus" && (state.resolve.bonusTasks || []).length === 0 ? "No bonus tasks yet." : "All done.";
            return (
              <div
                key={g.key}
                style={{
                  marginTop: 10, borderRadius: 14, overflow: "hidden",
                  border: `1px solid ${mix(g.color, 28)}`,
                  background: `linear-gradient(160deg, ${mix(g.color, 9)}, transparent 75%)`,
                }}
              >
                <div className="flex items-center gap-2" style={{ padding: "8px 12px", background: mix(g.color, 6) }}>
                  <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 10.5, color: g.color, letterSpacing: 0.5, textTransform: "uppercase" }}>
                    {g.label}
                  </span>
                  <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 10.5, color: g.items.length > 0 ? g.color : C.faint }}>
                    {g.items.length > 0 ? `${g.items.length} left` : "clear"}
                  </span>
                </div>
                {g.items.length === 0 ? (
                  <div className="flex items-center gap-2" style={{ padding: "10px 12px" }}>
                    <CheckCircle2 size={14} color={mix(g.color, 65)} />
                    <span style={{ color: C.onSurfaceVariant, fontSize: 12 }}>{noneMsg}</span>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {g.items.map((it, ii) => (
                      <label
                        key={it.id}
                        className="flex items-center gap-2"
                        style={{ padding: "7px 12px", borderTop: ii > 0 ? `1px solid ${mix(g.color, 12)}` : "none" }}
                      >
                        <Check2 checked={false} color={it.color} onClick={it.onClick} />
                        <span style={{ color: C.onSurface, fontSize: 13, fontWeight: 500 }}>{it.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   THEME TOGGLE — small sun/moon pill, used in the top bar & code gate
--------------------------------------------------------------- */
function ThemeToggle({ mode, onToggle }) {
  return (
    <Touchable
      onClick={onToggle}
      style={{
        width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
        background: C.containerHigh, border: `1px solid ${C.outlineVariant}`,
      }}
    >
      {mode === "dark" ? <Moon size={15} color={C.accent} /> : <Sun size={15} color={C.accent} />}
    </Touchable>
  );
}

/* ---------------------------------------------------------------
   SECRET CODE GATE — shown before any data loads.
   setupMode=true: no profile exists yet anywhere — the very first
   person here sets BOTH a write code and a read code at once, and
   there can never be a second profile after this.
   setupMode=false: profile already exists — a single code decides
   whether this device gets write or read-only access.
--------------------------------------------------------------- */
function CodeGate({ onSubmitEnter, onSubmitSetup, setupMode, checking, busy, error, mode, onToggleTheme }) {
  const [value, setValue] = useState("");
  const [writeVal, setWriteVal] = useState("");
  const [localError, setLocalError] = useState(null);

  const submitEnter = () => {
    const clean = sanitizeCode(value);
    if (clean.length < 4) { setLocalError("Code must be at least 4 characters."); return; }
    setLocalError(null);
    onSubmitEnter(clean);
  };

  const submitSetup = () => {
    const w = sanitizeCode(writeVal);
    if (w.length < 4) { setLocalError("Code must be at least 4 characters."); return; }
    setLocalError(null);
    onSubmitSetup(w);
  };

  const shownError = localError || error;

  return (
    <div
      style={{
        background: `radial-gradient(circle at 80% -10%, ${C.glow}, transparent 55%), var(--surface)`,
        fontFamily: sans, maxWidth: 420, margin: "0 auto",
        height: 780, borderRadius: 14, overflow: "hidden",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        boxShadow: "var(--shell-shadow)", border: `1px solid ${C.outlineVariant}`,
        padding: 32, position: "relative",
      }}
    >
      <style>{FONT_IMPORT}</style>
      <div style={{ position: "absolute", top: 16, right: 16 }}>
        <ThemeToggle mode={mode} onToggle={onToggleTheme} />
      </div>
      <Hex size={64} color={C.accent} glow>
        <KeyRound size={30} color={C.accent} />
      </Hex>

      {checking ? (
        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 size={16} className="md-spin" color={C.onSurfaceVariant} />
          <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Checking…</span>
        </div>
      ) : setupMode ? (
        <>
          <div style={{ fontFamily: sans, fontWeight: 900, fontSize: 20, color: C.onSurface, margin: "18px 0 6px", textAlign: "center" }}>
            Set up your quest
          </div>
          <p style={{ color: C.onSurfaceVariant, fontSize: 13, textAlign: "center", marginBottom: 22, lineHeight: 1.5 }}>
            This is a one-time setup. Choose a write code for full access — you're the only one who'll ever need it. Once you're in, add view-only passwords for friends from the menu.
          </p>
          <div style={{ width: "100%", marginBottom: 16 }}>
            <label style={{ color: C.faint, fontSize: 11, fontFamily: sans, fontWeight: 600 }}>WRITE CODE (yours)</label>
            <input
              autoFocus
              value={writeVal}
              onChange={(e) => setWriteVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitSetup(); }}
              placeholder="e.g. arjun-quest-9f3k2"
              style={{
                width: "100%", background: C.containerHigh, border: `1px solid ${C.outline}`, color: C.onSurface,
                fontFamily: mono, fontSize: 14, borderRadius: 14, padding: "13px 16px", marginTop: 6, outline: "none",
              }}
            />
          </div>
          {shownError && (
            <p style={{ color: C.danger, fontSize: 12, textAlign: "center", marginBottom: 12 }}>{shownError}</p>
          )}
          <Touchable
            onClick={submitSetup}
            disabled={busy}
            style={{
              width: "100%", background: C.accent, color: "#fff", borderRadius: 16, padding: "13px 0",
              display: "flex", alignItems: "center", justifyContent: "center", fontFamily: sans, fontWeight: 700, fontSize: 14.5,
              boxShadow: `0 0 18px ${C.glow}`, opacity: busy ? 0.7 : 1, gap: 8,
            }}
          >
            {busy && <Loader2 size={15} className="md-spin" />}
            {busy ? "Creating…" : "Create quest"}
          </Touchable>
        </>
      ) : (
        <>
          <div style={{ fontFamily: sans, fontWeight: 900, fontSize: 20, color: C.onSurface, margin: "18px 0 6px", textAlign: "center" }}>
            Enter your code
          </div>
          <p style={{ color: C.onSurfaceVariant, fontSize: 13, textAlign: "center", marginBottom: 22, lineHeight: 1.5 }}>
            Use your write code for full access, or a read code for view-only.
          </p>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitEnter(); }}
            placeholder="Enter your code"
            style={{
              width: "100%", background: C.containerHigh, border: `1px solid ${C.outline}`, color: C.onSurface,
              fontFamily: mono, fontSize: 14, borderRadius: 14, padding: "13px 16px", marginBottom: 12, outline: "none",
            }}
          />
          {shownError && (
            <p style={{ color: C.danger, fontSize: 12, textAlign: "center", marginBottom: 12 }}>{shownError}</p>
          )}
          <Touchable
            onClick={submitEnter}
            disabled={busy}
            style={{
              width: "100%", background: C.accent, color: "#fff", borderRadius: 16, padding: "13px 0",
              display: "flex", alignItems: "center", justifyContent: "center", fontFamily: sans, fontWeight: 700, fontSize: 14.5,
              boxShadow: `0 0 18px ${C.glow}`, opacity: busy ? 0.7 : 1, gap: 8,
            }}
          >
            {busy && <Loader2 size={15} className="md-spin" />}
            {busy ? "Checking…" : "Continue"}
          </Touchable>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   TOP APP BAR
--------------------------------------------------------------- */
/* Rank badge — pure typography: a small tracked "RANK" caption sitting
   above a large, heavy rank letter, tinted with the current rank's color.
   Tapping it opens a small popover with the rank color and XP details;
   it closes on any click outside. */
function RankBadge({ rank, color, xp, bandFrom, bandTo, mode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const elite = RANK_BANDS.findIndex((b) => b.rank === rank) >= RANK_BANDS.length - 2;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <Touchable onClick={() => setOpen((o) => !o)} rippleColor={`${mix(color, 20)}`} style={{ borderRadius: 10, padding: "0 2px" }}>
        <div className="flex flex-col items-center">
          <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: C.faint, letterSpacing: 2 }}>RANK</span>
          <span
            style={{
              fontFamily: sans, fontWeight: 900, lineHeight: 1,
              fontSize: 40,
              color,
              letterSpacing: 0.5,
              textShadow: elite ? `0 0 18px ${mix(color, 60)}, 0 0 36px ${mix(color, 33)}` : `0 0 10px ${mix(color, 27)}`,
            }}
          >
            {rank}
          </span>
        </div>
      </Touchable>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 10px)", left: 0,
            zIndex: 40, minWidth: 196, background: C.containerHighest, border: `1px solid ${mix(color, 33)}`,
            borderRadius: 14, padding: "12px 14px", boxShadow: "0 12px 28px rgba(0,0,0,0.4)",
          }}
        >
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
            <span style={{ fontFamily: sans, fontWeight: 700, color: C.onSurface, fontSize: 13.5 }}>Rank {rank}</span>
          </div>
          <div className="flex justify-between" style={{ marginBottom: 3 }}>
            <span style={{ fontFamily: mono, fontSize: 10.5, color: C.onSurfaceVariant }}>Total XP</span>
            <span style={{ fontFamily: mono, fontSize: 10.5, color: C.onSurface }}>{Math.round(xp)} / 400</span>
          </div>
          <div className="flex justify-between" style={{ marginBottom: 3 }}>
            <span style={{ fontFamily: mono, fontSize: 10.5, color: C.onSurfaceVariant }}>Rank band</span>
            <span style={{ fontFamily: mono, fontSize: 10.5, color: C.onSurface }}>{bandFrom}–{bandTo}</span>
          </div>
          <div style={{ height: 1, background: C.outlineVariant, margin: "6px 0" }} />
          <span style={{ fontFamily: mono, fontSize: 10.5, color }}>
            {rank === "SS" ? "Top rank reached" : `${Math.round(xp - bandFrom)}/${bandTo - bandFrom} to next rank`}
          </span>
          <div style={{ height: 1, background: C.outlineVariant, margin: "10px 0 8px" }} />
          <span style={{ fontFamily: mono, fontSize: 9, color: C.faint, letterSpacing: 1 }}>ALL RANKS</span>
          <div className="flex flex-col gap-1.5" style={{ marginTop: 6 }}>
            {RANK_BANDS.map((b) => {
              const bc = rankColor(b.rank, mode);
              const isCurrent = b.rank === rank;
              return (
                <div
                  key={b.rank}
                  className="flex items-center gap-2"
                  style={{
                    padding: "3px 6px", borderRadius: 8,
                    background: isCurrent ? `${mix(bc, 12)}` : "transparent",
                  }}
                >
                  <div style={{ width: 9, height: 9, borderRadius: "50%", background: bc, flexShrink: 0, boxShadow: isCurrent ? `0 0 6px ${bc}` : "none" }} />
                  <span style={{ fontFamily: sans, fontWeight: isCurrent ? 800 : 500, fontSize: 11.5, color: isCurrent ? bc : C.onSurfaceVariant, width: 20 }}>
                    {b.rank}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 10, color: isCurrent ? C.onSurface : C.faint, marginLeft: "auto" }}>
                    {b.from}–{b.to}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* Small neutral pill beside the name showing what the user is up to
   (home / office / trekking / muay thai / custom text). Tapping it opens
   a compact popover: preset options, a free-text field for anything else,
   and a toggle to hide the chip entirely. */
function StatusChip({ status, enabled, onChange, onToggleEnabled }) {
  const readOnly = useContext(ReadOnlyContext);
  const [open, setOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const wrapRef = useRef(null);
  const preset = STATUS_OPTIONS.find((o) => o.value === status);
  const Icon = preset ? preset.icon : status ? Tag : Tag;
  const label = preset ? preset.label : status || "Set status";

  useEffect(() => {
    if (open) setCustomDraft(preset ? "" : status || "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!enabled && readOnly) return null;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <Touchable
        onClick={() => !readOnly && setOpen((v) => !v)}
        writeAction
        style={{
          display: enabled || !readOnly ? "inline-flex" : "none",
          alignItems: "center", gap: 5,
          background: C.containerHigh, border: `1px solid ${C.outline}`,
          borderRadius: 999, padding: "3px 9px",
          opacity: enabled ? 1 : 0.45,
        }}
      >
        {enabled ? (
          <Icon size={11} color={C.onSurfaceVariant} />
        ) : (
          <EyeOff size={11} color={C.onSurfaceVariant} />
        )}
        <span style={{ fontFamily: sans, fontWeight: 500, fontSize: 10.5, color: C.onSurfaceVariant }}>
          {enabled ? label : "Hidden"}
        </span>
      </Touchable>

      {open && !readOnly && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30,
            width: 190, background: C.containerHighest, border: `1px solid ${C.outline}`,
            borderRadius: 12, padding: 8, boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
          }}
        >
          <div className="flex flex-col gap-0.5" style={{ marginBottom: 6 }}>
            {STATUS_OPTIONS.map((o) => {
              const OIcon = o.icon;
              const active = status === o.value;
              return (
                <Touchable
                  key={o.value}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 8px", borderRadius: 8,
                    background: active ? mix(C.accent, 16) : "transparent",
                  }}
                >
                  <OIcon size={13} color={active ? C.accent : C.onSurfaceVariant} />
                  <span style={{ fontFamily: sans, fontSize: 12, color: active ? C.accent : C.onSurface }}>
                    {o.label}
                  </span>
                </Touchable>
              );
            })}
          </div>

          <div style={{ borderTop: `1px solid ${C.outlineVariant}`, paddingTop: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: sans, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: C.faint }}>
              CUSTOM
            </span>
            <input
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customDraft.trim()) {
                  onChange(customDraft.trim());
                  setOpen(false);
                }
              }}
              placeholder="Type your own…"
              style={{
                width: "100%", marginTop: 4, fontFamily: sans, fontSize: 12, color: C.onSurface,
                background: C.container, border: `1px solid ${C.outline}`, borderRadius: 8,
                padding: "6px 8px", outline: "none",
              }}
            />
            <Touchable
              onClick={() => { if (customDraft.trim()) { onChange(customDraft.trim()); setOpen(false); } }}
              style={{
                marginTop: 6, width: "100%", textAlign: "center", padding: "6px 0",
                borderRadius: 8, border: `1px solid ${C.outline}`,
              }}
            >
              <span style={{ fontFamily: sans, fontSize: 11.5, color: C.onSurfaceVariant }}>Use custom text</span>
            </Touchable>
          </div>

          <Touchable
            onClick={() => onToggleEnabled(!enabled)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "6px 8px", borderRadius: 8, border: `1px solid ${C.outlineVariant}`,
            }}
          >
            <span style={{ fontFamily: sans, fontSize: 11.5, color: C.onSurfaceVariant }}>
              {enabled ? "Hide status chip" : "Show status chip"}
            </span>
            <EyeOff size={13} color={C.faint} />
          </Touchable>
        </div>
      )}
    </div>
  );
}

function LevelCard({ name, onNameChange, overall, totalXP, today, mode, status, statusEnabled, onStatusChange, onToggleStatusEnabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const { rank, progress, bandFrom, bandTo, xp } = rankInfo(totalXP);
  const rc = rankColor(rank, mode);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  const commit = () => {
    setEditing(false);
    onNameChange(draft.trim());
  };

  const dateStr = today.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <div
      className="mx-3 mb-1"
      style={{
        position: "relative",
        background: `linear-gradient(160deg, var(--container-high) 0%, var(--container) 65%)`,
        border: `1px solid ${mix(rc, 25)}`,
        borderRadius: 14,
        boxShadow: `inset 0 1px 0 ${mix(rc, 13)}, 0 1px 0 ${C.outlineVariant}`,
        transition: "border-color 0.3s ease, box-shadow 0.3s ease",
      }}
    >
      {/* decorative accents live in their own clipped layer so the rank
          popover (a sibling below) can overflow the card without being cut off */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 14, pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${rc}, transparent)`, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: -50, right: -40, width: 160, height: 160, borderRadius: "50%", background: `radial-gradient(circle, ${mix(rc, 20)}, transparent 72%)` }} />
      </div>
      <div className="flex items-end gap-3" style={{ position: "relative", padding: 16 }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") { setDraft(name); setEditing(false); }
                }}
                placeholder="Your Name"
                style={{
                  fontFamily: sans, fontWeight: 900, fontSize: 16, color: C.onSurface,
                  background: "transparent", border: "none", borderBottom: `1px solid ${C.outline}`,
                  outline: "none", width: "100%", padding: "1px 0",
                }}
              />
            ) : (
              <Touchable onClick={() => setEditing(true)} writeAction style={{ display: "inline-block", borderRadius: 8 }}>
                <span style={{ fontFamily: sans, fontWeight: 900, fontSize: 16, color: name ? C.onSurface : C.faint, letterSpacing: 0.3 }}>
                  {(name || "Your Name").toUpperCase()}
                </span>
              </Touchable>
            )}
            <StatusChip
              status={status}
              enabled={statusEnabled}
              onChange={onStatusChange}
              onToggleEnabled={onToggleStatusEnabled}
            />
          </div>

          <div className="flex items-end gap-3" style={{ marginTop: 8 }}>
            <RankBadge
              rank={rank} color={rc} xp={xp} bandFrom={bandFrom} bandTo={bandTo} mode={mode}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <Calendar size={11} color={C.onSurfaceVariant} />
                <span style={{ fontFamily: mono, fontSize: 11, color: C.onSurfaceVariant }}>{dateStr}</span>
              </div>
              <div style={{ height: 5, background: C.outlineVariant, borderRadius: 3, marginTop: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progress * 100}%`, background: rc, boxShadow: `0 0 6px ${mix(rc, 60)}`, borderRadius: 3, transition: "width 0.4s ease, background 0.3s ease" }} />
              </div>
              <span style={{ fontFamily: mono, fontSize: 9.5, color: C.faint }}>
                {rank === "SS" ? "Top rank reached" : `${Math.round(xp - bandFrom)}/${bandTo - bandFrom} XP to next rank`}
              </span>
            </div>
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <Ring value={overall} max={100} color={rc} size={72} stroke={5} glow>
            <div className="flex flex-col items-center leading-none">
              <span style={{ fontFamily: sans, fontSize: 19, fontWeight: 900, color: C.onSurface }}>{Math.round(overall)}</span>
              <span style={{ fontFamily: mono, fontSize: 7.5, color: C.faint, letterSpacing: 0.5 }}>/ 100</span>
            </div>
          </Ring>
        </div>
      </div>
    </div>
  );
}

function TopAppBar({ syncStatus, onMenu, mode, onToggleTheme, readOnly }) {
  return (
    <div className="flex items-center justify-between px-3" style={{ height: 60, flexShrink: 0 }}>
      <div className="flex items-center gap-1.5 pl-1.5">
        <div style={{ fontFamily: sans, fontWeight: 900, color: C.onSurface, fontSize: 16, letterSpacing: 0.5 }}>+ ULTRA</div>
        <span
          style={{
            fontFamily: mono, fontWeight: 700, fontSize: 9.5, letterSpacing: 0.5,
            color: C.accent, background: mix(C.accent, 16), border: `1px solid ${mix(C.accent, 30)}`,
            borderRadius: 8, padding: "3px 7px",
          }}
        >
          LEVEL 1
        </span>
        {readOnly && (
          <span
            style={{
              fontFamily: sans, fontWeight: 700, fontSize: 9.5, letterSpacing: 0.5,
              color: C.wealth, background: mix(C.wealth, 18), borderRadius: 8, padding: "3px 7px",
              display: "flex", alignItems: "center", gap: 3,
            }}
          >
            <Lock size={9} /> VIEW ONLY
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle mode={mode} onToggle={onToggleTheme} />
        <Touchable onClick={onMenu} style={{ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <MoreVertical size={18} color={C.onSurfaceVariant} />
        </Touchable>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   BOTTOM NAVIGATION — HUD nav bar with glow underline on active tab
--------------------------------------------------------------- */
function BottomNav({ tab, setTab, tabs }) {
  return (
    <div style={{ flexShrink: 0, padding: "0 12px 12px", background: C.surface }}>
      <div
        style={{
          height: NAV_H - 12, borderRadius: 14,
          background: C.containerHigh,
          border: `1px solid ${C.outlineVariant}`,
          boxShadow: "0 8px 22px rgba(0,0,0,0.28)",
        }}
        className="flex items-stretch"
      >
        {tabs.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <Touchable key={t.id} onClick={() => setTab(t.id)} rippleColor={`${mix(t.color, 20)}`} style={{ flex: 1, display: "flex" }}>
              <div className="w-full flex flex-col items-center justify-center gap-0.5">
                <div
                  style={{
                    padding: "3px 16px", borderRadius: 8,
                    background: active ? `${mix(t.color, 13)}` : "transparent",
                    boxShadow: active ? `0 0 10px ${mix(t.color, 27)}` : "none",
                    transition: "background 0.15s ease",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Icon size={19} color={active ? t.color : C.onSurfaceVariant} />
                </div>
                <span style={{ fontFamily: sans, fontSize: 10, fontWeight: active ? 700 : 500, color: active ? t.color : C.faint }}>
                  {t.label}
                </span>
                <div style={{ width: active ? 16 : 0, height: 2, borderRadius: 2, background: t.color, boxShadow: active ? `0 0 6px ${t.color}` : "none", transition: "width 0.15s ease" }} />
              </div>
            </Touchable>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   MAIN APP
--------------------------------------------------------------- */
export default function LifeRPG() {
  const [code, setCode] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(CODE_STORAGE_KEY) : null
  );
  const [mode, setMode] = useState(() =>
    (typeof window !== "undefined" && localStorage.getItem(THEME_STORAGE_KEY)) || "dark"
  );
  const [state, setState] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const contentScrollRef = useRef(null);
  useEffect(() => {
    if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0;
  }, [tab]);
  const [dirty, setDirty] = useState(false);
  const [syncStatus, setSyncStatus] = useState("synced");
  const [resetArm, setResetArm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [readOnly, setReadOnly] = useState(false);

  // authConfig: undefined = still checking, null = no profile exists yet,
  // object { writeCodeHash, readers: [{id,name,codeHash}] } = the one and
  // only profile. readCodeHash may still be present on older profiles —
  // see normalizeReaders().
  const [authConfig, setAuthConfig] = useState(undefined);
  const [authenticated, setAuthenticated] = useState(!SYNC_ENABLED);
  const [authError, setAuthError] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);

  // "Change write code" panel, owner-only.
  const [codesPanelOpen, setCodesPanelOpen] = useState(false);
  const [newWrite, setNewWrite] = useState("");
  const [codesError, setCodesError] = useState(null);
  const [codesSaving, setCodesSaving] = useState(false);

  // "Readers" panel, owner-only — named view-only passwords + who's opened
  // the app and when. Edits (name/password changes, deletes, new readers)
  // are staged in readerDrafts and only committed to Firestore when the
  // owner taps Save — nothing here writes immediately.
  const [readersPanelOpen, setReadersPanelOpen] = useState(false);
  const [readerDrafts, setReaderDrafts] = useState([]); // [{id, name, code, removed, isNew}]
  const [readerName, setReaderName] = useState("");
  const [readerCode, setReaderCode] = useState("");
  const [readersError, setReadersError] = useState(null);
  const [readersSaving, setReadersSaving] = useState(false);
  const [readerSessions, setReaderSessions] = useState(null);
  const [readerSessionsLoading, setReaderSessionsLoading] = useState(false);
  const [revealedReaders, setRevealedReaders] = useState({}); // {[id]: true}
  const loggedReaderSessionRef = useRef(null);

  // "Reset all data" write-code confirmation panel.
  const [resetPanelOpen, setResetPanelOpen] = useState(false);
  const [resetCodeInput, setResetCodeInput] = useState("");
  const [resetCodeError, setResetCodeError] = useState(null);
  const [resetBusy, setResetBusy] = useState(false);

  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  const toggleTheme = useCallback(() => {
    setMode((m) => {
      const next = m === "dark" ? "light" : "dark";
      if (typeof window !== "undefined") localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  }, []);

  // There is exactly one profile, ever. This listens for whether it exists
  // yet and, once it does, for its (hashed) write/read codes — so codes
  // changed on one device take effect everywhere immediately.
  useEffect(() => {
    if (!SYNC_ENABLED) return;
    const ref = doc(db, QUESTS_COLLECTION, AUTH_DOC_ID);
    const unsub = onSnapshot(
      ref,
      (snap) => setAuthConfig(snap.exists() ? snap.data() : null),
      () => setAuthConfig(null)
    );
    return () => unsub();
  }, []);

  // Validate whatever code this device has cached against the live
  // authConfig. Never creates anything — only the setup flow does that.
  useEffect(() => {
    if (!SYNC_ENABLED) return;
    if (authConfig === undefined) return;
    if (!code) { setAuthenticated(false); return; }

    if (authConfig === null) {
      // No profile exists — a cached code can't mean anything.
      if (typeof window !== "undefined") localStorage.removeItem(CODE_STORAGE_KEY);
      setCode(null);
      setAuthenticated(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const h = await sha256Hex(sanitizeCode(code));
      if (cancelled) return;
      if (h === authConfig.writeCodeHash) {
        setReadOnly(false);
        setAuthenticated(true);
        setAuthError(null);
      } else {
        const reader = normalizeReaders(authConfig).find((r) => r.codeHash === h);
        if (reader) {
          setReadOnly(true);
          setAuthenticated(true);
          setAuthError(null);
          // Log once per code entry, not on every authConfig refresh.
          if (loggedReaderSessionRef.current !== code) {
            loggedReaderSessionRef.current = code;
            logReaderSession(reader.id, reader.name);
          }
        } else {
          if (typeof window !== "undefined") localStorage.removeItem(CODE_STORAGE_KEY);
          setCode(null);
          setAuthenticated(false);
          setAuthError("That code is no longer valid. Please enter your current code.");
        }
      }
      setAuthBusy(false);
    })();
    return () => { cancelled = true; };
  }, [code, authConfig]);

  // Subscribe to the single quest document once this device is authenticated.
  useEffect(() => {
    if (!authenticated) return;
    setLoaded(false);
    if (!SYNC_ENABLED) {
      let initial = defaultState();
      if (typeof window !== "undefined") {
        try {
          const saved = localStorage.getItem(LOCAL_STATE_KEY);
          if (saved) initial = migrateState(JSON.parse(saved));
        } catch {}
      }
      setState(initial);
      setLoaded(true);
      setSyncStatus("synced");
      return;
    }
    const ref = doc(db, QUESTS_COLLECTION, MAIN_DOC_ID);
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        if (snap.exists()) {
          if (!dirtyRef.current) setState(migrateState(snap.data()));
        } else if (!readOnly) {
          const initial = defaultState();
          try { await setDoc(ref, initial); } catch {}
          setState(initial);
        } else {
          setState(defaultState());
        }
        setLoaded(true);
        setSyncStatus("synced");
      },
      () => { setSyncStatus("error"); setLoaded(true); }
    );
    return () => unsub();
  }, [authenticated, readOnly]);

  const submitEnter = useCallback((value) => {
    setAuthError(null);
    setAuthBusy(true);
    if (typeof window !== "undefined") localStorage.setItem(CODE_STORAGE_KEY, value);
    setCode(value);
  }, []);

  const submitSetup = useCallback(async (writeCode) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const existing = await getDoc(doc(db, QUESTS_COLLECTION, AUTH_DOC_ID));
      if (existing.exists()) {
        setAuthError("A profile already exists — please sign in instead.");
        setAuthConfig(existing.data());
        setAuthBusy(false);
        return;
      }
      const wHash = await sha256Hex(writeCode);
      const authPayload = { writeCodeHash: wHash, readers: [] };
      await setDoc(doc(db, QUESTS_COLLECTION, AUTH_DOC_ID), authPayload);
      await setDoc(doc(db, QUESTS_COLLECTION, MAIN_DOC_ID), defaultState());
      setAuthConfig(authPayload); // optimistic — avoids a race with the listener
      if (typeof window !== "undefined") localStorage.setItem(CODE_STORAGE_KEY, writeCode);
      setCode(writeCode);
    } catch {
      setAuthError("Something went wrong creating your quest. Please try again.");
      setAuthBusy(false);
    }
  }, []);

  const submitChangeCodes = useCallback(async () => {
    const w = sanitizeCode(newWrite);
    if (w.length < 4) { setCodesError("Code must be at least 4 characters."); return; }
    setCodesSaving(true);
    setCodesError(null);
    try {
      const wHash = await sha256Hex(w);
      const authPayload = { ...authConfig, writeCodeHash: wHash };
      await setDoc(doc(db, QUESTS_COLLECTION, AUTH_DOC_ID), authPayload);
      setAuthConfig(authPayload);
      if (typeof window !== "undefined") localStorage.setItem(CODE_STORAGE_KEY, w);
      setCode(w);
      setCodesPanelOpen(false);
      setNewWrite("");
      setMenuOpen(false);
    } catch {
      setCodesError("Couldn't save the new code. Try again.");
    } finally {
      setCodesSaving(false);
    }
  }, [newWrite, authConfig]);

  // Readers panel: fetch the recent open-events log (owner-only, on demand)
  // and seed the local draft list from whatever's currently saved. Legacy
  // (pre-named-reader) codes never had a plaintext password stored, so
  // they're excluded from drafts — they keep their own Retire action.
  const openReadersPanel = useCallback(async () => {
    setMenuOpen(false);
    setReadersError(null);
    setReadersPanelOpen(true);
    setRevealedReaders({});
    setReaderDrafts(
      (Array.isArray(authConfig?.readers) ? authConfig.readers : []).map((r) => ({
        id: r.id, name: r.name, code: r.code || "", hadPlaintext: !!r.code, removed: false, isNew: false,
      }))
    );
    setReaderSessionsLoading(true);
    try {
      const snap = await getDoc(doc(db, QUESTS_COLLECTION, READER_LOG_DOC_ID));
      setReaderSessions(snap.exists() && Array.isArray(snap.data().sessions) ? snap.data().sessions : []);
    } catch {
      setReaderSessions([]);
    } finally {
      setReaderSessionsLoading(false);
    }
  }, [authConfig]);

  const readersDirty = readerDrafts.some((r) => r.removed || r.isNew || r.dirty);

  // Stages a new reader in the draft list — nothing is written until Save.
  const addReaderDraft = useCallback(() => {
    const name = readerName.trim();
    const pass = sanitizeCode(readerCode);
    if (!name) { setReadersError("Enter a name."); return; }
    if (pass.length < 4) { setReadersError("Password must be at least 4 characters."); return; }
    setReadersError(null);
    setReaderDrafts((prev) => [...prev, { id: uid(), name, code: pass, hadPlaintext: true, removed: false, isNew: true }]);
    setReaderName("");
    setReaderCode("");
  }, [readerName, readerCode]);

  const updateReaderDraft = useCallback((id, patch) => {
    setReaderDrafts((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, dirty: true } : r)));
  }, []);

  // Toggles the pending-delete flag on a draft row — reversible until Save.
  const toggleRemoveReaderDraft = useCallback((id) => {
    setReaderDrafts((prev) => prev.map((r) => (r.id === id ? { ...r, removed: !r.removed } : r)));
  }, []);

  // Commits every staged change (edits, deletes, new readers) in one write.
  const saveReaders = useCallback(async () => {
    setReadersError(null);
    const kept = readerDrafts.filter((r) => !r.removed);
    for (const r of kept) {
      const pass = sanitizeCode(r.code);
      if (!r.name.trim()) { setReadersError("Every reader needs a name."); return; }
      if (pass.length < 4) { setReadersError(`${r.name || "A reader"}'s password must be at least 4 characters.`); return; }
    }
    setReadersSaving(true);
    try {
      const hashed = await Promise.all(
        kept.map(async (r) => ({ id: r.id, name: r.name.trim(), code: sanitizeCode(r.code), codeHash: await sha256Hex(sanitizeCode(r.code)) }))
      );
      const hashes = hashed.map((r) => r.codeHash);
      const dupeAgainstWrite = authConfig?.writeCodeHash && hashes.includes(authConfig.writeCodeHash);
      const dupeAmongReaders = new Set(hashes).size !== hashes.length;
      if (dupeAgainstWrite || dupeAmongReaders) {
        setReadersError("Two readers can't share the same password — pick different ones.");
        setReadersSaving(false);
        return;
      }
      const payload = { ...authConfig, readers: hashed };
      await setDoc(doc(db, QUESTS_COLLECTION, AUTH_DOC_ID), payload);
      setAuthConfig(payload);
      setReaderDrafts(hashed.map((r) => ({ id: r.id, name: r.name, code: r.code, hadPlaintext: true, removed: false, isNew: false })));
    } catch {
      setReadersError("Couldn't save changes. Try again.");
    } finally {
      setReadersSaving(false);
    }
  }, [readerDrafts, authConfig]);

  // Turns off the old shared read code, once every friend has their own
  // named password. readCodeHash: null clears it (normalizeReaders treats
  // a falsy value as absent).
  const retireLegacyCode = useCallback(async () => {
    try {
      const payload = { ...authConfig, readCodeHash: null };
      await setDoc(doc(db, QUESTS_COLLECTION, AUTH_DOC_ID), payload);
      setAuthConfig(payload);
    } catch {}
  }, [authConfig]);

  const update = useCallback((mutator) => {
    if (readOnly) return; // safety net — read-only sessions never write
    setState((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      mutator(next);
      return next;
    });
    setDirty(true);
    setSyncStatus("unsaved");
  }, [readOnly]);

  const saveNow = useCallback(() => {
    if (readOnly || !state) return;
    setSyncStatus("saving");
    if (!SYNC_ENABLED) {
      try {
        if (typeof window !== "undefined") localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
        setDirty(false);
        setSyncStatus("synced");
      } catch {
        setSyncStatus("error");
      }
      return;
    }
    const ref = doc(db, QUESTS_COLLECTION, MAIN_DOC_ID);
    setDoc(ref, state)
      .then(() => {
        setDirty(false);
        setSyncStatus("synced");
      })
      .catch(() => setSyncStatus("error"));
  }, [readOnly, state]);

  const doReset = useCallback(() => {
    if (readOnly) return;
    if (!resetArm) {
      setResetArm(true);
      setTimeout(() => setResetArm(false), 4000);
      return;
    }
    setResetArm(false);
    setMenuOpen(false);
    setResetCodeInput("");
    setResetCodeError(null);
    setResetPanelOpen(true);
  }, [readOnly, resetArm]);

  const confirmReset = useCallback(async () => {
    setResetBusy(true);
    if (!SYNC_ENABLED) {
      const initial = defaultState();
      try {
        if (typeof window !== "undefined") localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(initial));
      } catch {}
      setState(initial);
      setDirty(false);
      setSyncStatus("synced");
      setResetBusy(false);
      setResetPanelOpen(false);
      setResetCodeInput("");
      return;
    }
    if (!authConfig?.writeCodeHash) {
      setResetCodeError("Couldn't verify your write code. Please try again.");
      setResetBusy(false);
      return;
    }
    const h = await sha256Hex(sanitizeCode(resetCodeInput));
    if (h !== authConfig.writeCodeHash) {
      setResetCodeError("Incorrect write code.");
      setResetBusy(false);
      return;
    }
    const initial = defaultState();
    const ref = doc(db, QUESTS_COLLECTION, MAIN_DOC_ID);
    try {
      await setDoc(ref, initial);
    } catch {
      setSyncStatus("error");
    }
    setState(initial);
    setDirty(false);
    setSyncStatus("synced");
    setResetBusy(false);
    setResetPanelOpen(false);
    setResetCodeInput("");
  }, [resetCodeInput, authConfig]);

  const changeCode = useCallback(() => {
    if (typeof window !== "undefined") localStorage.removeItem(CODE_STORAGE_KEY);
    setCode(null);
    setState(null);
    setLoaded(false);
    setDirty(false);
    setMenuOpen(false);
    setReadOnly(false);
    setAuthenticated(false);
  }, []);

  const copyCode = useCallback(() => {
    if (!code) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 1500);
      });
    }
  }, [code]);

  if (!authenticated) {
    return (
      <div className={`theme-${mode}`}>
        <style>{THEME_CSS}</style>
        <CodeGate
          mode={mode}
          onToggleTheme={toggleTheme}
          checking={authConfig === undefined}
          busy={authBusy}
          setupMode={authConfig === null}
          error={authError}
          onSubmitEnter={submitEnter}
          onSubmitSetup={submitSetup}
        />
      </div>
    );
  }

  if (!loaded || !state) {
    return (
      <div className={`theme-${mode}`}>
        <style>{THEME_CSS}</style>
        <div style={{ background: C.surface, color: C.onSurfaceVariant, minHeight: 400, fontFamily: sans }} className="flex items-center justify-center rounded-[28px]">
          <style>{FONT_IMPORT}</style>
          <Loader2 size={20} className="md-spin" style={{ marginRight: 8 }} />
          <span style={{ fontSize: 13 }}>Loading quest…</span>
        </div>
      </div>
    );
  }

  const today = new Date();
  const effVitality = effectiveVitality(state.vitality, today);
  const effResolve = effectiveResolve(state.resolve, state.vitality, today);
  const wScore = wisdomScore(state.wisdom);
  const vScore = vitalityScore(effVitality);
  const weScore = wealthScore(state.wealth);
  const rScore = resolveScore(effResolve);
  const overall = (wScore + vScore + weScore + rScore) / 4;
  // Leave-adjusted state for achievement checks, so unlocks match what
  // the score screens actually show (see achievementState()).
  const achieveState = achievementState(state, effVitality, effResolve);
  const idx = clamp(dayIndex(today), 1, TOTAL_DAYS);
  const currentWeek = clamp(Math.ceil(idx / 7), 1, 13);
  const questLocked = false;

  const todayKey = fmtDate(today);
  const todayDietLog = state.diet?.logs?.[todayKey];
  const todayDietPlan = todayDietLog?.planId ? state.diet.plans.find((p) => p.id === todayDietLog.planId) : null;
  const todayProtein = todayDietPlan
    ? todayDietPlan.items.filter((i) => todayDietLog.completed?.[i.id]).reduce((sum, i) => sum + (Number(i.protein) || 0), 0)
    : 0;
  const todayProteinTarget = todayDietPlan
    ? todayDietPlan.items.reduce((sum, i) => sum + (Number(i.protein) || 0), 0)
    : 0;

  const todayPlannerTasks = state.planner?.days?.[todayKey] || [];
  const todayPlannerRemaining = todayPlannerTasks.filter((t) => !t.completed).length;

  // Rank-tinted theme: the same rank color that colors the name card's
  // badge/glow is also pushed down as the app-wide --accent/--glow, so the
  // whole UI's accent shifts as the player's overall rank climbs.
  const { rank: appRank } = rankInfo(wScore + vScore + weScore + rScore);
  const rankTint = rankColor(appRank, mode);

  const tabs = [
    { id: "dashboard", label: "Home", icon: Home, color: C.accent },
    { id: "wisdom", label: "Wisdom", icon: BookOpen, color: C.wisdom },
    { id: "vitality", label: "Vitality", icon: Dumbbell, color: C.vitality },
    { id: "wealth", label: "Wealth", icon: Coins, color: C.wealth },
    { id: "resolve", label: "Resolve", icon: ShieldCheck, color: C.resolve },
    { id: "achievements", label: "Awards", icon: Trophy, color: C.accent },
    { id: "diet", label: "Diet", icon: Utensils, color: C.accent },
    { id: "planner", label: "Planner", icon: ListTodo, color: C.accent },
    { id: "calendar", label: "Calendar", icon: Calendar, color: C.accent },
  ];
  const activeColor = tabs.find((t) => t.id === tab)?.color || C.accent;

  return (
    <ReadOnlyContext.Provider value={readOnly}>
    <div
      className={`theme-${mode}`}
      style={{ "--accent": rankTint, "--glow": `color-mix(in srgb, ${rankTint} 32%, transparent)` }}
    >
      <style>{THEME_CSS}</style>
      <div
        style={{
          background: C.surface, fontFamily: sans, maxWidth: 420, margin: "0 auto",
          height: "100dvh", borderRadius: 14, overflow: "hidden",
          display: "flex", flexDirection: "column",
          boxShadow: "var(--shell-shadow)",
          border: `1px solid ${C.outlineVariant}`,
          position: "relative",
        }}
      >
        <style>{`
          ${FONT_IMPORT}
          @keyframes md-ripple { to { transform: scale(1); opacity: 0; } }
          @keyframes md-spin { to { transform: rotate(360deg); } }
          .md-spin { animation: md-spin 0.9s linear infinite; }
          ::-webkit-scrollbar { width: 0; height: 0; }
        `}</style>

        <TopAppBar syncStatus={syncStatus} onMenu={() => setMenuOpen((o) => !o)} mode={mode} onToggleTheme={toggleTheme} readOnly={readOnly} />

        {/* overflow menu */}
        {menuOpen && (
          <>
            <div onClick={() => { setMenuOpen(false); setResetArm(false); }} style={{ position: "absolute", inset: 0, zIndex: 10 }} />
            <div
              style={{
                position: "absolute", top: 56, right: 12, zIndex: 20,
                background: C.containerHighest, borderRadius: 16, minWidth: 220,
                border: `1px solid ${C.outlineVariant}`,
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)", overflow: "hidden",
              }}
            >
              {SYNC_ENABLED && (
                <Touchable onClick={copyCode} style={{ display: "block" }}>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <Copy size={16} color={C.onSurfaceVariant} />
                    <span style={{ fontFamily: sans, fontSize: 13.5, color: C.onSurface }}>
                      {codeCopied ? "Copied!" : "Copy secret code"}
                    </span>
                  </div>
                </Touchable>
              )}
              {SYNC_ENABLED && (
                <Touchable onClick={changeCode} style={{ display: "block" }}>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <KeyRound size={16} color={C.onSurfaceVariant} />
                    <span style={{ fontFamily: sans, fontSize: 13.5, color: C.onSurface }}>Sign out</span>
                  </div>
                </Touchable>
              )}
              {SYNC_ENABLED && !readOnly && (
                <Touchable onClick={() => { setMenuOpen(false); setCodesError(null); setNewWrite(""); setCodesPanelOpen(true); }} style={{ display: "block" }}>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <KeyRound size={16} color={C.onSurfaceVariant} />
                    <span style={{ fontFamily: sans, fontSize: 13.5, color: C.onSurface }}>Change write code</span>
                  </div>
                </Touchable>
              )}
              {SYNC_ENABLED && !readOnly && (
                <Touchable onClick={openReadersPanel} style={{ display: "block" }}>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <Users size={16} color={C.onSurfaceVariant} />
                    <span style={{ fontFamily: sans, fontSize: 13.5, color: C.onSurface }}>Readers</span>
                  </div>
                </Touchable>
              )}
              {!readOnly && (
                <Touchable onClick={doReset} rippleColor={`${mix(C.danger, 20)}`} style={{ display: "block" }}>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <RotateCcw size={16} color={resetArm ? C.danger : C.onSurfaceVariant} />
                    <span style={{ fontFamily: sans, fontSize: 13.5, color: resetArm ? C.danger : C.onSurface }}>
                      {resetArm ? "Tap again to confirm" : "Reset all data"}
                    </span>
                  </div>
                </Touchable>
              )}
            </div>
          </>
        )}

        {codesPanelOpen && (
          <>
            <div
              onClick={() => { setCodesPanelOpen(false); setCodesError(null); }}
              style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(0,0,0,0.5)" }}
            />
            <div
              style={{
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                zIndex: 31, width: "calc(100% - 48px)", maxWidth: 340,
                background: C.containerHighest, borderRadius: 18, border: `1px solid ${C.outlineVariant}`,
                boxShadow: "0 12px 32px rgba(0,0,0,0.5)", padding: 20,
              }}
            >
              <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 15.5, color: C.onSurface, marginBottom: 4 }}>
                Change write code
              </div>
              <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 14, lineHeight: 1.4 }}>
                This replaces your write code everywhere. This device switches to the new code automatically. Reader passwords aren't affected — manage those from Readers in the menu.
              </p>
              <label style={{ color: C.faint, fontSize: 10.5, fontFamily: sans, fontWeight: 600 }}>NEW WRITE CODE</label>
              <input
                autoFocus
                value={newWrite}
                onChange={(e) => setNewWrite(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitChangeCodes(); }}
                placeholder="New write code"
                style={{
                  width: "100%", background: C.containerHigh, border: `1px solid ${C.outline}`, color: C.onSurface,
                  fontFamily: mono, fontSize: 13, borderRadius: 12, padding: "10px 12px", margin: "6px 0 12px", outline: "none",
                }}
              />
              {codesError && (
                <p style={{ color: C.danger, fontSize: 11.5, marginBottom: 10 }}>{codesError}</p>
              )}
              <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                <Touchable
                  onClick={() => { setCodesPanelOpen(false); setCodesError(null); }}
                  style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: `1px solid ${C.outline}`, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Cancel</span>
                </Touchable>
                <Touchable
                  onClick={submitChangeCodes}
                  disabled={codesSaving}
                  style={{
                    flex: 1, padding: "10px 0", borderRadius: 12, background: C.accent, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    fontWeight: 700, fontSize: 13, opacity: codesSaving ? 0.7 : 1,
                  }}
                >
                  {codesSaving && <Loader2 size={14} className="md-spin" />}
                  {codesSaving ? "Saving…" : "Save"}
                </Touchable>
              </div>
            </div>
          </>
        )}

        {resetPanelOpen && (
          <>
            <div
              onClick={() => { if (!resetBusy) { setResetPanelOpen(false); setResetCodeError(null); } }}
              style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(0,0,0,0.5)" }}
            />
            <div
              style={{
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                zIndex: 31, width: "calc(100% - 48px)", maxWidth: 340,
                background: C.containerHighest, borderRadius: 18, border: `1px solid ${mix(C.danger, 30)}`,
                boxShadow: "0 12px 32px rgba(0,0,0,0.5)", padding: 20,
              }}
            >
              <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 15.5, color: C.danger, marginBottom: 4 }}>
                Reset all data
              </div>
              <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 14, lineHeight: 1.4 }}>
                This permanently erases all progress and can't be undone. Enter your write code to confirm.
              </p>
              <label style={{ color: C.faint, fontSize: 10.5, fontFamily: sans, fontWeight: 600 }}>WRITE CODE</label>
              <input
                type="password"
                autoFocus
                value={resetCodeInput}
                onChange={(e) => setResetCodeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmReset(); }}
                placeholder="Enter your write code"
                style={{
                  width: "100%", background: C.containerHigh, border: `1px solid ${C.outline}`, color: C.onSurface,
                  fontFamily: mono, fontSize: 13, borderRadius: 12, padding: "10px 12px", margin: "6px 0 12px", outline: "none",
                }}
              />
              {resetCodeError && (
                <p style={{ color: C.danger, fontSize: 11.5, marginBottom: 10 }}>{resetCodeError}</p>
              )}
              <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                <Touchable
                  onClick={() => { if (!resetBusy) { setResetPanelOpen(false); setResetCodeError(null); } }}
                  style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: `1px solid ${C.outline}`, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Cancel</span>
                </Touchable>
                <Touchable
                  onClick={confirmReset}
                  disabled={resetBusy || !resetCodeInput}
                  style={{
                    flex: 1, padding: "10px 0", borderRadius: 12, background: C.danger, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    fontWeight: 700, fontSize: 13, opacity: resetBusy || !resetCodeInput ? 0.6 : 1,
                  }}
                >
                  {resetBusy && <Loader2 size={14} className="md-spin" />}
                  {resetBusy ? "Resetting…" : "Confirm reset"}
                </Touchable>
              </div>
            </div>
          </>
        )}

        {readersPanelOpen && (
          <>
            <div
              onClick={() => { setReadersPanelOpen(false); setReadersError(null); }}
              style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(0,0,0,0.5)" }}
            />
            <div
              style={{
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                zIndex: 31, width: "calc(100% - 48px)", maxWidth: 360, maxHeight: "80%", overflowY: "auto",
                background: C.containerHighest, borderRadius: 18, border: `1px solid ${C.outlineVariant}`,
                boxShadow: "0 12px 32px rgba(0,0,0,0.5)", padding: 20,
              }}
            >
              <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 15.5, color: C.onSurface, marginBottom: 4 }}>
                Readers
              </div>
              <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 16, lineHeight: 1.4 }}>
                Give each friend their own view-only password. They see nothing different — but you'll see who opened your quest and when.
              </p>

              <div className="flex flex-col gap-2" style={{ marginBottom: 16 }}>
                <input
                  value={readerName}
                  onChange={(e) => setReaderName(e.target.value)}
                  placeholder="Friend's name"
                  style={{
                    width: "100%", background: C.containerHigh, border: `1px solid ${C.outline}`, color: C.onSurface,
                    fontFamily: sans, fontSize: 13, borderRadius: 12, padding: "10px 12px", outline: "none",
                  }}
                />
                <input
                  value={readerCode}
                  onChange={(e) => setReaderCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addReaderDraft(); }}
                  placeholder="Their read-only password"
                  style={{
                    width: "100%", background: C.containerHigh, border: `1px solid ${C.outline}`, color: C.onSurface,
                    fontFamily: mono, fontSize: 13, borderRadius: 12, padding: "10px 12px", outline: "none",
                  }}
                />
                {readersError && (
                  <p style={{ color: C.danger, fontSize: 11.5, margin: 0 }}>{readersError}</p>
                )}
                <Touchable
                  onClick={addReaderDraft}
                  style={{
                    padding: "10px 0", borderRadius: 12, border: `1px solid ${C.outline}`, color: C.onSurfaceVariant,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    fontWeight: 700, fontSize: 13,
                  }}
                >
                  <UserPlus size={14} />
                  Add reader
                </Touchable>
              </div>

              <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 11, letterSpacing: 0.4, color: C.faint, marginBottom: 8 }}>
                {readerDrafts.filter((r) => !r.removed).length} READER{readerDrafts.filter((r) => !r.removed).length === 1 ? "" : "S"}
              </div>
              <div className="flex flex-col gap-2" style={{ marginBottom: 10 }}>
                {readerDrafts.length === 0 && (
                  <p style={{ color: C.faint, fontSize: 12.5 }}>No readers yet — add one above.</p>
                )}
                {readerDrafts.map((r) => {
                  const last = (readerSessions || []).filter((s) => s.readerId === r.id).slice(-1)[0];
                  const revealed = !!revealedReaders[r.id];
                  return (
                    <div
                      key={r.id}
                      style={{
                        background: C.containerHigh, border: `1px solid ${r.removed ? C.danger : C.outlineVariant}`,
                        borderRadius: 10, padding: "8px 10px", opacity: r.removed ? 0.5 : 1,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          value={r.name}
                          onChange={(e) => updateReaderDraft(r.id, { name: e.target.value })}
                          disabled={r.removed}
                          placeholder="Name"
                          style={{
                            flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
                            color: C.onSurface, fontFamily: sans, fontSize: 13, fontWeight: 600, padding: "2px 0",
                          }}
                        />
                        <Touchable onClick={() => toggleRemoveReaderDraft(r.id)} style={{ padding: 4 }}>
                          {r.removed ? (
                            <RotateCcw size={14} color={C.onSurfaceVariant} />
                          ) : (
                            <Trash2 size={14} color={C.faint} />
                          )}
                        </Touchable>
                      </div>
                      <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                        <input
                          value={r.hadPlaintext || r.dirty || r.isNew ? r.code : ""}
                          onChange={(e) => updateReaderDraft(r.id, { code: e.target.value })}
                          disabled={r.removed}
                          type={revealed ? "text" : "password"}
                          placeholder={r.hadPlaintext ? "" : "Set a password to reveal it here"}
                          style={{
                            flex: 1, minWidth: 0, background: C.container, border: `1px solid ${C.outlineVariant}`,
                            outline: "none", color: C.onSurface, fontFamily: mono, fontSize: 12.5,
                            borderRadius: 8, padding: "5px 8px",
                          }}
                        />
                        <Touchable
                          onClick={() => setRevealedReaders((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                          style={{ padding: 4 }}
                        >
                          {revealed ? <EyeOff size={14} color={C.faint} /> : <Eye size={14} color={C.faint} />}
                        </Touchable>
                      </div>
                      <span style={{ color: C.faint, fontFamily: mono, fontSize: 10, display: "block", marginTop: 3 }}>
                        {r.removed ? "Marked for removal — tap to undo" : last ? `Active ${timeAgo(last.at)}` : "No activity yet"}
                      </span>
                    </div>
                  );
                })}
                {authConfig?.readCodeHash && (
                  <div
                    style={{ background: C.containerHigh, border: `1px solid ${C.outlineVariant}`, borderRadius: 10, padding: "8px 12px" }}
                    className="flex items-center gap-2"
                  >
                    <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ color: C.onSurface, fontFamily: sans, fontSize: 13, fontWeight: 600 }}>Shared (old code)</span>
                      <span style={{ color: C.faint, fontFamily: mono, fontSize: 10.5 }}>No password on file — legacy code</span>
                    </div>
                    <Touchable onClick={retireLegacyCode} style={{ padding: "4px 8px" }}>
                      <span style={{ color: C.danger, fontFamily: sans, fontSize: 11.5, fontWeight: 600 }}>Retire</span>
                    </Touchable>
                  </div>
                )}
              </div>

              {readersDirty && (
                <Touchable
                  onClick={saveReaders}
                  disabled={readersSaving}
                  style={{
                    width: "100%", padding: "10px 0", borderRadius: 12, background: C.accent, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    fontWeight: 700, fontSize: 13, opacity: readersSaving ? 0.7 : 1, marginBottom: 10,
                  }}
                >
                  {readersSaving ? <Loader2 size={14} className="md-spin" /> : <Save size={14} />}
                  {readersSaving ? "Saving…" : "Save changes"}
                </Touchable>
              )}

              <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                <History size={13} color={C.faint} />
                <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 11, letterSpacing: 0.4, color: C.faint }}>
                  RECENT ACTIVITY
                </span>
              </div>
              <div className="flex flex-col gap-1.5" style={{ marginBottom: 16 }}>
                {readerSessionsLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 size={13} className="md-spin" color={C.faint} />
                    <span style={{ color: C.faint, fontSize: 12 }}>Loading…</span>
                  </div>
                ) : !readerSessions || readerSessions.length === 0 ? (
                  <p style={{ color: C.faint, fontSize: 12.5, margin: 0 }}>No opens logged yet.</p>
                ) : (
                  [...readerSessions].reverse().slice(0, 15).map((s, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span style={{ color: C.onSurfaceVariant, fontFamily: sans, fontSize: 12.5 }}>{s.name}</span>
                      <span style={{ color: C.faint, fontFamily: mono, fontSize: 11 }}>{timeAgo(s.at)}</span>
                    </div>
                  ))
                )}
              </div>

              <Touchable
                onClick={() => { setReadersPanelOpen(false); setReadersError(null); }}
                style={{ width: "100%", padding: "10px 0", borderRadius: 12, border: `1px solid ${C.outline}`, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Close</span>
              </Touchable>
            </div>
          </>
        )}

        <div className="pt-1">
          <LevelCard
            name={state.profile?.name || ""}
            onNameChange={(v) => update((d) => { d.profile.name = v; })}
            overall={overall}
            totalXP={wScore + vScore + weScore + rScore}
            today={today}
            mode={mode}
            status={state.profile?.status || ""}
            statusEnabled={state.profile?.statusEnabled !== false}
            onStatusChange={(v) => update((d) => { d.profile.status = v; })}
            onToggleStatusEnabled={(v) => update((d) => { d.profile.statusEnabled = v; })}
          />
        </div>

        {tab === "dashboard" && (
          <div className="pt-1">
            <div className="grid grid-cols-2 gap-2 mx-4" style={{ marginBottom: 6 }}>
              <DashDuoCard
                icon={Utensils}
                label="Diet"
                metric={
                  todayDietPlan ? (
                    <>
                      {Math.round(todayProtein)}
                      <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.65 }}>/{Math.round(todayProteinTarget)}g</span>
                    </>
                  ) : (
                    "0g"
                  )
                }
                sub="protein"
                onClick={() => setTab("diet")}
                variant="solid"
              />
              <DashDuoCard
                icon={ListTodo}
                label="Planner"
                metric={`${todayPlannerRemaining}`}
                sub="tasks"
                onClick={() => { if (!readOnly) setTab("planner"); }}
                locked={readOnly}
              />
            </div>
          </div>
        )}

        <QuestStrip today={today} />
        <div className="px-4 pb-1 flex items-center justify-between" style={{ flexShrink: 0 }}>
          <span style={{ fontFamily: mono, color: C.faint, fontSize: 11 }}>Day {idx} / 91</span>
          <span style={{ fontFamily: mono, color: C.faint, fontSize: 11 }}>Week {currentWeek}</span>
        </div>

        {/* scrollable content — reset to top on every tab switch, since this
            single container is reused across all tabs and would otherwise
            keep whatever scroll position the previous tab was left at. */}
        <div ref={contentScrollRef} className="flex-1 overflow-y-auto" style={{ position: "relative" }}>
          {tab === "dashboard" && (
            <div className="pb-4">
              <div className="px-4 pt-3">
                <QuestBar state={state} set={update} today={today} />
                <AttrRow icon={BookOpen} label="Wisdom" score={wScore} color={C.wisdom} tagline="Books & strategic thinking" onClick={() => setTab("wisdom")} />
                <AttrRow icon={Dumbbell} label="Vitality" score={vScore} color={C.vitality} tagline="Muay Thai, training, treks" onClick={() => setTab("vitality")} />
                <AttrRow icon={Coins} label="Wealth" score={weScore} color={C.wealth} tagline="Investing & saving" onClick={() => setTab("wealth")} />
                <AttrRow icon={ShieldCheck} label="Resolve" score={rScore} color={C.resolve} tagline="Daily discipline" onClick={() => setTab("resolve")} />
                <Touchable
                  onClick={() => setTab("calendar")}
                  style={{ background: C.container, border: `1px solid ${C.outlineVariant}`, borderRadius: 16, display: "block", marginTop: 4 }}
                >
                  <div className="flex items-center gap-3 pl-4 pr-5 py-3">
                    <Hex size={30} color={C.accent}>
                      <Calendar size={16} color={C.accent} />
                    </Hex>
                    <div className="flex flex-col">
                      <span style={{ color: C.onSurface, fontFamily: sans, fontWeight: 600, fontSize: 12.5 }}>Calendar</span>
                      <span style={{ color: C.faint, fontFamily: sans, fontSize: 10.5 }}>
                        Daily & weekly progress log
                      </span>
                    </div>
                    <ChevronRight size={18} color={C.faint} style={{ marginLeft: "auto" }} />
                  </div>
                </Touchable>
                <Touchable
                  onClick={() => setTab("achievements")}
                  style={{ background: C.container, border: `1px solid ${C.outlineVariant}`, borderRadius: 16, display: "block", marginTop: 8 }}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Hex size={30} color={C.accent}>
                      <Trophy size={17} color={C.accent} />
                    </Hex>
                    <span style={{ color: C.onSurfaceVariant, fontSize: 12.5 }}>
                      <span style={{ color: C.onSurface, fontFamily: mono }}>
                        {ACHIEVEMENTS.filter((a) => a.check(achieveState, overall)).length} / {ACHIEVEMENTS.length}
                      </span>{" "}
                      achievements unlocked
                    </span>
                    <ChevronRight size={16} color={C.faint} style={{ marginLeft: "auto" }} />
                  </div>
                </Touchable>
              </div>
            </div>
          )}
          {tab === "wisdom" && <WisdomTab s={state.wisdom} set={update} />}
          {tab === "vitality" && <VitalityTab s={state.vitality} effective={effVitality} set={update} locked={questLocked} />}
          {tab === "wealth" && <WealthTab s={state.wealth} set={update} locked={questLocked} />}
          {tab === "resolve" && <ResolveTab s={state.resolve} effective={effResolve} set={update} locked={questLocked} wealth={state.wealth} />}
          {tab === "achievements" && <AchievementsTab state={achieveState} overall={overall} />}
          {tab === "diet" && <DietTab s={state.diet} set={update} />}
          {tab === "planner" && (readOnly ? <RestrictedTab label="Planner" /> : <PlannerTab s={state.planner} set={update} />)}
          {tab === "calendar" && <CalendarTab state={state} set={update} />}

          {/* FAB */}
          {!readOnly && (
          <div
            style={{
              position: "sticky", bottom: 16, display: "flex", justifyContent: "flex-end",
              paddingRight: 16, pointerEvents: "none",
            }}
          >
            <Touchable
              onClick={saveNow}
              disabled={!dirty || syncStatus === "saving"}
              style={{
                position: "relative", overflow: "hidden",
                pointerEvents: dirty ? "auto" : "none",
                background: dirty ? `linear-gradient(155deg, ${mix("#fff", 22)}, transparent 60%), ${activeColor}` : C.containerHigh,
                color: dirty ? C.surface : C.faint,
                border: dirty ? `1px solid ${mix("#fff", 30)}` : `1px solid ${C.outlineVariant}`,
                borderRadius: 18,
                padding: dirty ? "13px 22px" : "14px",
                display: "flex", alignItems: "center", gap: 8,
                boxShadow: dirty
                  ? `0 8px 22px ${mix(activeColor, 45)}, inset 0 1px 0 ${mix("#fff", 35)}`
                  : "none",
                opacity: dirty ? 1 : 0,
                transform: dirty ? "scale(1)" : "scale(0.8)",
                transition: "all 0.2s ease",
              }}
            >
              {syncStatus === "saving" ? <Loader2 size={18} className="md-spin" /> : <Save size={18} strokeWidth={2.4} />}
              {dirty && <span style={{ fontFamily: sans, fontWeight: 800, fontSize: 14, letterSpacing: 0.2 }}>Save</span>}
            </Touchable>
          </div>
          )}
        </div>

        <BottomNav tab={tab} setTab={setTab} tabs={tabs.filter((t) => t.id !== "achievements" && t.id !== "diet" && t.id !== "planner" && t.id !== "calendar")} />
      </div>
    </div>
    </ReadOnlyContext.Provider>
  );
}
