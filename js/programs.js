// 활동 자료 모듈: 빛나다 · 동아리 · 교과 · 심화탐구
// 데이터 구조
//   portal/programs/{pid}                : 반 { category, subjectGroup, year, title, description, members, days, closed, private, freeLog, v2, createdBy, createdByUid, createdAt,
//                                           assignments: { aid: 과제 { title, description, startDate, endDate, allowFiles, closed, createdAt } } }
//   portal/submissions/{pid}/{sid}/{id}  : { programId, assignmentId(없으면 자유 기록), category, year, sid, name, grade, cls, no, title, content, files[], createdAt, updatedAt, feedback… }
//   반은 명단·요일만(기간 없음), 과제는 필요할 때 반 안에 추가(기간·파일 허용은 과제마다). 자유 기록(freeLog)이 켜진 반은 과제 없이도 수시로 제출.
// 권한
//   관리(수정·마감·삭제·교사 메모) : 프로그램을 만든 교사(createdByUid)만
//   제출자료 열람                  : private 이면 만든 교사만, 아니면 모든 교사 (DB 보안 규칙으로도 강제)
import { db, readVal, newKey, serverTime } from "./firebase.js";
import { CATEGORIES, CLUB_SCHEDULE, SUBJECT_GROUPS } from "./config.js";
import { session, isTeacher } from "./auth.js";
import { $, $$, esc, richText, toast, modal, confirmBox, loading, emptyState, dateKey, fmtDateTime, schoolYear, sidCompare, downloadCsv, periodFieldHtml, bindPeriodField, fmtDateKey } from "./ui.js";
import { setTitle, go } from "./nav.js";
import { uploadFile, openFile, deleteFile, checkFileSize, formatSize } from "./drive.js";
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

// 반의 상태: 운영중 / 종료(교사가 운영 종료). 기간은 과제에 있음
export function programStatus(p) {
  return p.closed ? { key: "closed", label: "종료", open: false } : { key: "open", label: "운영중", open: true };
}

// ---------------- 과제 ----------------
export const taskList = p => Object.entries(p.assignments || {}).map(([id, a]) => ({ ...a, id }));
export function taskStatus(a) {
  const today = dateKey();
  if (a.closed) return { key: "closed", label: "마감", open: false };
  if (a.startDate && today < a.startDate) return { key: "soon", label: "예정", open: false };
  if (a.endDate && today > a.endDate) return { key: "closed", label: "마감", open: false };
  return { key: "open", label: "진행중", open: true };
}
const TASK_ORDER = { open: 0, soon: 1, closed: 2 };
const sortTasks = list => list.sort((a, b) => TASK_ORDER[taskStatus(a).key] - TASK_ORDER[taskStatus(b).key]
  || (taskStatus(a).key === "closed" ? String(b.endDate).localeCompare(String(a.endDate)) : String(a.endDate).localeCompare(String(b.endDate))));
const taskPeriod = a => a.startDate === a.endDate ? `${fmtDateKey(a.startDate)} 하루` : `${fmtDateKey(a.startDate)} ~ ${fmtDateKey(a.endDate)}`;
const taskForm = a => (a.allowFiles === false ? "글" : "글·파일");
const taskBadge = a => { const s = taskStatus(a); return `<span class="badge st-${s.key}">${s.label}</span>`; };
const doneKey = s => `${s.programId}/${s.assignmentId}`;

// 예전 구조(반에 제출 기간)를 새 구조로 옮김 — 만든 교사가 화면을 열 때 한 번
//  · 빛나다·동아리: 기간 없이 수시 제출이었으므로 자유 기록 켬
//  · 심화탐구·교과: 반의 제출 기간을 "기본 과제" 하나로, 예전 제출자료는 그 과제로
async function migrateLegacy(p) {
  if (!p || p.v2 || !isOwner(p)) return p;
  const upd = { v2: true, startDate: null, endDate: null, allowFiles: null };
  let a0 = null;
  if (p.category === "bitnada" || p.category === "club") upd.freeLog = true;
  else if (p.startDate || p.endDate) {
    const start = p.startDate || p.endDate, end = p.endDate || p.startDate;
    a0 = { title: "기본 과제", description: "", startDate: start, endDate: end, allowFiles: p.allowFiles !== false, createdAt: serverTime };
    upd["assignments/a0"] = a0;
  }
  try {
    await db.ref(`portal/programs/${p.id}`).update(upd);
    if (a0) {
      const moves = {};
      (await loadProgramSubs(p.id)).filter(s => !s.assignmentId).forEach(s => { moves[`${s.sid}/${s.id}/assignmentId`] = "a0"; });
      if (Object.keys(moves).length) await db.ref(`portal/submissions/${p.id}`).update(moves);
    }
    return { ...p, ...upd, assignments: a0 ? { ...(p.assignments || {}), a0 } : p.assignments, startDate: undefined, endDate: undefined };
  } catch (err) {
    console.warn("예전 구조 옮기기 실패", p.id, err);
    return p;
  }
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
  return list.length && list.length < 5 ? list.map(d => WEEK[d]).join("·") : "매일";   // "화·목" (요일 글자 없이)
}

