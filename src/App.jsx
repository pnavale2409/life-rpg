import React, { useState, useEffect, useCallback, useRef } from "react";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { db, QUESTS_COLLECTION } from "./firebase.js";
import {
  BookOpen, Dumbbell, Coins, ShieldCheck, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Mountain, Check, Minus, Plus, Save, Trophy, Crown, Lock, Unlock, RotateCcw, Home, MoreVertical,
  CheckCircle2, CloudOff, Loader2, KeyRound, Copy,
} from "lucide-react";

/* ---------------------------------------------------------------
   MATERIAL 3 (DARK) TOKENS — tonal surface staircase + brand accents
--------------------------------------------------------------- */
const C = {
  surface: "#121317",
  surfaceLow: "#17181D",
  container: "#1C1E24",
  containerHigh: "#24262E",
  containerHighest: "#2C2F39",
  outline: "#383B45",
  outlineVariant: "#282A32",
  onSurface: "#E5E4E9",
  onSurfaceVariant: "#9B9CA8",
  faint: "#6C6D78",
  danger: "#F2B8B5",
  dangerContainer: "#4A2325",
  wisdom: "#9C8CFF",
  vitality: "#FF8A66",
  wealth: "#F0C15C",
  resolve: "#4FD8C4",
};
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
function wealthScore(s) {
  const inv = s.invest.filter(Boolean).length * 20;
  const sav = s.save.reduce((sum, a) => sum + savePoints(a), 0);
  const bonus = s.save.every((a) => a >= 15000) ? 4 : 0;
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
  { id: "we3", attr: "wealth", label: "Saver", desc: "Hit the ₹15,000 save target in a month.", check: (s) => s.wealth.save.some((a) => a >= 15000) },
  { id: "we4", attr: "wealth", label: "Consistency Bonus", desc: "Hit the save target all 3 months.", check: (s) => s.wealth.save.every((a) => a >= 15000) },
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
function Touchable({ children, onClick, style, className, disabled, rippleColor = "rgba(255,255,255,0.25)" }) {
  const ref = useRef(null);
  const fire = (e) => {
    if (disabled) return;
    const el = ref.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.6;
      const span = document.createElement("span");
      span.style.position = "absolute";
      span.style.borderRadius = "50%";
      span.style.background = rippleColor;
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
      style={{ position: "relative", overflow: "hidden", cursor: disabled ? "default" : "pointer", ...style }}
      className={className}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------
   SMALL UI PRIMITIVES
--------------------------------------------------------------- */
function Ring({ value, max, color, size = 52, stroke = 5, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = clamp(value / max, 0, 1);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
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

function Check2({ checked, onClick, color }) {
  return (
    <Touchable onClick={onClick} rippleColor={`${color}33`} style={{ borderRadius: "50%", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
  return (
    <div className="flex items-center gap-1">
      <Touchable onClick={() => onChange(clamp(value - 1, 0, max))} style={{ color: C.onSurfaceVariant, border: `1px solid ${C.outline}`, width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }} rippleColor="rgba(255,255,255,0.15)">
        <Minus size={14} />
      </Touchable>
      <span style={{ fontFamily: mono, color: C.onSurface, minWidth: 52, textAlign: "center", fontSize: 14 }}>
        {value} / {max}
      </span>
      <Touchable onClick={() => onChange(clamp(value + 1, 0, max))} style={{ color, border: `1px solid ${color}`, width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }} rippleColor={`${color}33`}>
        <Plus size={14} />
      </Touchable>
    </div>
  );
}

/* ---------------------------------------------------------------
   QUEST STRIP — horizontal scroll of week dots, Material stepper feel
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
              className="flex flex-col items-center gap-1.5 flex-shrink-0 rounded-2xl"
              style={{
                padding: "6px 8px",
                background: isCurrent ? `${C.wealth}1F` : "transparent",
              }}
            >
              <div className="flex gap-[3px]">
                {week.map((n) => {
                  const state = n < idx ? "past" : n === idx ? "now" : "future";
                  return (
                    <div
                      key={n}
                      style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: state === "past" ? C.resolve : state === "now" ? C.wealth : C.outlineVariant,
                        boxShadow: state === "now" ? `0 0 5px ${C.wealth}` : "none",
                      }}
                    />
                  );
                })}
              </div>
              <span style={{ fontFamily: mono, fontSize: 9.5, color: isCurrent ? C.wealth : C.faint }}>W{wi + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   ATTRIBUTE ROW — Material list item, full-width, stacked vertically
--------------------------------------------------------------- */
function AttrRow({ icon: Icon, label, score, color, onClick, tagline }) {
  return (
    <Touchable onClick={onClick} rippleColor={`${color}22`} style={{ background: C.container, borderRadius: 20, display: "block", marginBottom: 10 }}>
      <div className="flex items-center gap-4 p-4">
        <div style={{ width: 44, height: 44, borderRadius: 14, background: `${color}26`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={20} color={color} />
        </div>
        <div className="flex-1 min-w-0">
          <div style={{ fontFamily: sans, fontWeight: 500, color: C.onSurface, fontSize: 15.5 }}>{label}</div>
          <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginTop: 1 }}>{tagline}</p>
        </div>
        <Ring value={score} max={100} color={color} size={44} stroke={4}>
          <span style={{ fontFamily: mono, fontSize: 11, color: C.onSurface }}>{Math.round(score)}</span>
        </Ring>
        <ChevronRight size={18} color={C.faint} />
      </div>
    </Touchable>
  );
}

/* ---------------------------------------------------------------
   SECTION HEADER — compact Material list-section style
--------------------------------------------------------------- */
function ScreenHeader({ title, sub, color, score }) {
  return (
    <div className="px-4 pt-5 pb-4 flex items-center justify-between">
      <div>
        <div style={{ fontFamily: sans, fontWeight: 700, color: C.onSurface, fontSize: 22 }}>{title}</div>
        <p style={{ color: C.onSurfaceVariant, fontSize: 12.5, marginTop: 2 }}>{sub}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <div style={{ fontFamily: mono, color, fontSize: 20, fontWeight: 700 }}>{score.toFixed(1)}</div>
        <div style={{ fontFamily: mono, color: C.faint, fontSize: 10.5 }}>/ 100</div>
      </div>
    </div>
  );
}

function Mission({ title, points, children, color, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: C.container, borderRadius: 18 }} className="mx-4 mb-3 overflow-hidden">
      <Touchable onClick={() => setOpen((o) => !o)} rippleColor="rgba(255,255,255,0.06)" style={{ display: "block" }}>
        <div className="w-full flex items-center justify-between p-4">
          <span style={{ fontFamily: sans, fontWeight: 500, color: C.onSurface, fontSize: 14.5 }}>{title}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span style={{ fontFamily: mono, color, fontSize: 11.5 }}>{points} pts</span>
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
      <Mission title="The 48 Laws of Power" points={50} color={C.wisdom}>
        <div className="grid grid-cols-6 gap-2 mb-3">
          {s.laws.map((v, i) => (
            <Touchable
              key={i}
              onClick={() => set((d) => { d.wisdom.laws[i] = !d.wisdom.laws[i]; })}
              rippleColor={`${C.wisdom}33`}
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
      <Mission title="Rich Dad Poor Dad" points={30} color={C.wisdom}>
        <div className="flex flex-col">
          {s.rdpd.map((v, i) => (
            <label key={i} className="flex items-center gap-1">
              <Check2 checked={v} color={C.wisdom} onClick={() => set((d) => { d.wisdom.rdpd[i] = !d.wisdom.rdpd[i]; })} />
              <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>Chapter {i + 1}</span>
            </label>
          ))}
        </div>
      </Mission>
      <Mission title="The Alchemist" points={20} color={C.wisdom}>
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
            <Touchable onClick={() => toggleWeek(wi)} rippleColor="rgba(255,255,255,0.06)" style={{ display: "block" }}>
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
      <div style={{ background: C.container, borderLeft: `4px solid ${color}` }} className="rounded-2xl p-4 mx-4 mb-3 flex items-center gap-3">
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
        <Mission title="Muay Thai" points={65} color={C.vitality}>
          <p style={{ color: C.onSurfaceVariant, fontSize: 12, marginBottom: 10 }}>
            Weekday classes, 3 Aug – 30 Oct.{" "}
            <span style={{ fontFamily: mono, color: C.vitality }}>
              {Object.values(s.muayThai).filter(Boolean).length} / {MT_TOTAL}
            </span>
          </p>
          <MuayThaiGrid value={s.muayThai} color={C.vitality} onToggle={(ds) => set((d) => { d.vitality.muayThai[ds] = !d.vitality.muayThai[ds]; })} />
        </Mission>
        <Mission title="Arm Training" points={13} color={C.vitality}>
          <WeekSessionGrid weeks={s.armWeeks} color={C.vitality} onToggle={(wi, si) => set((d) => { d.vitality.armWeeks[wi][si] = !d.vitality.armWeeks[wi][si]; })} />
        </Mission>
        <Mission title="Ab Training" points={13} color={C.vitality}>
          <WeekSessionGrid weeks={s.abWeeks} color={C.vitality} onToggle={(wi, si) => set((d) => { d.vitality.abWeeks[wi][si] = !d.vitality.abWeeks[wi][si]; })} />
        </Mission>
        <Mission title="Treks" points={9} color={C.vitality}>
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
  const score = wealthScore(s);
  const months = ["August", "September", "October"];
  return (
    <div className="pb-4">
      <ScreenHeader title="Wealth" sub="Financial discipline through investing and saving." color={C.wealth} score={score} />
      <LockWrap locked={locked} color={C.wealth}>
        <Mission title="Invest — ₹50,000 / month" points={60} color={C.wealth}>
          <div className="flex flex-col">
            {months.map((m, i) => (
              <label key={m} className="flex items-center gap-1">
                <Check2 checked={s.invest[i]} color={C.wealth} onClick={() => set((d) => { d.wealth.invest[i] = !d.wealth.invest[i]; })} />
                <span style={{ color: C.onSurfaceVariant, fontSize: 13 }}>{m} (20 pts)</span>
              </label>
            ))}
          </div>
        </Mission>
        <Mission title="Save — ₹15,000 / month" points={40} color={C.wealth}>
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
                  onChange={(e) => {
                    const v = clamp(Number(e.target.value) || 0, 0, 15000);
                    set((d) => { d.wealth.save[i] = v; });
                  }}
                  style={{
                    background: C.containerHigh, border: "none", color: C.onSurface,
                    fontFamily: mono, fontSize: 13, borderRadius: 10, padding: "8px 10px", width: 96,
                  }}
                />
                <span style={{ fontFamily: mono, fontSize: 12, color: C.wealth }}>{savePoints(s.save[i])} pts</span>
              </div>
            ))}
            <span style={{ fontFamily: mono, fontSize: 11.5, color: s.save.every((a) => a >= 15000) ? C.wealth : C.faint }}>
              Consistency bonus: {s.save.every((a) => a >= 15000) ? "+4 earned" : "0 / 4"}
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
function ResolveTab({ s, set, locked }) {
  const score = resolveScore(s);
  const [viewDate, setViewDate] = useState(() => {
    const t = new Date();
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
    if (nd >= QUEST_START && nd <= QUEST_END) setViewDate(nd);
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

  return (
    <div className="pb-4">
      <ScreenHeader title="Resolve" sub="Consistency, discipline and self-control." color={C.resolve} score={score} />
      <LockWrap locked={locked} color={C.resolve}>
        <Mission title="Daily Missions" points={72.8} color={C.resolve} defaultOpen>
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

        <Mission title="Weekly Missions" points={26} color={C.resolve}>
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

        <Mission title="Bedsheets" points={1.2} color={C.resolve}>
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
    { key: "overall", label: "Overall", color: C.onSurface },
  ];
  return (
    <div className="pb-4">
      <ScreenHeader
        title="Achievements"
        sub={`${unlockedIds.size} of ${ACHIEVEMENTS.length} unlocked`}
        color={C.wealth}
        score={(unlockedIds.size / ACHIEVEMENTS.length) * 100}
      />
      {groups.map((g) => {
        const items = ACHIEVEMENTS.filter((a) => a.attr === g.key);
        return (
          <div key={g.key} className="mb-2">
            <h3 style={{ fontFamily: sans, fontWeight: 500, color: g.color, fontSize: 13, margin: "4px 20px 8px" }}>{g.label}</h3>
            <div className="px-4 flex flex-col gap-2 mb-3">
              {items.map((a) => {
                const unlocked = unlockedIds.has(a.id);
                const Icon = unlocked ? (a.id.startsWith("o") ? Crown : Trophy) : Lock;
                return (
                  <div
                    key={a.id}
                    style={{ background: unlocked ? C.container : C.surfaceLow, opacity: unlocked ? 1 : 0.55, borderRadius: 16 }}
                    className="p-3.5 flex items-center gap-3"
                  >
                    <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: unlocked ? g.color : C.containerHigh, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon size={15} color={unlocked ? C.surface : C.faint} />
                    </div>
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
   TODAY'S QUESTS — Material checklist card
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
    <div style={{ background: C.container, borderRadius: 20 }} className="mx-4 p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 style={{ fontFamily: sans, fontWeight: 500, color: C.onSurface, fontSize: 15.5 }}>Today's Quests</h3>
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
   SECRET CODE GATE — shown before any data loads
--------------------------------------------------------------- */
function CodeGate({ onSubmit }) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState("enter"); // "enter" | "create"

  const submit = () => {
    const clean = sanitizeCode(value);
    if (clean.length < 4) return;
    onSubmit(clean);
  };

  return (
    <div
      style={{
        background: C.surface, fontFamily: sans, maxWidth: 420, margin: "0 auto",
        height: 780, borderRadius: 14, overflow: "hidden",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        boxShadow: "0 12px 32px rgba(0,0,0,0.45)", border: `1px solid ${C.outlineVariant}`,
        padding: 32,
      }}
    >
      <style>{FONT_IMPORT}</style>
      <div style={{ width: 56, height: 56, borderRadius: 18, background: `${C.wealth}26`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
        <KeyRound size={24} color={C.wealth} />
      </div>
      <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 20, color: C.onSurface, marginBottom: 6, textAlign: "center" }}>
        {mode === "enter" ? "Enter your secret code" : "Choose a secret code"}
      </div>
      <p style={{ color: C.onSurfaceVariant, fontSize: 13, textAlign: "center", marginBottom: 22, lineHeight: 1.5 }}>
        {mode === "enter"
          ? "Type the code you use on your other device to load your quest data."
          : "Pick a long, unguessable code — this is what protects your data. Enter the same code on any device to sync."}
      </p>
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder="e.g. arjun-quest-9f3k2"
        style={{
          width: "100%", background: C.containerHigh, border: `1px solid ${C.outline}`, color: C.onSurface,
          fontFamily: mono, fontSize: 14, borderRadius: 14, padding: "13px 16px", marginBottom: 16, outline: "none",
        }}
      />
      <Touchable
        onClick={submit}
        rippleColor="rgba(0,0,0,0.15)"
        style={{
          width: "100%", background: C.wealth, color: C.surface, borderRadius: 16, padding: "13px 0",
          display: "flex", alignItems: "center", justifyContent: "center", fontFamily: sans, fontWeight: 700, fontSize: 14.5,
        }}
      >
        Continue
      </Touchable>
      <Touchable
        onClick={() => setMode((m) => (m === "enter" ? "create" : "enter"))}
        rippleColor="rgba(255,255,255,0.08)"
        style={{ marginTop: 16, padding: "6px 10px", borderRadius: 10 }}
      >
        <span style={{ color: C.onSurfaceVariant, fontSize: 12.5 }}>
          {mode === "enter" ? "First time? Create a new code" : "Already have a code? Enter it"}
        </span>
      </Touchable>
    </div>
  );
}

/* ---------------------------------------------------------------
   TOP APP BAR
--------------------------------------------------------------- */
function ProfileHeader({ name, onNameChange, overall, today, testMode, onToggleTest }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  const commit = () => {
    setEditing(false);
    onNameChange(draft.trim());
  };

  const dateStr = today.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="flex items-center gap-3 px-4 pt-1 pb-3" style={{ flexShrink: 0 }}>
      <Ring value={overall} max={100} color={C.wealth} size={62} stroke={5}>
        <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: C.onSurface }}>{Math.round(overall)}</span>
      </Ring>
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
            placeholder="Your name"
            style={{
              fontFamily: sans, fontWeight: 700, fontSize: 17, color: C.onSurface,
              background: "transparent", border: "none", borderBottom: `1px solid ${C.outline}`,
              outline: "none", width: "100%", padding: "2px 0",
            }}
          />
        ) : (
          <Touchable onClick={() => setEditing(true)} rippleColor="rgba(255,255,255,0.08)" style={{ display: "inline-block", borderRadius: 8 }}>
            <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 17, color: name ? C.onSurface : C.faint }}>
              {name || "Tap to set your name"}
            </span>
          </Touchable>
        )}
        <div style={{ fontFamily: mono, fontSize: 11.5, color: C.onSurfaceVariant, marginTop: 2 }}>{dateStr}</div>
      </div>
      <Touchable
        onClick={onToggleTest}
        rippleColor="rgba(255,255,255,0.15)"
        style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: 5,
          background: testMode ? C.wealth : C.containerHigh,
          color: testMode ? C.surface : C.onSurfaceVariant,
          borderRadius: 14, padding: "7px 10px",
        }}
      >
        {testMode ? <Unlock size={13} /> : <Lock size={13} />}
        <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 10 }}>{testMode ? "Unlocked" : "Test mode"}</span>
      </Touchable>
    </div>
  );
}

function TopAppBar({ syncStatus, onMenu }) {
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
        <div style={{ fontFamily: sans, fontWeight: 700, color: C.onSurface, fontSize: 18 }}>+U  -  Lv 1</div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          {statusIcon}
          <span style={{ fontFamily: mono, fontSize: 10.5, color: C.onSurfaceVariant }}>{statusLabel}</span>
        </div>
        <Touchable onClick={onMenu} style={{ width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }} rippleColor="rgba(255,255,255,0.12)">
          <MoreVertical size={19} color={C.onSurfaceVariant} />
        </Touchable>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   BOTTOM NAVIGATION — Material 3 NavigationBar
--------------------------------------------------------------- */
function BottomNav({ tab, setTab, tabs }) {
  return (
    <div
      style={{ height: NAV_H, background: C.surfaceLow, borderTop: `1px solid ${C.outlineVariant}`, flexShrink: 0 }}
      className="flex items-stretch"
    >
      {tabs.map((t) => {
        const active = tab === t.id;
        const Icon = t.icon;
        return (
          <Touchable key={t.id} onClick={() => setTab(t.id)} rippleColor={`${t.color}33`} style={{ flex: 1, display: "flex" }}>
            <div className="w-full flex flex-col items-center justify-center gap-0.5">
              <div
                style={{
                  padding: "3px 16px", borderRadius: 14,
                  background: active ? `${t.color}2E` : "transparent",
                  transition: "background 0.15s ease",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <Icon size={19} color={active ? t.color : C.onSurfaceVariant} />
              </div>
              <span style={{ fontFamily: sans, fontSize: 10, fontWeight: active ? 700 : 500, color: active ? t.color : C.faint }}>
                {t.label}
              </span>
            </div>
          </Touchable>
        );
      })}
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
  const [state, setState] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [dirty, setDirty] = useState(false);
  const [syncStatus, setSyncStatus] = useState("synced");
  const [resetArm, setResetArm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [testMode, setTestMode] = useState(true);
  const [codeCopied, setCodeCopied] = useState(false);

  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // Subscribe to the Firestore document for this code as soon as we have one.
  useEffect(() => {
    if (!code) return;
    setLoaded(false);
    const ref = doc(db, QUESTS_COLLECTION, code);
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        if (snap.exists()) {
          if (!dirtyRef.current) {
            setState(migrateState(snap.data()));
          }
        } else {
          const initial = defaultState();
          try {
            await setDoc(ref, initial);
          } catch {
            // ignore — will retry on next write
          }
          setState(initial);
        }
        setLoaded(true);
        setSyncStatus("synced");
      },
      () => {
        setSyncStatus("error");
        setLoaded(true);
      }
    );
    return () => unsub();
  }, [code]);

  const update = useCallback((mutator) => {
    setState((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      mutator(next);
      return next;
    });
    setDirty(true);
    setSyncStatus("unsaved");
  }, []);

  const saveNow = useCallback(() => {
    if (!code || !state) return;
    setSyncStatus("saving");
    const ref = doc(db, QUESTS_COLLECTION, code);
    setDoc(ref, state)
      .then(() => {
        setDirty(false);
        setSyncStatus("synced");
      })
      .catch(() => setSyncStatus("error"));
  }, [code, state]);

  const doReset = useCallback(() => {
    if (!resetArm) {
      setResetArm(true);
      setTimeout(() => setResetArm(false), 4000);
      return;
    }
    const initial = defaultState();
    if (code) {
      const ref = doc(db, QUESTS_COLLECTION, code);
      setDoc(ref, initial).catch(() => setSyncStatus("error"));
    }
    setState(initial);
    setDirty(false);
    setSyncStatus("synced");
    setResetArm(false);
    setMenuOpen(false);
  }, [resetArm, code]);

  const changeCode = useCallback(() => {
    if (typeof window !== "undefined") localStorage.removeItem(CODE_STORAGE_KEY);
    setCode(null);
    setState(null);
    setLoaded(false);
    setDirty(false);
    setMenuOpen(false);
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

  if (!code) {
    return (
      <CodeGate
        onSubmit={(c) => {
          if (typeof window !== "undefined") localStorage.setItem(CODE_STORAGE_KEY, c);
          setCode(c);
        }}
      />
    );
  }

  if (!loaded || !state) {
    return (
      <div style={{ background: C.surface, color: C.onSurfaceVariant, minHeight: 400, fontFamily: sans }} className="flex items-center justify-center rounded-[28px]">
        <style>{FONT_IMPORT}</style>
        <Loader2 size={20} className="md-spin" style={{ marginRight: 8 }} />
        <span style={{ fontSize: 13 }}>Loading quest…</span>
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
  const questLocked = testMode ? false : dayIndex(today) < 1;

  const tabs = [
    { id: "dashboard", label: "Home", icon: Home, color: C.wealth },
    { id: "wisdom", label: "Wisdom", icon: BookOpen, color: C.wisdom },
    { id: "vitality", label: "Vitality", icon: Dumbbell, color: C.vitality },
    { id: "wealth", label: "Wealth", icon: Coins, color: C.wealth },
    { id: "resolve", label: "Resolve", icon: ShieldCheck, color: C.resolve },
    { id: "achievements", label: "Awards", icon: Trophy, color: C.wisdom },
  ];
  const activeColor = tabs.find((t) => t.id === tab)?.color || C.wealth;

  return (
    <div
      style={{
        background: C.surface, fontFamily: sans, maxWidth: 420, margin: "0 auto",
        height: "100dvh", borderRadius: 14, overflow: "hidden",
        display: "flex", flexDirection: "column",
        boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
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

      <TopAppBar syncStatus={syncStatus} onMenu={() => setMenuOpen((o) => !o)} />

      {/* overflow menu */}
      {menuOpen && (
        <>
          <div onClick={() => { setMenuOpen(false); setResetArm(false); }} style={{ position: "absolute", inset: 0, zIndex: 10 }} />
          <div
            style={{
              position: "absolute", top: 56, right: 12, zIndex: 20,
              background: C.containerHighest, borderRadius: 16, minWidth: 220,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)", overflow: "hidden",
            }}
          >
            <Touchable onClick={copyCode} rippleColor="rgba(255,255,255,0.08)" style={{ display: "block" }}>
              <div className="flex items-center gap-3 px-4 py-3.5">
                <Copy size={16} color={C.onSurfaceVariant} />
                <span style={{ fontFamily: sans, fontSize: 13.5, color: C.onSurface }}>
                  {codeCopied ? "Copied!" : "Copy secret code"}
                </span>
              </div>
            </Touchable>
            <Touchable onClick={changeCode} rippleColor="rgba(255,255,255,0.08)" style={{ display: "block" }}>
              <div className="flex items-center gap-3 px-4 py-3.5">
                <KeyRound size={16} color={C.onSurfaceVariant} />
                <span style={{ fontFamily: sans, fontSize: 13.5, color: C.onSurface }}>Change code / sign out</span>
              </div>
            </Touchable>
            <Touchable onClick={doReset} rippleColor={`${C.danger}33`} style={{ display: "block" }}>
              <div className="flex items-center gap-3 px-4 py-3.5">
                <RotateCcw size={16} color={resetArm ? C.danger : C.onSurfaceVariant} />
                <span style={{ fontFamily: sans, fontSize: 13.5, color: resetArm ? C.danger : C.onSurface }}>
                  {resetArm ? "Tap again to confirm" : "Reset all data"}
                </span>
              </div>
            </Touchable>
          </div>
        </>
      )}

      <ProfileHeader
        name={state.profile?.name || ""}
        onNameChange={(v) => update((d) => { d.profile.name = v; })}
        overall={overall}
        today={today}
        testMode={testMode}
        onToggleTest={() => setTestMode((t) => !t)}
      />

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
                rippleColor="rgba(255,255,255,0.08)"
                style={{ background: C.container, borderRadius: 16, display: "block", marginBottom: 14 }}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <Trophy size={16} color={C.wealth} />
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
        {tab === "resolve" && <ResolveTab s={state.resolve} set={update} locked={questLocked} />}
        {tab === "achievements" && <AchievementsTab state={state} overall={overall} />}

        {/* FAB */}
        <div
          style={{
            position: "sticky", bottom: 16, display: "flex", justifyContent: "flex-end",
            paddingRight: 16, pointerEvents: "none",
          }}
        >
          <Touchable
            onClick={saveNow}
            disabled={!dirty || syncStatus === "saving"}
            rippleColor="rgba(0,0,0,0.15)"
            style={{
              pointerEvents: dirty ? "auto" : "none",
              background: dirty ? activeColor : C.containerHigh,
              color: dirty ? C.surface : C.faint,
              borderRadius: 20,
              padding: dirty ? "14px 22px" : "14px",
              display: "flex", alignItems: "center", gap: 8,
              boxShadow: dirty ? "0 6px 16px rgba(0,0,0,0.4)" : "none",
              opacity: dirty ? 1 : 0,
              transform: dirty ? "scale(1)" : "scale(0.8)",
              transition: "all 0.2s ease",
            }}
          >
            {syncStatus === "saving" ? <Loader2 size={18} className="md-spin" /> : <Save size={18} />}
            {dirty && <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 14 }}>Save</span>}
          </Touchable>
        </div>
      </div>

      <BottomNav tab={tab} setTab={setTab} tabs={tabs} />
    </div>
  );
}
