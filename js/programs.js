// 활동 자료 모듈: 빛나다 · 동아리 · 교과 · 심화탐구
// 데이터 구조
//   portal/programs/{pid}                : { category, year, title, description, grades{1:true}, startDate, endDate, closed, allowFiles, private, createdBy, createdByUid, createdAt }
//   portal/submissions/{pid}/{sid}/{id}  : { programId, category, year, sid, name, grade, cls, no, title, content, files[], createdAt, updatedAt, feedback, feedbackBy, feedbackAt }
// 권한
//   관리(수정·마감·삭제·교사 메모) : 프로그램을 만든 교사(createdByUid)만
//   제출자료 열람                  : private 이면 만든 교사만, 아니면 모든 교사 (DB 보안 규칙으로도 강제)
import { db, readVal, newKey, serverTime } from "./firebase.js";
import { CATEGORIES, CATEGORY_HAS_PERIOD, CLUB_SCHEDULE } from "./config.js";
import { session, isTeacher } from "./auth.js";
import { $, $$, esc, richText, toast, modal, confirmBox, loading, emptyState, dateKey, fmtDateTime, schoolYear, sidCompare, downloadCsv } from "./ui.js";
import { setTitle, go } from "./nav.js";
import { uploadFile, openFile, deleteFile, checkFileSize, formatSize } from "./drive.js";
import { getStudents, gradeOptions, classOptions } from "./directory.js";
import { memberPickerHtml, bindMemberPicker } from "./members.js";
import { sidInYear, isCurrentYear, currentYearOf } from "./years.js";

// ---------------- 데이터 ----------------
async function loadPrograms(cat) {
  const snap = await db.ref("portal/programs").orderByChild("category").equalTo(cat).once("value");
  const list = [];
  snap.forEach(c => { list.push({ ...c.val(), id: c.key }); });
  return list;
}

export async function loadAllPrograms() {
  const obj = (await readVal("portal/programs")) || {};
  return Object.fromEntries(Object.entries(obj).map(([id, p]) => [id, { ...p, id }]));
}

// 새로 만들 때 '열람도 담당 교사만'의 기본값 — 자기 교과·자기 동아리는 비공개
export const PRIVATE_BY_DEFAULT = { subject: true, club: true };

export const isOwner = p => !!p && p.createdByUid === session.profile?.uid;
// 교사가 이 프로그램의 제출자료를 볼 수 있는가
export const canView = p => !!p && isTeacher() && (p.private !== true || isOwner(p));

function subsPath(pid, sid, id) {
  return ["portal/submissions", pid, sid, id].filter(Boolean).join("/");
}

function flattenSubs(pid, bySid) {
  const list = [];
  Object.entries(bySid || {}).forEach(([sid, subs]) => {
    Object.entries(subs || {}).forEach(([id, s]) => list.push({ ...s, id, sid, programId: pid }));
  });
  return list;
}

// 한 프로그램의 전체 제출자료 (교사)
async function loadProgramSubs(pid) {
  return flattenSubs(pid, await readVal(subsPath(pid)));
}

async function loadProgramsSubs(programs) {
  return (await Promise.all(programs.map(p => loadProgramSubs(p.id)))).flat();
}

// 한 사람의 제출자료 — 프로그램마다 그 학년도에 쓰던 학번으로 찾습니다. person = { sid, sids }
export async function loadPersonSubs(person, programs) {
  const results = await Promise.all(programs.map(async p => {
    const sid = sidInYear(person, p.year || schoolYear());
    return sid ? flattenSubs(p.id, { [sid]: await readVal(subsPath(p.id, sid)) }) : [];
  }));
  return results.flat();
}

