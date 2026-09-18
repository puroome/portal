// 출결의 시간·집계 계산 (화면과 떨어져 있어 테스트로 규칙을 못박습니다 — tests/att-schedule.test.mjs)
import { ATT_PERIODS, ATT_DAY_PERIODS, ATT_STATUS, LATE_AFTER_MINUTES } from "./config.js";

export const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

// 야간자율은 반 이름을 짓지 않고 "학년 + 교시"만 고릅니다. 운영 요일은 시간표에서 자동으로 정해집니다.
//   자율1 → 월~금, 자율2 → 월~목, 8교시 → 금
export function nightSlots(period) {
  const slots = {};
  Object.entries(ATT_DAY_PERIODS.night).forEach(([day, list]) => {
    if (list.includes(period)) slots[day] = { [period]: true };
  });
  return Object.keys(slots).length ? slots : null;
}

export const nightPeriods = () => [...new Set(Object.values(ATT_DAY_PERIODS.night).flat())]
  .sort((a, b) => ATT_PERIODS[a].start.localeCompare(ATT_PERIODS[b].start));

export const nightGroupName = (grade, period) => `${grade}학년 ${ATT_PERIODS[period]?.label || ""}`.trim();

// 카드를 묶을 기준: 야간자율은 교시, 방과후는 묶지 않음
export const groupPeriodKey = g => (g.type === "night" ? (g.period || Object.keys(g.slots?.[Object.keys(g.slots || {})[0]] || {})[0] || "") : "");

export const periodsOn = (g, weekday) => Object.keys(g?.slots?.[weekday] || {}).filter(k => ATT_PERIODS[k]);

export const runsOn = (g, date = new Date()) => periodsOn(g, date.getDay()).length > 0;

export function scheduleText(g) {
  const parts = [];
  for (let d = 1; d <= 6; d++) {
    const list = periodsOn(g, d);
    if (list.length) parts.push(`${WEEK[d]} ${list.map(k => ATT_PERIODS[k].label).join("·")}`);
  }
  return [parts.join(" / "), g?.place].filter(Boolean).join(" · ");
}

// 그날 첫 교시 시작 시각 (지각 판정 기준)
export function startTimeOn(g, date) {
  const [y, m, d] = String(date).split("-").map(Number);
  const list = periodsOn(g, new Date(y, m - 1, d).getDay());
  if (!list.length) return null;
  const [hh, mm] = list.map(k => ATT_PERIODS[k].start).sort()[0].split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

export function isLate(at, g, date) {
  const start = startTimeOn(g, date);
  return !!(start && at && at > start + LATE_AFTER_MINUTES * 60000);
}

// 기록이 없으면 결석입니다.
export function effectiveStatus(rec, group, date) {
  if (!rec) return "absent";
  if (rec.by === "student" && rec.status === "present" && isLate(rec.at, group, date)) return "late";
  return ATT_STATUS[rec.status] ? rec.status : "absent";
}

export function countStatuses(recsByDate, group, dates) {
  const c = Object.fromEntries(Object.keys(ATT_STATUS).map(k => [k, 0]));
  dates.forEach(d => { c[effectiveStatus(recsByDate?.[d], group, d)]++; });
  return c;
}

// 통계·학생 출결에 쓸 날짜 = **감독교사가 확인된 날만**.
// 감독을 내려놓으면(uid 가 지워지면) 그날은 통계에서 빠집니다. 출결 기록만 있고 감독 확인이
// 없는 날도 세지 않습니다 — 그래야 확인하지 않은 시간이 결석으로 잡히지 않습니다.
export const isSupervised = v => !!(v && typeof v === "object" && v.uid);

export function sessionDates(sessions, from, to) {
  return Object.entries(sessions || {})
    .filter(([, v]) => isSupervised(v))
    .map(([d]) => d)
    .filter(d => (!from || d >= from) && (!to || d <= to))
    .sort();
}
