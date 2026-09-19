// 나이스 급식·학사일정 데이터: Apps Script 중계(gas/Code.gs neis_) + 브라우저 캐시(localStorage)
// 인증키는 Apps Script 스크립트 속성에만 있고 이 앱에는 없습니다.
//  - 급식은 월 단위, 학사일정은 학년도 단위로 받아 둡니다.
//  - 유효기간: 급식 6시간, 학사일정 7일. 지나면 다시 받되, 실패하면 지난 캐시라도 보여 줍니다.
import { callScript } from "./script-api.js";
import { toMeal, toEvents, schoolYearRange } from "./neis-parse.js";

const HOUR = 3600 * 1000;
const TTL = { meal: 6 * HOUR, schedule: 7 * 24 * HOUR };
const inflight = new Map();

function readCache(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function writeCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ fetchedAt: new Date().toISOString(), data })); } catch { /* 저장 공간 부족·사생활 보호 모드 */ }
}

// 캐시가 유효하면 그대로, 아니면 새로 받아 저장. 새로 받기가 실패하면 지난 캐시로 대신합니다.
async function cached(key, ttl, load, force = false) {
  const c = readCache(key);
  if (c && !force && Date.now() - Date.parse(c.fetchedAt) < ttl) return c.data;
  if (inflight.has(key)) return inflight.get(key);
  const p = load()
    .then(data => { writeCache(key, data); return data; })
    .catch(err => { if (c) return c.data; throw err; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ym = "YYYYMM"
export async function fetchMealsMonth(ym, force = false) {
  const last = new Date(Number(ym.slice(0, 4)), Number(ym.slice(4, 6)), 0).getDate();
  const rows = await cached(`neis:meal:${ym}`, TTL.meal,
    () => callScript("neis", { kind: "meal", from: `${ym}01`, to: `${ym}${last}` }).then(r => r.rows || []), force);
  return rows.map(toMeal);
}

// ay = 학년도(숫자). 3월 ~ 이듬해 2월
export async function fetchSchedule(ay, force = false) {
  const { from, to } = schoolYearRange(ay);
  const rows = await cached(`neis:schedule:${ay}`, TTL.schedule,
    () => callScript("neis", { kind: "schedule", from, to }).then(r => r.rows || []), force);
  return toEvents(rows);
}

// 인접한 달을 미리 받아 둡니다(실패해도 조용히)
export function prefetchMeals(...yms) {
  yms.forEach(ym => fetchMealsMonth(ym).catch(() => {}));
}