// 한 학생의 제출자료 — 주어진 프로그램들 안에서만 찾음
export async function loadStudentSubs(sid, programs) {
  const results = await Promise.all(programs.map(async p =>
    flattenSubs(p.id, { [sid]: await readVal(subsPath(p.id, sid)) })));
  return results.flat();
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export function programStatus(p) {
  const today = dateKey();
  if (p.closed) return { key: "closed", label: "마감", open: false };
  // 빛나다·동아리는 제출 기간 없이 그날 활동을 바로 기록합니다.
  if (!CATEGORY_HAS_PERIOD[p.category]) return { key: "open", label: "진행중", open: true };
  if (p.startDate && today < p.startDate) return { key: "soon", label: "예정", open: false };
  if (p.endDate && today > p.endDate) return { key: "closed", label: "마감", open: false };
  return { key: "open", label: "진행중", open: true };
}

// 그 프로그램이 오늘 하는 활동인가 (빛나다는 요일, 동아리는 수요일 고정)
export function runsToday(p) {
  const today = new Date().getDay();
  if (p.category === "club") return today === CLUB_SCHEDULE.day;
  if (p.category === "bitnada") return !p.days || !!p.days[today];
  return false;
}

function daysText(p) {
  const list = Object.keys(p.days || {}).map(Number).sort();
  return list.length ? list.map(d => WEEK[d] + "요일").join("·") : "요일 지정 없음";
}

function periodText(p) {
  if (p.category === "club") return CLUB_SCHEDULE.label;
  if (p.category === "bitnada") return daysText(p);
  if (!p.startDate && !p.endDate) return "상시";
  return `${p.startDate || ""} ~ ${p.endDate || ""}`;
}

function targetText(p) {
  if (p.members) return `학생 ${Object.keys(p.members).length}명`;
  const g = Object.keys(p.grades || {}).sort();
  return g.length ? g.map(x => x + "학년").join("·") : "전 학년";
}

// 예전 프로그램(명단 없이 학년으로 지정)도 계속 보이게 합니다.
const isMember = (p, profile) => (p.members ? !!p.members[profile.sid] : (!p.grades || !!p.grades[profile.grade]));

const statusBadge = p => { const s = programStatus(p); return `<span class="badge st-${s.key}">${s.label}</span>`; };
// 교사 화면용: 내 담당 / 비공개 표시
const accessBadge = p => (isOwner(p) ? `<span class="badge st-soon">내 담당</span>` : "") + (p.private ? `<span class="badge st-closed">🔒 담당자만</span>` : "");
const byNewest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);

// ---------------- 카테고리 화면 ----------------
// 교사는 제출자료가 기본 화면이고, 프로그램 관리는 [⚙️ 프로그램 관리] 버튼으로 들어가는 별도 화면(#/p/{cat}/manage)입니다.
export async function renderCategory(main, { cat, mode }, alive) {
  const c = CATEGORIES[cat];
  if (!c) { go("#/home"); return; }
  const manage = isTeacher() && mode === "manage";
  setTitle(manage ? `${c.icon} ${c.label} · 프로그램 관리` : `${c.icon} ${c.label}`, manage ? `#/p/${cat}` : "#/home");
  if (isTeacher()) return renderTeacherCategory(main, cat, alive, manage);
  return renderStudentCategory(main, cat, alive);
}

async function renderStudentCategory(main, cat, alive) {
  const p = session.profile;
  const programs = await loadPrograms(cat);
  const mySubs = await loadPersonSubs(p, programs);
  if (!alive()) return;
  const counts = {};
  mySubs.forEach(s => { counts[s.programId] = (counts[s.programId] || 0) + 1; });
  const year = currentYearOf(p, schoolYear());
  const visible = programs
    .filter(pr => counts[pr.id] || (Number(pr.year) === year && isMember(pr, p)))
    .sort((a, b) => Number(runsToday(b)) - Number(runsToday(a))
      || Number(programStatus(b).open) - Number(programStatus(a).open) || byNewest(a, b));

  main.innerHTML = `
    <div class="page">
      <p class="page-desc">참여한 프로그램을 선택해 활동 자료를 올리세요. 올린 자료는 선생님이 학교생활기록부 작성에 참고합니다.</p>
      <div class="card-list">
        ${visible.length ? visible.map(pr => `
          <a class="item-card" href="#/prog/${pr.id}">
            <div class="item-top">${Number(pr.year) === year ? statusBadge(pr) : `<span class="badge st-closed">${esc(pr.year)}학년도</span>`}${Number(pr.year) === year && runsToday(pr) ? '<span class="badge st-open">오늘</span>' : ""}<span class="item-meta">${esc(periodText(pr))}</span></div>
            <div class="item-title">${esc(pr.title)}</div>
            <div class="item-meta">${counts[pr.id] ? `✅ 내 제출 ${counts[pr.id]}건` : "아직 제출하지 않았어요"}</div>
          </a>`).join("") : emptyState("현재 참여할 수 있는 프로그램이 없습니다.")}
      </div>
    </div>`;
}

