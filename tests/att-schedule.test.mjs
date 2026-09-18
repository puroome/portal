// 출결 시간·집계 규칙 테스트:  node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLate, effectiveStatus, countStatuses, sessionDates, scheduleText, runsOn, startTimeOn,
         nightSlots, nightPeriods, nightGroupName, groupPeriodKey, isSupervised } from "../js/att-schedule.js";

// 금요일(2026-09-18) 야간자율: 8교시(16:50)·자율1(18:30)
const night = { type: "night", place: "3층", slots: { 1: { s1: true, s2: true }, 5: { p8: true, s1: true } } };
// 수요일 방과후: 7교시(15:50)·8교시
const after = { type: "afterschool", slots: { 3: { p7: true, p8: true } } };
const FRI = "2026-09-18";
const WED = "2026-09-16";
const at = (date, h, m) => { const [y, mo, d] = date.split("-").map(Number); return new Date(y, mo - 1, d, h, m).getTime(); };

test("요일별 운영 여부와 안내 문구", () => {
  assert.equal(runsOn(night, new Date(2026, 8, 18)), true);   // 금
  assert.equal(runsOn(after, new Date(2026, 8, 18)), false);  // 방과후는 수요일만
  assert.equal(scheduleText(after), "수 7교시·8교시");
  assert.match(scheduleText(night), /^월 자율1·자율2 \/ 금 8교시·자율1 · 3층$/);
});

test("지각 기준은 그날 첫 교시 시작 15분 뒤", () => {
  assert.equal(startTimeOn(night, FRI), at(FRI, 16, 50));     // 8교시가 자율1보다 빠름
  assert.equal(isLate(at(FRI, 16, 50), night, FRI), false);
  assert.equal(isLate(at(FRI, 17, 4), night, FRI), false);    // 14분 → 출석
  assert.equal(isLate(at(FRI, 17, 6), night, FRI), true);     // 16분 → 지각
  assert.equal(isLate(at(WED, 16, 20), after, WED), true);    // 7교시 15:50 기준
  assert.equal(isLate(at(WED, 15, 55), after, WED), false);
  assert.equal(isLate(at("2026-09-19", 23, 0), night, "2026-09-19"), false); // 운영일이 아니면 판정 없음
});

test("기록이 없으면 결석, 학생 체크인이 늦으면 지각", () => {
  assert.equal(effectiveStatus(null, night, FRI), "absent");
  assert.equal(effectiveStatus({ status: "present", by: "student", at: at(FRI, 16, 55) }, night, FRI), "present");
  assert.equal(effectiveStatus({ status: "present", by: "student", at: at(FRI, 18, 0) }, night, FRI), "late");
  // 교사가 직접 넣은 값은 시각과 상관없이 그대로 둡니다.
  assert.equal(effectiveStatus({ status: "present", by: "teacher" }, night, FRI), "present");
  assert.equal(effectiveStatus({ status: "early", by: "teacher" }, night, FRI), "early");
  // 없어진 상태(인정결)는 결석으로 봅니다.
  assert.equal(effectiveStatus({ status: "excused", by: "teacher" }, night, FRI), "absent");
});

test("운영일 집계: 감독교사 확인이 된 날만 센다", () => {
  const sessions = {
    "2026-09-14": { at: 1 },                       // 감독 확인을 내려놓은 날 → 제외
    "2026-09-16": { uid: "uT", name: "김교사" },
    "2026-09-18": { uid: "uT2", name: "박교사" }
  };
  assert.deepEqual(sessionDates(sessions), ["2026-09-16", "2026-09-18"]);
  assert.deepEqual(sessionDates(sessions, "2026-09-17", "2026-09-18"), ["2026-09-18"]);
  assert.deepEqual(sessionDates({}), []);
  assert.equal(isSupervised({ uid: "uT" }), true);
  assert.equal(isSupervised({ at: 1 }), false);
  assert.equal(isSupervised(true), false);         // 예전 자료(true)도 감독 확인으로 보지 않음

  const mine = { "2026-09-16": { status: "present", by: "student", at: at(WED, 15, 51) }, "2026-09-18": { status: "early", by: "teacher" } };
  assert.deepEqual(countStatuses(mine, after, ["2026-09-16", "2026-09-18", "2026-09-14"]),
    { present: 1, late: 0, early: 1, absent: 1 });
});

test("야간자율은 교시만 고르면 운영 요일이 자동으로 정해진다", () => {
  assert.deepEqual(nightSlots("s1"), { 1: { s1: true }, 2: { s1: true }, 3: { s1: true }, 4: { s1: true }, 5: { s1: true } }); // 월~금
  assert.deepEqual(nightSlots("s2"), { 1: { s2: true }, 2: { s2: true }, 3: { s2: true }, 4: { s2: true } });                  // 월~목
  assert.deepEqual(nightSlots("p8"), { 5: { p8: true } });                                                                     // 금
  assert.equal(nightSlots("p7"), null);          // 야간자율에 없는 교시
  assert.deepEqual(nightPeriods(), ["p8", "s1", "s2"]);  // 시작 시각 순
  assert.equal(nightGroupName("2", "s2"), "2학년 자율2");
  assert.equal(groupPeriodKey({ type: "night", period: "s1" }), "s1");
  assert.equal(groupPeriodKey({ type: "night", slots: nightSlots("p8") }), "p8");  // 예전 자료도 묶임
  assert.equal(groupPeriodKey({ type: "afterschool", slots: { 3: { p7: true } } }), "");
});
