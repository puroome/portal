// 출석 모듈: 방과후 · 야간자율
// 데이터 구조
//   portal/att/groups/{gid}                 : { type, year, name, place, slots{요일:{교시:true}}, members{sid:true}, active, createdBy, createdByUid, createdAt }
//   portal/att/sessions/{gid}/{date}        : { uid, name, at }         ← 그날 감독교사(확인된 날만 통계에 잡힘)
//   portal/att/codes/{gid}/{date}           : { code, expiresAt }       ← 교사만 읽기
//   portal/att/records/{gid}/{sid}/{date}   : { status, at, by, code, note }
// 권한
//   방과후 : 반을 등록한 교사만 편집·출석체크    야간자율 : 모든 교사가 편집·출석체크
//   기록이 없는 학생은 '결석' 으로 봅니다.
import { db, readVal, newKey, serverTime, serverNow } from "./firebase.js";
import { ATT_TYPES, ATT_PERIODS, ATT_DAY_PERIODS, ATT_STATUS, CHECKIN_CODE_MINUTES, LATE_AFTER_MINUTES, NIGHT_CLASS } from "./config.js";
import { session, isTeacher } from "./auth.js";
import { $, $$, esc, toast, modal, confirmBox, alertBox, emptyState, dateKey, fmtDateKey, fmtTime, schoolYear, sidCompare, downloadCsv } from "./ui.js";
import { setTitle, go, onLeave } from "./nav.js";
import { getStudentMap } from "./directory.js";
import { memberPickerHtml, bindMemberPicker } from "./members.js";
import { sidInYear, isCurrentYear } from "./years.js";
import { WEEK, periodsOn, runsOn, scheduleText, isLate, effectiveStatus, countStatuses, sessionDates,
         nightSlots, nightPeriods, nightGroupName, groupPeriodKey } from "./att-schedule.js";

const TAB_KEY = "att_tab";
const NIGHT_GRADES = ["1", "2", "3"];

// 야간자율 카드에는 요일만 짧게 (교시는 묶음 제목에 있음)
const daysText = g => Object.keys(g.slots || {}).map(Number).sort().map(d => WEEK[d]).join("·");
const cardTitle = g => (g.type === "night" && g.grade ? `${g.grade}학년` : g.name);
const cardSchedule = g => (g.type === "night" ? [daysText(g), g.place].filter(Boolean).join(" · ") : scheduleText(g));

// 방과후는 등록한 교사만, 야간자율은 모든 교사가 다룹니다.
// 예전에 만들어 등록 교사(uid)가 없는 반은 주인이 없으므로 아무 교사나 고치고 지울 수 있습니다.
export const isOwnerless = g => !g?.createdByUid;
export const canManage = g => isTeacher() && (g.type === "night" || isOwnerless(g) || g.createdByUid === session.profile.uid);

function statusChip(key) {
  const s = ATT_STATUS[key] || ATT_STATUS.absent;
  return `<span class="st-chip" style="--c:${s.color}">${s.label}</span>`;
}

// 쓰기가 막히면 조용히 끝나지 않도록 이유를 보여 줍니다.
async function guard(what, run) {
  try {
    await run();
    return true;
  } catch (err) {
    console.error(`[출석] ${what} 실패:`, err);
    const denied = String(err?.code || err?.message || "").toLowerCase().includes("permission");
    toast(denied
      ? `${what} 권한이 없습니다. Firebase 보안 규칙을 새 것으로 게시했는지 확인하세요.`
      : `${what} 실패: ${err?.message || err}`);
    return false;
  }
}

// ---------------- 데이터 ----------------
async function loadGroups() {
  const obj = (await readVal("portal/att/groups")) || {};
  return Object.entries(obj).map(([id, g]) => ({ ...g, id }));
}

const loadSessions = async gid => (await readVal(`portal/att/sessions/${gid}`)) || {};

// ---------------- 진입 ----------------
export async function renderAttendance(main, { mode = "today" } = {}, alive) {
  if (isTeacher()) return renderTeacherList(main, mode, alive);
  return renderStudentList(main, alive);
}

// ---------------- 교사: 목록 ----------------
// 프로그램 화면과 같은 구조: 기본은 [출석체크], 오른쪽 위 버튼으로 [📊 통계]·[⚙️ 관리](반 관리) 화면에 들어갑니다.
// 방과후·야간자율은 폴더 탭으로 고릅니다.
const MODES = {
  today:  { head: "출석체크", desc: "" },
  manage: { head: "반 관리", desc: "" },
  stats:  { head: "통계", desc: "개설된 모든 반의 출결 통계를 볼 수 있습니다." }
};