// 반의 활동 시간: 빛나다 요일만. 동아리(수요일 5교시 고정)는 늘 같아서 표시하지 않음(사용자 요청). 심화탐구·교과는 없음
function periodText(p) {
  if (p.category === "bitnada") return daysText(p);
  return "";
}

function targetText(p) {
  if (p.members) return `학생 ${Object.keys(p.members).length}명`;
  const g = Object.keys(p.grades || {}).sort();
  return g.length ? g.map(x => x + "학년").join("·") : "전 학년";
}

// 예전 프로그램(명단 없이 학년으로 지정)도 계속 보이게 합니다.
export const isMember = (p, profile) => (p.members ? !!p.members[profile.sid] : (!p.grades || !!p.grades[profile.grade]));

const statusBadge = p => { const s = programStatus(p); return `<span class="badge st-${s.key}">${s.label}</span>`; };
// 교사 화면용: 내 담당 / 비공개 표시
const accessBadge = p => (isOwner(p) ? `<span class="badge st-soon">내 담당</span>` : "") + (p.private ? `<span class="badge st-closed">🔒 담당자만</span>` : "");
// 교과는 "프로그램" 대신 "과목" (사용자 요청)
const unitOf = cat => (cat === "subject" ? "과목" : "프로그램");
const byNewest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);

// ---------------- 카테고리 화면 ----------------
// 메뉴(빛나다·동아리·심화탐구, 교과는 교과군)를 누르면 반 목록 → 반을 누르면 과제와 그 반의 제출자료.
// 교과는 한 단계 더: 교과(#/p/subject) → 교과군(#/sg/{군}) → 지금의 목록 화면. 교과군은 프로그램의 subjectGroup.
// 교과군을 정하지 않은 예전 교과 프로그램은 "기타"(etc)로 모아 보여 줍니다(있을 때만 카드가 나옴).
const groupOf = p => (SUBJECT_GROUPS[p.subjectGroup] ? p.subjectGroup : "etc");
const groupInfo = g => SUBJECT_GROUPS[g] || { label: "기타", icon: "📁" };

export async function renderCategory(main, { cat, mode, group }, alive) {
  const c = CATEGORIES[cat];
  if (!c) { go("#/home"); return; }
  if (cat === "subject" && !group) return renderSubjectGroups(main, alive);
  // 메뉴를 누르면 바로 반 목록 (예전 "제출자료" 첫 화면과 ⚙️ 관리 단계는 없앰 — 예전 …/manage 주소도 같은 화면)
  // 교과군 목록은 2단계(<<), 그 밖의 메뉴 목록은 1단계(<)
  if (group) setTitle(groupInfo(group).label, "#/p/subject", 2);
  else setTitle(c.label, "#/home");
  if (isTeacher()) return renderTeacherCategory(main, cat, alive, group);
  return renderStudentCategory(main, cat, alive, group);
}

// ---------------- 학생 미제출 배지 ----------------
// 미제출 = 올해 명단에 든 운영중인 반의 **진행중 과제** 중 아직 내지 않은 것 (자유 기록은 세지 않음)
// 돌려주는 값: 미제출 과제마다 그 반(프로그램)을 하나씩 — 부르는 쪽은 반의 메뉴·교과군으로 셈
export async function loadPendingPrograms() {
  const p = session.profile;
  const year = currentYearOf(p, schoolYear());
  const open = Object.values(await loadAllPrograms())
    .filter(pr => Number(pr.year) === year && isMember(pr, p) && programStatus(pr).open && taskList(pr).some(t => taskStatus(t).open));
  const done = new Set((await loadPersonSubs(p, open)).filter(s => s.assignmentId).map(doneKey));
  const out = [];
  open.forEach(pr => taskList(pr).forEach(t => { if (taskStatus(t).open && !done.has(`${pr.id}/${t.id}`)) out.push(pr); }));
  return out;
}
// 카드 오른쪽 위의 점멸하는 빨간 숫자
export function setPendingBadge(card, n) {
  if (!card) return;
  card.querySelector(".pend-badge")?.remove();
  if (n > 0) card.insertAdjacentHTML("beforeend", `<span class="pend-badge" aria-label="미제출 ${n}개">${n}</span>`);
}

export const renderSubjectGroup = (main, { group, mode }, alive) => renderCategory(main, { cat: "subject", group, mode }, alive);

// 학생에게 보이는 프로그램: 제출한 적 있거나, 올해 명단에 든 것
function studentVisible(programs, mySubs, p) {
  const counts = {};
  mySubs.forEach(s => { counts[s.programId] = (counts[s.programId] || 0) + 1; });
  const year = currentYearOf(p, schoolYear());
  return { counts, year, list: programs.filter(pr => counts[pr.id] || (Number(pr.year) === year && isMember(pr, p))) };
}

