import React, { useState, useEffect, useCallback, useRef, useContext, createContext } from "react";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { db, QUESTS_COLLECTION } from "./firebase.js";
import {
  BookOpen, Dumbbell, Coins, ShieldCheck, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Mountain, Check, Minus, Plus, Save, Trophy, Crown, Lock, RotateCcw, Home, MoreVertical,
  CheckCircle2, CloudOff, Loader2, KeyRound, Copy, Sun, Moon, Sparkles, Calendar,
} from "lucide-react";

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
  dark: { E: "#8A93B8", D: "#4ADE80", C: "#4F8EFF", B: "#B388FF", A: "#FF9F45", S: "#FFD54F", SS: "#FF5C7A" },
  light: { E: "#6E7997", D: "#16A34A", C: "#2F6FEF", B: "#7C4FE0", A: "#C05F0F", S: "#A9790A", SS: "#D6284A" },
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
function defaultState() {
  return {
    profile: {
      name: "",
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
      invest: [false, false, false],
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
    },
  };
}

function migrateState(parsed) {
  const base = defaultState();
  const next = { ...base, ...parsed };
  if (!next.profile) next.profile = { name: "" };
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
function savePoints(amt) {
  if (amt >= 15000) return 12;
  return Math.max(0, 12 - Math.floor((15000 - amt) / 1000));
}
const SAVE_ALLOWANCE_POOL = 5; // ₹5,000 total, in units of ₹1,000
function effSave(s, i) {
  return s.save[i] + (s.saveAllowance?.[i] || 0) * 1000;
}
function wealthScore(s) {
  const inv = s.invest.filter(Boolean).length * 20;
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
  return clamp(daily + weekly + bedsheets - deductions, 0, 100);
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
  { id: "v3", attr: "vitality", label: "Iron Will", desc: "Attend every Muay Thai class.", check: (s) => Object.values(s.vitality.muayThai).filter(Boolean).length >= MT_TOTAL },
  { id: "v4", attr: "vitality", label: "Arm Day", desc: "Complete every Arm Training session.", check: (s) => Object.values(s.vitality.armWeeks).every((w) => w.every(Boolean)) },
  { id: "v5", attr: "vitality", label: "Core Strength", desc: "Complete every Ab Training session.", check: (s) => Object.values(s.vitality.abWeeks).every((w) => w.every(Boolean)) },
  { id: "v6", attr: "vitality", label: "Trailblazer", desc: "Complete your first trek.", check: (s) => s.vitality.treks >= 1 },
  { id: "v7", attr: "vitality", label: "Summit Seeker", desc: "Complete all 9 treks.", check: (s) => s.vitality.treks >= 9 },
  { id: "v8", attr: "vitality", label: "Vitality Master", desc: "Reach 100/100 Vitality.", check: (s) => vitalityScore(s.vitality) >= 100 },
  { id: "we1", attr: "wealth", label: "First Investment", desc: "Invest ₹50,000 in a month.", check: (s) => s.wealth.invest.some(Boolean) },
  { id: "we2", attr: "wealth", label: "Investor", desc: "Hit the invest target 3 months running.", check: (s) => s.wealth.invest.every(Boolean) },
  { id: "we3", attr: "wealth", label: "Saver", desc: "Hit the ₹15,000 save target in a month.", check: (s) => s.wealth.save.some((a, i) => effSave(s.wealth, i) >= 15000) },
  { id: "we4", attr: "wealth", label: "Consistency Bonus", desc: "Hit the save target all 3 months.", check: (s) => s.wealth.save.every((a, i) => effSave(s.wealth, i) >= 15000) },
  { id: "we5", attr: "wealth", label: "Wealth Master", desc: "Reach 100/100 Wealth.", check: (s) => wealthScore(s.wealth) >= 100 },
  { id: "r1", attr: "resolve", label: "Perfect Day", desc: "Complete all 4 daily missions in one day.", check: (s) => perfectDaysCount(s.resolve.dailyLogs) >= 1 },
  { id: "r2", attr: "resolve", label: "Steady Streak", desc: "Log 14 perfect days.", check: (s) => perfectDaysCount(s.resolve.dailyLogs) >= 14 },
  { id: "r3", attr: "resolve", label: "Perfect Week", desc: "Laundry and iron done in the same week.", check: (s) => fullWeeksCount(s.resolve.weeklyLogs) >= 1 },
  { id: "r4", attr: "resolve", label: "Fresh Linen", desc: "Change bedsheets all 3 times.", check: (s) => s.resolve.bedsheets >= 3 },
  { id: "r5", attr: "resolve", label: "Disciplined", desc: "Reach 100/100 Resolve.", check: (s) => resolveScore(s.resolve) >= 100 },
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

function Mission({ title, points, earned, children, color, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ position: "relative", background: C.container, borderRadius: 16 }} className="mx-4 mb-3 overflow-hidden">
      <div
        style={{
          position: "absolute", left: 0, top: "22%", bottom: "22%", width: 3, borderRadius: 3,
          background: `linear-gradient(180deg, transparent, ${color}, transparent)`,
          boxShadow: `0 0 8px ${mix(color, 60)}`,
        }}
      />
      <Touchable onClick={() => setOpen((o) => !o)} style={{ display: "block" }}>
        <div className="w-full flex items-center justify-between p-4">
          <span style={{ fontFamily: sans, fontWeight: 500, color: C.onSurface, fontSize: 14.5 }}>{title}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span style={{ fontFamily: mono, color, fontSize: 11.5 }}>
              {earned !== undefined ? `${Math.round(earned * 10) / 10} / ${points} pts` : `${points} pts`}
            </span>
            {open ? <ChevronUp size={16} color={C.onSurfaceVariant} /> : <ChevronDown size={16} color={C.onSurfaceVariant} />}
          </div>
        </div>
      </Touchable>
      {open && <div className="px-4 pb-4">{children}</div>}
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
function MuayThaiGrid({ value, onToggle, color }) {
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
                {dates.map((ds) => (
                  <label key={ds} className="flex items-center gap-0.5">
                    <Check2 checked={!!value[ds]} color={color} onClick={() => onToggle(ds)} />
                    <span style={{ fontFamily: mono, fontSize: 9.5, color: C.faint }}>{shortDay(ds)}</span>
                  </label>
                ))}
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

function VitalityTab({ s, set, locked }) {
  const score = vitalityScore(s);
  return (
    <div className="pb-4">
      <ScreenHeader title="Vitality" sub="Physical strength, endurance and health." color={C.vitality} score={score} />
      <LockWrap locked={locked} color={C.vitality}>
        <Mission title="Muay Thai" points={65} earned={Object.values(s.muayThai).filter(Boolean).length} color={C.vitality}>
          <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 10 }}>
            Weekday classes, 3 Aug – 30 Oct.{" "}
            <span style={{ fontFamily: mono, color: C.vitality }}>
              {Object.values(s.muayThai).filter(Boolean).length} / {MT_TOTAL}
            </span>
          </p>
          <MuayThaiGrid value={s.muayThai} color={C.vitality} onToggle={(ds) => set((d) => { d.vitality.muayThai[ds] = !d.vitality.muayThai[ds]; })} />
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
   WEALTH TAB
--------------------------------------------------------------- */
function WealthTab({ s, set, locked }) {
  const readOnly = useContext(ReadOnlyContext);
  const score = wealthScore(s);
  const months = ["August", "September", "October"];
  return (
    <div className="pb-4">
      <ScreenHeader title="Wealth" sub="Financial discipline through investing and saving." color={C.wealth} score={score} />
      <LockWrap locked={locked} color={C.wealth}>
        <Mission title="Invest — ₹50,000 / month" points={60} earned={s.invest.filter(Boolean).length * 20} color={C.wealth}>
          <div className="flex flex-col">
            {months.map((m, i) => (
              <label key={m} className="flex items-center gap-1">
                <Check2 checked={s.invest[i]} color={C.wealth} onClick={() => set((d) => { d.wealth.invest[i] = !d.wealth.invest[i]; })} />
                <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>{m} (20 pts)</span>
              </label>
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
function ResolveTab({ s, set, locked, wealth }) {
  const score = resolveScore(s);
  const [viewDate, setViewDate] = useState(() => {
    const t = dateOnly(new Date());
    return t >= QUEST_START && t <= QUEST_END ? t : QUEST_START;
  });
  const key = fmtDate(viewDate);
  const log = s.dailyLogs[key] || { wake: false, plan: false, hair: false, teeth: false };
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
  const totalDeduction = allowanceItems.reduce((sum, [k, , allow]) => sum + Math.max(0, s[k] - allow), 0);

  const dailyEarned = Object.values(s.dailyLogs).reduce(
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
            Each occurrence past the allowance costs 1 point.
          </p>
          <div className="flex flex-col gap-3">
            {allowanceItems.map(([k, label, allow]) => {
              const deduction = Math.max(0, s[k] - allow);
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
                    <Counter value={s[k]} max={allow + 20} color={deduction > 0 ? C.danger : C.resolve} onChange={(v) => set((d) => { d.resolve[k] = v; })} />
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${C.outlineVariant}` }}>
              <span style={{ fontFamily: sans, fontWeight: 500, color: C.onSurfaceVariant, fontSize: 12.5 }}>Total deduction</span>
              <span style={{ fontFamily: mono, fontSize: 13.5, color: totalDeduction > 0 ? C.danger : C.faint, fontWeight: 700 }}>
                −{totalDeduction} pt{totalDeduction === 1 ? "" : "s"}
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
      </LockWrap>
    </div>
  );
}

/* ---------------------------------------------------------------
   ACHIEVEMENTS TAB
--------------------------------------------------------------- */
function AchievementsTab({ state, overall }) {
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
   TODAY'S QUESTS — HUD checklist card
--------------------------------------------------------------- */
function TodayQuests({ state, set, today }) {
  const idx = dayIndex(today);
  if (idx < 1 || idx > TOTAL_DAYS) return null;
  const key = fmtDate(today);
  const weekNum = clamp(Math.ceil(idx / 7), 1, 13);
  const weekIdx = weekNum - 1;
  const log = state.resolve.dailyLogs[key] || {};
  const wlog = state.resolve.weeklyLogs[weekNum] || {};
  const wd = today.getDay();
  const isWeekday = wd !== 0 && wd !== 6;
  const mtDone = !!state.vitality.muayThai[key];

  const dailyItems = [
    ["wake", "Wake up by 7:00 AM"],
    ["plan", "Create the day's plan"],
    ["hair", "Hair care routine"],
    ["teeth", "Brush teeth before bed"],
  ].filter(([k]) => !log[k]);

  const weeklyItems = [
    ["laundry", "Laundry"],
    ["iron", "Iron clothes"],
  ].filter(([k]) => !wlog[k]);

  const armSessions = state.vitality.armWeeks[weekIdx] || [];
  const abSessions = state.vitality.abWeeks[weekIdx] || [];
  const armPending = armSessions.map((v, si) => ({ v, si })).filter((x) => !x.v);
  const abPending = abSessions.map((v, si) => ({ v, si })).filter((x) => !x.v);

  const mtPending = isWeekday && MT_DATES.includes(key) && !mtDone;
  const totalPending =
    dailyItems.length + weeklyItems.length + armPending.length + abPending.length + (mtPending ? 1 : 0);

  return (
    <div style={{ background: `linear-gradient(120deg, var(--container-high), var(--container))`, borderRadius: 18, border: `1px solid ${C.outlineVariant}` }} className="mx-4 p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} color={C.accent} />
          <h3 style={{ fontFamily: sans, fontWeight: 700, color: C.onSurface, fontSize: 14.5, letterSpacing: 0.3 }}>TODAY'S QUESTS</h3>
        </div>
        <span style={{ fontFamily: mono, color: C.faint, fontSize: 10.5 }}>Day {idx} · Wk {weekNum}</span>
      </div>
      {totalPending === 0 ? (
        <p style={{ color: C.resolve, fontSize: 13 }}>No quests pending today.</p>
      ) : (
        <div className="flex flex-col">
          {mtPending && (
            <label className="flex items-center gap-1">
              <Check2 checked={false} color={C.vitality} onClick={() => set((d) => { d.vitality.muayThai[key] = true; })} />
              <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Muay Thai class</span>
            </label>
          )}
          {dailyItems.map(([k, label]) => (
            <label key={k} className="flex items-center gap-1">
              <Check2
                checked={false}
                color={C.resolve}
                onClick={() => set((d) => {
                  if (!d.resolve.dailyLogs[key]) d.resolve.dailyLogs[key] = { wake: false, plan: false, hair: false, teeth: false };
                  d.resolve.dailyLogs[key][k] = true;
                })}
              />
              <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>{label}</span>
            </label>
          ))}
          {weeklyItems.map(([k, label]) => (
            <label key={k} className="flex items-center gap-1">
              <Check2
                checked={false}
                color={C.resolve}
                onClick={() => set((d) => {
                  if (!d.resolve.weeklyLogs[weekNum]) d.resolve.weeklyLogs[weekNum] = { laundry: false, iron: false };
                  d.resolve.weeklyLogs[weekNum][k] = true;
                })}
              />
              <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>
                {label} <span style={{ color: C.faint, fontSize: 11 }}>(this week)</span>
              </span>
            </label>
          ))}
          {armPending.map(({ si }) => (
            <label key={`arm-${si}`} className="flex items-center gap-1">
              <Check2
                checked={false}
                color={C.vitality}
                onClick={() => set((d) => { d.vitality.armWeeks[weekIdx][si] = true; })}
              />
              <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>
                Arm Training <span style={{ color: C.faint, fontSize: 11 }}>(this week)</span>
              </span>
            </label>
          ))}
          {abPending.map(({ si }) => (
            <label key={`ab-${si}`} className="flex items-center gap-1">
              <Check2
                checked={false}
                color={C.vitality}
                onClick={() => set((d) => { d.vitality.abWeeks[weekIdx][si] = true; })}
              />
              <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>
                Ab Training <span style={{ color: C.faint, fontSize: 11 }}>(this week)</span>
              </span>
            </label>
          ))}
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
  const [readVal, setReadVal] = useState("");
  const [localError, setLocalError] = useState(null);

  const submitEnter = () => {
    const clean = sanitizeCode(value);
    if (clean.length < 4) { setLocalError("Code must be at least 4 characters."); return; }
    setLocalError(null);
    onSubmitEnter(clean);
  };

  const submitSetup = () => {
    const w = sanitizeCode(writeVal);
    const r = sanitizeCode(readVal);
    if (w.length < 4 || r.length < 4) { setLocalError("Both codes must be at least 4 characters."); return; }
    if (w.toLowerCase() === r.toLowerCase()) { setLocalError("Write and read codes must be different."); return; }
    setLocalError(null);
    onSubmitSetup(w, r);
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
            This is a one-time setup. Choose a write code (full access, for you) and a read code (view-only, for anyone you share it with). You can change both later.
          </p>
          <div style={{ width: "100%", marginBottom: 12 }}>
            <label style={{ color: C.faint, fontSize: 11, fontFamily: sans, fontWeight: 600 }}>WRITE CODE (yours)</label>
            <input
              autoFocus
              value={writeVal}
              onChange={(e) => setWriteVal(e.target.value)}
              placeholder="e.g. arjun-quest-9f3k2"
              style={{
                width: "100%", background: C.containerHigh, border: `1px solid ${C.outline}`, color: C.onSurface,
                fontFamily: mono, fontSize: 14, borderRadius: 14, padding: "13px 16px", marginTop: 6, outline: "none",
              }}
            />
          </div>
          <div style={{ width: "100%", marginBottom: 16 }}>
            <label style={{ color: C.faint, fontSize: 11, fontFamily: sans, fontWeight: 600 }}>READ CODE (share this)</label>
            <input
              value={readVal}
              onChange={(e) => setReadVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitSetup(); }}
              placeholder="e.g. family-view-7h2p"
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
              fontSize: rank.length > 1 ? 34 : 40,
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
          <span style={{ fontFamily: mono, fontSize: 9, color: C.faint, letterSpacing: 1, display: "block", marginBottom: 6 }}>ALL RANKS</span>
          <div className="flex flex-col gap-1.5">
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

function LevelCard({ name, onNameChange, overall, totalXP, today, mode }) {
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
      className="mx-4 mb-1"
      style={{
        position: "relative",
        background: `linear-gradient(160deg, var(--container-high) 0%, var(--container) 65%)`,
        border: `1px solid ${mix(rc, 25)}`,
        borderRadius: 20,
        boxShadow: `inset 0 1px 0 ${mix(rc, 13)}, 0 1px 0 ${C.outlineVariant}`,
        transition: "border-color 0.3s ease, box-shadow 0.3s ease",
      }}
    >
      {/* decorative accents live in their own clipped layer so the rank
          popover (a sibling below) can overflow the card without being cut off */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 20, pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${rc}, transparent)`, opacity: 0.7 }} />
        <div style={{ position: "absolute", top: -50, right: -40, width: 160, height: 160, borderRadius: "50%", background: `radial-gradient(circle, ${mix(rc, 20)}, transparent 72%)` }} />
      </div>
      <div className="flex items-end gap-3" style={{ position: "relative", padding: 16 }}>
        <div className="flex-1 min-w-0">
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

          <div className="flex items-end gap-3" style={{ marginTop: 8 }}>
            <RankBadge rank={rank} color={rc} xp={xp} bandFrom={bandFrom} bandTo={bandTo} mode={mode} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <Calendar size={11} color={C.onSurfaceVariant} />
                <span style={{ fontFamily: mono, fontSize: 11, color: C.onSurfaceVariant }}>{dateStr}</span>
              </div>
              <div style={{ height: 5, background: C.outlineVariant, borderRadius: 3, marginTop: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progress * 100}%`, background: rc, boxShadow: `0 0 6px ${mix(rc, 60)}`, borderRadius: 3, transition: "width 0.4s ease, background 0.3s ease" }} />
              </div>
              <span style={{ fontFamily: mono, fontSize: 9.5, color: C.faint }}>
                {rank === "SS" ? "Top rank reached" : `${Math.round(totalXP - bandFrom)}/${bandTo - bandFrom} XP to next rank`}
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
  const statusIcon =
    syncStatus === "saving" ? <Loader2 size={16} color={C.onSurfaceVariant} className="md-spin" /> :
    syncStatus === "error" ? <CloudOff size={16} color={C.danger} /> :
    syncStatus === "unsaved" ? <CloudOff size={16} color={C.wealth} /> :
    <CheckCircle2 size={16} color={C.resolve} />;
  const statusLabel =
    syncStatus === "saving" ? "Syncing" : syncStatus === "error" ? "Sync failed" : syncStatus === "unsaved" ? "Unsaved" : "Synced";
  return (
    <div className="flex items-center justify-between px-3" style={{ height: 60, flexShrink: 0 }}>
      <div className="flex items-center gap-1.5 pl-1.5">
        <div style={{ fontFamily: sans, fontWeight: 900, color: C.onSurface, fontSize: 16, letterSpacing: 0.5 }}>+ ULTRA</div>
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
        {!readOnly && (
          <div className="flex items-center gap-1">
            {statusIcon}
            <span style={{ fontFamily: mono, fontSize: 10.5, color: C.onSurfaceVariant }}>{statusLabel}</span>
          </div>
        )}
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
          height: NAV_H - 12, borderRadius: 22,
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
                    padding: "3px 16px", borderRadius: 14,
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
  const [dirty, setDirty] = useState(false);
  const [syncStatus, setSyncStatus] = useState("synced");
  const [resetArm, setResetArm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [readOnly, setReadOnly] = useState(false);

  // authConfig: undefined = still checking, null = no profile exists yet,
  // object { writeCodeHash, readCodeHash } = the one and only profile.
  const [authConfig, setAuthConfig] = useState(undefined);
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);

  // "Change access codes" panel, owner-only.
  const [codesPanelOpen, setCodesPanelOpen] = useState(false);
  const [newWrite, setNewWrite] = useState("");
  const [newRead, setNewRead] = useState("");
  const [codesError, setCodesError] = useState(null);
  const [codesSaving, setCodesSaving] = useState(false);

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
      } else if (h === authConfig.readCodeHash) {
        setReadOnly(true);
        setAuthenticated(true);
        setAuthError(null);
      } else {
        if (typeof window !== "undefined") localStorage.removeItem(CODE_STORAGE_KEY);
        setCode(null);
        setAuthenticated(false);
        setAuthError("That code is no longer valid. Please enter your current code.");
      }
      setAuthBusy(false);
    })();
    return () => { cancelled = true; };
  }, [code, authConfig]);

  // Subscribe to the single quest document once this device is authenticated.
  useEffect(() => {
    if (!authenticated) return;
    setLoaded(false);
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

  const submitSetup = useCallback(async (writeCode, readCode) => {
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
      const [wHash, rHash] = await Promise.all([sha256Hex(writeCode), sha256Hex(readCode)]);
      const authPayload = { writeCodeHash: wHash, readCodeHash: rHash };
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
    const r = sanitizeCode(newRead);
    if (w.length < 4 || r.length < 4) { setCodesError("Both codes must be at least 4 characters."); return; }
    if (w.toLowerCase() === r.toLowerCase()) { setCodesError("Write and read codes must be different."); return; }
    setCodesSaving(true);
    setCodesError(null);
    try {
      const [wHash, rHash] = await Promise.all([sha256Hex(w), sha256Hex(r)]);
      const authPayload = { writeCodeHash: wHash, readCodeHash: rHash };
      await setDoc(doc(db, QUESTS_COLLECTION, AUTH_DOC_ID), authPayload);
      setAuthConfig(authPayload);
      if (typeof window !== "undefined") localStorage.setItem(CODE_STORAGE_KEY, w);
      setCode(w);
      setCodesPanelOpen(false);
      setNewWrite("");
      setNewRead("");
      setMenuOpen(false);
    } catch {
      setCodesError("Couldn't save the new codes. Try again.");
    } finally {
      setCodesSaving(false);
    }
  }, [newWrite, newRead]);

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
    const initial = defaultState();
    const ref = doc(db, QUESTS_COLLECTION, MAIN_DOC_ID);
    setDoc(ref, initial).catch(() => setSyncStatus("error"));
    setState(initial);
    setDirty(false);
    setSyncStatus("synced");
    setResetArm(false);
    setMenuOpen(false);
  }, [readOnly, resetArm]);

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
  const wScore = wisdomScore(state.wisdom);
  const vScore = vitalityScore(state.vitality);
  const weScore = wealthScore(state.wealth);
  const rScore = resolveScore(state.resolve);
  const overall = (wScore + vScore + weScore + rScore) / 4;
  const idx = clamp(dayIndex(today), 1, TOTAL_DAYS);
  const currentWeek = clamp(Math.ceil(idx / 7), 1, 13);
  const questLocked = false;

  const tabs = [
    { id: "dashboard", label: "Home", icon: Home, color: C.accent },
    { id: "wisdom", label: "Wisdom", icon: BookOpen, color: C.wisdom },
    { id: "vitality", label: "Vitality", icon: Dumbbell, color: C.vitality },
    { id: "wealth", label: "Wealth", icon: Coins, color: C.wealth },
    { id: "resolve", label: "Resolve", icon: ShieldCheck, color: C.resolve },
    { id: "achievements", label: "Awards", icon: Trophy, color: C.wisdom },
  ];
  const activeColor = tabs.find((t) => t.id === tab)?.color || C.accent;

  return (
    <ReadOnlyContext.Provider value={readOnly}>
    <div className={`theme-${mode}`}>
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
              <Touchable onClick={copyCode} style={{ display: "block" }}>
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <Copy size={16} color={C.onSurfaceVariant} />
                  <span style={{ fontFamily: sans, fontSize: 13.5, color: C.onSurface }}>
                    {codeCopied ? "Copied!" : "Copy secret code"}
                  </span>
                </div>
              </Touchable>
              <Touchable onClick={changeCode} style={{ display: "block" }}>
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <KeyRound size={16} color={C.onSurfaceVariant} />
                  <span style={{ fontFamily: sans, fontSize: 13.5, color: C.onSurface }}>Sign out</span>
                </div>
              </Touchable>
              {!readOnly && (
                <Touchable onClick={() => { setMenuOpen(false); setCodesError(null); setCodesPanelOpen(true); }} style={{ display: "block" }}>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <KeyRound size={16} color={C.onSurfaceVariant} />
                    <span style={{ fontFamily: sans, fontSize: 13.5, color: C.onSurface }}>Change access codes</span>
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
                Change access codes
              </div>
              <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 14, lineHeight: 1.4 }}>
                This replaces both codes everywhere, including on devices already signed in. This device switches to the new write code automatically.
              </p>
              <label style={{ color: C.faint, fontSize: 10.5, fontFamily: sans, fontWeight: 600 }}>NEW WRITE CODE</label>
              <input
                value={newWrite}
                onChange={(e) => setNewWrite(e.target.value)}
                placeholder="New write code"
                style={{
                  width: "100%", background: C.containerHigh, border: `1px solid ${C.outline}`, color: C.onSurface,
                  fontFamily: mono, fontSize: 13, borderRadius: 12, padding: "10px 12px", margin: "6px 0 12px", outline: "none",
                }}
              />
              <label style={{ color: C.faint, fontSize: 10.5, fontFamily: sans, fontWeight: 600 }}>NEW READ CODE</label>
              <input
                value={newRead}
                onChange={(e) => setNewRead(e.target.value)}
                placeholder="New read code"
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

        <div className="px-1 pt-1">
          <LevelCard
            name={state.profile?.name || ""}
            onNameChange={(v) => update((d) => { d.profile.name = v; })}
            overall={overall}
            totalXP={wScore + vScore + weScore + rScore}
            today={today}
            mode={mode}
          />
        </div>

        <QuestStrip today={today} />
        <div className="px-4 pb-1 flex items-center justify-between" style={{ flexShrink: 0 }}>
          <span style={{ fontFamily: mono, color: C.faint, fontSize: 11 }}>Day {idx} / 91</span>
          <span style={{ fontFamily: mono, color: C.faint, fontSize: 11 }}>Week {currentWeek}</span>
        </div>

        {/* scrollable content */}
        <div className="flex-1 overflow-y-auto" style={{ position: "relative" }}>
          {tab === "dashboard" && (
            <div className="pb-4">
              <div className="px-4 pt-3">
                <Touchable
                  onClick={() => setTab("achievements")}
                  style={{ background: C.container, border: `1px solid ${C.outlineVariant}`, borderRadius: 16, display: "block", marginBottom: 14 }}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Hex size={30} color={C.accent}>
                      <Trophy size={17} color={C.accent} />
                    </Hex>
                    <span style={{ color: C.onSurfaceVariant, fontSize: 12.5 }}>
                      <span style={{ color: C.onSurface, fontFamily: mono }}>
                        {ACHIEVEMENTS.filter((a) => a.check(state, overall)).length} / {ACHIEVEMENTS.length}
                      </span>{" "}
                      achievements unlocked
                    </span>
                    <ChevronRight size={16} color={C.faint} style={{ marginLeft: "auto" }} />
                  </div>
                </Touchable>
                <AttrRow icon={BookOpen} label="Wisdom" score={wScore} color={C.wisdom} tagline="Books & strategic thinking" onClick={() => setTab("wisdom")} />
                <AttrRow icon={Dumbbell} label="Vitality" score={vScore} color={C.vitality} tagline="Muay Thai, training, treks" onClick={() => setTab("vitality")} />
                <AttrRow icon={Coins} label="Wealth" score={weScore} color={C.wealth} tagline="Investing & saving" onClick={() => setTab("wealth")} />
                <AttrRow icon={ShieldCheck} label="Resolve" score={rScore} color={C.resolve} tagline="Daily discipline" onClick={() => setTab("resolve")} />
              </div>
              <TodayQuests state={state} set={update} today={today} />
            </div>
          )}
          {tab === "wisdom" && <WisdomTab s={state.wisdom} set={update} />}
          {tab === "vitality" && <VitalityTab s={state.vitality} set={update} locked={questLocked} />}
          {tab === "wealth" && <WealthTab s={state.wealth} set={update} locked={questLocked} />}
          {tab === "resolve" && <ResolveTab s={state.resolve} set={update} locked={questLocked} wealth={state.wealth} />}
          {tab === "achievements" && <AchievementsTab state={state} overall={overall} />}

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

        <BottomNav tab={tab} setTab={setTab} tabs={tabs} />
      </div>
    </div>
    </ReadOnlyContext.Provider>
  );
}