async function renderTeacherList(main, mode, alive) {
  if (!MODES[mode]) mode = "today";   // 출석 메뉴에 들어오면 항상 [출석체크] 부터
  const cfg = MODES[mode];
  setTitle("🕘 출석", mode === "today" ? "#/home" : "#/att");
  const groups = await loadGroups();
  if (!alive()) return;

  let type = "night";
  try { type = sessionStorage.getItem(TAB_KEY) || type; } catch {}
  let includeEnded = false;

  const headButtons = {
    today:  `<a class="btn small ghost" href="#/att/stats">📊 통계</a><a class="btn small ghost" href="#/att/manage">⚙️ 관리</a>`,
    manage: `<button class="btn small primary add-btn" id="btnNewGroup" aria-label="새 반" title="새 반"><svg class="plus-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v15M4.5 12h15"/></svg></button>`,
    stats:  ""
  }[mode];

  main.innerHTML = `
    <div class="page">
      <div class="cat-head">
        <h3>${cfg.head}</h3>
        ${headButtons ? `<span class="head-actions">${headButtons}</span>` : ""}
      </div>
      <div class="folder-tabs" role="tablist">
        ${Object.entries(ATT_TYPES).map(([k, t]) => `<button class="folder-tab" role="tab" data-type="${k}">${t.label}</button>`).join("")}
      </div>
      <div class="folder-panel">
        ${cfg.desc ? `<p class="page-desc">${cfg.desc}</p>` : ""}
        ${mode === "today" ? "" : `
        <div class="filter-bar" id="attFilters">
          <label class="check-line small"><input type="checkbox" id="incEnded"> 종료된 수업 포함</label>
        </div>`}
        <div id="groupList"></div>
      </div>
    </div>`;

  const statsState = { from: dateKey(), to: dateKey(), grade: "" };

  const draw = () => {
    $$("[data-type]", main).forEach(b => {
      b.classList.toggle("active", b.dataset.type === type);
      b.setAttribute("aria-selected", String(b.dataset.type === type));
    });
    if (mode === "stats" && type === "night") {
      const filterBar = $("#attFilters", main);
      if (filterBar) filterBar.hidden = false;
      drawNightStats($("#groupList", main), groups.filter(g => includeEnded || g.active !== false), statsState, alive);
      return;
    }
    const mine = g => isOwnerless(g) || g.createdByUid === session.profile.uid;
    // 출석체크는 당일 운영하는 반만 — 다른 요일 반은 반 관리·통계에서 봅니다.
    // [종료된 수업 포함]은 반 관리·통계에서만 씁니다(끝난 수업을 출석체크할 일은 없음).
    const showEnded = mode !== "today" && includeEnded;
    const list = groups
      .filter(g => g.type === type)
      .filter(g => showEnded || g.active !== false)
      .filter(g => {
        if (mode === "stats") return true;                        // 통계는 개설된 모든 반
        if (mode === "manage") return type === "night" || mine(g); // 편집은 야자 전체 / 방과후는 내 반
        return runsOn(g) && (type === "night" || mine(g));         // 오늘 운영하는 반
      })
      .sort((a, b) => (Number(b.year) - Number(a.year)) || String(a.name).localeCompare(String(b.name), "ko"));

    const card = g => {
      const locked = mode === "today" && !canManage(g);
      const href = mode === "stats" ? `#/att/stats/${g.id}` : `#/att/g/${g.id}`;
      const inner = `
        <div class="item-top">
          ${g.type === "afterschool" ? `<span class="badge type-${g.type}">${esc(ATT_TYPES[g.type].label)}</span>` : ""}
          ${g.active === false ? '<span class="badge st-closed">종료</span>' : ""}
          ${mode === "today" && runsOn(g) ? '<span class="badge st-open">오늘 운영</span>' : ""}
          <span class="item-meta">${esc(cardSchedule(g))}</span>
        </div>
        <div class="item-title">${esc(cardTitle(g))}</div>
        <div class="item-meta">학생 ${Object.keys(g.members || {}).length}명${g.type === "afterschool" ? ` · 담당 ${esc(g.createdBy || "(없음)")}` : ""}${isOwnerless(g) ? " · ⚠️ 등록 교사 정보 없음" : ""}${locked ? " · 🔒 담당 교사만 출석체크" : ""}</div>`;
      if (mode === "manage") return `<button class="item-card" data-edit="${g.id}">${inner}</button>`;
      return locked ? `<div class="item-card locked">${inner}</div>` : `<a class="item-card" href="${href}">${inner}</a>`;
    };

    // 야간자율은 8교시·자율1·자율2 묶음으로 나눠서 봅니다.
    // 야간자율은 교시 카드 하나에 1·2·3학년을 칩으로 모읍니다. (요일은 교시마다 같아서 카드 머리에, 장소는 학년마다 달라 칩에)
    const gradeChip = g => {
      const locked = mode === "today" && !canManage(g);
      const cls = `grade-chip${locked ? " locked" : ""}${g.active === false ? " ended" : ""}`;
      const tip = locked ? "담당 교사만 출석체크" : g.active === false ? "운영 종료" : "";
      const inner = `${esc(cardTitle(g))} <small>${Object.keys(g.members || {}).length}${g.place ? ` · ${esc(g.place)}` : ""}</small>${locked ? " 🔒" : ""}${g.active === false ? " <small>· 종료</small>" : ""}`;
      if (mode === "manage") return `<button class="${cls}" data-edit="${g.id}"${tip ? ` title="${tip}"` : ""}>${inner}</button>`;
      return locked ? `<span class="${cls}" title="${tip}">${inner}</span>` : `<a class="${cls}" href="#/att/g/${g.id}">${inner}</a>`;
    };
    const grouped = () => nightPeriods().map(pk => {
      const inPeriod = list.filter(g => groupPeriodKey(g) === pk)
        .sort((a, b) => String(a.grade || a.name).localeCompare(String(b.grade || b.name), "ko"));
      return inPeriod.length
        ? `<div class="period-card">
             <div class="period-head"><b>${esc(ATT_PERIODS[pk].label)}</b><span>${esc(daysText(inPeriod[0]))}</span></div>
             <div class="grade-chips">${inPeriod.map(gradeChip).join("")}</div>
           </div>`
        : "";
    }).join("");

    $("#groupList", main).innerHTML = list.length
      ? (type === "night" ? grouped() : `<div class="card-list">${list.map(card).join("")}</div>`)
      : emptyState(mode === "today"
      ? (type === "night"
          ? "오늘 운영하는 야간자율 반이 없습니다."
          : "오늘 출석체크할 방과후 반이 없습니다.")
      : "등록된 반이 없습니다.");

    $$("[data-edit]", main).forEach(b => b.onclick = async () => {
      const g = groups.find(x => x.id === b.dataset.edit);
      if (await groupDialog(g, groups)) renderTeacherList(main, mode, alive);
    });
  };

  $$("[data-type]", main).forEach(b => b.onclick = () => {
    type = b.dataset.type;
    try { sessionStorage.setItem(TAB_KEY, type); } catch {}
    draw();
  });
  $("#incEnded", main)?.addEventListener("change", e => { includeEnded = e.target.checked; draw(); });
  $("#btnNewGroup", main)?.addEventListener("click", async () => {
    const id = await groupDialog({ type, year: schoolYear() }, groups);
    if (id) go(`#/att/g/${id}`);
  });
  draw();
}