// 교과 첫 화면: 교과군 카드 (교사 = 볼 수 있는 프로그램 수, 학생 = 내 프로그램 수)
async function renderSubjectGroups(main, alive) {
  setTitle(CATEGORIES.subject.label);
  let programs = await loadPrograms("subject");
  if (isTeacher()) programs = programs.filter(canView);
  else programs = studentVisible(programs, await loadPersonSubs(session.profile, programs), session.profile).list;
  if (!alive()) return;
  const n = {};
  programs.forEach(p => { n[groupOf(p)] = (n[groupOf(p)] || 0) + 1; });
  const keys = [...Object.keys(SUBJECT_GROUPS), ...(n.etc ? ["etc"] : [])];
  // 학생: 교과군마다 미제출 수
  const pending = {};
  if (!isTeacher()) (await loadPendingPrograms()).filter(pr => pr.category === "subject").forEach(pr => { pending[groupOf(pr)] = (pending[groupOf(pr)] || 0) + 1; });
  if (!alive()) return;
  main.innerHTML = `
    <div class="page">
      <div class="mini-grid">
        ${keys.map(k => `
          <a class="mini-card" href="#/sg/${k}" style="--accent:${CATEGORIES.subject.color}">
            <span class="mini-icon">${groupInfo(k).icon}</span>
            <span class="mini-text"><b>${esc(groupInfo(k).label)}</b><small>과목 ${n[k] || 0}개</small></span>
            ${pending[k] ? `<span class="pend-badge" aria-label="미제출 ${pending[k]}개">${pending[k]}</span>` : ""}
          </a>`).join("")}
      </div>
    </div>`;
}

// 학생 목록의 반 요약: 진행중 미제출(빨강) > 기간 만료 미제출(검정) > 모두 제출(초록) > 예정 과제(회색) > 과제 없음
function submitState(pr, done) {
  const tasks = taskList(pr);
  const got = t => done.has(`${pr.id}/${t.id}`);
  const open = tasks.filter(t => taskStatus(t).open && !got(t)).length;
  const expired = tasks.filter(t => taskStatus(t).key === "closed" && !got(t)).length;
  const due = tasks.filter(t => taskStatus(t).key !== "soon");
  const soon = tasks.length - due.length;
  if (open) return `<span class="not-submitted">미제출 ${open}개 (진행중)</span>`;
  if (expired) return `<span class="sub-expired">미제출 ${expired}개 (기간 만료)</span>`;
  if (due.length) return `<span class="sub-done">✅ 제출 완료</span>${soon ? ` <span class="sub-soon">· 예정 과제 ${soon}개</span>` : ""}`;
  if (soon) return `<span class="sub-soon">예정 과제 ${soon}개</span>`;
  return `<span class="sub-soon">과제 없음${pr.freeLog ? " · 자유기록" : ""}</span>`;
}

async function renderStudentCategory(main, cat, alive, group) {
  const p = session.profile;
  let programs = await loadPrograms(cat);
  if (group) programs = programs.filter(pr => groupOf(pr) === group);
  const mySubs = await loadPersonSubs(p, programs);
  if (!alive()) return;
  const { year, list } = studentVisible(programs, mySubs, p);
  const done = new Set(mySubs.filter(s => s.assignmentId).map(doneKey));
  const visible = list
    .sort((a, b) => Number(runsToday(b)) - Number(runsToday(a))
      || Number(programStatus(b).open) - Number(programStatus(a).open) || byNewest(a, b));

  main.innerHTML = `
    <div class="page">
      <div class="card-list">
        ${visible.length ? visible.map(pr => `
          <a class="item-card" href="#/prog/${pr.id}">
            <div class="item-top">${Number(pr.year) === year ? statusBadge(pr) : `<span class="badge st-closed">${esc(pr.year)}학년도</span>`}${Number(pr.year) === year && runsToday(pr) ? '<span class="badge st-open">오늘</span>' : ""}${periodText(pr) ? `<span class="item-meta">${esc(periodText(pr))}</span>` : ""}</div>
            <div class="item-title">${esc(pr.title)}</div>
            <div class="item-meta">${submitState(pr, done)}</div>
          </a>`).join("") : emptyState(`현재 참여할 수 있는 ${unitOf(cat)}이 없습니다.`)}
      </div>
    </div>`;
}

