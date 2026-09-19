// 🪧 공지
//   portal/notices/{nid} : { title, content, startDate, endDate("YYYY-MM-DD"), grades, createdBy, createdByUid, createdAt, updatedAt }
//   - grades: 대상 학년 { "1": true, "3": true } — 비어 있으면(null) 전 학년. 학생은 자기 학년 공지만 창에 뜸, 교사는 모두.
//   - programId·programTitle: [내 담당] 에서 고른 프로그램 — 있으면 학년 대신 그 프로그램 명단 학생에게만 뜸(명단이 바뀌면 따라감).
//   - 교사: 메뉴에서 모든 교사의 공지를 봄. 수정·삭제는 만든 교사만(관리자는 시트 [❌자료 삭제] 로 강제 삭제)
//   - 학생·교사 모두: 공지 기간 중이면 앱을 열 때 공지 창이 뜸 (여러 개면 한 창에, 남은 기간이 짧은 순)
import { db, readVal, newKey, serverTime } from "./firebase.js";
import { session, isTeacher } from "./auth.js";
import { $, $$, esc, richText, toast, modal, emptyState, dateKey, periodFieldHtml, bindPeriodField, schoolYear } from "./ui.js";
import { setTitle, go } from "./nav.js";
import { loadAllPrograms, isMember } from "./programs.js";
import { CATEGORIES } from "./config.js";

