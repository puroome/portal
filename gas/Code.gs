// =======================================================
// 광남고 포털 - Apps Script 백엔드
//  1) [계정] 시트 → Firebase 로그인 계정(학생·교사) 일괄 생성/비밀번호 초기화
//  2) 웹 앱(doPost) → 학생 제출 파일을 Google Drive 에 저장·조회·삭제
// =======================================================

// ▼▼▼ 설정 (js/config.js 와 같은 값이어야 합니다) ▼▼▼
const PROJECT_ID   = "record-99cf0";
const API_KEY      = "AIzaSyDzAYguXSjmjNJFEYPplLKUj_twhOO0Llk";
const DB_URL       = "https://record-99cf0-default-rtdb.asia-southeast1.firebasedatabase.app";
const EMAIL_DOMAIN = "gnhs-portal.app";
const PW_PREFIX    = "gn#";
const MIN_PW_LENGTH = 4;
const DEFAULT_PW   = "1234";                    // [초기 비밀번호] 칸이 비어 있을 때 쓰는 공통 초기 비밀번호
                                                // (첫 로그인 때 본인 비밀번호로 바꾸도록 강제됩니다)
const ADMIN_EMAIL  = "puroome@gmail.com";       // 계정 관리 메뉴를 실행할 수 있는 관리자
const DRIVE_ROOT_NAME = "스쿨포털_제출자료";      // 제출 파일이 모이는 최상위 폴더 이름
const MAX_FILE_MB  = 10;
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

const SHEET_NAME = "계정";
const HEADERS = ["구분(학생/교사)", "ID(학번/교사ID)", "이름", "학년", "반", "번호", "초기 비밀번호", "상태", "UID(자동)"];
const HEADER_KEYS = ["TYPE", "ID", "NAME", "GRADE", "CLASS", "NO", "PW", "STATUS", "UID"];
// 열 위치는 1행의 헤더 이름으로 찾습니다. 그래서 "2025년" 같은 연도 열을 어디에 끼워 넣어도 됩니다.
// 헤더를 못 찾으면 기본 위치(A~I)를 씁니다. 목록에 없는 열(예: 예전 "학교 Google 계정")은 무시합니다.
let COL = defaultCols_();

function defaultCols_() {
  const c = { YEARS: [], LAST: HEADERS.length };
  HEADER_KEYS.forEach((k, i) => { c[k] = i + 1; });
  return c;
}

// 연도 열: 헤더가 "2025년" 꼴인 열. 그 해에 이 학생이 쓰던 학번을 적습니다.
const YEAR_HEADER = /^(\d{4})년$/;

function loadCols_(sh) {
  const width = Math.max(sh.getLastColumn(), HEADERS.length);
  const header = sh.getRange(1, 1, 1, width).getDisplayValues()[0].map(h => String(h).trim());
  const c = defaultCols_();
  HEADER_KEYS.forEach((k, i) => { const at = header.indexOf(HEADERS[i]); if (at >= 0) c[k] = at + 1; });
  c.YEARS = header.map((h, i) => ({ m: h.match(YEAR_HEADER), col: i + 1 }))
    .filter(x => x.m).map(x => ({ year: Number(x.m[1]), col: x.col }));
  c.LAST = width;
  COL = c;
  return c;
}

// 빠진 기본 헤더만 채웁니다(이미 있는 열·연도 열은 건드리지 않음).
function ensureHeaders_(sh) {
  const cols = loadCols_(sh);
  const width = Math.max(sh.getLastColumn(), HEADERS.length);
  const header = sh.getRange(1, 1, 1, width).getDisplayValues()[0].map(h => String(h).trim());
  HEADERS.forEach((name, i) => {
    if (header.indexOf(name) >= 0) return;
    const def = i + 1;
    const at = !header[def - 1] ? def : sh.getLastColumn() + 1;
    sh.getRange(1, at).setValue(name);
    header[at - 1] = name;
  });
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight("bold").setBackground("#e8f0fe");
  return loadCols_(sh);
}

// 연도 열을 찾고, 없으면 맨 오른쪽에 새로 만듭니다.
function yearCol_(sh, year) {
  const cols = loadCols_(sh);
  const found = cols.YEARS.find(y => y.year === Number(year));
  if (found) return found.col;
  const at = sh.getLastColumn() + 1;
  sh.getRange(1, at).setValue(year + "년").setFontWeight("bold").setBackground("#fef7e0");
  sh.getRange(2, at, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat("@");
  loadCols_(sh);
  return at;
}

// 지금 B열 학번이 속한 학년도. [🔅신학년 준비] 가 스크립트 속성 CURRENT_SCHOOL_YEAR 로 정해 두며,
// 없으면 날짜로 계산합니다(3월~ 이듬해 2월).
function currentSchoolYear_() {
  const saved = Number(PropertiesService.getScriptProperties().getProperty("CURRENT_SCHOOL_YEAR"));
  if (saved) return saved;
  const d = new Date();
  return d.getMonth() + 1 <= 2 ? d.getFullYear() - 1 : d.getFullYear();
}
// 지금 ID 열 학번이 속한 학년도. currentSchoolYear_() 와 달리 3월도 "아직 지난 학년도" 로 봅니다 —
// [🔅신학년 준비] 는 학번을 바꾸기 전에 누르는 메뉴라, 3월에 눌러도 ID 열은 지난 학년도 학번이기 때문입니다.
function idColumnYear_() {
  const saved = Number(PropertiesService.getScriptProperties().getProperty("CURRENT_SCHOOL_YEAR"));
  if (saved) return saved;
  const d = new Date();
  return d.getMonth() + 1 <= 3 ? d.getFullYear() - 1 : d.getFullYear();
}

const SENIOR_SID = /^3\d{3,4}$/;        // 3학년 학번 (30101 · 3305 …) → 새 학년도 준비 때 자동 졸업
// 드라이브 폴더 이름용. js/config.js 의 CATEGORIES label 과 맞춥니다.
const CATEGORY_LABELS = { bitnada: "빛나다", club: "동아리", subject: "교과", contest: "심화탐구" };

// =======================================================
// [메뉴]
// =======================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("🏫 스쿨포털")
    .addItem("🔥Firebase 동기화", "syncAccounts")
    .addSeparator()
    .addItem("🟰Record앱과 명단대조", "compareWithRecord")
    .addSeparator()
    .addSubMenu(ui.createMenu("⚙️관리자 도구")
      .addItem("🔑 선택행 PW 초기화", "resetSelectedPasswords")
      .addItem("🚷 선택행 제외 처리", "moveOutSelected")
      .addSeparator()
      .addItem("✅교사별 자료보기", "listPortalOwners")
      .addItem("❌자료 삭제", "deletePortalDataByOwner")
      .addSeparator()
      .addItem("🔅신학년 준비", "prepareNewYear"))
    .addToUi();
}

