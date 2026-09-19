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
        <div class="modal-title">${esc(title)}</div>
        <div class="modal-body">${html}</div>
        ${okText || cancelText ? `<div class="modal-btns">
          ${cancelText ? `<button class="btn ghost" data-act="cancel">${esc(cancelText)}</button>` : ""}
          ${okText ? `<button class="btn primary" data-act="ok">${esc(okText)}</button>` : ""}
        </div>` : ""}
      </div>`;
    document.body.appendChild(overlay);
    const box = overlay.querySelector(".modal-box");
    const close = result => { overlay.remove(); resolve(result); };
    overlay.addEventListener("click", async e => {
      if (e.target === overlay && (cancelText || dismissible || closeX)) return close(false);
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