async function renderTeacherCategory(main, cat, alive, manage = false) {
  // 다른 교사의 비공개 프로그램은 목록에서도 보이지 않음
  const programs = (await loadPrograms(cat)).filter(canView);
  const [subs, students] = await Promise.all([loadProgramsSubs(programs), getStudents()]);
  if (!alive()) return;
  const programsById = Object.fromEntries(programs.map(p => [p.id, p]));
  const years = [...new Set([schoolYear(), ...programs.map(p => Number(p.year))])].filter(Boolean).sort((a, b) => b - a);

  const state = { tab: manage ? "progs" : "subs", year: String(schoolYear()), pid: "", grade: "", cls: "", q: "", view: "list" };

  main.innerHTML = `
    <div class="page">
      ${manage ? "" : `
      <div class="cat-head">
        <h3>제출자료</h3>
        <a class="btn small ghost" href="#/p/${cat}/manage">⚙️ 관리</a>
      </div>`}
      <div class="filter-bar prog-filter">
        <select id="fYear">${years.map(y => `<option value="${y}">${String(y).slice(2)}학년도</option>`).join("")}<option value="">전 학년도</option></select>
        <select id="fGrade" class="subs-only"><option value="">전 학년</option>${gradeOptions(students).map(g => `<option value="${g}">${g}학년</option>`).join("")}</select>
        <select id="fClass" class="subs-only"><option value="">전 반</option></select>
        <select id="fProgram" class="subs-only"></select>
        <input id="fQuery" class="subs-only grow" type="search" placeholder="이름·학번·제목·내용 검색">
      </div>
      <div id="catBody"></div>
    </div>`;

  const body = $("#catBody", main);

  const fillProgramSelect = () => {
    const list = programs.filter(p => !state.year || String(p.year) === state.year).sort(byNewest);
    $("#fProgram", main).innerHTML = `<option value="">전 프로그램</option>` +
      list.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join("");
    if (!list.some(p => p.id === state.pid)) state.pid = "";
    $("#fProgram", main).value = state.pid;
  };
  const fillClassSelect = () => {
    $("#fClass", main).innerHTML = `<option value="">전 반</option>` +
      classOptions(students, state.grade).map(c => `<option value="${c}">${c}반</option>`).join("");
    $("#fClass", main).value = state.cls;
  };

  const draw = () => {
    $$(".subs-only", main).forEach(el => { el.hidden = state.tab !== "subs"; });
    if (state.tab === "progs") return drawPrograms();
    const q = state.q.trim();
    const filtered = subs.filter(s =>
      (!state.year || String(s.year) === state.year) &&
      (!state.pid || s.programId === state.pid) &&
      (!state.grade || String(s.grade) === state.grade) &&
      (!state.cls || String(s.cls) === state.cls) &&
      (!q || [s.sid, s.name, s.title, s.content].some(v => String(v || "").includes(q)))
    );
    body.innerHTML = `
      <div class="result-head">
        <span>총 <b>${filtered.length}</b>건 · 학생 <b>${new Set(filtered.map(s => s.sid)).size}</b>명</span>
        <span class="head-actions">
          <span class="seg">
            <button class="${state.view === "list" ? "on" : ""}" data-view="list">목록</button>
            <button class="${state.view === "student" ? "on" : ""}" data-view="student">학생별</button>
          </span>
          <button class="btn small ghost" id="btnCsv">CSV</button>
        </span>
      </div>
      <div id="subResults"></div>`;
    renderSubmissionList($("#subResults", body), filtered, programsById, state.view);
    $$("[data-view]", body).forEach(b => b.onclick = () => { state.view = b.dataset.view; draw(); });
    $("#btnCsv", body).onclick = () => exportCsv(filtered, programsById, `${CATEGORIES[cat].label}_제출자료.csv`);
  };

  const drawPrograms = () => {
    const counts = {};
    subs.forEach(s => { counts[s.programId] = (counts[s.programId] || 0) + 1; });
    const list = programs.filter(p => !state.year || String(p.year) === state.year).sort(byNewest);
    body.innerHTML = `
      <div class="result-head">
        <span>프로그램 <b>${list.length}</b>개</span>
        <button class="btn small primary" id="btnNewProgram">+ 새 프로그램</button>
      </div>
      <div class="card-list">
        ${list.length ? list.map(p => `
          <a class="item-card" href="#/prog/${p.id}">
            <div class="item-top">${statusBadge(p)}${accessBadge(p)}<span class="item-meta">${esc(p.year)}학년도 · ${esc(targetText(p))} · ${esc(periodText(p))}</span></div>
            <div class="item-title">${esc(p.title)}</div>
            <div class="item-meta">제출 ${counts[p.id] || 0}건 · 담당 ${esc(p.createdBy || "")}</div>
          </a>`).join("") : emptyState("볼 수 있는 프로그램이 없습니다. [+ 새 프로그램]으로 만들어 주세요.")}
      </div>`;
    $("#btnNewProgram", body).onclick = async () => {
      const saved = await programDialog({ category: cat, year: Number(state.year) || schoolYear(), allowFiles: true, private: !!PRIVATE_BY_DEFAULT[cat] });
      if (saved) go(`#/prog/${saved}`);
    };
  };

  $("#fYear", main).onchange = e => { state.year = e.target.value; fillProgramSelect(); draw(); };
  $("#fProgram", main).onchange = e => { state.pid = e.target.value; draw(); };
  $("#fGrade", main).onchange = e => { state.grade = e.target.value; state.cls = ""; fillClassSelect(); draw(); };
  $("#fClass", main).onchange = e => { state.cls = e.target.value; draw(); };
  let t;
  $("#fQuery", main).oninput = e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; draw(); }, 200); };

  fillProgramSelect();
  fillClassSelect();
  draw();
}

