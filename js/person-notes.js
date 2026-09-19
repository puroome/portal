// 교사 메모 (학생 정보 화면 [ℹ️ 메모] · 졸업생 카드 뒷면 공용)
//   portal/alumniNotes/{학생 uid}/{nid} = { text, kind, createdBy, createdByUid, createdAt, updatedAt }
//   - kind: "school"(재학 중 — 학생 정보 화면에서 씀) · "after"(졸업 후 — 졸업 카드에서 씀)
//     꼬리표가 없는 예전 메모는 날짜로: 졸업연도 3월 1일 이전 = 재학 중
//   - 사람(uid)에 붙으므로 재학 중 메모를 졸업 카드 뒷면 [재학 중] 탭에서 참고로 볼 수 있습니다.
//   - 교사끼리 모두 보고, 수정·삭제는 쓴 교사만. 작성자 이름은 저장하지만 화면에는 보이지 않음(사용자 요청)
//   (경로 이름 alumniNotes 는 졸업생 메모로 먼저 만들어져서 그대로 둡니다)
import { db, readVal, newKey, serverTime } from "./firebase.js";
import { session } from "./auth.js";
import { $, $$, esc, modal, toast } from "./ui.js";

const pad2 = n => String(n).padStart(2, "0");
const ymd = ts => { const d = new Date(ts); return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`; };
const pathOf = uid => `portal/alumniNotes/${uid}`;

// graduated = 졸업연도(없으면 재학생)
export function noteKind(n, graduated) {
  if (n.kind === "school" || n.kind === "after") return n.kind;
  if (!graduated) return "school";
  return (n.createdAt || 0) >= new Date(Number(graduated), 2, 1).getTime() ? "after" : "school";
}

async function loadNotes(uid, graduated) {
  const v = (await readVal(pathOf(uid))) || {};
  return Object.entries(v).map(([id, n]) => ({ ...n, id })).filter(n => n.text)
    .map(n => ({ ...n, kind: noteKind(n, graduated) }))
    .sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
}

export async function countNotes(uid, kind = "school", graduated = null) {
  return uid ? (await loadNotes(uid, graduated)).filter(n => n.kind === kind).length : 0;
}

// 메모 면(제목줄 · 목록 · 입력칸 · 버튼). 부모가 높이를 정하면 목록만 스크롤됩니다.
// head 대신 tabs: true 면 [졸업 후 | 재학 중] 탭 (졸업 카드 뒷면)
export function notesFaceHtml(head, placeholder = "예: ○○대 ○○과 진학", tabs = false) {
  return `
    ${tabs
      ? `<div class="al-tabs"><button class="al-tab on" data-tab="after">졸업 후 <b>0</b></button><button class="al-tab" data-tab="school">재학 중 <b>0</b></button></div>`
      : head ? `<div class="al-notes-head">${esc(head)}</div>` : ""}
    <div class="al-notes"><div class="item-meta">불러오는 중…</div></div>
    <textarea class="al-note-input" rows="2" maxlength="500" placeholder="${esc(placeholder)}"></textarea>
    <button class="btn small primary block al-note-add">메모 남기기</button>`;
}

// 창 왼쪽 위 노란 모서리 + 메모 개수(빨간 동그라미). onClick 을 주면 버튼(졸업생 카드 뒤집기)
export function cornerHtml(clickable) {
  return clickable
    ? `<button class="modal-i" aria-label="메모"><span class="modal-i-count" hidden></span></button>`
    : `<span class="modal-i"><span class="modal-i-count" hidden></span></span>`;
}

// face = notesFaceHtml 을 넣은 요소. 메모를 불러와 그리고 쓰기·수정·삭제를 연결합니다.
//   kind: 이 면에서 새로 쓰는 메모의 꼬리표("school"|"after"). 탭이 있으면 [재학 중] 탭은 보기만(새 메모는 졸업 후 탭에서)
//   onCount(n): kind 에 해당하는 메모 개수 (졸업 카드 모서리 숫자 = 졸업 후 정보만)
export function bindNotes(face, uid, { kind = "school", graduated = null, onCount } = {}) {
  let notes = [];
  let tab = kind;
  const list = $(".al-notes", face);
  const hasTabs = !!$(".al-tabs", face);
  $$("[data-tab]", face).forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
  const draw = () => {
    onCount?.(notes.filter(n => n.kind === kind).length);
    if (hasTabs) {
      $$("[data-tab]", face).forEach(b => {
        b.classList.toggle("on", b.dataset.tab === tab);
        $("b", b).textContent = notes.filter(n => n.kind === b.dataset.tab).length;
      });
      const writable = tab === kind;
      $(".al-note-input", face).hidden = !writable;
      $(".al-note-add", face).hidden = !writable;
    }
    const shown = notes.filter(n => n.kind === tab);
    list.innerHTML = shown.length ? shown.map(n => `
      <div class="al-note ${n.kind === "school" && kind === "after" ? "old" : ""}" data-nid="${esc(n.id)}">
        <div class="al-note-text">${esc(n.text)}</div>
        <div class="al-note-foot">
          <span>${ymd(n.createdAt || Date.now())} 기록${n.updatedAt ? ` · ${ymd(n.updatedAt)} 수정` : ""}</span>
          ${n.createdByUid === session.profile?.uid ? `<span><button class="al-mini" data-edit>수정</button><button class="al-mini danger" data-del>삭제</button></span>` : ""}
        </div>
      </div>`).join("") : `<div class="al-empty">${tab === "school" && kind === "after"
        ? "재학 중에 남긴 메모가 없습니다."
        : "아직 기록이 없습니다.<br>알게 된 소식이나 기억할 내용을 남겨 주세요."}</div>`;

    $$("[data-edit]", list).forEach(b => b.onclick = () => {
      const el = b.closest(".al-note"), n = notes.find(x => x.id === el.dataset.nid);
      el.innerHTML = `<textarea rows="3" maxlength="500">${esc(n.text)}</textarea>
        <div class="al-note-foot"><span></span><span><button class="al-mini" data-cancel>취소</button><button class="al-mini primary" data-save>저장</button></span></div>`;
      $("[data-cancel]", el).onclick = draw;
      $("[data-save]", el).onclick = async () => {
        const text = $("textarea", el).value.trim();
        if (!text) { toast("내용을 입력하세요."); return; }
        await db.ref(`${pathOf(uid)}/${n.id}`).update({ text, updatedAt: serverTime });
        await load();
      };
    });
    $$("[data-del]", list).forEach(b => b.onclick = async () => {
      const n = notes.find(x => x.id === b.closest(".al-note").dataset.nid);
      const ok = await modal({ title: "메모 삭제", html: `<p>이 메모를 삭제할까요?</p>`, okText: "삭제", cancelText: "취소" });
      if (!ok) return;
      await db.ref(`${pathOf(uid)}/${n.id}`).remove();
      await load();
    });
  };
  const load = async () => {
    notes = await loadNotes(uid, graduated);
    if (face.isConnected) draw();
  };

  $(".al-note-add", face).onclick = async () => {
    const ta = $(".al-note-input", face), text = ta.value.trim();
    if (!text) { toast("내용을 입력하세요."); ta.focus(); return; }
    const btn = $(".al-note-add", face);
    btn.disabled = true;
    try {
      await db.ref(`${pathOf(uid)}/${newKey(pathOf(uid))}`).set({
        text, kind, createdBy: session.profile.name, createdByUid: session.profile.uid, createdAt: serverTime
      });
      ta.value = "";
      tab = kind;
      await load();
    } catch (err) { toast(err.message || String(err)); }
    finally { btn.disabled = false; }
  };
  load().catch(() => { list.innerHTML = `<div class="al-empty">메모를 불러오지 못했습니다.</div>`; });
  return load;
}

// 모서리의 개수 배지 갱신
export function setCornerCount(box, n) {
  const cnt = $(".modal-i-count", box);
  if (!cnt) return;
  cnt.hidden = !n;
  cnt.textContent = n;
}

// 학생 정보 화면의 [ℹ️ 메모] 창 — 졸업생 카드 뒷면과 같은 모양·크기
export function openNotesDialog({ uid, name }, onChange) {
  return modal({
    title: name,
    html: `<div class="notes-face memo-face">${notesFaceHtml("", "예: 진로 상담 내용, 특이사항")}</div>`,
    okText: null,
    dismissible: true,
    closeX: true,
    className: "alumni-modal memo-modal",
    onOpen: box => {
      box.insertAdjacentHTML("afterbegin", cornerHtml(false));
      bindNotes($(".memo-face", box), uid, { kind: "school", onCount: n => { setCornerCount(box, n); onChange?.(n); } });
    }
  });
}
