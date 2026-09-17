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

document.title = APP_NAME;
$("#loginTitle").textContent = APP_NAME;

// ---------------- 라우터 ----------------
// 패턴의 :이름 부분이 params 로 전달됩니다.
const routes = [
  ["home", renderHome],
  ["p/:cat", programs.renderCategory],
  ["prog/:pid", programs.renderProgram],
  ["submit/:pid", programs.renderSubmitForm],
  ["submit/:pid/:subId", programs.renderSubmitForm],
  ["sub/:pid/:sid/:subId", programs.renderSubmission],
  ["att", attendance.renderAttendance],
  ["att/g/:gid", attendance.renderGroup],
  ["checkin/:gid/:date/:code", attendance.renderCheckinLink],
  ["english", english.renderEnglish],
  ["grades", grades.renderGrades],
  ["grades/:sid", grades.renderGrades],
  ["students", students.renderSearch],
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
  main.innerHTML = `<div class="page-loading"><div class="spinner"></div></div>`;
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
// (처음 연 페이지 기록은 root 로 표시해 두고, 이후 해시 이동으로 생긴 기록만 inApp)
if (!history.state) history.replaceState({ root: true }, "");
window.addEventListener("hashchange", () => {
  if (!history.state) history.replaceState({ inApp: true }, "");
  route();
});

// ---------------- 홈 ----------------
function menuCard(hash, icon, label, desc, color) {
  return `
    <a class="menu-card" href="${hash}" style="--accent:${color}">
      <span class="menu-icon">${icon}</span>
      <span class="menu-label">${esc(label)}</span>
      <span class="menu-desc">${esc(desc)}</span>
    </a>`;
}

function renderHome(main) {
  setTitle(APP_NAME, null);
  const p = session.profile;
  const teacher = isTeacher();
  const catDesc = teacher ? "제출자료 검색·프로그램 관리" : "활동 자료 올리기";
  const cards = Object.entries(CATEGORIES)
    .map(([key, c]) => menuCard(`#/p/${key}`, c.icon, c.label, catDesc, c.color)).join("");

  main.innerHTML = `
    <div class="page">
      <div class="hello">
        <div>
          <div class="hello-name">${esc(p.name)} ${teacher ? "선생님" : ""}</div>
          <div class="hello-sub">${teacher ? "교사 계정" : `${esc(p.sid)} · ${esc(p.grade)}학년 ${esc(p.cls)}반 ${esc(p.no)}번`}</div>
        </div>
      </div>
      <div class="menu-grid">
        ${cards}
        ${menuCard("#/att", "🕘", "출석", teacher ? "방과후·야간자율 출결 관리" : "방과후·야간자율 체크인", "#fa7b17")}
        ${menuCard("#/english", "🌏", "ENGLISH", "Voca · Novel", "#3949ab")}
        ${menuCard("#/grades", "📊", "성적확인", teacher ? "전체 학생 성적 조회" : "내 성적 조회", "#ea4335")}
        ${teacher ? menuCard("#/students", "🧑‍🎓", "학생별 모아보기", "활동·출결·성적 한눈에", "#12b5cb") : ""}
      </div>
    </div>`;
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

// QR 체크인 링크로 들어왔는데 로그인 전이면 로그인 후 이어서 처리
const PENDING_KEY = "portal_pending_hash";
function rememberPendingHash() {
  if (location.hash.startsWith("#/checkin/")) {
    try { sessionStorage.setItem(PENDING_KEY, location.hash); } catch {}
  }
}

auth.onAuthStateChanged(async user => {
  if (!user) {
    session.profile = null;
    rememberPendingHash();
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

    let pending = null;
    try { pending = sessionStorage.getItem(PENDING_KEY); sessionStorage.removeItem(PENDING_KEY); } catch {}
    if (pending && pending !== location.hash) location.hash = pending;
    else route();
  } catch (err) {
    toast(err.message);
    showView("login");
  }
});