// ---------------- 교사: 야간자율 통계 (학년별 표) ----------------
// 가로는 그 기간에 실제 운영된 교시만, 세로는 그 학년 학생.
// 출석이 아닌 날이 있으면 "/" 를 찍고, 누르면 날짜·상태·메모를 보여 줍니다.
async function drawNightStats(container, groups, state, alive) {
  const nightGroups = groups.filter(g => g.type === "night");
  const grades = [...new Set(nightGroups.map(g => String(g.grade || "")))].filter(Boolean).sort();
  if (!grades.includes(state.grade)) state.grade = grades[0] || "";

  container.innerHTML = `
    <div class="roll-bar">
      <input type="date" id="stFrom" value="${state.from}"> ~ <input type="date" id="stTo" value="${state.to}">
    </div>
    <div class="chip-row">${grades.map(g => `<button class="chip ${g === state.grade ? "on" : ""}" data-grade="${g}">${g}학년</button>`).join("")}</div>
    <div id="nightMatrix">${grades.length ? `<div class="page-loading"><div class="spinner"></div></div>` : emptyState("등록된 야간자율 반이 없습니다.")}</div>`;

  const rerun = () => drawNightStats(container, groups, state, alive);
  $("#stFrom", container).onchange = e => { state.from = e.target.value; rerun(); };
  $("#stTo", container).onchange = e => { state.to = e.target.value; rerun(); };
  $$("[data-grade]", container).forEach(b => b.onclick = () => { state.grade = b.dataset.grade; rerun(); });
  if (!grades.length) return;

  const gradeGroups = nightGroups.filter(g => String(g.grade) === state.grade);
  const yearOf = g => Number(g.year) || schoolYear();
  const loaded = await Promise.all(gradeGroups.map(async g => {
    const [records, sessions] = await Promise.all([readVal(`portal/att/records/${g.id}`), loadSessions(g.id)]);
    return { g, year: yearOf(g), records: records || {}, dates: sessionDates(sessions, state.from, state.to) };
  }));
  if (!alive()) return;

  // 학번은 해마다 다른 학생에게 다시 쓰이므로, 기간이 두 학년도에 걸치면 학년도별로 표를 나눕니다.
  // (한 표에 섞으면 올해 10103 신입생 이름이 작년 10103 선배 기록 자리에 찍힙니다)
  const years = [...new Set(loaded.filter(d => d.dates.length).map(d => d.year))].sort((a, b) => b - a);
  const box = $("#nightMatrix", container);
  if (!years.length) {
    box.innerHTML = emptyState("이 기간에 감독교사 확인이 된 야간자율이 없습니다.");
    return;
  }

  const oneDay = state.from === state.to;
  const problemsOf = (col, sid) => col.dates
    .map(d => ({ date: d, status: effectiveStatus(col.records[sid]?.[d], col.g, d), note: col.records[sid]?.[d]?.note || "" }))
    .filter(x => x.status !== "present");

  const tables = await Promise.all(years.map(async year => {
    const studentMap = await getStudentMap(year);
    // 그 기간에 실제 운영된 교시만 세로줄로 세웁니다.
    const cols = nightPeriods()
      .map(pk => loaded.find(d => d.year === year && groupPeriodKey(d.g) === pk && d.dates.length))
      .filter(Boolean);
    const sids = [...new Set(cols.flatMap(c => Object.keys(c.g.members || {})))].sort(sidCompare);
    return { year, studentMap, cols, sids };
  }));
  if (!alive()) return;

  box.innerHTML = tables.map((t, ti) => `
    <p class="item-meta">${years.length > 1 ? `<b>${t.year}학년도</b> · ` : ""}${esc(state.grade)}학년 · ${oneDay ? fmtDateKey(state.from) : `${state.from} ~ ${state.to}`} · 운영 교시 ${t.cols.map(c => ATT_PERIODS[groupPeriodKey(c.g)].label).join("·")}</p>
    <div class="table-wrap" style="margin-bottom:14px">
      <table class="data-table att-matrix">
        <thead><tr><th>번호</th><th>이름</th>${t.cols.map(c => `<th>${esc(ATT_PERIODS[groupPeriodKey(c.g)].label)}<br><span class="item-meta">${c.dates.length}일</span></th>`).join("")}</tr></thead>
        <tbody>
          ${t.sids.map(sid => {
            const st = t.studentMap[sid] || {};
            return `<tr>
              <td>${esc(st.no || "")}</td><td class="left">${esc(st.name || sid)}</td>
              ${t.cols.map((c, i) => {
                if (!c.g.members?.[sid]) return `<td class="off"></td>`;
                const bad = problemsOf(c, sid);
                return `<td>${bad.length ? `<button class="cell-mark" data-t="${ti}" data-col="${i}" data-sid="${esc(sid)}">/</button>` : ""}</td>`;
              }).join("")}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`).join("") + `<p class="item-meta">출석이 아닌 날이 있으면 <b>/</b> 가 표시됩니다. 눌러서 자세한 내용을 보세요.</p>`;

  $$("[data-col]", box).forEach(btn => btn.onclick = () => {
    const t = tables[Number(btn.dataset.t)];
    const col = t.cols[Number(btn.dataset.col)];
    const sid = btn.dataset.sid;
    const st = t.studentMap[sid] || {};
    modal({
      title: `${st.name || sid} · ${ATT_PERIODS[groupPeriodKey(col.g)].label}`,
      html: problemsOf(col, sid).map(x => `
        <div class="detail-row">
          ${oneDay ? "" : `<b>${fmtDateKey(x.date)}</b>`}
          ${statusChip(x.status)}
          ${x.note ? `<span class="item-meta">${esc(x.note)}</span>` : ""}
        </div>`).join("")
    });
  });
}

// ---------------- 교사: 반 등록·편집 ----------------
function groupDialog(g, allGroups = []) {
  const isNew = !g.id;
  const type = g.type;
  const night = type === "night";
  let savedId = null;
  let picker = null;

  const dayRows = Object.entries(ATT_DAY_PERIODS[type]).map(([day, periods]) => `
    <div class="slot-row">
      <span class="slot-day">${WEEK[day]}</span>
      ${periods.map(k => `
        <label class="slot-chk"><input type="checkbox" class="gSlot" data-day="${day}" value="${k}" ${g.slots?.[day]?.[k] ? "checked" : ""}> ${ATT_PERIODS[k].label}</label>`).join("")}
    </div>`).join("");

  return modal({
    title: "",                    // 제목 줄 없이 (사용자 요청 — 공간만 차지)
    wide: true,
    className: "att-group-modal",
    html: `
      ${night ? `
        <div class="field-row">
          <label class="field"><span>학년</span>
            <select id="gGrade">${NIGHT_GRADES.map(n => `<option ${String(g.grade) === n ? "selected" : ""}>${n}</option>`).join("")}</select>
          </label>
          <label class="field"><span>교시</span>
            <select id="gPeriod">${nightPeriods().map(k => `<option value="${k}" ${g.period === k ? "selected" : ""}>${ATT_PERIODS[k].label}</option>`).join("")}</select>
          </label>
        </div>` : `
        <div class="field-row">
          <label class="field"><span>반 이름</span><input id="gName" value="${esc(g.name || "")}" placeholder="예: 수학심화"></label>
          <label class="field"><span>학년도</span><input id="gYear" type="number" value="${esc(g.year || schoolYear())}"></label>
        </div>
        <div class="field"><span>운영 요일·교시</span><div class="slot-grid">${dayRows}</div></div>`}
      <label class="field"><span>장소 (선택)</span><input id="gPlace" value="${esc(g.place || "")}" placeholder="예: 본관 3층 자습실"></label>
      ${memberPickerHtml(night ? `학생 명단 (각 학년 ${NIGHT_CLASS}반)` : "학생 명단", night)}
      ${isNew ? "" : `
        <div class="btn-row" style="border-top:1px solid var(--line); padding-top:12px">
          <button type="button" class="btn small ghost" data-x="toggle">${g.active === false ? "▶️ 다시 운영" : "⏹ 운영 종료"}</button>
          <button type="button" class="btn small ghost danger" data-x="delete">🗑 삭제</button>
        </div>`}`,
    okText: "저장",
    cancelText: "취소",
    onOpen: async (box, close) => {
      const gradeSel = $("#gGrade", box);
      picker = await bindMemberPicker(box, g.members, night ? { fixed: { grade: gradeSel.value, cls: NIGHT_CLASS } } : {});
      // 야간자율: 학년을 바꾸면 그 학년 반 학생으로 자동 교체
      if (night) {
        if (isNew) picker.setFixedClass(gradeSel.value, NIGHT_CLASS);
        gradeSel.onchange = () => picker.setFixedClass(gradeSel.value, NIGHT_CLASS);
      }
      box.addEventListener("click", async e => {
        const act = e.target.closest("[data-x]")?.dataset.x;
        if (act === "toggle") {
          const resume = g.active === false;
          await db.ref(`portal/att/groups/${g.id}/active`).set(resume);
          toast(resume ? "다시 운영합니다." : "운영을 종료했습니다.");
          savedId = g.id;
          close(true);
        }
        if (act === "delete") {
          const records = (await readVal(`portal/att/records/${g.id}`)) || {};
          const days = new Set();
          Object.values(records).forEach(byDate => Object.keys(byDate || {}).forEach(d => days.add(d)));
          const kept = Object.keys(records).length;

          if (!(await confirmBox("반 삭제", `'${esc(g.name)}' 반을 삭제할까요?`, "삭제"))) return;
          // 출결 기록이 있으면 한 번 더 확인합니다.
          if (kept && !(await confirmBox(
            "⚠️ 출결 기록이 함께 지워집니다",
            `이 반에는 학생 <b>${kept}명</b>의 출결 기록(<b>${days.size}일</b>)이 남아 있습니다.<br>` +
            "반을 지우면 그 기록도 함께 사라지고 되돌릴 수 없습니다.<br><br>그래도 삭제할까요?",
            "기록까지 삭제"))) return;

          if (await guard("반 삭제", async () => {
            await db.ref(`portal/att/records/${g.id}`).remove();
            await db.ref(`portal/att/sessions/${g.id}`).remove();
            await db.ref(`portal/att/codes/${g.id}`).remove();
            await db.ref(`portal/att/groups/${g.id}`).remove();
          })) {
            toast("삭제되었습니다.");
            savedId = g.id;
            close(true);
          }
        }
      });
    },
    beforeOk: async box => {
      const year = night ? (Number(g.year) || schoolYear()) : (Number($("#gYear", box).value) || schoolYear());
      let name, slots, extra = {};
      if (night) {
        const grade = $("#gGrade", box).value;
        const period = $("#gPeriod", box).value;
        const dup = allGroups.find(x => x.id !== g.id && x.type === "night" && String(x.grade) === grade && x.period === period && Number(x.year) === year);
        if (dup) throw new Error(`이미 ${nightGroupName(grade, period)} 반이 있습니다.`);
        name = nightGroupName(grade, period);
        slots = nightSlots(period);
        extra = { grade, period };
      } else {
        name = $("#gName", box).value.trim();
        if (!name) throw new Error("반 이름을 입력하세요.");
        slots = {};
        $$(".gSlot", box).forEach(c => {
          if (!c.checked) return;
          (slots[c.dataset.day] ||= {})[c.value] = true;
        });
        if (!Object.keys(slots).length) throw new Error("운영 요일·교시를 하나 이상 고르세요.");
      }
      const members = picker.get();
      if (!members) throw new Error("학생을 한 명 이상 선택하세요.");
      const data = {
        type, name, members, slots, year, ...extra,
        place: $("#gPlace", box).value.trim() || null
      };
      if (g.id) {
        // 등록 교사 정보가 없던 반은 이때 내 이름으로 맡습니다.
        if (isOwnerless(g)) Object.assign(data, { createdBy: session.profile.name, createdByUid: session.profile.uid });
        await db.ref(`portal/att/groups/${g.id}`).update(data);
        savedId = g.id;
      } else {
        savedId = newKey("portal/att/groups");
        await db.ref(`portal/att/groups/${savedId}`).set({
          ...data, active: true, createdBy: session.profile.name, createdByUid: session.profile.uid, createdAt: serverTime
        });
      }
      toast("저장되었습니다.");
    }
  }).then(ok => (ok ? savedId : null));
}

// ---------------- 교사: 출석부 (오늘) ----------------
export async function renderGroup(main, { gid }, alive) {
  const group = await readVal(`portal/att/groups/${gid}`);
  if (!alive()) return;
  if (!group) { main.innerHTML = emptyState("반을 찾을 수 없습니다."); return; }
  group.id = gid;
  if (!isTeacher()) return renderStudentGroup(main, group, alive);

  setTitle("🕘 출석부", "#/att");
  if (!canManage(group)) {
    main.innerHTML = emptyState(`🔒 이 반은 등록한 교사(${group.createdBy || ""})만 출석체크할 수 있습니다.`);
    return;
  }

  const today = dateKey();

  // 출석체크는 그 반이 운영하는 날(당일)에만 합니다. 다른 요일·종료된 반·지난 학년도 반은 막고 통계로 안내합니다.
  // (목록에서 숨기는 것만으로는 부족 — 학생별 모아보기의 출결 카드나 주소로도 들어올 수 있습니다)
  const closedWhy = group.active === false ? "운영이 끝난 반입니다."
    : Number(group.year || schoolYear()) !== schoolYear() ? `${esc(group.year)}학년도 반입니다.`
    : !runsOn(group) ? `오늘은 이 반이 운영하지 않는 날입니다.<br>출석체크는 운영일(<b>${esc(cardSchedule(group))}</b>)에만 할 수 있습니다.`
    : "";
  if (closedWhy) {
    main.innerHTML = `
      <div class="page">
        <div class="info-card">
          <div class="item-top">
            <span class="badge type-${group.type}">${esc(ATT_TYPES[group.type]?.label || "")}</span>
            <span class="item-meta">${esc(cardSchedule(group))}</span>
          </div>
          <h2 class="info-title">${esc(group.name)}</h2>
          <div class="info-meta">${fmtDateKey(today)} · 학생 ${Object.keys(group.members || {}).length}명</div>
          <p class="closed-note">🚫 ${closedWhy}</p>
          <div class="btn-row"><a class="btn ghost" href="#/att/stats/${gid}">📊 이 반 출결 통계 보기</a></div>
        </div>
      </div>`;
    return;
  }

  const studentMap = await getStudentMap(group.year || schoolYear());
  if (!alive()) return;
  let records = {};
  // 야간자율은 그날 감독교사가 '감독교사 확인'을 눌러야 출석체크를 시작할 수 있습니다.
  const needsSupervisor = group.type === "night";
  let supervisor = null;

  main.innerHTML = `
    <div class="page">
      <div class="info-card">
        <div class="item-top">
          <span class="badge type-${group.type}">${esc(ATT_TYPES[group.type]?.label || "")}</span>
          <span class="item-meta">${esc(cardSchedule(group))}</span>
        </div>
        <h2 class="info-title">${esc(group.name)}</h2>
        <div class="info-meta">${fmtDateKey(today)} · 학생 ${Object.keys(group.members || {}).length}명</div>
        <div class="btn-row">
          ${needsSupervisor ? `<button class="btn ghost" id="btnSupervisor">🙋 감독교사 확인</button>` : ""}
          <button class="btn primary" id="btnCode">📋 체크인 코드</button>
        </div>
        <div class="item-meta" id="supervisorInfo"></div>
      </div>
      <div class="stat-line" id="rollCount"></div>
      <div class="roll-list" id="rollList"></div>
      <p class="page-desc">체크인하지 않은 학생은 <b>결석</b>으로 기록됩니다. 기기가 없는 학생은 선생님이 직접 눌러 주세요.</p>
    </div>`;

  const members = () => Object.keys(group.members || {}).sort(sidCompare)
    .map(sid => ({ sid, ...(studentMap[sid] || { name: "(계정 없음)", no: "" }) }));

  const iAmSupervisor = () => !needsSupervisor || supervisor?.uid === session.profile.uid;

  const drawSupervisor = () => {
    if (!needsSupervisor) return;
    const iAm = supervisor?.uid === session.profile.uid;
    $("#supervisorInfo", main).innerHTML = supervisor
      ? `<b>${esc(supervisor.name || "")}</b> 선생님의 감독일입니다.`
      : "먼저 <b>감독교사 확인</b>을 눌러야 출석체크를 시작할 수 있습니다.";
    const btn = $("#btnSupervisor", main);
    btn.textContent = supervisor ? (iAm ? "✅ 내가 감독중" : `🙋 감독: ${supervisor.name || ""}`) : "🙋 감독교사 확인";
    btn.classList.toggle("on", iAm);
    btn.disabled = !!supervisor && !iAm;
    $("#btnCode", main).disabled = !iAm;
  };

  const draw = () => {
    const list = members();
    const blocked = !iAmSupervisor();   // 감독 확인 전이거나, 다른 교사가 감독인 날
    const counts = countStatuses(records, group, []);
    list.forEach(m => { counts[effectiveStatus(records[m.sid]?.[today], group, today)]++; });

    $("#rollCount", main).innerHTML = Object.entries(ATT_STATUS)
      .map(([k, s]) => `<span style="color:${s.color}">${s.label} <b>${counts[k]}</b></span>`).join("");

    $("#rollList", main).innerHTML = list.length ? list.map(m => {
      const rec = records[m.sid]?.[today];
      const st = effectiveStatus(rec, group, today);
      return `
        <div class="roll-row ${rec ? "" : "unchecked"}">
          <div class="roll-who">
            <b>${esc(m.name)}</b> <span class="item-meta">${esc(m.sid)}</span>
            <div class="item-meta">${rec ? (rec.by === "student" ? `📱 체크인 ${fmtTime(rec.at)}` : "✍️ 교사 입력") : "미체크"}${rec?.note ? ` · ${esc(rec.note)}` : ""}</div>
          </div>
          <div class="roll-status">
            ${Object.entries(ATT_STATUS).map(([k, s]) => `<button class="st-btn ${st === k ? "on" : ""}" style="--c:${s.color}" data-sid="${esc(m.sid)}" data-st="${k}" ${blocked ? "disabled" : ""}>${s.short}</button>`).join("")}
            <button class="st-btn memo" data-memo="${esc(m.sid)}" title="메모" ${blocked ? "disabled" : ""}>✎</button>
          </div>
        </div>`;
    }).join("") : emptyState("명단이 비어 있습니다. [⚙️ 관리]에서 학생을 추가하세요.");

    $$("[data-st]", main).forEach(b => b.onclick = () => setStatus(b.dataset.sid, b.dataset.st));
    $$("[data-memo]", main).forEach(b => b.onclick = () => editMemo(b.dataset.memo));
    drawSupervisor();
  };

  const recRef = db.ref(`portal/att/records/${gid}`);
  // 그날을 운영일(감독 확인)로 남깁니다. 야간자율은 이미 감독 확인이 되어 있어야 여기까지 옵니다.
  const ensureSession = async () => {
    const snap = await sessionRef.once("value");
    if (!snap.val()?.uid) {
      await sessionRef.update({ uid: session.profile.uid, name: session.profile.name, at: serverTime });
    }
  };

  const setStatus = async (sid, status) => {
    const rec = records[sid]?.[today];
    const ref = recRef.child(`${sid}/${today}`);
    // 같은 버튼을 다시 누르면 교사 입력 취소 (→ 미체크=결석)
    if (rec?.by === "teacher" && rec.status === status && !rec.note) return guard("출결 지우기", () => ref.remove());
    await guard("출결 저장", async () => {
      await ensureSession();
      await ref.update({ status, by: "teacher", updatedBy: session.profile.name, updatedAt: serverTime });
    });
  };

  const editMemo = async sid => {
    const rec = records[sid]?.[today] || {};
    await modal({
      title: `${studentMap[sid]?.name || sid} 메모`,
      html: `<input id="memoText" value="${esc(rec.note || "")}" placeholder="예: 병원 진료로 조퇴">`,
      okText: "저장", cancelText: "취소",
      beforeOk: async box => {
        const note = $("#memoText", box).value.trim();
        if (!records[sid]?.[today] && !note) return;
        await guard("메모 저장", () => recRef.child(`${sid}/${today}`).update({
          note: note || null,
          ...(rec.status ? {} : { status: "absent", by: "teacher" }),
          updatedBy: session.profile.name, updatedAt: serverTime
        }));
      }
    });
  };

  $("#btnCode", main).onclick = () => openCodeDialog(group, today);
  $("#btnSupervisor", main)?.addEventListener("click", async () => {
    if (supervisor && supervisor.uid !== session.profile.uid) return;   // 다른 교사가 감독이면 누를 수 없음
    if (supervisor) {
      // 잘못 누른 경우를 위해 본인은 감독을 내려놓을 수 있습니다.
      if (!(await confirmBox("감독 내려놓기", "오늘 감독을 내려놓을까요?<br>다른 선생님이 감독교사 확인을 누를 수 있게 됩니다."))) return;
      if (await guard("감독 내려놓기", () => sessionRef.update({ uid: null, name: null }))) toast("감독을 내려놓았습니다.");
      return;
    }
    if (await guard("감독교사 지정", () => sessionRef.update({ uid: session.profile.uid, name: session.profile.name, at: serverTime }))) {
      toast("오늘 감독교사로 지정되었습니다.");
    }
  });
  draw();

  const sessionRef = db.ref(`portal/att/sessions/${gid}/${today}`);
  const onRecs = recRef.on("value", s => { records = s.val() || {}; draw(); });
  const onSession = sessionRef.on("value", s => {
    const v = s.val();
    supervisor = v && typeof v === "object" && v.uid ? v : null;
    draw();
  });
  onLeave(() => { recRef.off("value", onRecs); sessionRef.off("value", onSession); });
}

// 체크인 코드 (학생에게 불러 주는 4자리 번호)
async function openCodeDialog(group, date) {
  const codeRef = db.ref(`portal/att/codes/${group.id}/${date}`);
  let timer = null;

  const sessionRef = db.ref(`portal/att/sessions/${group.id}/${date}`);
  const markSession = async () => {
    // 그날 운영했다는 표시 (통계·학생 출결의 기준 날짜). 감독교사 기록은 덮어쓰지 않습니다.
    if (!(await sessionRef.once("value")).exists()) {
      await sessionRef.update({ uid: session.profile.uid, name: session.profile.name, at: serverTime });
    }
  };
  const issue = async () => {
    const data = {
      code: String(Math.floor(Math.random() * 10000)).padStart(4, "0"),
      expiresAt: serverNow() + CHECKIN_CODE_MINUTES * 60000,
      createdBy: session.profile.name
    };
    await guard("체크인 코드 발급", async () => { await codeRef.set(data); await markSession(); });
    return data;
  };

  let current = await codeRef.once("value").then(s => s.val());
  if (!current || current.expiresAt < serverNow()) current = await issue();
  else await markSession();

  await modal({
    title: `${group.name} · ${fmtDateKey(date)}`,
    okText: "닫기",
    html: `
      <div class="code-screen">
        <div>
          <div class="item-meta">체크인 코드</div>
          <div id="bigCode" class="big-code"></div>
          <div id="codeLeft" class="item-meta"></div>
          <button class="btn small ghost" id="btnNewCode" style="margin-top:10px">🔄 새 코드 발급</button>
        </div>
      </div>`,
    onOpen: box => {
      const paint = () => { $("#bigCode", box).textContent = current.code; };
      const tick = () => {
        const left = Math.max(0, current.expiresAt - serverNow());
        $("#codeLeft", box).textContent = left
          ? `남은 시간 ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`
          : "만료됨 — 새 코드를 발급하세요";
        if (!box.isConnected) clearInterval(timer);
      };
      paint(); tick();
      timer = setInterval(tick, 1000);
      $("#btnNewCode", box).onclick = async () => { current = await issue(); paint(); tick(); };
    }
  });
  clearInterval(timer);
}

// ---------------- 교사: 통계 ----------------
export async function renderGroupStats(main, { gid }, alive) {
  if (!isTeacher()) { go("#/att"); return; }
  setTitle("출석", "#/att/stats", 3);
  const [group, records, sessions, studentMap] = await Promise.all([
    readVal(`portal/att/groups/${gid}`), readVal(`portal/att/records/${gid}`), loadSessions(gid), null
  ]).then(async ([g, r, se]) => [g, r, se, await getStudentMap(g?.year || schoolYear())]);
  if (!alive()) return;
  if (!group) { main.innerHTML = emptyState("반을 찾을 수 없습니다."); return; }
  group.id = gid;

  const range = { from: dateKey(), to: dateKey() };   // 기본은 오늘 하루

  main.innerHTML = `
    <div class="page">
      <div class="info-card">
        <div class="item-top"><span class="badge type-${group.type}">${esc(ATT_TYPES[group.type]?.label || "")}</span><span class="item-meta">${esc(cardSchedule(group))}</span></div>
        <h2 class="info-title">${esc(group.name)}</h2>
      </div>
      <div class="roll-bar">
        <input type="date" id="stFrom" value="${range.from}"> ~ <input type="date" id="stTo" value="${range.to}">
        <button class="btn small ghost icon-only" id="btnStatCsv" aria-label="CSV 내려받기" title="CSV 내려받기"><svg class="dl-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/></svg></button>
      </div>
      <div id="statBody"></div>
    </div>`;

  const draw = () => {
    const dates = sessionDates(sessions, range.from, range.to);
    const rows = Object.keys(group.members || {}).sort(sidCompare).map(sid => {
      const c = countStatuses(records?.[sid], group, dates);
      const attended = c.present + c.late + c.early;
      return { sid, name: studentMap[sid]?.name || "", c, rate: dates.length ? Math.round(attended / dates.length * 100) : 0 };
    });

    $("#statBody", main).innerHTML = `
      <p class="item-meta">기간 내 운영일 <b>${dates.length}</b>일 (감독교사 확인이 된 날만) · 출석률 = (출석+지각+조퇴) / 운영일</p>
      ${dates.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>학번</th><th>이름</th>${Object.values(ATT_STATUS).map(s => `<th>${s.label}</th>`).join("")}<th>출석률</th></tr></thead>
            <tbody>
              ${rows.map(r => `<tr data-detail="${esc(r.sid)}">
                <td>${esc(r.sid)}</td><td class="left">${esc(r.name)}</td>
                ${Object.keys(ATT_STATUS).map(k => `<td class="${r.c[k] && k !== "present" ? "warn" : ""}">${r.c[k]}</td>`).join("")}
                <td><b>${r.rate}%</b></td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>` : emptyState("이 기간에 운영한 날이 없습니다.")}`;

    $$("[data-detail]", main).forEach(tr => tr.onclick = () => {
      const sid = tr.dataset.detail;
      modal({
        title: `${studentMap[sid]?.name || sid} 출결`,
        html: dates.map(d => {
          const rec = records?.[sid]?.[d];
          return `<div class="history-row"><span>${fmtDateKey(d)}</span><span>${fmtTime(rec?.at)}</span>${statusChip(effectiveStatus(rec, group, d))}</div>
                  ${rec?.note ? `<div class="item-meta right">${esc(rec.note)}</div>` : ""}`;
        }).join("")
      });
    });

    $("#btnStatCsv", main).onclick = () => downloadCsv(`${group.name}_출결_${range.from}_${range.to}.csv`, [
      ["학번", "이름", ...Object.values(ATT_STATUS).map(s => s.label), "출석률", ...dates],
      ...rows.map(r => [r.sid, r.name, ...Object.keys(ATT_STATUS).map(k => r.c[k]), r.rate + "%",
        ...dates.map(d => ATT_STATUS[effectiveStatus(records?.[r.sid]?.[d], group, d)].label)])
    ]);
  };

  $("#stFrom", main).onchange = e => { range.from = e.target.value; draw(); };
  $("#stTo", main).onchange = e => { range.to = e.target.value; draw(); };
  draw();
}

// ---------------- 학생 ----------------
// 학생이 이 반에 속했는가: 그 반 학년도에 쓰던 학번이 명단에 있는지로 봅니다.
const mySidIn = g => sidInYear(session.profile, g.year || schoolYear());
const isNowGroup = g => g.active !== false && isCurrentYear(session.profile, g.year || schoolYear(), schoolYear());

async function renderStudentList(main, alive) {
  setTitle("🕘 출석");
  const mine = (await loadGroups()).filter(g => { const sid = mySidIn(g); return sid && g.members?.[sid]; });
  if (!alive()) return;
  const now = mine.filter(isNowGroup);
  const past = mine.filter(g => !isNowGroup(g)).sort((a, b) => Number(b.year) - Number(a.year));

  const card = g => `
    <a class="item-card" href="#/att/g/${g.id}">
      <div class="item-top">
        <span class="badge type-${g.type}">${esc(ATT_TYPES[g.type]?.label || "")}</span>
        ${isNowGroup(g) && runsOn(g) ? '<span class="badge st-open">오늘 운영</span>' : ""}
        ${isNowGroup(g) ? "" : `<span class="badge st-closed">${esc(g.year || "")}학년도</span>`}
        <span class="item-meta">${esc(cardSchedule(g))}</span>
      </div>
      <div class="item-title">${esc(g.name)}</div>
    </a>`;

  main.innerHTML = `
    <div class="page">
      ${now.length ? `<div class="card-list">${now.map(card).join("")}</div>`
        : emptyState("참여 중인 방과후·야간자율이 없습니다.\n담당 선생님께 명단 등록을 요청하세요.")}
      ${past.length ? `
        <div class="section-head"><h3>지난 출결</h3><span class="item-meta">보기만 가능</span></div>
        <div class="card-list">${past.map(card).join("")}</div>` : ""}
    </div>`;
}

// 학생 반 화면 (2026-09-20 사용자 선택 1안): 활동 프로그램 반 화면과 같은 틀(.prog-shell)
//   오늘 출석 = 코드 입력칸을 바로 보여 줌(창 없음, 세로선 없음) · 나의 출결 = 숫자 4개 + 지각·조퇴·결석 날짜(세로선 카드)
async function renderStudentGroup(main, group, alive) {
  setTitle(group.name, "#/att");
  const sid = mySidIn(group);
  if (!sid || !group.members?.[sid]) { main.innerHTML = emptyState("이 반 명단에 없습니다."); return; }
  const now = isNowGroup(group);
  const date = dateKey();

  main.innerHTML = `
    <div class="page">
      <div class="prog-shell att-${esc(group.type)}">
        <div class="prog-head">
          <div class="item-top">
            <span class="badge type-${group.type}">${esc(ATT_TYPES[group.type]?.label || "")}</span>
            ${now ? (runsOn(group) ? '<span class="badge st-open">오늘 운영</span>' : "") : `<span class="badge st-closed">${esc(group.year || "")}학년도</span>`}
            <span class="item-meta">${esc(cardSchedule(group))}</span>
          </div>
          <h2 class="prog-title">${esc(group.name)}</h2>
        </div>
        <div class="prog-body">
          ${now ? `<div class="task-head">오늘 출석</div><div id="ciBox" class="ci-box"></div>`
                : `<p class="item-meta">지난 학년도(${esc(group.year || "")}) 반입니다. 출결 기록만 볼 수 있습니다.</p>`}
          <div class="task-head ci-mine-head">나의 출결 <span class="item-meta" id="mineDays"></span></div>
          <div class="task-rail" id="mineBox"><div class="task-empty">불러오는 중…</div></div>
        </div>
      </div>
    </div>`;

  const draw = async () => {
    const [records, sessions] = await Promise.all([readVal(`portal/att/records/${group.id}/${sid}`), loadSessions(group.id)]);
    if (!alive()) return;
    const dates = sessionDates(sessions);
    const counts = countStatuses(records, group, dates);
    const problems = dates.filter(d => effectiveStatus(records?.[d], group, d) !== "present").sort().reverse();

    // 오늘 출석 칸: 운영일 아님 / 이미 기록됨 / 코드 입력
    const box = $("#ciBox", main);
    if (box) {
      const rec = records?.[date];
      if (rec) {
        const st = rec.status === "present" && isLate(rec.at, group, date) ? "late" : rec.status;
        box.innerHTML = `<div class="ci-done">오늘 ${esc(ATT_STATUS[st]?.label || "출결")} 기록됨 ${rec.at ? `<span class="item-meta">(${fmtTime(rec.at)})</span>` : ""}</div>`;
      } else if (!runsOn(group)) {
        box.innerHTML = `<div class="task-empty">오늘은 운영하는 날이 아닙니다.</div>`;
      } else {
        box.innerHTML = `
          <form class="ci-form" id="ciForm">
            <!-- 4칸 코드: 보이는 칸 4개 위에 투명한 입력칸 하나를 겹침 -->
            <label class="ci-otp">
              ${[0, 1, 2, 3].map(i => `<span class="ci-cell" data-i="${i}"></span>`).join("")}
              <input id="ciCode" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" aria-label="출석 코드 4자리">
            </label>
            <button class="btn primary" id="ciBtn">출석</button>
          </form>`;
        const input = $("#ciCode", box);
        const paint = () => {
          input.value = input.value.replace(/\D/g, "").slice(0, 4);
          const v = input.value, focused = document.activeElement === input;
          $$(".ci-cell", box).forEach((c, i) => {
            c.textContent = v[i] || "";
            c.classList.toggle("filled", !!v[i]);
            c.classList.toggle("active", focused && i === Math.min(v.length, 3));
          });
        };
        input.addEventListener("input", paint);
        input.addEventListener("focus", paint);
        input.addEventListener("blur", paint);
        paint();
        $("#ciForm", box).onsubmit = async e => {
          e.preventDefault();
          const code = $("#ciCode", box).value.trim();
          if (!/^\d{4}$/.test(code)) { toast("4자리 숫자를 입력하세요."); return; }
          const btn = $("#ciBtn", box);
          btn.disabled = true;
          try {
            const at = await doCheckin(group, date, code);
            alertBox("출석완료", isLate(at, group, date) ? "✅ 출석완료<br><b style='color:#f9ab00'>지각입니다.</b>" : "✅ 출석완료");
            draw();
          } catch (err) {
            toast(err.message || "출석하지 못했습니다.");
            btn.disabled = false;
          }
        };
      }
    }

    $("#mineDays", main).textContent = `운영 ${dates.length}일`;
    $("#mineBox", main).innerHTML = `
      <div class="task-card"><div class="ci-stats">${Object.entries(ATT_STATUS).map(([k, s]) =>
        `<span style="color:${s.color}"><b>${counts[k]}</b>${s.label}</span>`).join("")}</div></div>
      ${problems.length ? problems.map(d => {
        const rec = records?.[d];
        return `<div class="task-card"><div class="task-line" style="margin-top:0"><span>${fmtDateKey(d)}${rec?.at ? ` ${fmtTime(rec.at)}` : ""}</span>${statusChip(effectiveStatus(rec, group, d))}</div>
                ${rec?.note ? `<div class="task-desc">${esc(rec.note)}</div>` : ""}</div>`;
      }).join("") : `<div class="task-empty">지각·조퇴·결석 기록이 없습니다. 👍</div>`}`;
  };
  await draw();
}

async function doCheckin(group, date, code) {
  const sid = session.profile.sid;
  const path = `portal/att/records/${group.id}/${sid}/${date}`;
  try {
    await db.ref(path).set({ status: "present", at: serverTime, by: "student", code });
  } catch (err) {
    const existing = await readVal(path).catch(() => null);
    if (existing) throw new Error("이미 오늘 출결이 기록되어 있습니다.");
    throw new Error("코드가 틀렸거나 만료되었습니다. 선생님께 확인하세요.");
  }
  return (await readVal(path))?.at || serverNow();
}

// 학생별 모아보기(교사)용 요약. person = { sid, sids } — 반마다 그 해 학번으로 찾습니다.
export async function loadStudentAttendance(person) {
  const groups = (await loadGroups())
    .map(g => ({ g, sid: sidInYear(person, g.year || schoolYear()) }))
    .filter(x => x.sid && x.g.members?.[x.sid]);
  const data = await Promise.all(groups.map(async ({ g, sid }) => {
    const [records, sessions] = await Promise.all([readVal(`portal/att/records/${g.id}/${sid}`), loadSessions(g.id)]);
    const dates = sessionDates(sessions);
    return { group: g, dates, counts: countStatuses(records, g, dates) };
  }));
  return data;
}

export { cardSchedule, statusChip };
