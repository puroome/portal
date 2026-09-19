// 공통 UI 헬퍼: 모달, 토스트, 화면 전환, 문자열 처리
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 여러 줄 텍스트를 안전하게 표시 (URL 자동 링크)
export function richText(v) {
  return esc(v)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, "<br>");
}

export function toast(msg) {
  const box = $("#toast");
  box.textContent = msg;
  box.classList.add("show");
  clearTimeout(box._t);
  box._t = setTimeout(() => box.classList.remove("show"), 2200);
}

// ---- 열린 팝업 목록: 뒤 화면 멈추기 · 뒤로가기로 닫기 ----
//  팝업이 열리면 브라우저 기록에 한 칸을 넣어 두고, 뒤로가기(폰 뒤로 버튼 포함)가 오면 맨 위 팝업을 닫습니다.
//  버튼·바깥 클릭으로 닫을 때는 그 칸을 되돌린 "뒤에" 결과를 알려 줍니다
//  — 닫자마자 다른 화면으로 이동하는 경우(저장 후 이동 등) 되돌리기가 이동을 취소하지 않도록.
const openModals = [];
window.addEventListener("popstate", () => {
  if (pendingBack) return;   // 팝업을 닫으며 우리가 되돌린 기록 — 사용자의 뒤로가기가 아님
  const top = openModals[openModals.length - 1];
  if (top && !top.leaving) top.onBack();
});
let pendingBack = null;   // 닫힌 팝업의 기록 되돌리기가 끝나기 전에는 새 팝업이 기록을 넣지 않음
const lockPage = () => document.documentElement.classList.toggle("modal-open", openModals.length > 0);

// 모달: 확인 → true, 취소/닫기 → false
// dismissible: 창 바깥을 누르면 닫힘 (취소 버튼이 있으면 원래 바깥 클릭으로 닫힘). 버튼이 하나도 없으면 버튼 줄을 그리지 않습니다.
// closeX: 오른쪽 위 모서리에 닫기(✕) 버튼 — 창 모서리 곡률에 맞춘 모양
export function modal({ title = "알림", html = "", okText = "확인", cancelText = null, wide = false, onOpen = null, beforeOk = null, dismissible = false, className = "", closeX = false }) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay show";
    overlay.innerHTML = `
      <div class="modal-box ${wide ? "wide" : ""} ${className}">
        ${closeX ? `<button class="modal-x" data-act="cancel" aria-label="닫기">✕</button>` : ""}
        ${title ? `<div class="modal-title">${esc(title)}</div>` : ""}
        <div class="modal-body">${html}</div>
        ${okText || cancelText ? `<div class="modal-btns">
          ${cancelText ? `<button class="btn ghost" data-act="cancel">${esc(cancelText)}</button>` : ""}
          ${okText ? `<button class="btn primary" data-act="ok">${esc(okText)}</button>` : ""}
        </div>` : ""}
      </div>`;
    document.body.appendChild(overlay);
    const box = overlay.querySelector(".modal-box");
    const canDismiss = !!(cancelText || dismissible || closeX);

    const entry = { leaving: false };
    openModals.push(entry);
    lockPage();
    let pushed = false;
    const push = () => {
      if (done) return;
      try { history.pushState({ ...(history.state || {}), modal: true }, ""); pushed = true; } catch { /* 기록을 못 쓰는 환경 */ }
    };

    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      overlay.remove();
      openModals.splice(openModals.indexOf(entry), 1);
      lockPage();
      resolve(result);
    };
    // 뒤로가기: 닫을 수 있는 창이면 닫고, 꼭 거쳐야 하는 창(첫 로그인 비밀번호 변경 등)이면 그대로 둡니다
    entry.onBack = () => {
      if (canDismiss) { pushed = false; finish(false); }
      else { try { history.pushState({ ...(history.state || {}), modal: true }, ""); } catch { /* 무시 */ } }
    };
    const close = result => {
      if (done || entry.leaving) return;
      if (!pushed) { finish(result); return; }
      entry.leaving = true;
      overlay.style.display = "none";          // 화면에서는 바로 사라짐
      pendingBack = new Promise(res => {
        const timer = setTimeout(res, 500);
        window.addEventListener("popstate", () => { clearTimeout(timer); res(); }, { once: true });
      }).then(() => { pendingBack = null; finish(result); });
      history.back();                          // 넣어 둔 기록 한 칸 되돌리기
    };
    // 기록 넣기는 finish 정의 뒤에 (앞 팝업의 되돌리기가 진행 중이면 끝난 뒤에)
    if (pendingBack) pendingBack.then(push); else push();
    overlay.addEventListener("click", async e => {
      if (e.target === overlay && canDismiss) return close(false);
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "cancel") close(false);
      if (act === "ok") {
        if (beforeOk) {
          const btn = e.target.closest("button");
          btn.disabled = true;
          try {
            const ok = await beforeOk(box);
            if (ok === false) { btn.disabled = false; return; }
          } catch (err) {
            btn.disabled = false;
            toast(err.message || String(err));
            return;
          }
        }
        close(true);
      }
    });
    if (onOpen) onOpen(box, close);
  });
}

