// 🪧 공지
//   portal/notices/{nid} : { title, content, startDate, endDate("YYYY-MM-DD"), createdBy, createdByUid, createdAt, updatedAt }
//   - 교사: 메뉴에서 모든 교사의 공지를 봄. 수정·삭제는 만든 교사만(관리자는 시트 [❌자료 삭제] 로 강제 삭제)
//   - 학생·교사 모두: 공지 기간 중이면 앱을 열 때 공지 창이 뜸 (여러 개면 한 창에, 남은 기간이 짧은 순)
import { db, readVal, newKey, serverTime } from "./firebase.js";
import { session, isTeacher } from "./auth.js";
import { $, $$, esc, richText, toast, modal, emptyState, dateKey } from "./ui.js";
import { setTitle, go } from "./nav.js";

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

function noticeCard(n, withActions = false) {
  const mine = isMine(n);
  return `
    <div class="item-card nt-card" data-open="${esc(n.id)}">
      <div class="item-top">${stateBadge(n)}<span class="item-meta">${esc(periodText(n))} · 담당 ${esc(n.createdBy || "")}</span></div>
      <div class="item-title">${esc(n.title)}</div>
      ${n.content ? `<div class="nt-preview">${esc(n.content)}</div>` : ""}
      ${withActions ? `<div class="nt-actions">${mine
        ? `<button class="btn small ghost" data-edit="${esc(n.id)}">수정</button><button class="btn small ghost danger" data-del="${esc(n.id)}">삭제</button>`
        : `<span class="item-meta">🔒 ${esc(n.createdBy || "다른 선생님")}만 수정할 수 있습니다</span>`}</div>` : ""}
    </div>`;
}

function showDetail(n) {
  modal({
    title: n.title,
    html: `
      <div class="item-meta nt-detail-meta">${stateBadge(n)} ${esc(periodText(n))} · 담당 ${esc(n.createdBy || "")}</div>
      <div class="nt-content">${n.content ? richText(n.content) : `<span class="item-meta">내용이 없습니다.</span>`}</div>`,
    okText: null,
    cancelText: "닫기",
    className: "notice-modal"
  });
}

// ---------------- 교사 화면 ----------------
// #/notice : 모든 공지 (진행 중 · 예정 · 지난 공지)   #/notice/manage : [+ 새 공지] · 내 공지 수정·삭제
export async function renderNotices(main, { mode } = {}, alive) {
  if (!isTeacher()) { go("#/home"); return; }
  const manage = mode === "manage";
  setTitle(manage ? "🪧 공지 · 공지 관리" : "🪧 공지", manage ? "#/notice" : "#/home");
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
          <button class="btn small primary" id="btnNewNotice">+ 새 공지</button>
        </div>
        <div class="card-list">
          ${open.length || ended.length ? [...open, ...ended].map(n => noticeCard(n, true)).join("") : emptyState("공지가 없습니다. [+ 새 공지]로 만들어 주세요.")}
        </div>
      </div>`;
    $("#btnNewNotice", main).onclick = async () => { if (await noticeDialog()) renderNotices(main, { mode }, alive); };
  } else {
    const active = list.filter(n => noticeState(n, today) === "active").sort(byEndSoonest);
    const soon = list.filter(n => noticeState(n, today) === "soon").sort((a, b) => a.startDate.localeCompare(b.startDate));
    const ended = list.filter(n => noticeState(n, today) === "ended").sort((a, b) => b.endDate.localeCompare(a.endDate));
    const section = (title, arr, emptyText) => `
      <div class="section-head"><h3>${title} <small class="item-meta">${arr.length}</small></h3></div>
      <div class="card-list">${arr.length ? arr.map(n => noticeCard(n)).join("") : `<div class="empty nt-empty">${emptyText}</div>`}</div>`;
    main.innerHTML = `
      <div class="page">
        <div class="cat-head">
          <h3>공지</h3>
          <a class="btn small ghost" href="#/notice/manage">⚙️ 공지 관리</a>
        </div>
        <p class="page-desc">공지 기간 중인 공지는 학생·교사가 앱을 열 때 창으로 뜹니다.</p>
        ${section("진행 중", active, "지금 띄우는 공지가 없습니다.")}
        ${soon.length ? section("예정", soon, "") : ""}
        ${ended.length ? section("지난 공지", ended, "") : ""}
      </div>`;
  }

  $$("[data-open]", main).forEach(el => el.onclick = e => {
    if (e.target.closest("button")) return;
    showDetail(byId[el.dataset.open]);
  });
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
    title: n.id ? "공지 수정" : "새 공지",
    wide: true,
    html: `
      <label class="field"><span>제목</span><input id="ntTitle" value="${esc(n.title || "")}" placeholder="예: 2학기 방과후 수강신청 안내"></label>
      <label class="field"><span>내용</span><textarea id="ntContent" rows="7" placeholder="자세한 내용 (주소를 적으면 링크가 됩니다)">${esc(n.content || "")}</textarea></label>
      <div class="field-row">
        <label class="field"><span>공지 시작일</span><input id="ntStart" type="date" value="${esc(n.startDate || today)}"></label>
        <label class="field"><span>공지 종료일</span><input id="ntEnd" type="date" value="${esc(n.endDate || dateKey(week))}"></label>
      </div>
      <p class="item-meta">이 기간에는 학생·교사가 앱을 열 때마다 공지 창에 제목·기한·담당 교사가 뜨고, [자세히보기]로 내용을 봅니다.</p>`,
    okText: "저장",
    cancelText: "취소",
    beforeOk: async box => {
      const title = $("#ntTitle", box).value.trim();
      const start = $("#ntStart", box).value, end = $("#ntEnd", box).value;
      if (!title) throw new Error("제목을 입력하세요.");
      if (!start || !end) throw new Error("공지 기간을 입력하세요.");
      if (start > end) throw new Error("종료일이 시작일보다 빠릅니다.");
      const data = { title, content: $("#ntContent", box).value.trim(), startDate: start, endDate: end };
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
// 교사만 [오늘은 다시 뜨지 않기] — 이 기기에 오늘 날짜와 그때 본 공지를 적어 둡니다.
// 그날 새 공지가 올라오면 다시 뜹니다(본 공지만 숨김). 학생은 항상 뜹니다.
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
  const teacher = isTeacher();
  const list = (await loadNotices()).filter(n => noticeState(n, today) === "active").sort(byEndSoonest);
  if (!list.length) return;
  if (teacher) {
    const hidden = hiddenToday(today);
    if (list.every(n => hidden.has(n.id))) return;
  }
  let hideToday = false;
  await modal({
    title: `🪧 공지${list.length > 1 ? ` ${list.length}건` : ""}`,
    html: `<div class="nt-pop-list">` + list.map(n => `
      <div class="nt-pop">
        <div class="nt-pop-head"><b>${esc(n.title)}</b><span class="nt-due">${dueText(n, today)}</span></div>
        <div class="item-meta">${esc(md(n.endDate))}까지 · 담당 ${esc(n.createdBy || "")}</div>
        ${n.content ? `<button class="nt-more" data-more>자세히보기 ▾</button><div class="nt-content" hidden>${richText(n.content)}</div>` : ""}
      </div>`).join("") + `</div>` +
      (teacher ? `<label class="check-line nt-hide"><input type="checkbox" id="ntHideToday"> 오늘은 다시 뜨지 않기</label>` : ""),
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
  if (teacher && hideToday) {
    try { localStorage.setItem(hideKey(), JSON.stringify({ date: today, ids: list.map(n => n.id) })); } catch { /* 저장 불가(사생활 보호 모드 등) */ }
  }
}
