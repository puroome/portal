// 나이스(NEIS) 급식·학사일정 응답 해석 (화면·네트워크와 무관한 계산만 — tests/neis.test.mjs)
// 서버(gas/Code.gs 의 neis_)가 넘겨주는 행:
//   급식 { date:"YYYYMMDD", code:"1|2|3", type:"조식|중식|석식", dish, kcal, ntr, org }  (dish·ntr·org 는 <br/> 구분)
//   일정 { date:"YYYYMMDD", title, content, holiday:"해당없음|공휴일|휴업일…", grades:[1,2,3] }

export const ALLERGY = {
  1: "난류", 2: "우유", 3: "메밀", 4: "땅콩", 5: "대두", 6: "밀", 7: "고등어",
  8: "게", 9: "새우", 10: "돼지고기", 11: "복숭아", 12: "토마토", 13: "아황산류",
  14: "호두", 15: "닭고기", 16: "쇠고기", 17: "오징어", 18: "조개류", 19: "잣"
};

export const splitBr = s => String(s ?? "").split(/<br\s*\/?>/i).map(v => v.trim()).filter(Boolean);

// 요리명 뒤의 알레르기 번호를 떼어 냅니다. 실제 응답은 "육개장 (1.9.16)" 처럼 괄호 안에 오고,
// 명세서 예시는 "닭갈비1.2.5.10.15." 처럼 붙어 옵니다. 둘 다 처리합니다.
export function parseDish(raw) {
  const s = String(raw || "").trim();
  const nums = t => t.split(".").filter(Boolean).map(Number).filter(n => n >= 1 && n <= 19);
  let m = s.match(/^(.*?)\s*\((\d{1,2}(?:\.\d{1,2})*)\.?\)\s*$/);
  if (m && m[1]) return { name: m[1].trim(), allergies: nums(m[2]) };
  m = s.match(/^(.*?)\s*((?:\d{1,2}\.)+)\s*$/);
  if (m && m[1]) return { name: m[1].trim(), allergies: nums(m[2]) };
  return { name: s, allergies: [] };
}

export function toMeal(r) {
  return {
    date: r.date, type: r.type, typeCode: String(r.code || ""),
    dishes: splitBr(r.dish).map(parseDish),
    kcal: r.kcal || "", nutrients: splitBr(r.ntr), origins: splitBr(r.org).filter(v => !/^비고\s*:\s*$/.test(v))
  };
}

// ---------------- 학사일정 ----------------
// 토요휴업일은 해마다 49번이나 되는데 토요일이면 당연하므로 목록·달력에서 뺍니다.
const HIDDEN = /^토요휴업일$/;

export function toEvents(rows) {
  return (rows || [])
    .filter(r => r.date && r.title && !HIDDEN.test(String(r.title).trim()))
    .map(r => ({
      date: String(r.date), title: String(r.title).trim(), content: String(r.content || "").trim(),
      holiday: r.holiday && r.holiday !== "해당없음" ? String(r.holiday) : "",
      grades: Array.isArray(r.grades) ? r.grades.map(Number) : []
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// 학년 필터: 학년 정보가 없거나(전교 행사) 그 학년이 포함되면 보여 줌. grade 가 없으면 전체
export const forGrade = (ev, grade) => !grade || !ev.grades.length || ev.grades.includes(Number(grade));

export const ymdToDate = ymd => new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
export const dateToYmd = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const dayDiff = (a, b) => Math.round((ymdToDate(b) - ymdToDate(a)) / 86400000);

// 여름방학·겨울방학처럼 날마다 같은 이름으로 들어오는 일정을 기간 하나로 묶습니다.
// (주말은 빠져 있으므로 3일 이하 간격이면 이어진 것으로 봄)
export function groupRanges(events) {
  const out = [];
  const last = {};
  events.forEach(ev => {
    const prev = last[ev.title];
    if (prev && dayDiff(prev.end, ev.date) <= 3) {
      prev.end = ev.date;
      ev.grades.forEach(g => { if (!prev.grades.includes(g)) prev.grades.push(g); });
      return;
    }
    const r = { ...ev, start: ev.date, end: ev.date, grades: [...ev.grades] };
    last[ev.title] = r;
    out.push(r);
  });
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// 상단 배너: 오늘 진행 중인 일정과, 오늘 이후 처음 시작하는 일정(D-n)
export function upcoming(ranges, todayYmd) {
  const today = ranges.filter(r => r.start <= todayYmd && todayYmd <= r.end);
  const nextStart = ranges.find(r => r.start > todayYmd)?.start;
  const next = nextStart ? ranges.filter(r => r.start === nextStart) : [];
  return { today, next, dDay: nextStart ? dayDiff(todayYmd, nextStart) : null };
}

// 학년도(3월~이듬해 2월)의 첫날·마지막 날
export function schoolYearRange(ay) {
  const end = new Date(ay + 1, 2, 0);   // 이듬해 2월 말일
  return { from: `${ay}0301`, to: dateToYmd(end) };
}
