// 학년도별 학번 규칙 테스트:  node --test tests/years.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { sidInYear, currentYearOf, isCurrentYear } from "../js/years.js";

const senior = { sid: "30101", sids: { "10101": 2024, "20101": 2025, "30101": 2026 } };
const fresh = { sid: "10101", sids: { "10101": 2026 } };
const graduate = { sid: null, sids: { "30505": 2025, "20505": 2024 } };
const legacy = { sid: "10102" };   // 연도 열을 반영하기 전 계정

test("그 해에 쓰던 학번을 찾는다", () => {
  assert.equal(sidInYear(senior, 2024), "10101");
  assert.equal(sidInYear(senior, 2025), "20101");
  assert.equal(sidInYear(senior, 2026), "30101");
  assert.equal(sidInYear(senior, 2023), null);       // 그 해엔 학생이 아니었음
  assert.equal(sidInYear(fresh, 2026), "10101");
  assert.equal(sidInYear(fresh, 2024), null);        // 같은 10101 이라도 2024년 자료는 선배 것
  assert.equal(sidInYear(graduate, 2025), "30505");  // 졸업생도 지난 기록은 이름으로 찾힘
  assert.equal(sidInYear(legacy, 2026), "10102");    // 예전 계정은 지금 학번 그대로
  assert.equal(sidInYear(null, 2026), null);
});

test("지금 학년도인지", () => {
  assert.equal(currentYearOf(senior, 2099), 2026);
  assert.equal(currentYearOf(legacy, 2026), 2026);   // sids 가 없으면 기본값
  assert.equal(isCurrentYear(senior, 2026, 2026), true);
  assert.equal(isCurrentYear(senior, 2025, 2026), false);   // 지난 학년도 프로그램에는 제출 불가
  assert.equal(isCurrentYear(graduate, 2025, 2026), false);
});