const subHash = s => `#/sub/${s.programId}/${encodeURIComponent(s.sid)}/${s.id}`;

// 제출자료 목록 (교사 검색 결과·학생 프로필에서 공용)
export function renderSubmissionList(container, subs, programsById, view = "list") {
  if (!subs.length) { container.innerHTML = emptyState("조건에 맞는 제출 자료가 없습니다."); return; }
  const itemHtml = (s, full) => {
    const pr = programsById[s.programId];
    const cat = CATEGORIES[s.category];
    return `
      <a class="sub-row" href="${subHash(s)}">
        <div class="sub-row-top">
          <span class="who">${esc(s.sid)} ${esc(s.name)}</span>
          <span class="prog">${cat ? cat.icon : ""} ${esc(pr ? pr.title : "(삭제된 프로그램)")}</span>
          <span class="date">${fmtDateTime(s.updatedAt || s.createdAt).slice(0, 10)}</span>
        </div>
        <div class="sub-row-title">${esc(s.title)}${s.files?.length ? ` <span class="clip">📎${s.files.length}</span>` : ""}${s.feedback ? ` <span class="clip">💬</span>` : ""}</div>
        <div class="sub-row-content ${full ? "full" : ""}">${full ? richText(s.content) : esc(s.content)}</div>
      </a>`;
  };

  if (view === "student") {
    const groups = {};
    subs.forEach(s => { (groups[s.sid] ||= []).push(s); });
    container.innerHTML = Object.keys(groups).sort(sidCompare).map(sid => {
      const list = groups[sid].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const s0 = list[0];
      return `
        <div class="student-group">
          <div class="student-group-head">
            <a href="#/student/${encodeURIComponent(sid)}">${esc(sid)} ${esc(s0.name)}</a>
            <span>${list.length}건</span>
          </div>
          ${list.map(s => itemHtml(s, true)).join("")}
        </div>`;
    }).join("");
  } else {
    container.innerHTML = [...subs].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      .map(s => itemHtml(s, false)).join("");
  }
}

function exportCsv(subs, programsById, filename) {
  const rows = [["학년도", "구분", "프로그램", "학번", "학년", "반", "번호", "이름", "제목", "내용", "첨부파일", "제출일", "교사 메모"]];
  [...subs].sort((a, b) => sidCompare(a.sid, b.sid) || (a.createdAt || 0) - (b.createdAt || 0)).forEach(s => {
    rows.push([
      s.year, CATEGORIES[s.category]?.label || s.category, programsById[s.programId]?.title || "",
      s.sid, s.grade, s.cls, s.no, s.name, s.title, s.content,
      (s.files || []).map(f => f.name).join(" / "), fmtDateTime(s.createdAt), s.feedback || ""
    ]);
  });
  downloadCsv(filename, rows);
}

