// 나이스 급식·학사일정 해석 테스트:  node --test tests/neis.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDish, toMeal, toEvents, groupRanges, upcoming, forGrade, schoolYearRange } from "../js/neis-parse.js";

test("요리명 뒤 알레르기 번호 떼기 (실제 괄호 형식 · 명세서 형식)", () => {
  assert.deepEqual(parseDish("육개장 (1.9.16)"), { name: "육개장", allergies: [1, 9, 16] });
  assert.deepEqual(parseDish("치즈함박스테이크*소스 (1.2.5.6.10.12.13.15.16.18)").name, "치즈함박스테이크*소스");
  assert.deepEqual(parseDish("닭갈비1.2.5.10.15."), { name: "닭갈비", allergies: [1, 2, 5, 10, 15] });
  assert.deepEqual(parseDish("찹쌀현미밥 "), { name: "찹쌀현미밥", allergies: [] });
  assert.deepEqual(parseDish("배추김치 (9)"), { name: "배추김치", allergies: [9] });
});

test("급식 행 → 메뉴 목록·영양·원산지 (빈 '비고' 줄 제외)", () => {
  const m = toMeal({ date: "20260914", code: "2", type: "중식", dish: "찹쌀현미밥 <br/>육개장 (1.9.16)", kcal: "878.7 Kcal", ntr: "탄수화물(g) : 130.1<br/>단백질(g) : 38.3", org: "쌀 : 국내산<br/>비고 : " });
  assert.equal(m.dishes.length, 2);
  assert.deepEqual(m.dishes[1], { name: "육개장", allergies: [1, 9, 16] });
  assert.deepEqual(m.origins, ["쌀 : 국내산"]);
  assert.equal(m.nutrients.length, 2);
});

test("학사일정: 토요휴업일 제외 · 방학 묶기 · 휴업일 표시 · 학년 필터", () => {
  const rows = [
    { date: "20260718", title: "토요휴업일", holiday: "휴업일", grades: [1, 2, 3] },
    { date: "20260720", title: "여름방학", holiday: "휴업일", grades: [1, 2, 3] },
    { date: "20260721", title: "여름방학", holiday: "휴업일", grades: [1, 2, 3] },
    { date: "20260724", title: "여름방학", holiday: "휴업일", grades: [1, 2, 3] },   // 주말 건너뜀 → 이어짐
    { date: "20260727", title: "여름방학", holiday: "휴업일", grades: [1, 2, 3] },
    { date: "20260902", title: "3학년 모의평가", holiday: "해당없음", grades: [3] },
    { date: "20260925", title: "추석", holiday: "공휴일", grades: [1, 2, 3] }
  ];
  const ev = toEvents(rows);
  assert.equal(ev.length, 6);                       // 토요휴업일 빠짐
  assert.equal(ev.find(e => e.title === "3학년 모의평가").holiday, "");   // "해당없음" 은 휴업일 아님
  const ranges = groupRanges(ev);
  assert.equal(ranges.length, 3);
  assert.deepEqual([ranges[0].start, ranges[0].end], ["20260720", "20260727"]);
  assert.equal(forGrade(ranges[1], 1), false);
  assert.equal(forGrade(ranges[1], 3), true);
  assert.equal(forGrade(ranges[1], ""), true);

  const u = upcoming(ranges, "20260919");
  assert.equal(u.today.length, 0);
  assert.equal(u.next[0].title, "추석");
  assert.equal(u.dDay, 6);
  assert.equal(upcoming(ranges, "20260721").today[0].title, "여름방학");
});

test("학년도 기간: 윤년 2월 말일", () => {
  assert.deepEqual(schoolYearRange(2026), { from: "20260301", to: "20270228" });
  assert.deepEqual(schoolYearRange(2027), { from: "20270301", to: "20280229" });
});