const WEEK = "일월화수목금토";
const toDate = key => { const [y, m, d] = String(key).split("-").map(Number); return new Date(y, m - 1, d); };
const md = key => { const d = toDate(key); return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`; };
const daysLeft = (key, today) => Math.round((toDate(key) - toDate(today)) / 86400000);
const isMine = n => n.createdByUid === session.profile?.uid;

export async function loadNotices() {
  const all = (await readVal("portal/notices")) || {};
  return Object.entries(all).map(([id, n]) => ({ ...n, id })).filter(n => n.title && n.startDate && n.endDate);
}

// 지금 공지 기간인지 / 예정 / 종료
export function noticeState(n, today = dateKey()) {
  if (today < n.startDate) return "soon";
  if (today > n.endDate) return "ended";
  return "active";
}
const byEndSoonest = (a, b) => a.endDate.localeCompare(b.endDate) || (a.createdAt || 0) - (b.createdAt || 0);

function dueText(n, today = dateKey()) {
  const left = daysLeft(n.endDate, today);
  return left <= 0 ? "오늘까지" : `D-${left}`;
}
function stateBadge(n) {
  const st = noticeState(n);
  if (st === "active") return `<span class="badge nt-on">진행 중 · ${dueText(n)}</span>`;
  if (st === "soon") return `<span class="badge nt-soon">예정</span>`;
  return `<span class="badge nt-off">종료</span>`;
}
const periodText = n => `${md(n.startDate)} ~ ${md(n.endDate)}`;

// 대상 학년: 비어 있거나 1·2·3 모두면 전 학년
const ALL_GRADES = ["1", "2", "3"];
const targetGrades = n => {
  const g = ALL_GRADES.filter(k => n.grades && n.grades[k]);
  return g.length && g.length < ALL_GRADES.length ? g : null;   // null = 전 학년
};
const forMe = n => isTeacher() || !!n.programId || !targetGrades(n) || targetGrades(n).includes(String(session.profile?.grade || ""));
// 학년 알약: 전 학년이면 all, 아니면 학년 숫자마다
const gradePills = n => {
  if (n.programId) return `<span class="grade-pills"><span class="grade-pill prog" title="${esc(n.programTitle || "")}">${esc(n.programTitle || "내 담당")}</span></span>`;
  const g = targetGrades(n);
  return `<span class="grade-pills">${g ? g.map(k => `<span class="grade-pill">${k}</span>`).join("") : `<span class="grade-pill all">all</span>`}</span>`;
};

function noticeCard(n, withActions = false) {
  const mine = isMine(n);
  return `
    <div class="item-card nt-card">
      <div class="item-top">${stateBadge(n)}${gradePills(n)}<span class="item-meta">${esc(periodText(n))} · 담당 ${esc(n.createdBy || "")}</span></div>
      <div class="item-title">${esc(n.title)}</div>
      ${n.content ? `<div class="nt-preview">${richText(n.content)}</div>` : ""}
      ${withActions ? `<div class="nt-actions">${mine
        ? `<button class="btn small ghost" data-edit="${esc(n.id)}">수정</button><button class="btn small ghost danger" data-del="${esc(n.id)}">삭제</button>`
        : `<span class="item-meta">🔒 ${esc(n.createdBy || "다른 선생님")}만 수정할 수 있습니다</span>`}</div>` : ""}
    </div>`;
}

// ---------------- 교사 화면 ----------------
// #/notice : 모든 공지 (진행 중 · 예정 · 지난 공지)   #/notice/manage : [+ 새 공지] · 내 공지 수정·삭제
export async function renderNotices(main, { mode } = {}, alive) {
  if (!isTeacher()) { go("#/home"); return; }
  const manage = mode === "manage";
  setTitle("공지", manage ? "#/notice" : "#/home");
  const list = await loadNotices();
  if (!alive()) return;
  const byId = Object.fromEntries(list.map(n => [n.id, n]));
  const today = dateKey();

  if (manage) {
    // 진행 중·예정 먼저(끝나는 날 순), 그다음 지난 공지(최근 것부터)
    const open = list.filter(n => noticeState(n, today) !== "ended").sort(byEndSoonest);
    const ended = list.filter(n => noticeState(n, today) === "ended").sort((a, b) => b.endDate.localeCompare(a.endDate));
    main.innerHTML = `
      <div class="page">
        <div class="result-head">
          <span>공지 <b>${list.length}</b>개 · 내 공지 <b>${list.filter(isMine).length}</b>개</span>
          <button class="btn small primary add-btn" id="btnNewNotice" aria-label="새 공지" title="새 공지"><svg class="plus-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v15M4.5 12h15"/></svg></button>
        </div>
        <div class="card-list">
          ${open.length || ended.length ? [...open, ...ended].map(n => noticeCard(n, true)).join("") : emptyState("공지가 없습니다.")}
        </div>
      </div>`;
    $("#btnNewNotice", main).onclick = async () => { if (await noticeDialog()) renderNotices(main, { mode }, alive); };
  } else {
    const active = list.filter(n => noticeState(n, today) === "active").sort(byEndSoonest);
    const soon = list.filter(n => noticeState(n, today) === "soon").sort((a, b) => a.startDate.localeCompare(b.startDate));
    const ended = list.filter(n => noticeState(n, today) === "ended").sort((a, b) => b.endDate.localeCompare(a.endDate));
    // 예정·지난 공지는 [완료/예정 공지 포함] 을 체크해야 보임 (기본: 진행 중만)
    const section = (title, arr, emptyText, extra = false) => `
      <div class="${extra ? "nt-extra" : ""}" ${extra ? "hidden" : ""}>
        <div class="section-head"><h3>${title} <small class="item-meta">${arr.length}</small></h3></div>
        <div class="card-list">${arr.length ? arr.map(n => noticeCard(n)).join("") : `<div class="empty nt-empty">${emptyText}</div>`}</div>
      </div>`;
    main.innerHTML = `
      <div class="page">
        <div class="cat-head">
          <label class="check-line"><input type="checkbox" id="ntShowAll">완료/예정 공지 포함</label>
          <a class="btn small ghost" href="#/notice/manage">⚙️ 관리</a>
        </div>
        ${section("진행 중", active, "지금 띄우는 공지가 없습니다.")}
        ${soon.length ? section("예정", soon, "", true) : ""}
        ${ended.length ? section("지난 공지", ended, "", true) : ""}
      </div>`;
    $("#ntShowAll", main).onchange = e => $$(".nt-extra", main).forEach(el => { el.hidden = !e.target.checked; });
  }

  // 카드를 눌러도 상세 창은 띄우지 않음(사용자 요청) — 내용은 카드에 전부 보임
  $$("[data-edit]", main).forEach(b => b.onclick = async () => { if (await noticeDialog(byId[b.dataset.edit])) renderNotices(main, { mode }, alive); });
  $$("[data-del]", main).forEach(b => b.onclick = async () => {
    const n = byId[b.dataset.del];
    const ok = await modal({ title: "공지 삭제", html: `<p><b>${esc(n.title)}</b><br>이 공지를 삭제할까요? 되돌릴 수 없습니다.</p>`, okText: "삭제", cancelText: "취소" });
    if (!ok) return;
    await db.ref(`portal/notices/${n.id}`).remove();
    toast("삭제되었습니다.");
    renderNotices(main, { mode }, alive);
  });
}

function noticeDialog(n = {}) {
  const today = dateKey();
  const week = new Date(); week.setDate(week.getDate() + 6);
  return modal({
    title: "",                    // 제목 줄 없이 (사용자 요청)
    wide: true,
    html: `
      <label class="field"><span>제목</span><input id="ntTitle" value="${esc(n.title || "")}" placeholder="예: 2학기 방과후 수강신청 안내"></label>
      <label class="field"><span>내용</span><textarea id="ntContent" rows="7" placeholder="자세한 내용 (주소를 적으면 링크가 됩니다)">${esc(n.content || "")}</textarea></label>
      <div class="nt-when">
        ${periodFieldHtml({ label: "공지 기간", startId: "ntStart", endId: "ntEnd", start: n.startDate || today, end: n.endDate || dateKey(week) })}
        <div class="field"><span>공지 대상</span>
          <div class="checks nt-grades">${ALL_GRADES.map(k => `<label><input type="checkbox" class="ntGrade" value="${k}" ${!targetGrades(n) || targetGrades(n).includes(k) ? "checked" : ""}> ${k}</label>`).join("")}
            <select id="ntProgram" class="nt-mine" aria-label="내 담당 프로그램"><option value="">내 담당</option></select>
          </div>
        </div>
      </div>`,
    okText: "저장",
    cancelText: "취소",
    onOpen: async box => {
      bindPeriodField(box, "ntStart", "ntEnd");
      // 내가 만든 올해 프로그램(빛나다·동아리·심화탐구·교과)을 드롭메뉴에
      const sel = $("#ntProgram", box);
      const year = schoolYear();
      const all = Object.values(await loadAllPrograms().catch(() => ({})));
      const mine = all.filter(p => p.createdByUid === session.profile.uid && CATEGORIES[p.category] && (Number(p.year) === year || p.id === n.programId));
      // 목록은 프로그램 이름만 (메뉴·교과군 경로 없이)
      sel.insertAdjacentHTML("beforeend", mine.sort((a, b) => String(a.title).localeCompare(String(b.title), "ko"))
        .map(p => `<option value="${esc(p.id)}" data-title="${esc(p.title)}">${esc(p.title)}</option>`).join(""));
      sel.value = n.programId || "";
      // 프로그램을 고르면 학년 체크는 흐리게(쓰지 않음)
      const sync = () => $$(".ntGrade", box).forEach(c => { c.disabled = !!sel.value; c.closest("label").classList.toggle("off", !!sel.value); });
      sel.onchange = sync;
      sync();
    },
    beforeOk: async box => {
      const title = $("#ntTitle", box).value.trim();
      const start = $("#ntStart", box).value, end = $("#ntEnd", box).value;
      if (!title) throw new Error("제목을 입력하세요.");
      if (!start || !end) throw new Error("공지 기간을 입력하세요.");
      if (start > end) throw new Error("종료일이 시작일보다 빠릅니다.");
      const sel = $("#ntProgram", box);
      const programId = sel.value || null;
      const picked = $$(".ntGrade", box).filter(c => c.checked).map(c => c.value);
      if (!programId && !picked.length) throw new Error("공지 학년을 하나 이상 고르거나 내 담당 프로그램을 고르세요.");
      // 1·2·3 모두면 전 학년(null). 프로그램을 골랐으면 학년은 쓰지 않음
      const grades = programId || picked.length === ALL_GRADES.length ? null : Object.fromEntries(picked.map(k => [k, true]));
      const programTitle = programId ? (sel.selectedOptions[0]?.dataset.title || "") : null;
      const data = { title, content: $("#ntContent", box).value.trim(), startDate: start, endDate: end, grades, programId, programTitle };
      if (n.id) {
        await db.ref(`portal/notices/${n.id}`).update({ ...data, updatedAt: serverTime });
      } else {
        await db.ref(`portal/notices/${newKey("portal/notices")}`).set({
          ...data, createdBy: session.profile.name, createdByUid: session.profile.uid, createdAt: serverTime
        });
      }
      toast("저장되었습니다.");
    }
  });
}

// ---------------- 앱을 열 때 뜨는 공지 창 ----------------
// 공지 기간이 겹치는 공지를 모두 한 창에, 남은 기간이 짧은 것부터. 창 바깥을 누르면 닫힙니다.
// [오늘은 다시 뜨지 않기] (학생·교사 모두) — 이 기기에 오늘 날짜와 그때 본 공지를 적어 둡니다.
// 그날 새 공지가 올라오면 다시 뜹니다(본 공지만 숨김).
let popupShown = false;
const hideKey = () => `noticeHide:${session.profile?.uid}`;
function hiddenToday(today) {
  try {
    const v = JSON.parse(localStorage.getItem(hideKey()) || "null");
    return v && v.date === today ? new Set(v.ids || []) : new Set();
  } catch { return new Set(); }
}

export async function showActiveNotices() {
  if (popupShown) return;
  popupShown = true;
  const today = dateKey();
  let list = (await loadNotices()).filter(n => noticeState(n, today) === "active" && forMe(n));
  // 학생: [내 담당] 프로그램 공지는 그 프로그램 명단에 있을 때만
  if (!isTeacher()) {
    const pids = [...new Set(list.filter(n => n.programId).map(n => n.programId))];
    const progs = Object.fromEntries(await Promise.all(pids.map(async id => [id, await readVal(`portal/programs/${id}`).catch(() => null)])));
    list = list.filter(n => !n.programId || (progs[n.programId] && isMember(progs[n.programId], session.profile)));
  }
  list.sort(byEndSoonest);
  if (!list.length) return;
  {
    const hidden = hiddenToday(today);
    if (list.every(n => hidden.has(n.id))) return;
  }
  let hideToday = false;
  await modal({
    title: `🪧 공지${list.length > 1 ? ` ${list.length}건` : ""}`,
    html: `<div class="nt-pop-list">` + list.map(n => `
      <div class="nt-pop">
        <div class="nt-pop-head"><b>${esc(n.title)}</b><span class="nt-pop-tags">${gradePills(n)}<span class="nt-due">${dueText(n, today)}</span></span></div>
        <div class="item-meta">${esc(md(n.endDate))}까지 · 담당 ${esc(n.createdBy || "")}</div>
        ${n.content ? `<button class="nt-more" data-more>자세히보기 ▾</button><div class="nt-content" hidden>${richText(n.content)}</div>` : ""}
      </div>`).join("") + `</div>` +
      `<label class="check-line nt-hide"><input type="checkbox" id="ntHideToday"> 오늘은 다시 뜨지 않기</label>`,
    okText: null,
    closeX: true,                 // 졸업생 창과 같은 모서리 ✕ (바깥을 눌러도 닫힘)
    className: "notice-pop-modal",
    onOpen: box => {
      $$("[data-more]", box).forEach(b => b.onclick = () => {
        const body = b.nextElementSibling;
        body.hidden = !body.hidden;
        b.textContent = body.hidden ? "자세히보기 ▾" : "접기 ▴";
      });
      const chk = $("#ntHideToday", box);
      if (chk) chk.onchange = () => { hideToday = chk.checked; };
    }
  });
  // 닫기 버튼이든 바깥 클릭이든, 체크해 두었으면 기억
  if (hideToday) {
    try { localStorage.setItem(hideKey(), JSON.stringify({ date: today, ids: list.map(n => n.id) })); } catch { /* 저장 불가(사생활 보호 모드 등) */ }
  }
}