// ---------------- 프로그램 등록/수정 (교사) ----------------
function programDialog(p) {
  let savedId = null;
  let picker = null;
  const hasPeriod = !!CATEGORY_HAS_PERIOD[p.category];
  return modal({
    title: p.id ? "프로그램 수정" : `새 프로그램 · ${CATEGORIES[p.category].label}`,
    wide: true,
    html: `
      <label class="field"><span>프로그램명</span><input id="pgTitle" value="${esc(p.title || "")}" placeholder="예: 2학기 인문학 독서토론"></label>
      <label class="field"><span>안내 (학생에게 보이는 설명·제출 방법)</span><textarea id="pgDesc" rows="5" placeholder="활동 내용, 제출해야 할 자료, 유의사항 등">${esc(p.description || "")}</textarea></label>
      <div class="field-row">
        <label class="field"><span>학년도</span><input id="pgYear" type="number" value="${esc(p.year || schoolYear())}"></label>
        ${p.category === "bitnada" ? `
          <div class="field"><span>활동 요일 (선택 안 하면 매일)</span>
            <div class="checks">${[1, 2, 3, 4, 5].map(n => `<label><input type="checkbox" class="pgDay" value="${n}" ${p.days?.[n] ? "checked" : ""}> ${WEEK[n]}</label>`).join("")}</div>
          </div>` : `<div class="field"><span>활동 시간</span><p class="item-meta">${esc(periodText({ ...p, startDate: null, endDate: null }))}</p></div>`}
      </div>
      ${hasPeriod ? `
        <div class="field-row">
          <label class="field"><span>제출 시작일</span><input id="pgStart" type="date" value="${esc(p.startDate || "")}"></label>
          <label class="field"><span>제출 마감일</span><input id="pgEnd" type="date" value="${esc(p.endDate || "")}"></label>
        </div>` : `<p class="item-meta">${esc(CATEGORIES[p.category].label)}는 제출 기간 없이, 활동한 날 바로 기록합니다.</p>`}
      ${memberPickerHtml("참여 학생 명단")}
      <label class="check-line"><input type="checkbox" id="pgFiles" ${p.allowFiles !== false ? "checked" : ""}> 파일 첨부 허용</label>
      <label class="check-line"><input type="checkbox" id="pgPrivate" ${p.private ? "checked" : ""}> 🔒 제출자료 열람도 담당 교사(나)만</label>
      <p class="item-meta">체크하지 않으면 모든 교사가 제출자료를 볼 수 있습니다. 수정·마감·삭제·교사 메모는 항상 담당 교사만 할 수 있습니다.</p>`,
    okText: "저장",
    cancelText: "취소",
    // 동아리는 반에서 몇 명만 참여하므로 반을 골라도 꺼진 상태로 시작합니다.
    onOpen: async box => { picker = await bindMemberPicker(box, p.members, { defaultOn: p.category !== "club" }); },
    beforeOk: async box => {
      const title = $("#pgTitle", box).value.trim();
      if (!title) throw new Error("프로그램명을 입력하세요.");
      const start = $("#pgStart", box)?.value || "", end = $("#pgEnd", box)?.value || "";
      if (start && end && start > end) throw new Error("마감일이 시작일보다 빠릅니다.");
      const members = picker.get();
      if (!members) throw new Error("참여 학생을 한 명 이상 선택하세요.");
      const days = {};
      $$(".pgDay", box).forEach(c => { if (c.checked) days[c.value] = true; });
      const data = {
        category: p.category,
        year: Number($("#pgYear", box).value) || schoolYear(),
        title,
        description: $("#pgDesc", box).value.trim(),
        members,
        grades: null,
        days: Object.keys(days).length ? days : null,
        startDate: start || null,
        endDate: end || null,
        allowFiles: $("#pgFiles", box).checked,
        private: $("#pgPrivate", box).checked,
        closed: p.closed || false
      };
      if (p.id) {
        await db.ref(`portal/programs/${p.id}`).update({ ...data, updatedAt: serverTime });
        savedId = p.id;
      } else {
        savedId = newKey("portal/programs");
        await db.ref(`portal/programs/${savedId}`).set({
          ...data, createdBy: session.profile.name, createdByUid: session.profile.uid, createdAt: serverTime
        });
      }
      toast("저장되었습니다.");
    }
  }).then(ok => (ok ? savedId : null));
}