export const alertBox = (title, msg) => modal({ title, html: `<p>${msg}</p>` });
export const confirmBox = (title, msg, okText = "확인") => modal({ title, html: `<p>${msg}</p>`, okText, cancelText: "취소" });

export function loading(on, text = "처리 중...") {
  const el = $("#loadingOverlay");
  $("#loadingText").textContent = text;
  el.classList.toggle("show", !!on);
}

export function emptyState(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

// ---------- 날짜 ----------
const pad = n => String(n).padStart(2, "0");
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function fmtDateTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  const w = "일월화수목금토"[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${w})`;
}
export function schoolYear(d = new Date()) {
  return d.getMonth() + 1 <= 2 ? d.getFullYear() - 1 : d.getFullYear();
}

// 학번 정렬용
export function sidCompare(a, b) {
  return String(a).localeCompare(String(b), "ko", { numeric: true });
}

export function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- 기간 한 칸: "9/19(토) ~ 9/25(금)" ----------
// 연도는 보여 주지 않고, 글자 위에 투명한 날짜 선택기를 겹쳐 누르면 달력이 뜹니다(저장은 연도까지).
// 공지 기간 · 프로그램 제출 기간에서 함께 씁니다. clearable 이면 ✕ 로 비울 수 있음(비우면 상시).
export function periodFieldHtml({ label, startId, endId, start = "", end = "", startPh = "시작일", endPh = "종료일", clearable = false }) {
  return `
    <div class="field period-field"><span>${esc(label)}</span>
      <div class="nt-period">
        <label class="nt-date"><b data-ph="${esc(startPh)}"></b><input id="${startId}" type="date" value="${esc(start)}" aria-label="${esc(label)} 시작"></label>
        <span class="nt-tilde">~</span>
        <label class="nt-date"><b data-ph="${esc(endPh)}"></b><input id="${endId}" type="date" value="${esc(end)}" aria-label="${esc(label)} 끝"></label>
        ${clearable ? `<button type="button" class="period-clear" aria-label="기간 지우기" title="기간 지우기">✕</button>` : ""}
      </div>
    </div>`;
}

export function bindPeriodField(box, startId, endId) {
  const start = box.querySelector(`#${startId}`), end = box.querySelector(`#${endId}`);
  const field = start.closest(".nt-period");
  const clear = field.querySelector(".period-clear");
  const show = () => {
    [start, end].forEach(inp => {
      const b = inp.previousElementSibling;
      b.textContent = inp.value ? fmtDateKey(inp.value) : b.dataset.ph;
      b.classList.toggle("ph", !inp.value);
    });
    if (clear) clear.hidden = !start.value && !end.value;
  };
  start.addEventListener("change", () => { if (start.value && end.value && end.value < start.value) end.value = start.value; show(); });
  end.addEventListener("change", show);
  // PC 에서는 투명 날짜 칸을 눌러도 달력이 안 뜰 수 있어 직접 엽니다
  [start, end].forEach(inp => inp.addEventListener("click", () => { try { inp.showPicker(); } catch { /* 지원 안 함: 기본 동작 */ } }));
  if (clear) clear.onclick = () => { start.value = ""; end.value = ""; show(); };
  show();
}
