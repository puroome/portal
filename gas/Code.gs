// =======================================================
// 광남고 스쿨포털 - Apps Script 백엔드
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
const ADMIN_EMAIL  = "puroome@gmail.com";       // 계정 관리 메뉴를 실행할 수 있는 관리자
const DRIVE_ROOT_NAME = "스쿨포털_제출자료";      // 제출 파일이 모이는 최상위 폴더 이름
const MAX_FILE_MB  = 10;
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

const SHEET_NAME = "계정";
const COL = { TYPE: 1, ID: 2, NAME: 3, GRADE: 4, CLASS: 5, NO: 6, PW: 7, STATUS: 8, UID: 9, GOOGLE: 10 };
const HEADERS = ["구분(학생/교사)", "ID(학번/교사ID)", "이름", "학년", "반", "번호", "초기 비밀번호", "상태", "UID(자동)", "학교 Google 계정"];
const CATEGORY_LABELS = { bitnada: "빛나다프로그램", club: "동아리", subject: "교과", contest: "심화탐구대회" };

// =======================================================
// [메뉴]
// =======================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu("🏫 스쿨포털")
    .addItem("① 계정 시트 준비", "setupSheet")
    .addItem("   └ record 학생 명단 가져오기 (학번·이름)", "importStudentsFromRecord")
    .addItem("   └ 빈 초기 비밀번호를 record 비밀번호로 채우기", "fillPasswordsFromRecord")
    .addSeparator()
    .addItem("② 계정 생성 · 정보 반영 (전체 행)", "syncAccounts")
    .addSeparator()
    .addItem("🔑 선택한 행 비밀번호 초기화", "resetSelectedPasswords")
    .addItem("⛔ 선택한 행 사용 중지", "disableSelected")
    .addItem("✅ 선택한 행 사용 재개", "enableSelected")
    .addSeparator()
    .addItem("🔧 제출자료 저장 구조 변환 (업데이트 후 1회)", "migrateSubmissionsByProgram")
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

