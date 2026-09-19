// 🎓 졸업생 (교사): 졸업연도를 고르면 반별 사진첩, 사진을 누르면 연락처
// 데이터: users/{uid} 중 graduated(졸업연도)가 있는 학생
//   - 포털 [🔅신학년 준비] 로 졸업한 학생 + [🎓 record 졸업생 가져오기] 로 옮긴 record 앱 old 시트 졸업생
// 졸업 후 정보 메모: js/person-notes.js (학생 정보 화면의 [ℹ️ 메모] 와 같은 칸 — 재학 중 메모가 이어짐)
import { isTeacher } from "./auth.js";
import { GRAD_PHOTO_BASE } from "./config.js";
import { $, $$, esc, emptyState, sidCompare, modal } from "./ui.js";
import { notesFaceHtml, cornerHtml, bindNotes, setCornerCount } from "./person-notes.js";
import { setTitle, go } from "./nav.js";
import { getGraduates, parseSid, hydratePhotos } from "./directory.js";

// 3학년 학번 = 졸업 전 학년도(졸업연도 - 1)에 쓴 학번
function toAlumnus(u) {
  const year = Number(u.graduated);
  const sids = Object.entries(u.sids || {});
  const sid = (sids.find(([, y]) => Number(y) === year - 1) || sids.find(([s]) => /^3/.test(s)) || sids[0] || [""])[0];
  const est = parseSid(sid);
  return {
    uid: u.uid, year, sid, name: u.name || "",
    cls: String(u.cls || est.cls || ""), no: String(u.no || est.no || ""),
    phone: String(u.phone || "").replace(/[^0-9]/g, ""),
    // 사진은 record 앱과 같은 규칙: images/old/{졸업연도}_{3학년 학번}.jpg
    photo: u.photo || (sid ? `${GRAD_PHOTO_BASE}${year}_${sid}.jpg` : "")
  };
}

export async function renderAlumni(main, params, alive) {
  if (!isTeacher()) { go("#/home"); return; }
  setTitle("🎓 졸업생");
  const all = (await getGraduates()).map(toAlumnus).filter(a => a.year);
  if (!alive()) return;

  const years = [...new Set(all.map(a => a.year))].sort((a, b) => b - a);
  const year = Number(params?.year) || years[0];
  if (!years.length) {
    main.innerHTML = `<div class="page">${emptyState("졸업생 자료가 없습니다.")}</div>`;
    return;
  }

  const list = all.filter(a => a.year === year)
    .sort((a, b) => sidCompare(a.cls, b.cls) || sidCompare(a.no, b.no) || sidCompare(a.sid, b.sid));
  const byCls = {};
  list.forEach(a => { (byCls[a.cls || "?"] ||= []).push(a); });

  main.innerHTML = `
    <div class="page">
      <div class="chip-row">
        ${years.map(y => `<button class="chip ${y === year ? "on" : ""}" data-year="${y}">${y}년 졸업</button>`).join("")}
      </div>
      <p class="page-desc">${year}년 졸업생 ${list.length}명 · 사진을 누르면 연락처가 보입니다.</p>
      ${Object.entries(byCls).sort(([a], [b]) => sidCompare(a, b)).map(([cls, arr]) => `
        <div class="section-head"><h3>3학년 ${esc(cls)}반 <small class="item-meta">${arr.length}명</small></h3></div>
        <div class="student-results">
          ${arr.map(a => `
            <button type="button" class="student-card" data-sid="${esc(a.sid)}">
              <span class="sc-photo" data-photo-url="${esc(a.photo)}"><span class="sc-none" aria-hidden="true">👤</span></span>
              <span class="sc-name">${esc(a.name)} <small>(${esc(a.sid)})</small></span>
            </button>`).join("")}
        </div>`).join("")}
    </div>`;
  hydratePhotos(main);

  $$("[data-year]", main).forEach(b => b.onclick = () => go(`#/alumni/${b.dataset.year}`));
  $$("[data-sid]", main).forEach(b => b.onclick = () => {
    const a = list.find(x => x.sid === b.dataset.sid);
    if (a) showContact(a);
  });
}

// 앞면 = 사진·연락처, 뒷면 = 졸업 후 정보 메모. 왼쪽 위 노란 모서리로 뒤집고, 이름(제목)은 그대로 둡니다.
function showContact(a) {
  modal({
    title: a.name,
    html: `
      <div class="flip" id="alFlip">
        <div class="flip-inner">
          <div class="flip-face flip-front">
            <div class="alumni-contact">
              <span class="sc-photo alumni-photo" data-photo-url="${esc(a.photo)}"><span class="sc-none" aria-hidden="true">👤</span></span>
              <div class="item-meta">${a.year}년 졸업 · 3학년 ${esc(a.cls)}반 ${esc(a.no)}번</div>
              ${a.phone ? `
                <div class="alumni-btns">
                  <a class="btn contact-call" href="tel:${a.phone}">📞 전화</a>
                  <a class="btn contact-sms" href="sms:${a.phone}">📩 문자</a>
                </div>` : `<p class="alumni-none">연락처가 없습니다.</p>`}
            </div>
          </div>
          <div class="flip-face flip-back notes-face">${notesFaceHtml("", "예: ○○대 ○○과 진학", true)}</div>
        </div>
      </div>`,
    okText: null,
    dismissible: true,          // 창 바깥을 누르면 닫힘
    closeX: true,               // 백업용 모서리 ✕ 버튼
    className: "alumni-modal",
    onOpen: box => {
      hydratePhotos(box);
      // 왼쪽 위 노란 모서리 (오른쪽 ✕ 와 같은 모양) — 메모 개수를 빨간 동그라미로. 누르면 뒤집기
      box.insertAdjacentHTML("afterbegin", cornerHtml(true));
      const flip = $("#alFlip", box), infoBtn = $(".modal-i", box);
      infoBtn.onclick = () => {
        flip.classList.toggle("on");
        infoBtn.classList.toggle("on", flip.classList.contains("on"));
      };
      // 모서리 숫자는 졸업 후 정보만. 재학 중 메모는 [재학 중] 탭에서 참고로
      if (a.uid) bindNotes($(".flip-back", box), a.uid, { kind: "after", graduated: a.year, onCount: n => setCornerCount(box, n) });
    }
  });
}
