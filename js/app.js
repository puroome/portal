// 앱 진입점: 로그인 상태 감시, 해시 라우터, 홈 메뉴
import { auth } from "./firebase.js";
import { APP_NAME, CATEGORIES } from "./config.js";
import { session, isTeacher, login, loadProfile, logout, changePasswordDialog } from "./auth.js";
import { $, esc, toast, modal } from "./ui.js";
import { setTitle, runCleanups } from "./nav.js";
import * as programs from "./programs.js";
import * as attendance from "./attendance.js";
import * as grades from "./grades.js";
import * as students from "./students.js";
import * as english from "./english.js";
import { getStudents, filterStudents } from "./directory.js";

// 우클릭 메뉴·이미지/링크 끌어가기 막기 (텍스트 선택은 css 에서 막음)
// 입력칸은 예외 — 활동 내용을 쓰다가 우클릭·길게 눌러 붙여넣기를 할 수 있어야 합니다.
const isEditable = el => el?.closest?.("input, textarea, select, [contenteditable='true']");
document.addEventListener("contextmenu", e => { if (!isEditable(e.target)) e.preventDefault(); });
document.addEventListener("dragstart", e => { if (!isEditable(e.target)) e.preventDefault(); });

document.title = APP_NAME;
$("#loginTitle").textContent = APP_NAME;

// ---------------- 라우터 ----------------
// 패턴의 :이름 부분이 params 로 전달됩니다.
const routes = [
  ["home", renderHome],
  ["p/:cat", programs.renderCategory],
  ["p/:cat/:mode", programs.renderCategory],
  ["prog/:pid", programs.renderProgram],
  ["submit/:pid", programs.renderSubmitForm],
  ["submit/:pid/:subId", programs.renderSubmitForm],
  ["sub/:pid/:sid/:subId", programs.renderSubmission],
  ["att", attendance.renderAttendance],
  ["att/:mode", attendance.renderAttendance],
  ["att/g/:gid", attendance.renderGroup],
  ["att/stats/:gid", attendance.renderGroupStats],
  ["english", english.renderEnglish],
  ["grades", grades.renderGrades],
  ["grades/:sid", grades.renderGrades],
  ["students", students.renderSearch],
  ["students/:q", students.renderSearch],
  ["student/:sid", students.renderProfile]
];

function matchRoute(hash) {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { handler: renderHome, params: {} };
  for (const [pattern, handler] of routes) {
    const pp = pattern.split("/");
    if (pp.length !== parts.length) continue;
    const params = {};
    const ok = pp.every((seg, i) => seg.startsWith(":") ? (params[seg.slice(1)] = parts[i], true) : seg === parts[i]);
    if (ok) return { handler, params };
  }
  return null;
}

let renderSeq = 0;

async function route() {
  if (!session.profile) return;
  runCleanups();
  const m = matchRoute(location.hash);
  if (!m) { location.hash = "#/home"; return; }
  const seq = ++renderSeq;
  const main = $("#main");
  // 넓은 화면끼리 이동할 때 로딩 동안 상단바 폭이 좁아졌다 넓어지지 않도록 직전 폭을 표시해 둡니다 (css .hold-wide)
  const wasWide = !!main.querySelector(".page.wide");
  main.innerHTML = `<div class="page-loading${wasWide ? " hold-wide" : ""}"><div class="spinner"></div></div>`;
  window.scrollTo(0, 0);
  try {
    await m.handler(main, m.params, () => seq === renderSeq);
  } catch (err) {
    console.error(err);
    if (seq !== renderSeq) return;
    const denied = String(err.code || err.message).toLowerCase().includes("permission");
    main.innerHTML = `<div class="empty">${denied ? "접근 권한이 없습니다." : "오류가 발생했습니다.<br>" + esc(err.message)}</div>`;
  }
}

// 앱 안에서 이동한 기록인지 표시 → 뒤로가기 버튼이 history.back() 을 쓸 수 있게
// 앱을 새로 열면 이전에 보던 화면 주소가 남아 있어도 항상 첫 화면에서 시작합니다.
if (location.hash && location.hash !== "#/home") history.replaceState({ root: true }, "", location.pathname + location.search);
// (처음 연 페이지 기록은 root 로 표시해 두고, 이후 해시 이동으로 생긴 기록만 inApp)
if (!history.state) history.replaceState({ root: true }, "");
window.addEventListener("hashchange", () => {
  if (!history.state) history.replaceState({ inApp: true }, "");
  route();
});

