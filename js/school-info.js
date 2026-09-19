// 🍴 급식 · 📅 행사 (교사·학생 모두, 보기 전용) — 데이터는 나이스(NEIS), js/neis.js 참고
import { ALLERGY, forGrade, groupRanges, upcoming, ymdToDate, dateToYmd } from "./neis-parse.js";
import { fetchMealsMonth, fetchSchedule, prefetchMeals } from "./neis.js";
import { $, $$, esc, toast } from "./ui.js";
import { setTitle, onLeave } from "./nav.js";

const WEEK = "일월화수목금토";
const md = ymd => { const d = ymdToDate(ymd); return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`; };
const todayYmd = () => dateToYmd(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;
// 주말은 급식이 없으므로 앞뒤로 움직일 때 건너뜁니다.
const nextWeekday = (d, step) => { let x = addDays(d, step); while (isWeekend(x)) x = addDays(x, step); return x; };
const monthOf = ymd => ymd.slice(0, 6);
const shiftMonth = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(4, 6)) - 1 + n, 1); return dateToYmd(d).slice(0, 6); };
const ayOf = ym => Number(ym.slice(4, 6)) <= 2 ? Number(ym.slice(0, 4)) - 1 : Number(ym.slice(0, 4));

function skeleton(lines = 6) {
  return `<div class="info-card skel-card">${Array.from({ length: lines }, (_, i) => `<div class="skel" style="width:${55 + (i * 17) % 40}%"></div>`).join("")}</div>`;
}
function inlineError(msg) {
  return `<div class="inline-error"><span>${esc(msg || "일시적 오류로 불러오지 못했습니다.")}</span><button class="btn small ghost" data-retry>다시 시도</button></div>`;
}

// 좌우로 밀어 넘기기 (세로 스크롤과 구분: 가로로 60px 이상, 세로 흔들림 40px 이하)
function onSwipe(el, fn) {
  let x0 = null, y0 = null;
  el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener("touchend", e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 40) fn(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ======================= 🍴 급식 =======================
// 식사 탭은 기억하지 않고 날짜마다 늘 중식부터 (사용자 요청)

export async function renderMeal(main, params) {
  setTitle("🍴 급식");
  const today = todayYmd();
  let cur = params?.date && /^\d{8}$/.test(params.date) ? params.date : today;
  let seq = 0;
  let mealType = "2";

  main.innerHTML = `
    <div class="page">
      <div class="date-nav">
        <button class="icon-btn" data-step="-1" aria-label="이전 날"><svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z"/></svg></button>
        <div class="date-label"><b id="mealDate"></b><button class="chip" id="mealToday">오늘</button></div>
        <button class="icon-btn" data-step="1" aria-label="다음 날"><svg viewBox="0 0 24 24"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg></button>
      </div>
      <div id="mealBox"></div>
    </div>`;
  const box = $("#mealBox", main);

  const move = step => { cur = dateToYmd(nextWeekday(ymdToDate(cur), step)); mealType = "2"; draw(); };
  $$("[data-step]", main).forEach(b => b.onclick = () => move(Number(b.dataset.step)));
  $("#mealToday", main).onclick = () => { cur = today; mealType = "2"; draw(); };
  onSwipe(main.querySelector(".page"), move);
  const onKey = e => { if (e.key === "ArrowLeft") move(-1); if (e.key === "ArrowRight") move(1); };
  document.addEventListener("keydown", onKey);
  onLeave(() => document.removeEventListener("keydown", onKey));

  async function draw(force = false) {
    const my = ++seq;
    const d = ymdToDate(cur);
    $("#mealDate", main).textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
    $("#mealToday", main).hidden = cur === today;
    box.innerHTML = skeleton();
    let meals;
    try {
      meals = (await fetchMealsMonth(monthOf(cur), force)).filter(m => m.date === cur);
    } catch (err) {
      if (my !== seq) return;
      box.innerHTML = inlineError(err.message);
      $("[data-retry]", box).onclick = () => draw(true);
      return;
    }
    if (my !== seq) return;
    prefetchMeals(shiftMonth(monthOf(cur), -1), shiftMonth(monthOf(cur), 1));

    if (!meals.length) {
      const nx = dateToYmd(nextWeekday(d, 1));
      box.innerHTML = `
        <div class="info-card meal-empty">
          <div class="meal-empty-icon">🍽️</div>
          <p>${cur === today ? "오늘은" : "이 날은"} 급식이 없습니다.</p>
          <button class="btn small ghost" id="mealNext">${esc(md(nx))} 급식 보기 ›</button>
        </div>`;
      $("#mealNext", box).onclick = () => { cur = nx; mealType = "2"; draw(); };
      return;
    }
    meals.sort((a, b) => a.typeCode.localeCompare(b.typeCode));
    const pick = meals.find(m => m.typeCode === mealType) || meals.find(m => m.typeCode === "2") || meals[0];
    box.innerHTML = `
      ${meals.length > 1 ? `<div class="tabs">${meals.map(m => `<button class="tab-btn ${m === pick ? "active" : ""}" data-type="${esc(m.typeCode)}">${esc(m.type)}</button>`).join("")}</div>` : ""}
      <div class="info-card meal-card">
        ${meals.length === 1 ? `<div class="meal-type">${esc(pick.type)}</div>` : ""}
        <ul class="meal-list">
          ${pick.dishes.map(x => `
            <li><span class="dish">${esc(x.name)}</span>
              <span class="allergies">${x.allergies.map(n => `<button class="allergy" data-al="${n}" title="${n} ${esc(ALLERGY[n] || "")}">${n}</button>`).join("")}</span>
            </li>`).join("")}
        </ul>
        ${pick.kcal ? `<div class="meal-kcal">🔥 ${esc(pick.kcal)}</div>` : ""}
        ${pick.nutrients.length ? `<details class="meal-more"><summary>영양 정보</summary><ul>${pick.nutrients.map(v => `<li>${esc(v)}</li>`).join("")}</ul></details>` : ""}
        ${pick.origins.length ? `<details class="meal-more"><summary>원산지</summary><ul>${pick.origins.map(v => `<li>${esc(v)}</li>`).join("")}</ul></details>` : ""}
        <details class="meal-more"><summary>알레르기 번호 안내</summary>
          <div class="allergy-legend">${Object.entries(ALLERGY).map(([n, v]) => `<span><b>${n}</b> ${esc(v)}</span>`).join("")}</div>
        </details>
      </div>`;
    $$("[data-type]", box).forEach(b => b.onclick = () => { mealType = b.dataset.type; draw(); });
    $$("[data-al]", box).forEach(b => b.onclick = () => toast(`${b.dataset.al} ${ALLERGY[b.dataset.al] || ""}`));
  }
  draw();
}

// ======================= 📅 행사 (학사일정) =======================
// 학년 구분 없이 늘 전체 (특정 학년 행사는 목록에 "○학년" 배지가 붙음)
const gradeFilter = "";

export async function renderEvents(main, params) {
  setTitle("📅 행사");
  const today = todayYmd();
  let ym = params?.ym && /^\d{6}$/.test(params.ym) ? params.ym : monthOf(today);
  let selected = monthOf(today) === ym ? today : `${ym}01`;
  let seq = 0;

  main.innerHTML = `
    <div class="page">
      <div id="evBanner"></div>
      <div class="info-card cal-card">
        <div class="cal-head">
          <button class="icon-btn" data-mstep="-1" aria-label="이전 달"><svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z"/></svg></button>
          <b id="calTitle"></b>
          <button class="icon-btn" data-mstep="1" aria-label="다음 달"><svg viewBox="0 0 24 24"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg></button>
        </div>
        <div id="calBody"></div>
      </div>
      <div id="evDay"></div>
      <div class="section-head"><h3 id="evListTitle"></h3></div>
      <div id="evList"></div>
    </div>`;

  const moveMonth = n => { ym = shiftMonth(ym, n); selected = monthOf(today) === ym ? today : `${ym}01`; draw(); };
  $$("[data-mstep]", main).forEach(b => b.onclick = () => moveMonth(Number(b.dataset.mstep)));
  onSwipe($(".cal-card", main), moveMonth);

  // 배너는 보고 있는 달과 상관없이 지금 학년도 기준 (학년 칩을 바꾸면 다시 그림)
  let bannerRanges = null;
  (async () => {
    try {
      bannerRanges = groupRanges(await fetchSchedule(ayOf(monthOf(today))));
      drawBanner(bannerRanges);
    } catch { /* 달력 쪽에서 오류를 보여 줌 */ }
  })();
  function drawBanner(all) {
    const u = upcoming(all.filter(r => forGrade(r, gradeFilter)), today);
    const el = $("#evBanner", main);
    if (!el) return;
    const parts = [];
    if (u.today.length) parts.push(`<div class="ev-banner today"><span class="ev-dday">오늘</span><b>${u.today.map(r => esc(r.title)).join(", ")}</b></div>`);
    if (u.next.length) parts.push(`<div class="ev-banner"><span class="ev-dday">D-${u.dDay}</span><b>${u.next.map(r => esc(r.title)).join(", ")}</b><small>${esc(md(u.next[0].start))}</small></div>`);
    el.innerHTML = parts.join("");
  }

  async function draw(force = false) {
    const my = ++seq;
    const y = Number(ym.slice(0, 4)), m = Number(ym.slice(4, 6));
    $("#calTitle", main).textContent = `${y}년 ${m}월`;
    $("#evListTitle", main).textContent = `${m}월 일정`;
    $("#calBody", main).innerHTML = `<div class="skel" style="height:220px;width:100%"></div>`;
    $("#evDay", main).innerHTML = "";
    $("#evList", main).innerHTML = skeleton(4);
    if (bannerRanges) drawBanner(bannerRanges);
    let events;
    try {
      events = await fetchSchedule(ayOf(ym), force);
    } catch (err) {
      if (my !== seq) return;
      $("#calBody", main).innerHTML = inlineError(err.message);
      $("#evList", main).innerHTML = "";
      $("[data-retry]", main).onclick = () => draw(true);
      return;
    }
    if (my !== seq) return;

    const shown = events.filter(e => forGrade(e, gradeFilter));
    const byDay = {};
    shown.forEach(e => { (byDay[e.date] ||= []).push(e); });
    // 휴업일 색은 학년과 상관없이(학교 전체가 쉬는 날)
    const holidays = new Set(events.filter(e => e.holiday).map(e => e.date));

    const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(`<span class="cal-cell blank"></span>`);
    for (let day = 1; day <= days; day++) {
      const key = `${ym}${String(day).padStart(2, "0")}`;
      const dow = (first.getDay() + day - 1) % 7;
      const evs = byDay[key] || [];
      const cls = ["cal-cell", dow === 0 ? "sun" : "", dow === 6 ? "sat" : "", holidays.has(key) ? "holiday" : "",
        key === today ? "today" : "", key === selected ? "sel" : ""].filter(Boolean).join(" ");
      cells.push(`<button class="${cls}" data-day="${key}"><span class="cal-num">${day}</span>${evs.some(e => !e.holiday) ? `<span class="cal-dot"></span>` : ""}</button>`);
    }
    $("#calBody", main).innerHTML = `
      <div class="cal-grid">${[...WEEK].map((w, i) => `<span class="cal-w ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</span>`).join("")}${cells.join("")}</div>`;
    $$("[data-day]", main).forEach(b => b.onclick = () => {
      selected = b.dataset.day;
      $$("[data-day]", main).forEach(x => x.classList.toggle("sel", x === b));
      drawDay();
    });

    const ranges = groupRanges(shown).filter(r => r.end >= `${ym}01` && r.start <= `${ym}${days}`);
    const drawDay = () => {
      const list = ranges.filter(r => r.start <= selected && selected <= r.end);
      $("#evDay", main).innerHTML = `
        <div class="ev-day">
          <div class="ev-day-date">${esc(md(selected))}</div>
          ${list.length ? list.map(evItem).join("") : `<div class="item-meta">일정이 없습니다.</div>`}
        </div>`;
    };
    drawDay();
    $("#evList", main).innerHTML = ranges.length
      ? `<div class="ev-list">${ranges.map(r => `<div class="ev-row"><span class="ev-when">${esc(md(r.start))}${r.end !== r.start ? `<br>~ ${esc(md(r.end))}` : ""}</span>${evItem(r)}</div>`).join("")}</div>`
      : `<div class="empty">이 달에는 일정이 없습니다.</div>`;
  }

  function evItem(r) {
    const grades = r.grades.length && r.grades.length < 3 ? r.grades.map(g => `<span class="badge ev-grade">${g}학년</span>`).join("") : "";
    return `
      <div class="ev-item ${r.holiday ? "holiday" : ""}">
        <div class="ev-title">${esc(r.title)} ${grades}${r.holiday ? `<span class="badge ev-off">${esc(r.holiday)}</span>` : ""}</div>
        ${r.content ? `<div class="item-meta">${esc(r.content)}</div>` : ""}
      </div>`;
  }
  draw();
}