// ---------------- 프로그램 상세 ----------------
export async function renderProgram(main, { pid }, alive) {
  const program = await readVal(`portal/programs/${pid}`);
  if (!alive()) return;
  if (!program) { main.innerHTML = emptyState("프로그램을 찾을 수 없습니다."); return; }
  program.id = pid;
  const cat = CATEGORIES[program.category];
  setTitle(`${cat.icon} ${cat.label}`, `#/p/${program.category}`);
  const st = programStatus(program);

  const infoHtml = `
    <div class="info-card">
      <div class="item-top">${!isTeacher() && !isCurrentYear(session.profile, program.year || schoolYear(), schoolYear())
        ? `<span class="badge st-closed">지난 학년도</span>` : statusBadge(program)}${isTeacher() ? accessBadge(program) : ""}<span class="item-meta">${esc(program.year)}학년도 · ${esc(targetText(program))}</span></div>
      <h2 class="info-title">${esc(program.title)}</h2>
      <div class="info-meta">제출 기간: ${esc(periodText(program))} · 담당: ${esc(program.createdBy || "")}</div>
      ${program.description ? `<div class="info-desc">${richText(program.description)}</div>` : ""}
    </div>`;

  if (!isTeacher()) {
    const mine = (await loadPersonSubs(session.profile, [program])).sort(byNewest);
    const thisYear = isCurrentYear(session.profile, program.year || schoolYear(), schoolYear());
    if (!alive()) return;
    main.innerHTML = `
      <div class="page">
        ${infoHtml}
        <div class="section-head">
          <h3>내 제출 자료 (${mine.length})</h3>
          ${!thisYear ? `<span class="item-meta">지난 학년도 프로그램 (보기만 가능)</span>`
            : st.open ? `<a class="btn primary small" href="#/submit/${pid}">+ 자료 올리기</a>` : `<span class="item-meta">${st.key === "soon" ? "제출 기간 전입니다" : "제출이 마감되었습니다"}</span>`}
        </div>
        <div class="card-list">
          ${mine.length ? mine.map(s => `
            <a class="item-card" href="${subHash(s)}">
              <div class="item-title">${esc(s.title)}</div>
              <div class="item-meta">${fmtDateTime(s.updatedAt || s.createdAt)}${s.files?.length ? ` · 📎${s.files.length}` : ""}${s.feedback ? " · 💬 선생님 메모" : ""}</div>
            </a>`).join("") : emptyState("아직 올린 자료가 없습니다.")}
        </div>
      </div>`;
    return;
  }

  // 교사
  if (!canView(program)) {
    main.innerHTML = `<div class="page">${infoHtml}${emptyState(`🔒 담당 교사(${program.createdBy || ""})만 제출자료를 볼 수 있는 프로그램입니다.`)}</div>`;
    return;
  }
  const owner = isOwner(program);
  const subs = await loadProgramSubs(pid);
  if (!alive()) return;
  let view = "list";
  main.innerHTML = `
    <div class="page">
      ${infoHtml}
      ${owner ? `
      <div class="btn-row">
        <button class="btn small ghost" id="btnEdit">✏️ 수정</button>
        <button class="btn small ghost" id="btnClose">${program.closed ? "🔓 제출 다시 열기" : "🔒 제출 마감"}</button>
        <button class="btn small ghost danger" id="btnDelete">🗑 삭제</button>
      </div>` : `<p class="item-meta">열람만 가능합니다. 프로그램 관리는 담당 교사(${esc(program.createdBy || "")})가 합니다.</p>`}
      <div class="result-head">
        <span>제출 <b>${subs.length}</b>건 · 학생 <b>${new Set(subs.map(s => s.sid)).size}</b>명</span>
        <span class="head-actions">
          <span class="seg"><button class="on" data-view="list">목록</button><button data-view="student">학생별</button></span>
          <button class="btn small ghost" id="btnCsv">CSV</button>
        </span>
      </div>
      <div id="subResults"></div>
    </div>`;
  const drawList = () => renderSubmissionList($("#subResults", main), subs, { [pid]: program }, view);
  drawList();
  $$("[data-view]", main).forEach(b => b.onclick = () => {
    view = b.dataset.view;
    $$("[data-view]", main).forEach(x => x.classList.toggle("on", x === b));
    drawList();
  });
  $("#btnCsv", main).onclick = () => exportCsv(subs, { [pid]: program }, `${program.title}_제출자료.csv`);
  if (!owner) return;
  $("#btnEdit", main).onclick = async () => { if (await programDialog(program)) renderProgram(main, { pid }, alive); };
  $("#btnClose", main).onclick = async () => {
    await db.ref(`portal/programs/${pid}/closed`).set(!program.closed);
    toast(program.closed ? "제출을 다시 열었습니다." : "제출을 마감했습니다.");
    renderProgram(main, { pid }, alive);
  };
  $("#btnDelete", main).onclick = async () => {
    if (subs.length) {
      modal({ title: "삭제할 수 없음", html: `<p>학생 제출 자료가 ${subs.length}건 있어 삭제할 수 없습니다.<br>더 이상 받지 않으려면 <b>제출 마감</b>을 사용하세요.</p>` });
      return;
    }
    if (!(await confirmBox("프로그램 삭제", `'${esc(program.title)}' 프로그램을 삭제할까요?`, "삭제"))) return;
    await db.ref(`portal/programs/${pid}`).remove();
    toast("삭제되었습니다.");
    go(`#/p/${program.category}`);
  };
}