// ---------------- 홈 ----------------
// 맨 위 [학생 찾기](교사) → 매일 쓰는 [출석] 큰 띠 → 나머지는 작은 카드
function miniCard(hash, icon, label, desc, color) {
  return `
    <a class="mini-card" href="${hash}" style="--accent:${color}">
      <span class="mini-icon">${icon}</span>
      <span class="mini-text"><b>${esc(label)}</b><small>${esc(desc || "")}</small></span>
    </a>`;
}

function renderHome(main) {
  setTitle(APP_NAME, null);
  const p = session.profile;
  const teacher = isTeacher();
  const minis = [
    ...Object.entries(CATEGORIES).map(([key, c]) => miniCard(`#/p/${key}`, c.icon, c.label, c.desc, c.color)),
    miniCard("#/english", "🌏", "ENGLISH", "Voca · Novel", "#3949ab"),
    miniCard("#/grades", "📊", "성적확인", teacher ? "전체 학생 성적 조회" : "내 성적 조회", "#ea4335")
  ].join("");

  main.innerHTML = `
    <div class="page">
      <div class="hello">
        <div>
          <div class="hello-name">${esc(p.name)} ${teacher ? "선생님" : ""}</div>
          <div class="hello-sub">${teacher ? "교사 계정" : `${esc(p.sid)} · ${esc(p.grade)}학년 ${esc(p.cls)}반 ${esc(p.no)}번`}</div>
        </div>
      </div>
      ${teacher ? `
      <form class="student-find" id="studentFind" role="search">
        <svg class="sf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/></svg>
        <input type="search" id="studentFindQ" placeholder="학생 이름·학번으로 모아보기" autocomplete="off" enterkeyhint="search" aria-label="학생별 모아보기 검색">
        <button type="submit" class="sf-go" aria-label="찾기">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 9.5 16a6.5 6.5 0 0 0 4.2-1.6l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>
        </button>
      </form>` : ""}
      <a class="att-banner" href="#/att">
        <span class="ab-icon">🕘</span>
        <span class="ab-text"><b>출석</b><small>${teacher ? "방과후·야간자율 출결 관리" : "방과후·야간자율 체크인"}</small></span>
      </a>
      <div class="mini-grid">${minis}</div>
    </div>`;

  if (teacher) {
    // 이름·학번을 치고 Enter → 딱 한 명이면 그 학생 화면으로 바로, 여러 명(또는 0명)이면 검색 결과 화면.
    // 비워 두면 학년·반으로 고르는 화면
    $("#studentFind", main).onsubmit = async e => {
      e.preventDefault();
      const q = $("#studentFindQ", main).value.trim();
      if (!q) { location.hash = "#/students"; return; }
      let found = [];
      try { found = filterStudents(await getStudents(), q); } catch { /* 목록을 못 읽으면 검색 화면에서 다시 시도 */ }
      location.hash = found.length === 1
        ? `#/student/${encodeURIComponent(found[0].sid)}`
        : `#/students/${encodeURIComponent(q)}`;
    };
  }
}

// ---------------- 사용자 메뉴 ----------------
function openUserMenu() {
  modal({
    title: session.profile.name,
    html: `
      <div class="menu-list">
        <button class="list-btn" data-menu="pw">🔑 비밀번호 변경</button>
        <button class="list-btn danger" data-menu="logout">↩️ 로그아웃</button>
      </div>`,
    okText: null,
    cancelText: "닫기",
    onOpen: (box, close) => {
      box.addEventListener("click", async e => {
        const act = e.target.closest("[data-menu]")?.dataset.menu;
        if (act === "pw") { close(false); changePasswordDialog(false); }
        if (act === "logout") { close(false); await logout(); location.hash = ""; }
      });
    }
  });
}
$("#userChip").addEventListener("click", openUserMenu);

// ---------------- 로그인 처리 ----------------
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("#loginBtn");
  btn.disabled = true;
  btn.textContent = "로그인 중...";
  try {
    await login($("#loginId").value.trim(), $("#loginPw").value);
    $("#loginPw").value = "";
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "로그인";
  }
});

function showView(name) {
  $("#bootView").hidden = name !== "boot";
  $("#loginView").hidden = name !== "login";
  $("#appView").hidden = name !== "app";
}

auth.onAuthStateChanged(async user => {
  if (!user) {
    session.profile = null;
    showView("login");
    return;
  }
  showView("boot");
  try {
    const p = await loadProfile(user);
    $("#userName").textContent = p.name;
    $("#userRole").textContent = p.role === "teacher" ? "교사" : p.sid;
    showView("app");
    if (p.mustChangePw) await changePasswordDialog(true);
    route();
  } catch (err) {
    toast(err.message);
    showView("login");
  }
});