function setupSheet() {
  if (!requireAdmin_()) return;
  const sh = getSheet_();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold").setBackground("#e8f0fe");
  sh.setFrozenRows(1);
  // 학번·비밀번호가 숫자로 바뀌어 앞자리 0 이 사라지지 않도록 텍스트 서식
  sh.getRange(2, COL.ID, sh.getMaxRows() - 1, 1).setNumberFormat("@");
  sh.getRange(2, COL.PW, sh.getMaxRows() - 1, 1).setNumberFormat("@");
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(["학생", "교사"], true).build();
  sh.getRange(2, COL.TYPE, sh.getMaxRows() - 1, 1).setDataValidation(rule);
  sh.setColumnWidth(COL.UID, 90);
  SpreadsheetApp.getUi().alert(
    "계정 시트를 준비했습니다.\n\n" +
    "• 학생: 구분=학생, ID=학번, 이름·학년·반·번호 입력\n" +
    "• 교사: 구분=교사, ID=영문/숫자 (예: t_kim), 이름 입력\n" +
    "• 초기 비밀번호: " + MIN_PW_LENGTH + "자 이상 (첫 로그인 시 본인이 변경)\n\n" +
    "입력 후 [② 계정 생성 · 정보 반영]을 실행하세요."
  );
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

function isEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function loginEmail_(loginId) {
  return String(loginId).trim().toLowerCase() + "@" + EMAIL_DOMAIN;
}

// =======================================================
// [계정] 시트 읽기
// =======================================================
function readRows_(onlySelected) {
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  let rowNumbers = [];
  if (onlySelected) {
    sh.getActiveRangeList().getRanges().forEach(r => {
      for (let i = r.getRow(); i < r.getRow() + r.getNumRows(); i++) if (i >= 2 && i <= last) rowNumbers.push(i);
    });
    rowNumbers = [...new Set(rowNumbers)];
  }
  const values = sh.getRange(2, 1, last - 1, HEADERS.length).getDisplayValues();
  return values.map((v, i) => ({
    row: i + 2,
    role: v[COL.TYPE - 1].trim() === "교사" ? "teacher" : (v[COL.TYPE - 1].trim() === "학생" ? "student" : ""),
    loginId: v[COL.ID - 1].trim(),
    name: v[COL.NAME - 1].trim(),
    grade: v[COL.GRADE - 1].trim(),
    cls: v[COL.CLASS - 1].trim(),
    no: v[COL.NO - 1].trim(),
    pw: v[COL.PW - 1],
    uid: v[COL.UID - 1].trim(),
    googleEmail: v[COL.GOOGLE - 1].trim().toLowerCase()
  })).filter(r => r.loginId && (!onlySelected || rowNumbers.includes(r.row)));
}

function setStatus_(sh, row, status, uid) {
  sh.getRange(row, COL.STATUS).setValue(status);
  if (uid) sh.getRange(row, COL.UID).setValue(uid);
}

function profileOf_(r) {
  const p = { role: r.role, loginId: r.loginId, name: r.name, active: true, googleEmail: r.googleEmail || null };
  if (r.role === "student") Object.assign(p, { sid: r.loginId, grade: r.grade, cls: r.cls, no: r.no });
  return p;
}

// =======================================================
// ② 계정 생성 · 정보 반영
// =======================================================
function syncAccounts() {
  if (!requireAdmin_()) return;
  const sh = getSheet_();
  // 예전에 만든 시트에는 새 열 제목이 없으므로 채워 둠
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold").setBackground("#e8f0fe");
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
  withUid.forEach(r => {
    if (!r.role) { setStatus_(sh, r.row, "❌ 구분 오류"); failed++; return; }
    if (r.googleEmail && !isEmail_(r.googleEmail)) { setStatus_(sh, r.row, "❌ 학교 Google 계정 형식 오류"); failed++; return; }
    if (!/^[a-zA-Z0-9._-]+$/.test(r.loginId)) { setStatus_(sh, r.row, "❌ ID는 영문·숫자만"); failed++; return; }
    if (!authEmail[r.uid]) { setStatus_(sh, r.row, "❌ 인증 계정 없음 (UID 칸을 지우고 다시 실행)"); failed++; return; }
    let status = "✅ 정보 반영";
    const oldId = authEmail[r.uid].split("@")[0];
    if (authEmail[r.uid] !== loginEmail_(r.loginId)) {
      try {
        toolkitCall_("accounts:update", { localId: r.uid, email: loginEmail_(r.loginId) });
        status = "✅ ID 변경 (" + oldId + " → " + r.loginId + ")";
      } catch (e) {
        const msg = String(e.message).indexOf("EMAIL_EXISTS") === 0 ? "이미 다른 계정이 쓰는 ID" : e.message;
        setStatus_(sh, r.row, "❌ ID 변경 실패: " + msg);
        failed++;
        return;
      }
    }
    const p = profileOf_(r);
    Object.keys(p).forEach(k => { if (k !== "active") patch[r.uid + "/" + k] = p[k]; });
    if (r.role === "teacher") ["sid", "grade", "cls", "no"].forEach(k => { patch[r.uid + "/" + k] = null; });
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
      if (String(r.pw).length < MIN_PW_LENGTH) { setStatus_(sh, r.row, "❌ 초기 비밀번호 " + MIN_PW_LENGTH + "자 이상"); failed++; return false; }
      if (r.googleEmail && !isEmail_(r.googleEmail)) { setStatus_(sh, r.row, "❌ 학교 Google 계정 형식 오류"); failed++; return false; }
      return true;
    });
    const responses = UrlFetchApp.fetchAll(chunk.map(r =>
      toolkitRequest_("accounts", { email: loginEmail_(r.loginId), password: PW_PREFIX + r.pw, displayName: r.name })
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
          if (uid) toolkitCall_("accounts:update", { localId: uid, password: PW_PREFIX + r.pw, disableUser: false });
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
// 선택 행 비밀번호 초기화 / 사용 중지 / 재개
// =======================================================
function resetSelectedPasswords() {
  if (!requireAdmin_()) return;
  const ui = SpreadsheetApp.getUi();
  const rows = readRows_(true).filter(r => r.uid);
  if (!rows.length) { ui.alert("UID 가 있는 행을 선택하세요."); return; }
  const ask = ui.prompt("비밀번호 초기화 (" + rows.length + "명)",
    "새 초기 비밀번호를 입력하세요.\n비워 두면 각 행의 [초기 비밀번호] 칸 값을 사용합니다.", ui.ButtonSet.OK_CANCEL);
  if (ask.getSelectedButton() !== ui.Button.OK) return;
  const common = ask.getResponseText().trim();

  const sh = getSheet_();
  const patch = {};
  let ok = 0;
  rows.forEach(r => {
    const pw = common || r.pw;
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

function disableSelected() { setActive_(false); }
function enableSelected() { setActive_(true); }

function setActive_(active) {
  if (!requireAdmin_()) return;
  const rows = readRows_(true).filter(r => r.uid);
  if (!rows.length) { SpreadsheetApp.getUi().alert("UID 가 있는 행을 선택하세요."); return; }
  const sh = getSheet_();
  const patch = {};
  rows.forEach(r => {
    try {
      toolkitCall_("accounts:update", { localId: r.uid, disableUser: !active });
      patch[r.uid + "/active"] = active;
      setStatus_(sh, r.row, active ? "✅ 사용 재개" : "⛔ 사용 중지");
    } catch (e) {
      setStatus_(sh, r.row, "❌ " + e.message);
    }
  });
  if (Object.keys(patch).length) dbPatch_("users", patch);
  SpreadsheetApp.getUi().alert(rows.length + "명 처리했습니다.");
}

// =======================================================
// record 앱 데이터 활용 (선택)
// =======================================================
// students/{학번} 의 학번·이름을 계정 시트에 추가. 학년·반·번호는 학번에서 추정하므로 꼭 확인하세요.
function importStudentsFromRecord() {
  if (!requireAdmin_()) return;
  const ui = SpreadsheetApp.getUi();
  const keys = Object.keys(JSON.parse(UrlFetchApp.fetch(DB_URL + "/students.json?shallow=true&access_token=" + encodeURIComponent(ScriptApp.getOAuthToken())).getContentText()) || {});
  const sh = getSheet_();
  const existing = new Set(readRows_(false).map(r => r.loginId));
  const newIds = keys.filter(k => !existing.has(k)).sort();
  if (!newIds.length) { ui.alert("추가할 새 학생이 없습니다."); return; }

  const names = [];
  for (let i = 0; i < newIds.length; i += 100) {
    const chunk = newIds.slice(i, i + 100);
    UrlFetchApp.fetchAll(chunk.map(id => ({ url: dbUrl_("students/" + id + "/name"), muteHttpExceptions: true })))
      .forEach(res => names.push(JSON.parse(res.getContentText() || "null") || ""));
  }
  const rows = newIds.map((id, i) => {
    let g = "", c = "", n = "";
    if (/^\d{5}$/.test(id)) { g = id[0]; c = String(Number(id.slice(1, 3))); n = String(Number(id.slice(3))); }
    else if (/^\d{4}$/.test(id)) { g = id[0]; c = id[1]; n = String(Number(id.slice(2))); }
    return ["학생", id, names[i], g, c, n, "", "", "", ""];
  });
  const start = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(start, COL.ID, rows.length, 1).setNumberFormat("@");
  sh.getRange(start, COL.PW, rows.length, 1).setNumberFormat("@");
  sh.getRange(start, 1, rows.length, HEADERS.length).setValues(rows);
  ui.alert(rows.length + "명을 추가했습니다.\n학년·반·번호는 학번에서 추정한 값이니 확인 후 초기 비밀번호를 채워주세요.");
}

// 초기 비밀번호 칸이 빈 학생 행을, 학생이 record 앱에서 쓰던 비밀번호로 채움
function fillPasswordsFromRecord() {
  if (!requireAdmin_()) return;
  const sh = getSheet_();
  const rows = readRows_(false).filter(r => r.role === "student" && !r.uid && !String(r.pw).trim());
  let filled = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    UrlFetchApp.fetchAll(chunk.map(r => ({ url: dbUrl_("students/" + r.loginId + "/pw"), muteHttpExceptions: true })))
      .forEach((res, j) => {
        const pw = JSON.parse(res.getContentText() || "null");
        if (pw && String(pw).trim().length >= MIN_PW_LENGTH) {
          sh.getRange(chunk[j].row, COL.PW).setNumberFormat("@").setValue(String(pw).trim());
          filled++;
        }
      });
  }
  SpreadsheetApp.getUi().alert(filled + "명의 초기 비밀번호를 채웠습니다.\n(record 비밀번호가 없거나 " + MIN_PW_LENGTH + "자 미만인 학생은 비어 있습니다)");
}

// =======================================================
// [웹 앱] 파일 업로드·다운로드·삭제
//  배포: 배포 > 새 배포 > 웹 앱 / 실행: 나 / 액세스: 모든 사용자
// =======================================================
function doGet() {
  return json_({ ok: true, service: "school-portal" });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const user = verifyUser_(req.idToken);
    if (req.action === "upload") return json_(uploadFile_(user, req));
    if (req.action === "download") return json_(downloadFile_(user, req));
    if (req.action === "remove") return json_(removeFile_(user, req));
    if (req.action === "englishToken") return json_(englishToken_(user, req));
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
// [ENGLISH] voca · novel 통합 로그인
//  포털에 로그인한 사용자를, 각 앱 Firebase 프로젝트에서 "학교 Google 계정과 같은 사용자"로
//  로그인시키는 1회용 커스텀 토큰을 만듭니다. 같은 UID 를 쓰므로 기존 학습 기록·승인이 그대로 유지됩니다.
//  준비: 각 프로젝트의 서비스 계정 키(JSON)를 스크립트 속성 SA_VOCA / SA_NOVEL 에 붙여넣기
// =======================================================
const ENGLISH_APPS = {
  voca:  { projectId: "wordapp-91c0a", keyProperty: "SA_VOCA" },
  novel: { projectId: "novel-91d5f",  keyProperty: "SA_NOVEL" }
};
const CUSTOM_TOKEN_AUDIENCE = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";

function englishToken_(user, req) {
  const app = ENGLISH_APPS[req.app];
  if (!app) throw new Error("알 수 없는 앱입니다.");
  const email = String(user.googleEmail || "").trim().toLowerCase();
  if (!email) throw new Error("학교 Google 계정이 등록되지 않았습니다. 담당 선생님께 문의하세요.");

  const sa = serviceAccount_(app);
  const uid = appUid_(app, sa, email, user.name);
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt_(sa, {
    iss: sa.client_email, sub: sa.client_email, aud: CUSTOM_TOKEN_AUDIENCE,
    iat: now, exp: now + 300,               // 5분 안에 써야 함
    uid, claims: { portal: true }
  });
  return { token };
}

function serviceAccount_(app) {
  const raw = PropertiesService.getScriptProperties().getProperty(app.keyProperty);
  if (!raw) throw new Error("관리자 설정 필요: 스크립트 속성 " + app.keyProperty + " 가 없습니다.");
  const sa = JSON.parse(raw);
  if (sa.project_id !== app.projectId) {
    throw new Error("관리자 설정 오류: " + app.keyProperty + " 키가 " + app.projectId + " 프로젝트 것이 아닙니다.");
  }
  return sa;
}

function base64Url_(bytesOrString) {
  return Utilities.base64EncodeWebSafe(bytesOrString).replace(/=+$/, "");
}

function signJwt_(sa, claims) {
  const input = base64Url_(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + base64Url_(JSON.stringify(claims));
  return input + "." + base64Url_(Utilities.computeRsaSha256Signature(input, sa.private_key));
}

// 서비스 계정으로 해당 프로젝트의 관리자 액세스 토큰 발급 (50분 캐시)
function saAccessToken_(sa) {
  const cache = CacheService.getScriptCache();
  const key = "sa_tok_" + sa.project_id;
  const cached = cache.get(key);
  if (cached) return cached;
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt_(sa, {
    iss: sa.client_email, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
    scope: "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform"
  });
  const res = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post", payload: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }, muteHttpExceptions: true
  });
  const data = JSON.parse(res.getContentText() || "{}");
  if (!data.access_token) throw new Error("서비스 계정 인증 실패: " + (data.error_description || data.error || res.getResponseCode()));
  cache.put(key, data.access_token, 3000);
  return data.access_token;
}

function appToolkit_(sa, endpoint, body) {
  const res = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/projects/" + sa.project_id + "/" + endpoint, {
    method: "post", contentType: "application/json", payload: JSON.stringify(body),
    headers: { Authorization: "Bearer " + saAccessToken_(sa) }, muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText() || "{}");
  if (json.error) throw new Error(json.error.message);
  return json;
}

// 그 앱에서 이 이메일로 Google 로그인한 적이 있으면 그 UID, 없으면 같은 이메일로 사용자를 만들어 UID 반환
function appUid_(app, sa, email, name) {
  const cache = CacheService.getScriptCache();
  const key = "uid_" + app.projectId + "_" + Utilities.base64EncodeWebSafe(email);
  const cached = cache.get(key);
  if (cached) return cached;
  const found = appToolkit_(sa, "accounts:lookup", { email: [email] });
  let uid = found.users && found.users[0] && found.users[0].localId;
  if (!uid) {
    uid = appToolkit_(sa, "accounts", { email, emailVerified: true, displayName: name || "" }).localId;
  }
  cache.put(key, uid, 21600);
  return uid;
}

// =======================================================
// 🔧 제출자료 저장 구조 변환 (프로그램별 권한 업데이트 후 1회)
//  예전: portal/submissions/{학번}/{자료}  →  지금: portal/submissions/{프로그램}/{학번}/{자료}
//  이미 새 구조인 자료는 그대로 두므로 여러 번 실행해도 안전합니다.
// =======================================================
function migrateSubmissionsByProgram() {
  if (!requireAdmin_()) return;
  const ui = SpreadsheetApp.getUi();
  const all = dbGet_("portal/submissions") || {};
  const programs = dbGet_("portal/programs") || {};
  const result = {};
  let moved = 0, kept = 0, orphan = 0;

  Object.keys(all).forEach(key => {
    Object.keys(all[key] || {}).forEach(child => {
      const node = all[key][child] || {};
      if (node.programId) {
        // 예전 구조: key = 학번, child = 자료 id
        const pid = node.programId;
        if (!programs[pid]) orphan++;
        result[pid] = result[pid] || {};
        result[pid][key] = result[pid][key] || {};
        result[pid][key][child] = node;
        moved++;
      } else {
        // 새 구조: key = 프로그램, child = 학번
        Object.keys(node).forEach(subId => {
          result[key] = result[key] || {};
          result[key][child] = result[key][child] || {};
          result[key][child][subId] = node[subId];
          kept++;
        });
      }
    });
  });

  if (!moved) { ui.alert("변환할 예전 구조 자료가 없습니다. (새 구조 " + kept + "건)"); return; }
  const ok = ui.alert("제출자료 구조 변환",
    "예전 구조 " + moved + "건을 프로그램별 구조로 옮깁니다." + (orphan ? "\n(프로그램이 삭제된 자료 " + orphan + "건 포함)" : "") + "\n계속할까요?",
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  dbPut_("portal/submissions", result);
  ui.alert("완료: " + moved + "건 변환, " + kept + "건 유지");
}
