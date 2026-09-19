// 학생별 모아보기 (교사): 한 학생의 활동 자료 · 방과후/야자 출결 · 성적 바로가기
import { isTeacher } from "./auth.js";
import { CATEGORIES, ATT_TYPES, ATT_STATUS } from "./config.js";
import { $, $$, esc, emptyState, sidCompare } from "./ui.js";
import { setTitle, go } from "./nav.js";
import { getStudents, getStudentSids, filterStudents, gradeOptions, classOptions, studentCard, hydratePhotos } from "./directory.js";
import { loadAllPrograms, loadPersonSubs, renderSubmissionList, canView } from "./programs.js";
import { loadStudentAttendance, cardSchedule } from "./attendance.js";
import { openNotesDialog, countNotes } from "./person-notes.js";

export async function renderSearch(main, params, alive) {
  if (!isTeacher()) { go("#/home"); return; }
  setTitle("🧑‍🎓 학생별 모아보기");
  const students = await getStudents();
  if (!alive()) return;
  const q0 = String(params?.q || "").trim();   // 홈의 [학생 찾기] 에서 넘어온 검색어

  main.innerHTML = `
    <div class="page">
      <p class="page-desc">학번 · 이름 · 학년-반 형식으로 검색하세요.</p>
      <input id="sSearch" type="search" class="search-input" placeholder="예: 3129, 홍길동, 3-1" autocomplete="off" value="${esc(q0)}">
      <div class="filter-bar">
        <select id="sGrade"><option value="">학년 선택</option>${gradeOptions(students).map(g => `<option>${g}</option>`).join("")}</select>
        <select id="sClass"><option value="">반 선택</option></select>
      </div>
      <div id="sResults" class="student-results"></div>
    </div>`;

  const draw = list => {
    const box = $("#sResults", main);
    box.innerHTML = list === null ? "" : list.length
      ? list.map(s => studentCard(s, `#/student/${encodeURIComponent(s.sid)}`)).join("")
      : emptyState("일치하는 학생이 없습니다.");
    hydratePhotos(box);
  };
  $("#sSearch", main).oninput = e => {
    const q = e.target.value.trim();
    draw(q ? filterStudents(students, q).slice(0, 100) : null);
  };
  $("#sGrade", main).onchange = e => {
    $("#sClass", main).innerHTML = `<option value="">반 선택</option>` + classOptions(students, e.target.value).map(c => `<option>${c}</option>`).join("");
    draw(null);
  };
  $("#sClass", main).onchange = e => {
    const g = $("#sGrade", main).value;
    draw(e.target.value ? students.filter(s => s.grade === g && s.cls === e.target.value) : null);
  };
  if (q0) draw(filterStudents(students, q0).slice(0, 100));
}

export async function renderProfile(main, { sid }, alive) {
  if (!isTeacher()) { go("#/home"); return; }
  setTitle("🧑‍🎓 학생 정보", "#/students");
  // 공통 프로그램 + 내가 담당하는 비공개 프로그램(교과·동아리)의 자료만
  // 지난 학년도 학번까지 모아서, 프로그램·반마다 그 해 학번으로 찾습니다.
  const person = { sid, sids: await getStudentSids(sid) };
  const [students, programsById, att] = await Promise.all([getStudents(), loadAllPrograms(), loadStudentAttendance(person)]);
  const subs = await loadPersonSubs(person, Object.values(programsById).filter(canView));
  if (!alive()) return;
  const st = students.find(s => s.sid === sid) || { sid, name: subs[0]?.name || "" };
  const phone = String(st.phone || "").replace(/[^0-9]/g, "");   // 계정 시트 [전화번호] 열 → 🔥Firebase 동기화

  const byCat = {};
  subs.forEach(s => { (byCat[s.category] ||= []).push(s); });
  let catFilter = "";

  main.innerHTML = `
    <div class="page">
      <div class="info-card profile-head">
        <div>
          <div class="hello-name">${esc(st.name)}</div>
          <div class="item-meta">${esc(sid)}${st.grade ? ` · ${esc(st.grade)}학년 ${esc(st.cls)}반 ${esc(st.no)}번` : ""}</div>
        </div>
        <div class="profile-actions">
          ${st.uid ? `<button class="btn small contact-memo" id="btnMemo">ℹ️ 메모<span class="memo-count" hidden></span></button>` : ""}
          ${phone ? `<a class="btn small contact-call" href="tel:${phone}">📞 전화</a>
          <a class="btn small contact-sms" href="sms:${phone}">📩 문자</a>` : ""}
          <a class="btn small ghost" href="#/grades/${encodeURIComponent(sid)}">📊 성적</a>
        </div>
      </div>

      <div class="section-head"><h3>활동 자료 (${subs.length})</h3></div>
      <div class="chip-row">
        <button class="chip on" data-cat="">전체 ${subs.length}</button>
        ${Object.entries(CATEGORIES).map(([k, c]) => `<button class="chip" data-cat="${k}">${c.icon} ${c.label} ${byCat[k]?.length || 0}</button>`).join("")}
      </div>
      <div id="profileSubs"></div>

      <div class="section-head"><h3>방과후·야간자율 출결</h3></div>
      <div class="card-list">
        ${att.length ? att.map(({ group, counts, dates }) => `
          <a class="item-card" href="#/att/g/${group.id}">
            <div class="item-top"><span class="badge type-${group.type}">${esc(ATT_TYPES[group.type]?.label || "")}</span><span class="item-meta">${esc(group.year)}학년도 · ${esc(cardSchedule(group))}</span></div>
            <div class="item-title">${esc(group.name)}</div>
            <div class="stat-line">${Object.entries(ATT_STATUS).map(([k, s]) => `<span>${s.label} <b>${counts[k]}</b></span>`).join("")}<span class="item-meta">운영 ${dates.length}일</span></div>
          </a>`).join("") : emptyState("참여 중인 방과후·야간자율이 없습니다.")}
      </div>
    </div>`;

  const drawSubs = () => {
    const list = catFilter ? (byCat[catFilter] || []) : subs;
    renderSubmissionList($("#profileSubs", main), list.sort((a, b) => sidCompare(a.category, b.category) || (a.createdAt || 0) - (b.createdAt || 0)), programsById, "student");
  };
  $$("[data-cat]", main).forEach(b => b.onclick = () => {
    catFilter = b.dataset.cat;
    $$("[data-cat]", main).forEach(x => x.classList.toggle("on", x === b));
    drawSubs();
  });
  drawSubs();

  // ℹ️ 메모: 졸업생 카드 뒷면과 같은 창. 메모가 있으면 버튼에 개수
  const memoBtn = $("#btnMemo", main);
  if (memoBtn) {
    const setCount = n => { const c = $(".memo-count", memoBtn); c.hidden = !n; c.textContent = n; };
    countNotes(st.uid, "school").then(n => { if (memoBtn.isConnected) setCount(n); }).catch(() => {});
    memoBtn.onclick = () => openNotesDialog({ uid: st.uid, name: st.name }, setCount);
  }
}