function requireAdmin_() {
  const me = Session.getActiveUser().getEmail();
  if (me !== ADMIN_EMAIL) {
    SpreadsheetApp.getUi().alert("⛔ 관리자(" + ADMIN_EMAIL + ")만 실행할 수 있습니다.");
    return false;
  }
  return true;
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

// 시트의 틀(열 제목·텍스트 서식·구분 드롭다운·틀 고정)을 갖춥니다.
// [🔥Firebase 동기화] 가 실행될 때마다 알아서 불리므로 따로 누를 메뉴가 없습니다.
// 학번·비밀번호는 숫자로 바뀌면 앞자리 0 이 사라지므로(01234 → 1234) 반드시 텍스트 서식이어야 합니다.
function prepareSheet_(sh) {
  const cols = ensureHeaders_(sh);
  const rows = Math.max(sh.getMaxRows() - 1, 1);
  sh.setFrozenRows(1);
  sh.getRange(2, cols.ID, rows, 1).setNumberFormat("@");
  sh.getRange(2, cols.PW, rows, 1).setNumberFormat("@");
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(["학생", "교사"], true).build();
  sh.getRange(2, cols.TYPE, rows, 1).setDataValidation(rule);
  sh.setColumnWidth(cols.UID, 90);
  return cols;
}

// =======================================================
// [Firebase REST 유틸] 관리자(스크립트 소유자) OAuth 토큰 사용
// =======================================================
function authHeaders_() {
  return { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "X-Goog-User-Project": PROJECT_ID };
}

function dbUrl_(path) {
  return DB_URL + "/" + path + ".json?access_token=" + encodeURIComponent(ScriptApp.getOAuthToken());
}

function dbGet_(path) {
  const res = UrlFetchApp.fetch(dbUrl_(path), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("DB 읽기 실패(" + path + "): " + res.getContentText());
  return JSON.parse(res.getContentText());
}

function dbPut_(path, data) {
  const res = UrlFetchApp.fetch(dbUrl_(path), {
    method: "put", contentType: "application/json", payload: JSON.stringify(data), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error("DB 쓰기 실패(" + path + "): " + res.getContentText());
}

function dbPatch_(path, data) {
  const res = UrlFetchApp.fetch(dbUrl_(path), {
    method: "patch", contentType: "application/json", payload: JSON.stringify(data), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error("DB 쓰기 실패(" + path + "): " + res.getContentText());
}

function toolkitRequest_(endpoint, body) {
  return {
    url: "https://identitytoolkit.googleapis.com/v1/projects/" + PROJECT_ID + "/" + endpoint,
    method: "post", contentType: "application/json", headers: authHeaders_(),
    payload: JSON.stringify(body), muteHttpExceptions: true
  };
}

function toolkitCall_(endpoint, body) {
  const req = toolkitRequest_(endpoint, body);
  const res = UrlFetchApp.fetch(req.url, req);
  const json = JSON.parse(res.getContentText() || "{}");
  if (json.error) throw new Error(json.error.message);
  return json;
}

function loginEmail_(loginId) {
  return String(loginId).trim().toLowerCase() + "@" + EMAIL_DOMAIN;
}

// =======================================================
// [계정] 시트 읽기
// =======================================================
function readRows_(onlySelected, includeNoId) {
  const sh = getSheet_();
  const cols = loadCols_(sh);
  const last = sh.getLastRow();
  if (last < 2) return [];
  let rowNumbers = [];
  if (onlySelected) {
    sh.getActiveRangeList().getRanges().forEach(r => {
      for (let i = r.getRow(); i < r.getRow() + r.getNumRows(); i++) if (i >= 2 && i <= last) rowNumbers.push(i);
    });
    rowNumbers = [...new Set(rowNumbers)];
  }
  const values = sh.getRange(2, 1, last - 1, cols.LAST).getDisplayValues();
  const cell = (v, k) => String(v[cols[k] - 1] || "").trim();
  return values.map((v, i) => ({
    row: i + 2,
    role: cell(v, "TYPE") === "교사" ? "teacher" : (cell(v, "TYPE") === "학생" ? "student" : ""),
    loginId: cell(v, "ID"),
    name: cell(v, "NAME"),
    grade: cell(v, "GRADE"),
    cls: cell(v, "CLASS"),
    no: cell(v, "NO"),
    pw: v[cols.PW - 1],
    uid: cell(v, "UID"),
    // 지난 학년도 학번: { 2025: "10101", ... }
    years: Object.fromEntries(cols.YEARS.map(y => [y.year, String(v[y.col - 1] || "").trim()]).filter(([, sid]) => sid))
  })).filter(r => (includeNoId ? (r.loginId || r.uid) : r.loginId) && (!onlySelected || rowNumbers.includes(r.row)));
}

function setStatus_(sh, row, status, uid) {
  sh.getRange(row, COL.STATUS).setValue(status);
  if (uid) sh.getRange(row, COL.UID).setValue(uid);
}

// 학생의 연도별 학번 { 학번: 학년도 } — 앱과 보안 규칙이 "그 해에 그 학번이었는지"를 여기서 확인합니다.
function sidsOf_(r, currentYear) {
  const sids = {};
  Object.keys(r.years || {}).forEach(y => { sids[r.years[y]] = Number(y); });
  if (r.loginId) sids[r.loginId] = currentYear;   // 지금 학번이 가장 우선
  return Object.keys(sids).length ? sids : null;
}

// [초기 비밀번호] 칸이 비어 있으면 공통 기본값(DEFAULT_PW)을 씁니다.
function pwOf_(r) {
  return String(r.pw == null ? "" : r.pw).trim() || DEFAULT_PW;
}

function profileOf_(r) {
  // googleEmail: null — 예전 ENGLISH 자동 로그인용으로 저장했던 학교 이메일을 동기화 때 지웁니다(이제 쓰지 않음)
  const p = { role: r.role, loginId: r.loginId, name: r.name, active: true, googleEmail: null };
  if (r.role === "student") Object.assign(p, { sid: r.loginId, grade: r.grade, cls: r.cls, no: r.no, sids: sidsOf_(r, currentSchoolYear_()) });
  return p;
}

// =======================================================
// 🔥Firebase 동기화
// =======================================================
function syncAccounts() {
  if (!requireAdmin_()) return;
  const sh = getSheet_();
  // 시트 틀을 먼저 갖춥니다 (빠진 열 제목 채우기·텍스트 서식·드롭다운, 연도 열은 그대로)
  prepareSheet_(sh);
  const rows = readRows_(false);
  const started = Date.now();
  let created = 0, updated = 0, failed = 0;
  const patch = {};

  // 1) 이미 UID 가 있는 행 → 이름·학년·반 정보 갱신 (비밀번호는 그대로)
  //    시트에서 ID 를 바꿨다면 로그인 ID(인증 이메일)도 함께 변경
  const withUid = rows.filter(r => r.uid);
  const authEmail = {};
  for (let i = 0; i < withUid.length; i += 100) {
    const found = toolkitCall_("accounts:lookup", { localId: withUid.slice(i, i + 100).map(r => r.uid) });
    (found.users || []).forEach(u => { authEmail[u.localId] = u.email; });
  }
  // 같은 ID 가 두 번 적혀 있으면 둘 다 멈춤
  const idCount = {};
  rows.forEach(r => { idCount[r.loginId.toLowerCase()] = (idCount[r.loginId.toLowerCase()] || 0) + 1; });

  const ready = [];
  withUid.forEach(r => {
    if (!r.role) { setStatus_(sh, r.row, "❌ 구분 오류"); failed++; return; }
    if (!/^[a-zA-Z0-9._-]+$/.test(r.loginId)) { setStatus_(sh, r.row, "❌ ID는 영문·숫자만"); failed++; return; }
    if (idCount[r.loginId.toLowerCase()] > 1) { setStatus_(sh, r.row, "❌ 같은 ID 가 시트에 두 번 있음"); failed++; return; }
    if (!authEmail[r.uid]) { setStatus_(sh, r.row, "❌ 인증 계정 없음 (UID 칸을 지우고 다시 실행)"); failed++; return; }
    ready.push(r);
  });

  // 학년도가 바뀌면 전교생 학번이 한꺼번에 바뀝니다(20101 → 30101 인데 30101 을 아직 다른 계정이 쓰는 등).
  // 그래서 ID 가 바뀌는 계정을 먼저 모두 임시 ID 로 옮긴 뒤, 새 ID 를 줍니다.
  const changes = ready.filter(r => authEmail[r.uid] !== loginEmail_(r.loginId));
  const failedIds = {};
  const runUpdates = (list, emailOf) => {
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      UrlFetchApp.fetchAll(chunk.map(r => toolkitRequest_("accounts:update", { localId: r.uid, email: emailOf(r) })))
        .forEach((res, j) => {
          const json = JSON.parse(res.getContentText() || "{}");
          if (json.error) failedIds[chunk[j].uid] = json.error.message;
        });
    }
  };
  runUpdates(changes, r => "tmp-" + r.uid.toLowerCase() + "@" + EMAIL_DOMAIN);
  runUpdates(changes.filter(r => !failedIds[r.uid]), r => loginEmail_(r.loginId));
  // 새 ID 를 못 받은 계정은 원래 ID 로 되돌려 둡니다(임시 ID 로 남으면 로그인이 안 됨).
  const restore = changes.filter(r => failedIds[r.uid]);
  if (restore.length) runUpdates(restore, r => authEmail[r.uid]);

  ready.forEach(r => {
    let status = "✅ 정보 반영";
    if (authEmail[r.uid] !== loginEmail_(r.loginId)) {
      if (failedIds[r.uid]) {
        const msg = String(failedIds[r.uid]).indexOf("EMAIL_EXISTS") === 0 ? "이미 다른 계정이 쓰는 ID" : failedIds[r.uid];
        setStatus_(sh, r.row, "❌ ID 변경 실패: " + msg);
        failed++;
        return;
      }
      status = "✅ ID 변경 (" + authEmail[r.uid].split("@")[0] + " → " + r.loginId + ")";
    }
    const p = profileOf_(r);
    Object.keys(p).forEach(k => { if (k !== "active") patch[r.uid + "/" + k] = p[k]; });
    if (r.role === "teacher") ["sid", "grade", "cls", "no", "sids"].forEach(k => { patch[r.uid + "/" + k] = null; });
    setStatus_(sh, r.row, status);
    updated++;
  });

  // 2) UID 가 없는 행 → 새 계정 생성 (50개씩 병렬 요청)
  const todo = rows.filter(r => !r.uid);
  for (let i = 0; i < todo.length; i += 50) {
    if (Date.now() - started > 5 * 60 * 1000) {
      SpreadsheetApp.getUi().alert("⏱ 실행 시간 한도에 가까워 중단했습니다. 메뉴를 한 번 더 실행하면 이어서 처리합니다.");
      break;
    }
    const chunk = todo.slice(i, i + 50).filter(r => {
      if (!r.role) { setStatus_(sh, r.row, "❌ 구분(학생/교사) 오류"); failed++; return false; }
      if (!/^[a-zA-Z0-9._-]+$/.test(r.loginId)) { setStatus_(sh, r.row, "❌ ID는 영문·숫자만"); failed++; return false; }
      if (pwOf_(r).length < MIN_PW_LENGTH) { setStatus_(sh, r.row, "❌ 초기 비밀번호 " + MIN_PW_LENGTH + "자 이상"); failed++; return false; }
      return true;
    });
    const responses = UrlFetchApp.fetchAll(chunk.map(r =>
      toolkitRequest_("accounts", { email: loginEmail_(r.loginId), password: PW_PREFIX + pwOf_(r), displayName: r.name })
    ));
    responses.forEach((res, j) => {
      const r = chunk[j];
      const json = JSON.parse(res.getContentText() || "{}");
      let uid = json.localId;
      try {
        if (!uid && json.error && String(json.error.message).indexOf("EMAIL_EXISTS") === 0) {
          // 이미 인증 계정이 있으면(시트에서 UID 만 지워진 경우) 찾아서 비밀번호를 초기값으로 맞춤
          const found = toolkitCall_("accounts:lookup", { email: [loginEmail_(r.loginId)] });
          uid = found.users && found.users[0] && found.users[0].localId;
          if (uid) toolkitCall_("accounts:update", { localId: uid, password: PW_PREFIX + pwOf_(r), disableUser: false });
        }
        if (!uid) throw new Error(json.error ? json.error.message : "알 수 없는 오류");
        patch[uid] = Object.assign(profileOf_(r), { mustChangePw: true });
        setStatus_(sh, r.row, "✅ 생성", uid);
        created++;
      } catch (e) {
        setStatus_(sh, r.row, "❌ " + e.message);
        failed++;
      }
    });
  }

  if (Object.keys(patch).length) dbPatch_("users", patch);
  SpreadsheetApp.getUi().alert("완료\n\n새 계정: " + created + "\n정보 반영: " + updated + "\n실패: " + failed);
}

// =======================================================
// 🔑 선택행 PW 초기화
//  전원 초기화: 시트에서 2행부터 끝까지 선택한 뒤 실행하고, 공통 비밀번호를 입력하면 됩니다.
// =======================================================
function resetSelectedPasswords() {
  if (!requireAdmin_()) return;
  const ui = SpreadsheetApp.getUi();
  const rows = readRows_(true).filter(r => r.uid);
  if (!rows.length) { ui.alert("UID 가 있는 행을 선택하세요."); return; }
  const ask = ui.prompt("비밀번호 초기화 (" + rows.length + "명)",
    "새 초기 비밀번호를 입력하세요.\n비워 두면 각 행의 [초기 비밀번호] 칸 값(그 칸도 비면 " + DEFAULT_PW + ")을 사용합니다.", ui.ButtonSet.OK_CANCEL);
  if (ask.getSelectedButton() !== ui.Button.OK) return;
  const common = ask.getResponseText().trim();

  const sh = getSheet_();
  const patch = {};
  let ok = 0;
  rows.forEach(r => {
    const pw = common || pwOf_(r);
    if (String(pw).length < MIN_PW_LENGTH) { setStatus_(sh, r.row, "❌ 초기 비밀번호 " + MIN_PW_LENGTH + "자 이상"); return; }
    try {
      toolkitCall_("accounts:update", { localId: r.uid, password: PW_PREFIX + pw });
      patch[r.uid + "/mustChangePw"] = true;
      if (common) sh.getRange(r.row, COL.PW).setValue(common);
      setStatus_(sh, r.row, "🔑 초기화 " + Utilities.formatDate(new Date(), "Asia/Seoul", "MM/dd HH:mm"));
      ok++;
    } catch (e) {
      setStatus_(sh, r.row, "❌ " + e.message);
    }
  });
  if (Object.keys(patch).length) dbPatch_("users", patch);
  ui.alert(ok + "명의 비밀번호를 초기화했습니다.\n학생은 다음 로그인 때 새 비밀번호로 변경하게 됩니다.");
}

// =======================================================
// 🟰Record앱과 명단대조 — 보여 주기만 하고 아무것도 고치지 않습니다.
//  올해 학번(ID 열) 기준으로 record DB(students/{학번}) 와 견줘,
//  한쪽에만 있는 학생을 목록으로 띄웁니다. 양쪽에 다 있는 학생은 나오지 않습니다.
//  ※ record 는 올해 학번만 갖고 있으므로 지난 학년도 학번은 대조 대상이 아닙니다.
// =======================================================
function compareWithRecord() {
  if (!requireAdmin_()) return;
  const ui = SpreadsheetApp.getUi();
  const keys = Object.keys(JSON.parse(UrlFetchApp.fetch(DB_URL + "/students.json?shallow=true&access_token=" + encodeURIComponent(ScriptApp.getOAuthToken())).getContentText()) || {});
  const inRecord = {};
  keys.forEach(k => { inRecord[k] = true; });

  const students = readRows_(false).filter(r => r.role === "student" && r.loginId);
  const inSheet = {};
  students.forEach(r => { inSheet[r.loginId] = r; });

  const onlyRecord = keys.filter(k => !inSheet[k]).sort(sidCompare_);
  const onlySheet = students.filter(r => !inRecord[r.loginId]).sort((a, b) => sidCompare_(a.loginId, b.loginId));

  // record 쪽 이름을 채웁니다 (목록에 이름이 있어야 어느 학생인지 압니다)
  const names = [];
  for (let i = 0; i < onlyRecord.length; i += 100) {
    UrlFetchApp.fetchAll(onlyRecord.slice(i, i + 100).map(id => ({ url: dbUrl_("students/" + id + "/name"), muteHttpExceptions: true })))
      .forEach(res => names.push(JSON.parse(res.getContentText() || "null") || ""));
  }

  if (!onlyRecord.length && !onlySheet.length) {
    ui.alert("🟰Record앱과 명단대조",
      "두 명단이 똑같습니다. (학생 " + students.length + "명)", ui.ButtonSet.OK);
    return;
  }

  const rowsHtml = list => list.length
    ? list.map(x => "<tr><td>" + x[0] + "</td><td>" + escapeHtml_(x[1]) + "</td><td>" + (x[2] || "") + "</td></tr>").join("")
    : "<tr><td colspan='3' class='none'>없음</td></tr>";
  const html = HtmlService.createHtmlOutput(
    "<style>body{font-family:'Malgun Gothic',sans-serif;font-size:13px;margin:0;padding:12px}" +
    "h3{margin:14px 0 6px;font-size:14px}h3:first-child{margin-top:0}" +
    "p.hint{color:#5f6368;margin:2px 0 8px;font-size:12px}" +
    "table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #eee;padding:4px 6px}" +
    "td:first-child{width:80px;font-variant-numeric:tabular-nums}td:last-child{color:#5f6368}" +
    ".none{color:#9aa0a6;text-align:center;padding:10px}" +
    ".sum{background:#e8f0fe;border-radius:6px;padding:8px 10px;margin-bottom:10px}</style>" +
    "<div class='sum'>계정 시트 학생 " + students.length + "명 · Record앱 학생 " + keys.length + "명" +
    "<br>양쪽에 다 있는 학생은 목록에 나오지 않습니다.</div>" +
    "<h3>🟦 Record앱에만 있는 학생 (" + onlyRecord.length + "명)</h3>" +
    "<p class='hint'>전입생이거나, 계정 시트에 아직 안 넣은 학생입니다.</p>" +
    "<table>" + rowsHtml(onlyRecord.map((id, i) => [id, names[i]])) + "</table>" +
    "<h3>🟨 계정 시트에만 있는 학생 (" + onlySheet.length + "명)</h3>" +
    "<p class='hint'>Record앱에서 빠진 학생입니다(전학·자퇴). 괄호는 시트 행 번호입니다.</p>" +
    "<table>" + rowsHtml(onlySheet.map(r => [r.loginId, r.name, r.row + "행"])) + "</table>"
  ).setWidth(460).setHeight(520);
  ui.showModalDialog(html, "🟰Record앱과 명단대조");
}

function escapeHtml_(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// 학번을 자릿수·숫자 순으로 정렬
function sidCompare_(a, b) {
  const x = String(a), y = String(b);
  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
}

// =======================================================
// [웹 앱] 파일 업로드·다운로드·삭제
//  배포: 배포 > 새 배포 > 웹 앱 / 실행: 나 / 액세스: 모든 사용자
// =======================================================
// 웹 앱 주소를 그냥 열면 나오는 상태 확인용.
// 제출 파일은 "웹 앱을 배포한 계정"의 드라이브에 저장되므로, 그 계정을 여기서 확인합니다.
// (주소가 공개되어 있으므로 이메일은 앞 세 글자만 보여 줍니다)
function doGet() {
  let account = "(확인 불가)", folder = "(아직 없음)";
  try {
    account = String(Session.getEffectiveUser().getEmail() || "").replace(/^(.{3}).*(@.*)$/, "$1***$2");
  } catch (e) { /* 권한이 없으면 그대로 둠 */ }
  try {
    const id = PropertiesService.getScriptProperties().getProperty("ROOT_FOLDER_ID");
    if (id) folder = DriveApp.getFolderById(id).getName();
  } catch (e) { folder = "(폴더를 열 수 없음 — 배포 계정이 바뀌었는지 확인하세요)"; }
  return json_({ ok: true, service: "school-portal", deployedAs: account, driveFolder: folder });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const user = verifyUser_(req.idToken);
    if (req.action === "upload") return json_(uploadFile_(user, req));
    if (req.action === "download") return json_(downloadFile_(user, req));
    if (req.action === "remove") return json_(removeFile_(user, req));
    return json_({ error: "알 수 없는 요청입니다." });
  } catch (err) {
    return json_({ error: err.message || String(err) });
  }
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// Firebase ID 토큰 검증 → users/{uid} 프로필 반환
function verifyUser_(idToken) {
  if (!idToken) throw new Error("로그인이 필요합니다.");
  const cache = CacheService.getScriptCache();
  const cacheKey = "tok_" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const res = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + API_KEY, {
    method: "post", contentType: "application/json", payload: JSON.stringify({ idToken }), muteHttpExceptions: true
  });
  const data = JSON.parse(res.getContentText() || "{}");
  const uid = data.users && data.users[0] && data.users[0].localId;
  if (!uid) throw new Error("로그인이 만료되었습니다. 다시 로그인하세요.");
  const profile = dbGet_("users/" + uid);
  if (!profile || profile.active === false) throw new Error("사용할 수 없는 계정입니다.");
  profile.uid = uid;
  cache.put(cacheKey, JSON.stringify(profile), 300);
  return profile;
}

function safeName_(s) {
  return String(s || "").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 80) || "_";
}

function getOrCreateFolder_(parent, name) {
  const it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function getRootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("ROOT_FOLDER_ID");
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 폴더가 삭제된 경우 새로 만듦 */ }
  }
  const folder = getOrCreateFolder_(null, DRIVE_ROOT_NAME);
  props.setProperty("ROOT_FOLDER_ID", folder.getId());
  return folder;
}

function uploadFile_(user, req) {
  if (user.role !== "student") throw new Error("학생 계정만 업로드할 수 있습니다.");
  if (String(req.sid) !== String(user.sid)) throw new Error("본인 자료만 업로드할 수 있습니다.");
  const bytes = Utilities.base64Decode(req.data);
  if (bytes.length > MAX_FILE_MB * 1024 * 1024) throw new Error("파일이 " + MAX_FILE_MB + "MB를 넘습니다.");

  // 폴더 구조: 스쿨포털_제출자료 / 2026학년도 / 동아리 / 프로그램명 / 10101_홍길동
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let folder;
  try {
    folder = getRootFolder_();
    folder = getOrCreateFolder_(folder, safeName_((req.year || "") + "학년도"));
    folder = getOrCreateFolder_(folder, CATEGORY_LABELS[req.category] || "기타");
    folder = getOrCreateFolder_(folder, safeName_(req.programTitle) + " (" + String(req.programId).slice(-6) + ")");
    folder = getOrCreateFolder_(folder, safeName_(user.sid + "_" + user.name));
  } finally {
    lock.releaseLock();
  }

  const blob = Utilities.newBlob(bytes, req.mimeType || "application/octet-stream", safeName_(req.fileName));
  const file = folder.createFile(blob);
  // 다운로드 권한 확인용 메타데이터 (파일은 공유하지 않고 교사 드라이브에만 보관)
  file.setDescription(JSON.stringify({ sid: user.sid, subId: req.subId, programId: req.programId }));
  return { id: file.getId() };
}

function fileMeta_(file) {
  try { return JSON.parse(file.getDescription() || "{}"); } catch (e) { return {}; }
}

// 학생: 본인 파일만 / 교사: 그 프로그램 제출자료를 볼 수 있을 때만 (비공개 프로그램은 만든 교사만)
function checkFileAccess_(user, file, forRemove) {
  const meta = fileMeta_(file);
  if (user.role !== "teacher") {
    if (String(meta.sid || "") !== String(user.sid)) throw new Error("이 파일에 접근할 권한이 없습니다.");
    return;
  }
  const program = meta.programId ? dbGet_("portal/programs/" + meta.programId) : null;
  const isOwner = program && program.createdByUid === user.uid;
  if (forRemove ? !isOwner : (program && program.private === true && !isOwner)) {
    throw new Error("담당 교사만 볼 수 있는 파일입니다.");
  }
}

function downloadFile_(user, req) {
  const file = DriveApp.getFileById(req.fileId);
  checkFileAccess_(user, file, false);
  const blob = file.getBlob();
  return { name: file.getName(), mimeType: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function removeFile_(user, req) {
  const file = DriveApp.getFileById(req.fileId);
  checkFileAccess_(user, file, true);
  file.setTrashed(true);
  return { ok: true };
}

// =======================================================
// ✅교사별 자료보기 · ❌자료 삭제 — 없어진 교사 계정이 만든 프로그램·출석 반을 지웁니다.
//  앱에서는 만든 교사만 지울 수 있어서, 계정을 지운 뒤에는 앱으로 정리할 수 없습니다.
// =======================================================
function portalOwnerStats_() {
  const groups = dbGet_("portal/att/groups") || {};
  const programs = dbGet_("portal/programs") || {};
  const stats = {};
  const bump = (uid, name, field) => {
    const key = uid || "(등록 교사 정보 없음)";
    stats[key] = stats[key] || { name: name || "", groups: 0, programs: 0 };
    if (name && !stats[key].name) stats[key].name = name;
    stats[key][field]++;
  };
  Object.values(groups).forEach(g => bump(g.createdByUid, g.createdBy, "groups"));
  Object.values(programs).forEach(p => bump(p.createdByUid, p.createdBy, "programs"));
  return stats;
}

function listPortalOwners() {
  if (!requireAdmin_()) return;
  const stats = portalOwnerStats_();
  const lines = Object.keys(stats).map(uid =>
    `• ${stats[uid].name || "(이름 없음)"}  |  UID: ${uid}\n   출석 반 ${stats[uid].groups}개 · 프로그램 ${stats[uid].programs}개`);
  SpreadsheetApp.getUi().alert("✅교사별 자료보기",
    (lines.length ? lines.join("\n\n") : "자료가 없습니다.") +
    "\n\n지우려면 [⚙️관리자 도구 → ❌자료 삭제] 를 실행하고 위 UID 나 이름을 입력하세요.",
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function deletePortalDataByOwner() {
  if (!requireAdmin_()) return;
  const ui = SpreadsheetApp.getUi();
  const ask = ui.prompt("자료 삭제",
    "지울 자료를 만든 교사의 UID 또는 이름을 입력하세요.\n(먼저 [✅교사별 자료보기] 로 확인하세요)",
    ui.ButtonSet.OK_CANCEL);
  if (ask.getSelectedButton() !== ui.Button.OK) return;
  const key = ask.getResponseText().trim();
  if (!key) return;

  const groups = dbGet_("portal/att/groups") || {};
  const programs = dbGet_("portal/programs") || {};
  const submissions = dbGet_("portal/submissions") || {};
  const match = obj => obj && (obj.createdByUid === key || obj.createdBy === key);

  const gids = Object.keys(groups).filter(id => match(groups[id]));
  const pids = Object.keys(programs).filter(id => match(programs[id]));

  let subCount = 0, fileCount = 0;
  const fileIds = [];
  pids.forEach(pid => {
    Object.values(submissions[pid] || {}).forEach(bySid => {
      Object.values(bySid || {}).forEach(sub => {
        subCount++;
        (sub.files || []).forEach(f => { if (f && f.id) { fileIds.push(f.id); fileCount++; } });
      });
    });
  });

  if (!gids.length && !pids.length) { ui.alert("해당하는 자료가 없습니다: " + key); return; }

  const summary =
    `[${key}] 이(가) 만든 자료를 지웁니다.\n\n` +
    `• 출석 반 ${gids.length}개: ${gids.map(id => groups[id].name).join(", ") || "-"}\n` +
    `   (그 반의 출결 기록·운영일·체크인 코드도 함께 삭제)\n` +
    `• 프로그램 ${pids.length}개: ${pids.map(id => programs[id].title).join(", ") || "-"}\n` +
    `   (학생 제출자료 ${subCount}건, 첨부 파일 ${fileCount}개도 함께 삭제)\n\n` +
    `되돌릴 수 없습니다. 계속할까요?`;
  if (ui.alert("⚠️ 삭제 확인", summary, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  gids.forEach(id => {
    dbDelete_("portal/att/records/" + id);
    dbDelete_("portal/att/sessions/" + id);
    dbDelete_("portal/att/codes/" + id);
    dbDelete_("portal/att/groups/" + id);
  });
  pids.forEach(id => {
    dbDelete_("portal/submissions/" + id);
    dbDelete_("portal/programs/" + id);
  });
  let trashed = 0;
  fileIds.forEach(fid => {
    try { DriveApp.getFileById(fid).setTrashed(true); trashed++; } catch (e) { /* 이미 지워진 파일 */ }
  });

  ui.alert("삭제 완료",
    `출석 반 ${gids.length}개, 프로그램 ${pids.length}개(제출자료 ${subCount}건)를 지웠습니다.\n첨부 파일 ${trashed}개를 휴지통으로 옮겼습니다.`,
    ui.ButtonSet.OK);
}

function dbDelete_(path) {
  const res = UrlFetchApp.fetch(dbUrl_(path), { method: "delete", muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("DB 삭제 실패(" + path + "): " + res.getContentText());
}

// =======================================================
// 🔅신학년 준비
//  지금 ID 열(학번)을 "○○○○년" 열로 복사해 두고, 현재 학년도를 다음 해로 바꿉니다.
//  그다음 ID·학년·반·번호를 새 학번으로 고치고 ② 를 실행하면, 학생마다 연도별 학번이 이어집니다.
// =======================================================
function prepareNewYear() {
  if (!requireAdmin_()) return;
  const ui = SpreadsheetApp.getUi();

  // 1) 시기 확인 — 2·3월에만 (그 학년도 활동이 끝난 뒤 ~ 새 학년도 첫 수업 전)
  const month = new Date().getMonth() + 1;
  if (month !== 2 && month !== 3) {
    ui.alert("🔅신학년 준비",
      "새학년도 준비 기간이 아닙니다.\n\n" +
      "2월 · 3월에만 실행할 수 있습니다.\n" +
      "(그 학년도 활동이 모두 끝난 뒤 ~ 새 학년도 첫 수업 전)", ui.ButtonSet.OK);
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const year = idColumnYear_();          // 지금 ID 열 학번의 학년도
  const next = year + 1;

  // 두 번 실행하면 학번이 엉뚱한 연도 열에 적힙니다.
  if (Number(props.getProperty("NEW_YEAR_DONE")) === next) {
    const again = ui.alert("🔅신학년 준비",
      next + "학년도 준비는 이미 끝냈습니다. (" + (props.getProperty("NEW_YEAR_DONE_AT") || "") + ")\n\n" +
      "또 실행하면 새 학번이 지난 연도 열에 적힐 수 있습니다.\n그래도 다시 실행할까요?", ui.ButtonSet.YES_NO);
    if (again !== ui.Button.YES) return;
  }

  const sh = getSheet_();
  const students = readRows_(false).filter(r => r.role === "student");
  if (!students.length) { ui.alert("계정 시트에 학생 행이 없습니다."); return; }

  const seniors = students.filter(r => SENIOR_SID.test(r.loginId));
  const graduating = seniors.filter(r => r.uid);
  const toCopy = students.filter(r => !SENIOR_SID.test(r.loginId) && !String(r.years[year] || "").trim());

  // 2) 되돌릴 수 없는 작업이므로 무엇이 닫히고 무엇이 바뀌는지 분명히 알립니다.
  const ok = ui.alert("🔅신학년 준비",
    year + "학년도 활동이 모두 끝났나요?\n" +
    "계속 진행하면 더이상 " + year + "학년도 활동을 관리하지 못합니다.\n" +
    "(지난 학년도 출결 체크인 · 자료 제출이 닫힙니다)\n\n" +
    "──────────────────\n" +
    "① 3학년 " + graduating.length + "명을 \"" + next + "\" 졸업시트로 자동 이관합니다\n" +
    "② 나머지 학생 " + toCopy.length + "명의 지금 학번을 \"" + year + "년\" 열에 보관합니다\n" +
    "③ 현재 학년도를 " + year + " → " + next + " 로 바꿉니다\n" +
    "──────────────────\n\n" +
    "※ 시트의 ID(학번)는 이 단계에서 바뀌지 않습니다.\n\n계속할까요?", ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  // ① 3학년 졸업 이관 (행이 지워지므로 이어지는 단계는 시트를 다시 읽습니다)
  if (graduating.length) {
    exportRows_(sh, graduating, {
      sheetName: String(next), emailPrefix: "grad-", sidYear: year,
      status: "🎓 " + next + " 졸업", extra: { graduated: next }
    });
  }

  // ② 남은 학생의 지금 학번을 연도 열에 보관
  const rest = readRows_(false).filter(r => r.role === "student" && !String(r.years[year] || "").trim());
  if (rest.length) {
    const col = yearCol_(sh, year);
    rest.forEach(r => sh.getRange(r.row, col).setNumberFormat("@").setValue(r.loginId));
  }

  // ③ 현재 학년도 변경
  props.setProperties({
    CURRENT_SCHOOL_YEAR: String(next),
    NEW_YEAR_DONE: String(next),
    NEW_YEAR_DONE_AT: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm")
  });

  const noUid = seniors.length - graduating.length;
  ui.alert("🔅신학년 준비 완료",
    "이제 새학년도 준비가 끝났습니다.\n\n" +
    "• 3학년 " + graduating.length + "명을 \"" + next + "\" 시트로 이관했습니다\n" +
    "• 학생 " + rest.length + "명의 학번을 \"" + year + "년\" 열에 보관했습니다\n" +
    "• 현재 학년도가 " + next + " 로 바뀌었습니다\n" +
    (noUid ? "\n⚠ 계정(UID)이 없는 3학년 행 " + noUid + "개는 그대로 두었습니다. 직접 확인하세요.\n" : "") +
    "\n──────────────────\n" +
    "다음에 하실 일\n\n" +
    "1. 진급한 학생들의 학번을 신학번으로 변경하세요\n" +
    "2. 신입생 정보도 추가하세요\n" +
    "3. 그리고나면 반드시 [🔥Firebase 동기화] 를 실행하셔야 합니다",
    ui.ButtonSet.OK);
}

// =======================================================
// 🎓 졸업 이관 · 🚷 선택행 제외 처리(전학·자퇴·전근) (공통 엔진)
//  - 학생은 지금 학번을 연도 열에 남기고 ID 열을 비웁니다 → 그 학번을 다음 학생이 쓸 수 있습니다.
//  - 포털 로그인을 막습니다. (계정·프로필은 지우지 않으므로 지난 기록이 이름과 함께 계속 보입니다)
//  - 행을 다른 시트로 옮깁니다.
//  졸업은 [🔅신학년 준비] 가 3학년을 자동으로 처리하므로 따로 누를 메뉴가 없습니다.
// =======================================================
const MOVEOUT_SHEET = "전출";

// 전학·자퇴 학생, 전근·퇴직 교사. (시트 행만 지우면 계정이 살아 있어 계속 로그인됩니다)
function moveOutSelected() {
  if (!requireAdmin_()) return;
  const ui = SpreadsheetApp.getUi();
  const sh = getSheet_();
  const rows = readRows_(true, true).filter(r => r.uid && r.role);
  if (!rows.length) { ui.alert("UID 가 있는 행을 선택하세요.\n(전학·자퇴 학생, 전근·퇴직 교사)"); return; }
  const sidYear = currentSchoolYear_();

  const list = rows.slice(0, 15).map(r => "  · " + (r.role === "teacher" ? "교사 " : "") + (r.loginId || "(ID 없음)") + " " + r.name).join("\n");
  const ok = ui.alert("🚷 선택행 제외 처리 (" + rows.length + "명)",
    list + (rows.length > 15 ? "\n  · … 외 " + (rows.length - 15) + "명" : "") + "\n\n" +
    "• 포털 로그인을 막습니다\n" +
    "• 학생은 지금 학번을 \"" + sidYear + "년\" 열에 남기고 ID 열을 비웁니다\n" +
    "• 행을 \"" + MOVEOUT_SHEET + "\" 시트로 옮깁니다\n" +
    "• 지난 활동·출결 기록은 선생님들이 이름과 함께 계속 볼 수 있습니다\n\n" +
    "⚠ 이 학번은 " + sidYear + "학년도가 끝날 때까지 다른 학생에게 주지 마세요.\n" +
    "   (같은 해에 같은 학번을 쓰면 전입생이 전출 학생의 자료를 보게 됩니다. 전입생은 뒷번호로)\n\n계속할까요?", ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  exportRows_(sh, rows, {
    sheetName: MOVEOUT_SHEET, emailPrefix: "out-",
    status: "🚷 제외 " + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd"),
    extra: { leftAt: sidYear }
  });
  ui.alert("🚷 완료", rows.length + "명을 \"" + MOVEOUT_SHEET + "\" 시트로 옮기고 로그인을 막았습니다.", ui.ButtonSet.OK);
}

function exportRows_(sh, rows, opt) {
  // 학번을 어느 연도 열에 남길지. [🔅신학년 준비] 는 3월에도 지난 학년도로 남겨야 해서 직접 지정합니다.
  const sidYear = opt.sidYear || currentSchoolYear_();

  // 1) 학생의 지금 학번을 연도 열에 기록
  const students = rows.filter(r => r.role === "student" && r.loginId);
  if (students.length) {
    const col = yearCol_(sh, sidYear);
    students.forEach(r => {
      const already = Object.values(r.years || {}).indexOf(r.loginId) >= 0;
      if (!already) { sh.getRange(r.row, col).setNumberFormat("@").setValue(r.loginId); r.years[sidYear] = r.loginId; }
    });
  }

  // 2) 로그인 막기 + 로그인 ID 비우기(전용 ID 로 옮김)
  const patch = {};
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    UrlFetchApp.fetchAll(chunk.map(r => toolkitRequest_("accounts:update",
      { localId: r.uid, email: opt.emailPrefix + r.uid.toLowerCase() + "@" + EMAIL_DOMAIN, disableUser: true })));
  }
  rows.forEach(r => {
    patch[r.uid + "/active"] = false;
    patch[r.uid + "/loginId"] = null;
    if (r.role === "student") {
      patch[r.uid + "/sid"] = null;
      patch[r.uid + "/sids"] = sidsOf_(Object.assign({}, r, { loginId: "" }), sidYear);
    }
    Object.keys(opt.extra || {}).forEach(k => { patch[r.uid + "/" + k] = opt.extra[k]; });
  });
  dbPatch_("users", patch);

  // 3) ID 열 비우고 상태 표시
  const cols = loadCols_(sh);
  rows.forEach(r => {
    sh.getRange(r.row, cols.ID).setValue("");
    sh.getRange(r.row, cols.STATUS).setValue(opt.status);
  });

  // 4) 대상 시트로 옮기기 (헤더 이름을 맞춰서 붙임)
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const target = ss.getSheetByName(opt.sheetName) || ss.insertSheet(opt.sheetName);
  const srcHeader = sh.getRange(1, 1, 1, cols.LAST).getDisplayValues()[0].map(h => String(h).trim());
  let tgtHeader = target.getLastColumn() ? target.getRange(1, 1, 1, target.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim()) : [];
  srcHeader.forEach(h => { if (h && tgtHeader.indexOf(h) < 0) tgtHeader.push(h); });
  target.getRange(1, 1, 1, tgtHeader.length).setValues([tgtHeader]).setFontWeight("bold").setBackground("#e8f0fe");
  target.setFrozenRows(1);

  const sorted = rows.slice().sort((a, b) => a.row - b.row);
  const values = sorted.map(r => sh.getRange(r.row, 1, 1, cols.LAST).getDisplayValues()[0]);
  const out = values.map(v => tgtHeader.map(h => { const i = srcHeader.indexOf(h); return i >= 0 ? v[i] : ""; }));
  const start = Math.max(target.getLastRow(), 1) + 1;
  target.getRange(start, 1, out.length, tgtHeader.length).setNumberFormat("@").setValues(out);
  sorted.slice().reverse().forEach(r => sh.deleteRow(r.row));
}