// 교사: 반 목록 (학년도 · 반 n개 · ➕). 반을 누르면 과제와 그 반의 제출자료(과제 필터·CSV)
async function renderTeacherCategory(main, cat, alive, group = null) {
  // 다른 교사의 비공개 반은 목록에서도 보이지 않음
  let programs = (await loadPrograms(cat)).filter(canView).filter(p => !group || groupOf(p) === group);
  programs = await Promise.all(programs.map(migrateLegacy));   // 내 반 중 예전 구조는 이때 옮김
  const subs = await loadProgramsSubs(programs);
  if (!alive()) return;
  const years = [...new Set([schoolYear(), ...programs.map(p => Number(p.year))])].filter(Boolean).sort((a, b) => b - a);
  const counts = {};
  subs.forEach(s => { counts[s.programId] = (counts[s.programId] || 0) + 1; });
  let year = String(schoolYear());

  main.innerHTML = `
    <div class="page">
      <div class="filter-bar prog-filter manage-bar">
        <select id="fYear">${years.map(y => `<option value="${y}">${String(y).slice(2)}학년도</option>`).join("")}<option value="">전 학년도</option></select>
        <span class="mh-count" id="progCount"></span>
        <button class="btn small primary add-btn" id="btnNewProgram" aria-label="새 ${unitOf(cat)}" title="새 ${unitOf(cat)}"><svg class="plus-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v15M4.5 12h15"/></svg></button>
      </div>
      <div id="catBody"></div>
    </div>`;

  const draw = () => {
    const list = programs.filter(p => !year || String(p.year) === year).sort(byNewest);
    $("#progCount", main).innerHTML = `${unitOf(cat)} <b>${list.length}</b>개`;
    $("#catBody", main).innerHTML = `
      <div class="card-list">
        ${list.length ? list.map(p => `
          <a class="item-card" href="#/prog/${p.id}">
            <div class="item-top">${statusBadge(p)}${accessBadge(p)}<span class="item-meta">${esc([targetText(p), periodText(p)].filter(Boolean).join(" · "))}</span></div>
            <div class="item-title">${esc(p.title)}</div>
            <div class="item-meta">과제 ${taskList(p).length}개${taskList(p).some(t => taskStatus(t).open) ? " (진행중 있음)" : ""} · 제출 ${counts[p.id] || 0}건${p.freeLog ? " · 자유기록" : ""} · 담당 ${esc(p.createdBy || "")}</div>
          </a>`).join("") : emptyState(`${unitOf(cat)}이 없습니다.`)}
      </div>`;
  };
  $("#fYear", main).onchange = e => { year = e.target.value; draw(); };
  $("#btnNewProgram", main).onclick = async () => {
    const saved = await programDialog({ category: cat, subjectGroup: group && group !== "etc" ? group : null, year: schoolYear(), private: !!PRIVATE_BY_DEFAULT[cat] });
    if (saved) go(`#/prog/${saved}`);
  };
  draw();
}

const subHash = s => `#/sub/${s.programId}/${encodeURIComponent(s.sid)}/${s.id}`;