// ---------------- 자료 제출/수정 (학생) ----------------
export async function renderSubmitForm(main, { pid, subId }, alive) {
  if (isTeacher()) { main.innerHTML = emptyState("자료 제출은 학생 계정에서만 가능합니다."); return; }
  const p = session.profile;
  const [program, existing] = await Promise.all([
    readVal(`portal/programs/${pid}`),
    subId ? readVal(subsPath(pid, p.sid, subId)) : null
  ]);
  if (!alive()) return;
  if (!program) { main.innerHTML = emptyState("프로그램을 찾을 수 없습니다."); return; }
  const cat = CATEGORIES[program.category];
  setTitle(subId ? "자료 수정" : "자료 올리기", `#/prog/${pid}`);
  if (!isCurrentYear(p, program.year || schoolYear(), schoolYear())) { main.innerHTML = emptyState("지난 학년도 프로그램에는 제출할 수 없습니다."); return; }
  if (!programStatus(program).open) { main.innerHTML = emptyState("제출 기간이 아닙니다."); return; }
  if (subId && !existing) { main.innerHTML = emptyState("자료를 찾을 수 없습니다."); return; }

  let keptFiles = [...(existing?.files || [])];
  const removedFiles = [];
  let newFiles = [];

  main.innerHTML = `
    <div class="page">
      <div class="form-card">
        <div class="item-meta">${cat.icon} ${esc(cat.label)}</div>
        <h2 class="info-title">${esc(program.title)}</h2>
        <label class="field"><span>제목</span><input id="sTitle" maxlength="100" value="${esc(existing?.title || "")}" placeholder="활동을 한 줄로 요약"></label>
        <label class="field"><span>활동 내용</span>
          <textarea id="sContent" rows="10" placeholder="무엇을 했고, 무엇을 배우고 느꼈는지 구체적으로 적어주세요.">${esc(existing?.content || "")}</textarea>
        </label>
        ${program.allowFiles !== false ? `
          <div class="field"><span>첨부 파일 (사진·PDF·한글 등, 파일당 최대 10MB)</span>
            <div id="fileList" class="file-list"></div>
            <label class="file-pick">📎 파일 선택<input type="file" id="sFiles" multiple hidden></label>
          </div>` : ""}
        <button class="btn primary block" id="btnSave">${subId ? "수정 저장" : "제출하기"}</button>
      </div>
    </div>`;

  const drawFiles = () => {
    const el = $("#fileList", main);
    if (!el) return;
    el.innerHTML = [
      ...keptFiles.map((f, i) => `<div class="file-item"><span>📄 ${esc(f.name)} <small>${formatSize(f.size)}</small></span><button data-kept="${i}">✕</button></div>`),
      ...newFiles.map((f, i) => `<div class="file-item new"><span>🆕 ${esc(f.name)} <small>${formatSize(f.size)}</small></span><button data-new="${i}">✕</button></div>`)
    ].join("") || `<div class="item-meta">첨부된 파일이 없습니다.</div>`;
  };
  drawFiles();

  $("#fileList", main)?.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.kept !== undefined) removedFiles.push(...keptFiles.splice(Number(b.dataset.kept), 1));
    if (b.dataset.new !== undefined) newFiles.splice(Number(b.dataset.new), 1);
    drawFiles();
  });
  $("#sFiles", main)?.addEventListener("change", e => {
    for (const f of e.target.files) {
      try { checkFileSize(f); newFiles.push(f); } catch (err) { toast(err.message); }
    }
    e.target.value = "";
    drawFiles();
  });

  $("#btnSave", main).onclick = async () => {
    const title = $("#sTitle", main).value.trim();
    const content = $("#sContent", main).value.trim();
    if (!title) return toast("제목을 입력하세요.");
    if (!content && !keptFiles.length && !newFiles.length) return toast("활동 내용이나 파일을 올려주세요.");

    const id = subId || newKey(subsPath(pid, p.sid));
    const files = [...keptFiles];
    try {
      for (let i = 0; i < newFiles.length; i++) {
        loading(true, `파일 업로드 중 (${i + 1}/${newFiles.length})`);
        files.push(await uploadFile(newFiles[i], {
          sid: p.sid, name: p.name, subId: id, programId: pid, programTitle: program.title, category: program.category, year: program.year
        }));
      }
      loading(true, "저장 중...");
      const record = {
        programId: pid, category: program.category, year: program.year,
        sid: p.sid, name: p.name, grade: p.grade ?? "", cls: p.cls ?? "", no: p.no ?? "",
        title, content, files,
        createdAt: existing?.createdAt || serverTime,
        updatedAt: serverTime
      };
      if (existing?.feedback) Object.assign(record, { feedback: existing.feedback, feedbackBy: existing.feedbackBy || null, feedbackAt: existing.feedbackAt || null });
      await db.ref(subsPath(pid, p.sid, id)).set(record);
      // 목록에서 뺀 기존 파일은 저장이 끝난 뒤 드라이브 휴지통으로 이동
      for (const f of removedFiles) { try { await deleteFile(f.id); } catch (err) { console.warn(err); } }
      toast(subId ? "수정되었습니다." : "제출되었습니다.");
      location.replace(subHash({ programId: pid, sid: p.sid, id }));
    } catch (err) {
      console.error(err);
      toast("저장 실패: " + err.message);
    } finally {
      loading(false);
    }
  };
}

