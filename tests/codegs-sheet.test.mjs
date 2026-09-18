// Code.gs 의 시트 읽기·연도별 학번 로직을 가짜 SpreadsheetApp 로 검증:  node --test tests/codegs-sheet.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { test } from "node:test";

const code = readFileSync(new URL("../gas/Code.gs", import.meta.url), "utf8");

function fakeSheet(grid) {
  // grid: 2차원 배열 (1행 = 헤더)
  const at = (r, c) => (grid[r - 1] || [])[c - 1] ?? "";
  const range = (r, c, nr = 1, nc = 1) => ({
    getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => String(at(r + i, c + j)))),
    setValue: v => { (grid[r - 1] ||= [])[c - 1] = v; return range(r, c, nr, nc); },
    setValues: vs => { vs.forEach((row, i) => row.forEach((v, j) => { (grid[r - 1 + i] ||= [])[c - 1 + j] = v; })); return range(r, c, nr, nc); },
    setFontWeight: () => range(r, c, nr, nc), setBackground: () => range(r, c, nr, nc), setNumberFormat: () => range(r, c, nr, nc)
  });
  return {
    grid,
    getLastRow: () => grid.length,
    getLastColumn: () => Math.max(...grid.map(r => r.length)),
    getMaxRows: () => 1000,
    getRange: range,
    getActiveRangeList: () => ({ getRanges: () => [] })
  };
}

let props = {};
const ctx = {
  console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  SpreadsheetApp: null, UrlFetchApp: {}, ScriptApp: {}, Utilities: {}, CacheService: {}, Session: {}, DriveApp: {}, LockService: {}, ContentService: {}
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

test("계정 시트: 헤더로 열 찾기 · 연도별 학번 · 현재 학년도", () => {
// ---- 1) 연도 열을 B 바로 오른쪽에 끼워 넣어도 헤더로 찾는다 ----
const headers = ["구분(학생/교사)", "ID(학번/교사ID)", "2025년", "이름", "학년", "반", "번호", "초기 비밀번호", "상태", "UID(자동)", "학교 Google 계정", "2024년"];
const sheet = fakeSheet([
  headers,
  ["학생", "30101", "20101", "선배", "3", "1", "1", "", "", "uA", "a@school.kr", "10101"],
  ["학생", "10101", "", "신입생", "1", "1", "1", "1234", "", "", "", ""],
  ["교사", "t_kim", "", "김선생", "", "", "", "1234", "", "uT", "", ""],
  ["학생", "", "30505", "졸업예정", "3", "5", "5", "", "", "uG", "", ""]
]);
ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }) };

const cols = ctx.loadCols_(sheet);
assert.equal(cols.ID, 2);
assert.equal(cols.NAME, 4);          // 연도 열 때문에 한 칸 밀려도 이름으로 찾음
assert.equal(cols.UID, 10);
assert.deepEqual(cols.YEARS.map(y => [y.year, y.col]), [[2025, 3], [2024, 12]]);

props.CURRENT_SCHOOL_YEAR = "2026";
const rows = ctx.readRows_(false);
assert.equal(rows.length, 3);                               // ID 가 빈 행은 건너뜀
const senior = rows.find(r => r.loginId === "30101");
assert.equal(senior.name, "선배");
assert.deepEqual({ ...senior.years }, { 2024: "10101", 2025: "20101" });
assert.deepEqual({ ...ctx.sidsOf_(senior, 2026) }, { "10101": 2024, "20101": 2025, "30101": 2026 });

const prof = ctx.profileOf_(senior);
assert.equal(prof.sid, "30101");
assert.deepEqual({ ...prof.sids }, { "10101": 2024, "20101": 2025, "30101": 2026 });

const fresh = rows.find(r => r.loginId === "10101");
assert.deepEqual({ ...ctx.profileOf_(fresh).sids }, { "10101": 2026 });

const teacher = rows.find(r => r.loginId === "t_kim");
assert.equal(ctx.profileOf_(teacher).sids, undefined);    // 교사는 연도별 학번 없음

// ID 가 빈(졸업 처리 중) 행도 includeNoId 로는 읽힘
assert.equal(ctx.readRows_(false, true).length, 4);

// ---- 2) 현재 학년도: 속성이 있으면 속성, 없으면 날짜 ----
assert.equal(ctx.currentSchoolYear_(), 2026);
props = {};
const d = new Date();
assert.equal(ctx.currentSchoolYear_(), d.getMonth() + 1 <= 2 ? d.getFullYear() - 1 : d.getFullYear());

// ---- 3) 빠진 헤더만 채우고 연도 열은 건드리지 않음 ----
const old = fakeSheet([["구분(학생/교사)", "ID(학번/교사ID)", "이름", "학년", "반", "번호", "초기 비밀번호", "상태", "UID(자동)", "", "2025년"]]);
ctx.ensureHeaders_(old);
assert.equal(old.grid[0][9], "학교 Google 계정");
assert.equal(old.grid[0][10], "2025년");

});