// 제출자료 목록 (교사 검색 결과·학생 프로필에서 공용)
// view: "list" | "student"(학생별 묶음) | "profile"(학생 정보 화면 — 위에 학생이 이미 있어 학번·이름 줄 없음)
export function renderSubmissionList(container, subs, programsById, view = "list") {
  if (!subs.length) { container.innerHTML = emptyState("조건에 맞는 제출 자료가 없습니다."); return; }
  const itemHtml = (s, full, who = true) => {
    const pr = programsById[s.programId];
    const cat = CATEGORIES[s.category];
    const task = pr && s.assignmentId ? pr.assignments?.[s.assignmentId] : null;
    return `
      <a class="sub-row" href="${subHash(s)}">
        <div class="sub-row-top">
          ${who ? `<span class="who">${esc(s.sid)} ${esc(s.name)}</span>` : ""}
          <span class="prog">${cat ? cat.icon : ""} ${esc(pr ? pr.title : "(삭제된 프로그램)")}${pr ? ` · ${esc(task ? task.title : "자유 기록")}` : ""}</span>
          <span class="date">${fmtDateTime(s.updatedAt || s.createdAt).slice(0, 10)}</span>
        </div>
        <div class="sub-row-title">${esc(s.title)}${s.files?.length ? ` <span class="clip">🍒${s.files.length}</span>` : ""}${s.feedback ? ` <span class="clip">💬</span>` : ""}</div>
        <div class="sub-row-content ${full ? "full" : ""}">${full ? richText(s.content) : esc(s.content)}</div>
      </a>`;
  };

  if (view === "profile") {
    container.innerHTML = `<div class="student-group">${subs.map(s => itemHtml(s, true, false)).join("")}</div>`;
  } else if (view === "student") {
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
  const rows = [["학년도", "구분", "프로그램", "과제", "학번", "학년", "반", "번호", "이름", "제목", "내용", "첨부파일", "제출일", "교사 메모"]];
  [...subs].sort((a, b) => sidCompare(a.sid, b.sid) || (a.createdAt || 0) - (b.createdAt || 0)).forEach(s => {
    rows.push([
      s.year, CATEGORIES[s.category]?.label || s.category, programsById[s.programId]?.title || "",
      (s.assignmentId && programsById[s.programId]?.assignments?.[s.assignmentId]?.title) || "자유 기록",
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
  return modal({
    title: "",                    // 제목 줄 없이 (사용자 요청)
    wide: true,
    html: `
      <label class="field"><span>${unitOf(p.category)}명</span><input id="pgTitle" value="${esc(p.title || "")}" placeholder="${p.category === "subject" ? "예: 공통영어2 1-3반" : "예: 2학기 인문학 독서토론"}"></label>
      <label class="field"><span>안내 (학생에게 보이는 설명·제출 방법)</span><textarea id="pgDesc" rows="5" placeholder="활동 내용, 제출해야 할 자료, 유의사항 등">${esc(p.description || "")}</textarea></label>
      ${p.category === "bitnada" ? `
        <div class="field"><span>활동 요일</span>
          <div class="checks">${[1, 2, 3, 4, 5].map(n => `<label><input type="checkbox" class="pgDay" value="${n}" ${!p.days || p.days[n] ? "checked" : ""}> ${WEEK[n]}</label>`).join("")}</div>
        </div>` : ""}
      ${memberPickerHtml("참여 학생 명단")}
      <div class="check-pair">
        <label class="check-line"><input type="checkbox" id="pgFree" ${p.freeLog ? "checked" : ""}>♾️자유 기록</label>
        <label class="check-line"><input type="checkbox" id="pgPrivate" ${p.private ? "checked" : ""}>🔒타교사 열람 제한</label>
      </div>`,
    okText: "저장",
    cancelText: "취소",
    // 동아리는 반에서 몇 명만 참여하므로 반을 골라도 꺼진 상태로 시작합니다.
    onOpen: async box => {
      picker = await bindMemberPicker(box, p.members, { defaultOn: p.category !== "club" });
    },
    beforeOk: async box => {
      const title = $("#pgTitle", box).value.trim();
      if (!title) throw new Error(`${unitOf(p.category)}명을 입력하세요.`);
      const members = picker.get();
      if (!members) throw new Error("참여 학생을 한 명 이상 선택하세요.");
      const days = {};
      $$(".pgDay", box).forEach(c => { if (c.checked) days[c.value] = true; });
      if (p.category === "bitnada" && !Object.keys(days).length) throw new Error("활동 요일을 하나 이상 고르세요.");
      const data = {
        category: p.category,
        subjectGroup: p.category === "subject" ? (p.subjectGroup || null) : null,
        year: Number(p.id && p.year) || schoolYear(),   // 학년도는 고르지 않음: 만들 때의 학년도
        title,
        description: $("#pgDesc", box).value.trim(),
        members,
        grades: null,
        days: Object.keys(days).length && Object.keys(days).length < 5 ? days : null,   // 월~금 모두 = 매일(null)
        startDate: null,            // 기간은 과제마다 (반에는 없음)
        endDate: null,
        allowFiles: null,
        freeLog: $("#pgFree", box).checked,
        v2: true,
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
  let program = await readVal(`portal/programs/${pid}`);
  if (!alive()) return;
  if (!program) { main.innerHTML = emptyState("프로그램을 찾을 수 없습니다."); return; }
  program.id = pid;
  program = await migrateLegacy(program);   // 만든 교사가 열면 예전 구조를 한 번 옮김
  if (!alive()) return;
  const cat = CATEGORIES[program.category];
  // 반 목록에서 들어옴: 2단계(<<), 교과는 교과군이 한 단계 더 있어 3단계(<<<)
  const back = program.category === "subject" ? `#/sg/${groupOf(program)}` : `#/p/${program.category}`;
  const label = program.category === "subject" ? groupInfo(groupOf(program)).label : cat.label;
  setTitle(label, back, program.category === "subject" ? 3 : 2);

  const teacher = isTeacher();
  const tasks = sortTasks(taskList(program));
  const open = programStatus(program).open;
  const memberN = program.members ? Object.keys(program.members).length : 0;

  // 반 머리 (메뉴 색) — 교사: 인원·자유 기록 / 학생: 담당 선생님
  // actions: 만든 교사에게만 오른쪽 위 [수정 · 종료/재개 · 삭제] (이모지 없이, 사용자 요청)
  const head = (extra, actions = "") => `
    <div class="prog-head">
      ${actions}
      <div class="item-top">${teacher || isCurrentYear(session.profile, program.year || schoolYear(), schoolYear())
        ? statusBadge(program) : `<span class="badge st-closed">지난 학년도</span>`}${teacher ? accessBadge(program) : ""}<span class="item-meta">${esc(extra)}</span></div>
      <h2 class="prog-title">${esc(program.title)}</h2>
      ${program.description ? `<div class="prog-desc">${richText(program.description)}</div>` : ""}
    </div>`;

  if (!teacher) {
    const mine = (await loadPersonSubs(session.profile, [program])).sort(byNewest);
    const thisYear = isCurrentYear(session.profile, program.year || schoolYear(), schoolYear());
    if (!alive()) return;
    const byTask = {};
    mine.filter(s => s.assignmentId).forEach(s => { byTask[s.assignmentId] ||= s; });
    const free = mine.filter(s => !s.assignmentId);
    const canFree = thisYear && open && program.freeLog;
    main.innerHTML = `
      <div class="page">
        <div class="prog-shell cat-${program.category}">
          ${head([periodText(program), `담당 ${program.createdBy || ""}`].filter(Boolean).join(" · "))}
          <div class="prog-body">
            ${program.freeLog || free.length ? `
              <div class="free-box">
                <div class="free-top"><span>♾️ ${program.freeLog ? "내 활동 기록" : "이전 자료"} ${free.length}건</span>
                  ${canFree ? `<a class="btn small ghost" href="#/submit/${pid}">기록하기</a>` : ""}</div>
                ${free.length ? `<div class="free-list">${free.map(s => `<a href="${subHash(s)}">${esc(s.title)} <small>${fmtDateTime(s.updatedAt || s.createdAt).slice(0, 10)}</small></a>`).join("")}</div>` : ""}
              </div>` : ""}
            <div class="task-head"><span>과제 ${tasks.length}개</span></div>
            <div class="task-rail">
              ${tasks.length ? tasks.map(t => {
                const st = taskStatus(t), my = byTask[t.id];
                let line;
                if (my) line = `<span class="sub-done">✓ 제출 완료</span><a class="task-go ghost" href="${subHash(my)}">보기</a>`;
                else if (st.open && thisYear && open) line = `<span class="not-submitted">미제출 (진행중)</span><a class="task-go" href="#/submit/${pid}/a/${t.id}">제출하기</a>`;
                else if (st.key === "closed") line = `<span class="sub-expired">미제출 (기간 만료)</span>`;
                else line = `<span class="sub-soon">미제출 (시작 전)</span>`;
                return `
                  <div class="task-card">
                    <div class="item-meta">${taskPeriod(t)} · ${taskForm(t)}</div>
                    <div class="task-title">${esc(t.title)}</div>
                    ${t.description ? `<div class="task-desc">${richText(t.description)}</div>` : ""}
                    <div class="task-line">${line}</div>
                  </div>`;
              }).join("") : `<div class="task-empty">아직 과제가 없습니다.</div>`}
            </div>
          </div>
        </div>
      </div>`;
    return;
  }

  // ---------- 교사 ----------
  if (!canView(program)) {
    main.innerHTML = `<div class="page"><div class="prog-shell cat-${program.category}">${head(`담당 ${program.createdBy || ""}`)}</div>
      ${emptyState(`🔒 담당 교사(${program.createdBy || ""})만 제출자료를 볼 수 있는 ${unitOf(program.category)}입니다.`)}</div>`;
    return;
  }
  const owner = isOwner(program);
  const subs = await loadProgramSubs(pid);
  if (!alive()) return;
  const doneBy = aid => new Set(subs.filter(s => s.assignmentId === aid).map(s => s.sid)).size;
  const free = subs.filter(s => !s.assignmentId);
  let view = "list", filter = "";

  main.innerHTML = `
    <div class="page">
      <div class="prog-shell cat-${program.category}">
        ${head([periodText(program), targetText(program), program.freeLog ? "자유기록" : ""].filter(Boolean).join(" · "),
          owner ? `<div class="prog-actions">
            <button class="al-mini" id="btnEdit">수정</button>
            <button class="al-mini" id="btnClose">${program.closed ? "재개" : "종료"}</button>
            <button class="al-mini danger" id="btnDelete">삭제</button>
          </div>` : "")}
        <div class="prog-body">
          ${program.freeLog || free.length ? `
            <button class="free-box free-btn" data-pick="__free">
              <span>♾️ ${program.freeLog ? "자유 기록" : "이전 자료"} ${free.length}건</span><span class="item-meta">보기</span>
            </button>` : ""}
          <div class="task-head"><span>과제 ${tasks.length}개</span>
            ${owner ? `<button class="btn small primary add-btn" id="btnNewTask" aria-label="새 과제" title="새 과제"><svg class="plus-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v15M4.5 12h15"/></svg></button>` : ""}</div>
          <div class="task-rail">
            ${tasks.length ? tasks.map(t => `
              <div class="task-card clickable" data-pick="${t.id}">
                <div class="item-top">${taskBadge(t)}<span class="item-meta">${taskPeriod(t)} · ${taskForm(t)} · ${doneBy(t.id)}${memberN ? `/${memberN}` : "명"}</span></div>
                <div class="task-title">${esc(t.title)}</div>
                ${owner ? `<div class="task-actions"><button class="al-mini" data-tedit="${t.id}">수정</button><button class="al-mini" data-tclose="${t.id}">${t.closed ? "다시 열기" : "마감"}</button><button class="al-mini danger" data-tdel="${t.id}">삭제</button></div>` : ""}
              </div>`).join("") : `<div class="task-empty">과제가 없습니다.${owner ? " ➕ 로 추가하세요." : ""}</div>`}
          </div>
        </div>
      </div>
      ${owner ? "" : `<p class="item-meta">열람만 가능합니다. 관리는 담당 교사(${esc(program.createdBy || "")})가 합니다.</p>`}
      <div class="result-head">
        <span>제출 <b id="subCount">${subs.length}</b>건</span>
        <span class="head-actions">
          <select id="taskFilter" class="task-filter"><option value="">전 과제</option>${tasks.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join("")}${program.freeLog || free.length ? `<option value="__free">자유 기록</option>` : ""}</select>
          <span class="seg"><button class="on" data-view="list">목록</button><button data-view="student">학생별</button></span>
          <button class="btn small ghost icon-only" id="btnCsv" aria-label="CSV 내려받기" title="CSV 내려받기"><svg class="dl-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/></svg></button>
        </span>
      </div>
      <div id="subResults"></div>
    </div>`;

  const shown = () => subs.filter(s => !filter || (filter === "__free" ? !s.assignmentId : s.assignmentId === filter));
  const drawList = () => {
    $("#subCount", main).textContent = shown().length;
    renderSubmissionList($("#subResults", main), shown(), { [pid]: program }, view);
  };
  drawList();
  const setFilter = v => { filter = v; $("#taskFilter", main).value = v; drawList(); };
  $("#taskFilter", main).onchange = e => setFilter(e.target.value);
  // 과제(또는 자유 기록)를 누르면 아래 제출 목록이 그것만 보이게
  $$("[data-pick]", main).forEach(el => el.onclick = e => {
    if (e.target.closest("button[data-tedit], button[data-tdel], button[data-tclose]")) return;
    setFilter(el.dataset.pick);
    $("#subResults", main).scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $$("[data-view]", main).forEach(b => b.onclick = () => {
    view = b.dataset.view;
    $$("[data-view]", main).forEach(x => x.classList.toggle("on", x === b));
    drawList();
  });
  $("#btnCsv", main).onclick = () => exportCsv(shown(), { [pid]: program }, `${program.title}_제출자료.csv`);
  if (!owner) return;

  const reload = () => renderProgram(main, { pid }, alive);
  $("#btnNewTask", main).onclick = async () => { if (await taskDialog(program)) reload(); };
  $$("[data-tedit]", main).forEach(b => b.onclick = async () => { if (await taskDialog(program, program.assignments[b.dataset.tedit], b.dataset.tedit)) reload(); });
  $$("[data-tclose]", main).forEach(b => b.onclick = async () => {
    const t = program.assignments[b.dataset.tclose];
    await db.ref(`portal/programs/${pid}/assignments/${b.dataset.tclose}/closed`).set(!t.closed || null);
    toast(t.closed ? "과제를 다시 열었습니다." : "과제를 마감했습니다.");
    reload();
  });
  $$("[data-tdel]", main).forEach(b => b.onclick = async () => {
    const aid = b.dataset.tdel, n = subs.filter(s => s.assignmentId === aid).length;
    if (n) { modal({ title: "삭제할 수 없음", html: `<p>이 과제에 제출된 자료가 ${n}건 있어 삭제할 수 없습니다.<br>더 받지 않으려면 <b>마감</b>을 누르세요.</p>` }); return; }
    if (!(await confirmBox("과제 삭제", `'${esc(program.assignments[aid].title)}' 과제를 삭제할까요?`, "삭제"))) return;
    await db.ref(`portal/programs/${pid}/assignments/${aid}`).remove();
    toast("삭제되었습니다.");
    reload();
  });
  $("#btnEdit", main).onclick = async () => { if (await programDialog(program)) reload(); };
  $("#btnClose", main).onclick = async () => {
    await db.ref(`portal/programs/${pid}/closed`).set(!program.closed);
    toast(program.closed ? "다시 운영합니다." : "운영을 종료했습니다. 학생은 더 이상 제출할 수 없습니다.");
    reload();
  };
  $("#btnDelete", main).onclick = async () => {
    if (subs.length) {
      modal({ title: "삭제할 수 없음", html: `<p>학생 제출 자료가 ${subs.length}건 있어 삭제할 수 없습니다.<br>더 이상 받지 않으려면 <b>운영 종료</b>를 사용하세요.</p>` });
      return;
    }
    if (!(await confirmBox(`${unitOf(program.category)} 삭제`, `'${esc(program.title)}' ${unitOf(program.category)}을 삭제할까요?`, "삭제"))) return;
    await db.ref(`portal/programs/${pid}`).remove();
    toast("삭제되었습니다.");
    go(program.category === "subject" ? `#/sg/${groupOf(program)}` : `#/p/${program.category}`);
  };
}

// ---------------- 과제 추가·수정 (반을 만든 교사) ----------------
function taskDialog(program, t = {}, aid = null) {
  const today = dateKey();
  const week = new Date(); week.setDate(week.getDate() + 6);
  return modal({
    title: "",
    wide: true,
    html: `
      <label class="field"><span>과제명</span><input id="tkTitle" value="${esc(t.title || "")}" placeholder="예: 토론 소감문"></label>
      <label class="field"><span>안내</span><textarea id="tkDesc" rows="4" placeholder="무엇을, 어떻게 제출하는지">${esc(t.description || "")}</textarea></label>
      <div class="nt-when">
        ${periodFieldHtml({ label: "제출 기간", startId: "tkStart", endId: "tkEnd", start: t.startDate || today, end: t.endDate || dateKey(week), endPh: "마감일" })}
        <div class="field"><span>제출 형식</span>
          <div class="checks nt-grades"><label><input type="checkbox" id="tkFiles" ${t.allowFiles !== false ? "checked" : ""}>파일·사진 첨부 허용</label></div>
        </div>
      </div>`,
    okText: "저장",
    cancelText: "취소",
    onOpen: box => bindPeriodField(box, "tkStart", "tkEnd"),
    beforeOk: async box => {
      const title = $("#tkTitle", box).value.trim();
      const start = $("#tkStart", box).value, end = $("#tkEnd", box).value;
      if (!title) throw new Error("과제명을 입력하세요.");
      if (!start || !end) throw new Error("제출 기간을 입력하세요.");
      if (start > end) throw new Error("마감일이 시작일보다 빠릅니다.");
      const data = { title, description: $("#tkDesc", box).value.trim(), startDate: start, endDate: end, allowFiles: $("#tkFiles", box).checked };
      if (aid) await db.ref(`portal/programs/${program.id}/assignments/${aid}`).update({ ...data, updatedAt: serverTime });
      else await db.ref(`portal/programs/${program.id}/assignments/${newKey(`portal/programs/${program.id}/assignments`)}`).set({ ...data, createdAt: serverTime });
      toast("저장되었습니다.");
    }
  });
}

// ---------------- 자료 제출/수정 (학생) ----------------
// #/submit/{반}            자유 기록 새로 쓰기
// #/submit/{반}/a/{과제}    과제 제출 (이미 냈으면 그 자료 수정으로)
// #/submit/{반}/{자료}      자료 수정
export async function renderSubmitForm(main, { pid, subId, aid }, alive) {
  if (isTeacher()) { main.innerHTML = emptyState("자료 제출은 학생 계정에서만 가능합니다."); return; }
  const p = session.profile;
  const [program, existing] = await Promise.all([
    readVal(`portal/programs/${pid}`),
    subId ? readVal(subsPath(pid, p.sid, subId)) : null
  ]);
  if (!alive()) return;
  if (!program) { main.innerHTML = emptyState("프로그램을 찾을 수 없습니다."); return; }
  program.id = pid;
  const cat = CATEGORIES[program.category];
  setTitle(subId ? "자료 수정" : (aid ? "과제 제출" : "자유 기록"), `#/prog/${pid}`, 3);
  if (subId && !existing) { main.innerHTML = emptyState("자료를 찾을 수 없습니다."); return; }
  const taskId = aid || existing?.assignmentId || null;
  const task = taskId ? program.assignments?.[taskId] : null;
  if (!isCurrentYear(p, program.year || schoolYear(), schoolYear())) { main.innerHTML = emptyState(`지난 학년도 ${unitOf(program.category)}에는 제출할 수 없습니다.`); return; }
  if (!programStatus(program).open) { main.innerHTML = emptyState(`운영이 종료된 ${unitOf(program.category)}입니다.`); return; }
  if (taskId && !task) { main.innerHTML = emptyState("과제를 찾을 수 없습니다."); return; }
  if (task && !taskStatus(task).open) { main.innerHTML = emptyState("제출 기간이 아닙니다."); return; }
  if (!task && !program.freeLog) { main.innerHTML = emptyState(`이 ${unitOf(program.category)}은 과제로만 제출합니다.`); return; }
  // 과제는 한 번만 제출(이미 냈으면 수정 화면으로)
  if (task && !subId) {
    const mine = (await loadPersonSubs(p, [program])).find(s => s.assignmentId === taskId);
    if (mine) { location.replace(`#/submit/${pid}/${mine.id}`); return; }
  }
  const allowFiles = task ? task.allowFiles !== false : true;

  let keptFiles = [...(existing?.files || [])];
  const removedFiles = [];
  let newFiles = [];

  main.innerHTML = `
    <div class="page">
      <div class="form-card">
        <div class="item-meta">${cat.icon} ${esc(cat.label)} · ${esc(program.title)}</div>
        <h2 class="info-title">${task ? esc(task.title) : "♾️ 자유 기록"}</h2>
        ${task ? `<div class="item-meta">${taskPeriod(task)} · ${taskForm(task)}</div>` : ""}
        ${task?.description ? `<div class="info-desc">${richText(task.description)}</div>` : ""}
        <label class="field"><span>제목</span><input id="sTitle" maxlength="100" value="${esc(existing?.title || (task ? task.title : ""))}" placeholder="활동을 한 줄로 요약"></label>
        <label class="field"><span>내용</span>
          <textarea id="sContent" rows="10" placeholder="무엇을 했고, 무엇을 배우고 느꼈는지 구체적으로 적어주세요.">${esc(existing?.content || "")}</textarea>
        </label>
        ${allowFiles ? `
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
    if (!content && !keptFiles.length && !newFiles.length) return toast("내용이나 파일을 올려주세요.");

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
      if (taskId) record.assignmentId = taskId;
      if (existing?.feedback) Object.assign(record, { feedback: existing.feedback, feedbackBy: existing.feedbackBy || null, feedbackAt: existing.feedbackAt || null });
      await db.ref(subsPath(pid, p.sid, id)).set(record);
      // 목록에서 뺀 기존 파일은 저장이 끝난 뒤 드라이브 휴지통으로 이동
      for (const f of removedFiles) { try { await deleteFile(f.id); } catch (err) { console.warn(err); } }
      toast(subId ? "수정되었습니다." : "제출되었습니다.");
      location.replace(`#/prog/${pid}`);
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
  const task = s.assignmentId ? program.assignments?.[s.assignmentId] : null;
  const stillOpen = programStatus(program).open && (task ? taskStatus(task).open : !!program.freeLog);
  const canEdit = !teacher && stillOpen
    && sid === String(session.profile.sid) && isCurrentYear(session.profile, program.year || schoolYear(), schoolYear());
  setTitle(`${cat.icon} 제출 자료`, `#/prog/${s.programId}`, 3);

  main.innerHTML = `
    <div class="page">
      <div class="info-card">
        <div class="item-meta">${cat.icon} ${esc(cat.label)} · <a href="#/prog/${s.programId}">${esc(program.title)}</a> · ${esc(task ? task.title : "자유 기록")}</div>
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