// ---------------- 제출 자료 상세 ----------------
export async function renderSubmission(main, { pid, sid, subId }, alive) {
  const program = await readVal(`portal/programs/${pid}`);
  if (!alive()) return;
  const teacher = isTeacher();
  if (!program) { main.innerHTML = emptyState("프로그램을 찾을 수 없습니다."); return; }
  program.id = pid;
  if (teacher && !canView(program)) { main.innerHTML = emptyState("🔒 담당 교사만 볼 수 있는 자료입니다."); return; }
  const s = await readVal(subsPath(pid, sid, subId));
  if (!alive()) return;
  if (!s) { main.innerHTML = emptyState("자료를 찾을 수 없습니다."); return; }
  const owner = isOwner(program);
  const cat = CATEGORIES[s.category] || { icon: "", label: "" };
  const canEdit = !teacher && program.category && programStatus(program).open
    && sid === String(session.profile.sid) && isCurrentYear(session.profile, program.year || schoolYear(), schoolYear());
  setTitle(`${cat.icon} 제출 자료`, `#/prog/${s.programId}`);

  main.innerHTML = `
    <div class="page">
      <div class="info-card">
        <div class="item-meta">${cat.icon} ${esc(cat.label)} · <a href="#/prog/${s.programId}">${esc(program.title)}</a></div>
        <h2 class="info-title">${esc(s.title)}</h2>
        <div class="info-meta">
          ${teacher ? `<a href="#/student/${encodeURIComponent(sid)}">${esc(sid)} ${esc(s.name)}</a> · ${esc(s.grade)}학년 ${esc(s.cls)}반 ${esc(s.no)}번 · ` : ""}
          제출 ${fmtDateTime(s.createdAt)}${s.updatedAt && s.updatedAt !== s.createdAt ? ` · 수정 ${fmtDateTime(s.updatedAt)}` : ""}
        </div>
        <div class="info-desc">${richText(s.content) || '<span class="item-meta">(내용 없음)</span>'}</div>
        ${s.files?.length ? `
          <div class="file-list">
            ${s.files.map((f, i) => `<button class="file-item link" data-file="${i}"><span>📄 ${esc(f.name)} <small>${formatSize(f.size)}</small></span><span>열기</span></button>`).join("")}
          </div>` : ""}
      </div>

      ${owner ? `
        <div class="form-card">
          <label class="field"><span>💬 교사 메모 (학생에게도 보입니다)</span>
            <textarea id="fbText" rows="3" placeholder="피드백이나 확인 메모">${esc(s.feedback || "")}</textarea>
          </label>
          <div class="btn-row end">
            ${s.feedbackBy ? `<span class="item-meta">${esc(s.feedbackBy)} · ${fmtDateTime(s.feedbackAt)}</span>` : ""}
            <button class="btn small primary" id="btnFeedback">메모 저장</button>
          </div>
        </div>` : (s.feedback ? `
        <div class="info-card feedback">
          <div class="item-meta">💬 ${esc(s.feedbackBy || "선생님")} 메모</div>
          <div>${richText(s.feedback)}</div>
        </div>` : "")}

      ${canEdit ? `
        <div class="btn-row">
          <a class="btn ghost" href="#/submit/${s.programId}/${subId}">✏️ 수정</a>
          <button class="btn ghost danger" id="btnDelSub">🗑 삭제</button>
        </div>` : ""}
    </div>`;

  $$("[data-file]", main).forEach(b => b.onclick = async () => {
    try { await openFile(s.files[Number(b.dataset.file)]); }
    catch (err) { toast("파일 열기 실패: " + err.message); }
  });

  $("#btnFeedback", main)?.addEventListener("click", async () => {
    const text = $("#fbText", main).value.trim();
    await db.ref(subsPath(pid, sid, subId)).update({
      feedback: text || null, feedbackBy: text ? session.profile.name : null, feedbackAt: text ? serverTime : null
    });
    toast("메모를 저장했습니다.");
  });

  $("#btnDelSub", main)?.addEventListener("click", async () => {
    if (!(await confirmBox("자료 삭제", "이 자료를 삭제할까요? 첨부 파일도 함께 삭제됩니다.", "삭제"))) return;
    loading(true, "삭제 중...");
    try {
      await db.ref(subsPath(pid, sid, subId)).remove();
      for (const f of s.files || []) { try { await deleteFile(f.id); } catch (err) { console.warn(err); } }
      toast("삭제되었습니다.");
      location.replace(`#/prog/${s.programId}`);
    } finally {
      loading(false);
    }
  });
}
