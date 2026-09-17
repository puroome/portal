// 출석 모듈: 방과후 · 야간자율 (학생 체크인 + 교사 확인)
// 데이터 구조
//   portal/att/groups/{gid}                 : { type, year, name, place, days{1:true}, startTime, endTime, members{sid:true}, active, createdBy, createdAt }
//   portal/att/codes/{gid}/{date}           : { code, expiresAt, createdBy }            ← 교사만 읽기 가능
//   portal/att/records/{gid}/{sid}/{date}   : { status, at, by:'student'|'teacher', code, note, updatedBy, updatedAt }
import { db, readVal, newKey, serverTime, serverNow } from "./firebase.js";
import { ATT_TYPES, ATT_STATUS, CHECKIN_CODE_MINUTES, LATE_AFTER_MINUTES } from "./config.js";
import { session, isTeacher } from "./auth.js";
import { $, $$, esc, toast, modal, confirmBox, emptyState, dateKey, fmtDateKey, fmtTime, schoolYear, sidCompare, downloadCsv } from "./ui.js";
import { setTitle, go, onLeave } from "./nav.js";
import { getStudents, getStudentMap, gradeOptions, classOptions } from "./directory.js";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

// ---------------- 공통 ----------------
async function loadGroups() {
  const obj = (await readVal("portal/att/groups")) || {};
  return Object.entries(obj).map(([id, g]) => ({ ...g, id }));
}

function scheduleText(g) {
  const days = Object.keys(g.days || {}).map(Number).sort().map(d => WEEK[d]).join("·");
  return [days, g.startTime && `${g.startTime}~${g.endTime || ""}`, g.place].filter(Boolean).join(" · ");
}

// 학생이 스스로 체크인한 기록은 시작 시각 + N분 이후면 '지각'으로 간주
export function effectiveStatus(rec, group, date) {
  if (!rec) return null;
  if (rec.by === "student" && rec.status === "present" && group.startTime && rec.at) {
    const [h, m] = group.startTime.split(":").map(Number);
    const [y, mo, d] = date.split("-").map(Number);
    const limit = new Date(y, mo - 1, d, h, m).getTime() + LATE_AFTER_MINUTES * 60000;
    if (rec.at > limit) return "late";
  }
  return rec.status;
}

function statusChip(key, extra = "") {
  if (!key) return `<span class="st-chip none">미체크</span>`;
  const s = ATT_STATUS[key];
  return `<span class="st-chip" style="--c:${s.color}">${s.label}${extra}</span>`;
}

function countStatuses(recsByDate, group) {
  const c = Object.fromEntries(Object.keys(ATT_STATUS).map(k => [k, 0]));
  Object.entries(recsByDate || {}).forEach(([date, r]) => {
    const st = effectiveStatus(r, group, date);
    if (st) c[st]++;
  });
  return c;
}

function checkinUrl(gid, date, code) {
  return `${location.origin}${location.pathname}#/checkin/${gid}/${date}/${code}`;
}

// ---------------- 메인 ----------------
export async function renderAttendance(main, params, alive) {
  setTitle("🕘 출석 (방과후·야간자율)");
  if (isTeacher()) return renderTeacherHome(main, alive);
  return renderStudentHome(main, alive);
}

// ---------------- 학생 ----------------
async function renderStudentHome(main, alive) {
  const sid = session.profile.sid;
  const groups = (await loadGroups()).filter(g => g.active !== false && g.members?.[sid]);
  const recs = await Promise.all(groups.map(g => readVal(`portal/att/records/${g.id}/${sid}`)));
  if (!alive()) return;
  const today = dateKey();

  if (!groups.length) {
    main.innerHTML = `<div class="page">${emptyState("참여 중인 방과후·야간자율이 없습니다.\n담당 선생님께 명단 등록을 요청하세요.")}</div>`;
    return;
  }

  main.innerHTML = `
    <div class="page">
      ${groups.map((g, i) => {
        const r = recs[i] || {};
        const todayRec = r[today];
        const c = countStatuses(r, g);
        const scheduled = !!g.days?.[new Date().getDay()];
        const history = Object.keys(r).sort().reverse();
        return `
          <div class="info-card">
            <div class="item-top"><span class="badge type-${g.type}">${esc(ATT_TYPES[g.type]?.label || "")}</span><span class="item-meta">${esc(scheduleText(g))}</span></div>
            <h2 class="info-title">${esc(g.name)}</h2>
            <div class="today-box">
              <div>
                <div class="item-meta">오늘 ${fmtDateKey(today)}</div>
                <div>${todayRec ? `${statusChip(effectiveStatus(todayRec, g, today))} <span class="item-meta">${fmtTime(todayRec.at)}</span>` : (scheduled ? "아직 체크인하지 않았어요" : '<span class="item-meta">오늘은 운영일이 아닙니다</span>')}</div>
              </div>
              ${todayRec ? "" : `<button class="btn primary" data-checkin="${g.id}">체크인</button>`}
            </div>
            <div class="stat-line">${Object.entries(ATT_STATUS).map(([k, s]) => `<span>${s.label} <b>${c[k]}</b></span>`).join("")}</div>
            ${history.length ? `
              <details class="history">
                <summary>출결 기록 ${history.length}일</summary>
                ${history.map(d => `<div class="history-row"><span>${fmtDateKey(d)}</span><span>${fmtTime(r[d].at)}</span>${statusChip(effectiveStatus(r[d], g, d))}</div>`).join("")}
              </details>` : ""}
          </div>`;
      }).join("")}
      <p class="page-desc center">📷 감독 선생님 화면의 QR을 휴대폰 카메라로 찍거나, 4자리 코드를 입력하세요.</p>
    </div>`;

  $$("[data-checkin]", main).forEach(b => b.onclick = async () => {
    const g = groups.find(x => x.id === b.dataset.checkin);
    const ok = await modal({
      title: `${g.name} 체크인`,
      html: `<p>감독 선생님이 보여주는 4자리 코드를 입력하세요.</p>
             <input id="ciCode" class="code-input" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="0000">`,
      okText: "체크인", cancelText: "취소",
      onOpen: box => setTimeout(() => $("#ciCode", box).focus(), 50),
      beforeOk: async box => {
        const code = $("#ciCode", box).value.trim();
        if (!/^\d{4}$/.test(code)) throw new Error("4자리 숫자를 입력하세요.");
        await doCheckin(g.id, dateKey(), code);
      }
    });
    if (ok) renderStudentHome(main, alive);
  });
}

async function doCheckin(gid, date, code) {
  const sid = session.profile.sid;
  try {
    await db.ref(`portal/att/records/${gid}/${sid}/${date}`).set({ status: "present", at: serverTime, by: "student", code });
    toast("체크인 완료!");
  } catch (err) {
    const existing = await readVal(`portal/att/records/${gid}/${sid}/${date}`).catch(() => null);
    if (existing) throw new Error("이미 오늘 출결이 기록되어 있습니다.");
    throw new Error("코드가 틀렸거나 만료되었습니다. 선생님께 확인하세요.");
  }
}

// QR 링크로 들어온 경우
export async function renderCheckinLink(main, { gid, date, code }, alive) {
  setTitle("체크인", "#/att");
  if (isTeacher()) { go(`#/att/g/${gid}`); return; }
  const group = await readVal(`portal/att/groups/${gid}`);
  if (!alive()) return;
  let msg, ok = false;
  if (!group) msg = "존재하지 않는 출석 그룹입니다.";
  else if (date !== dateKey()) msg = "오늘 날짜의 QR이 아닙니다.";
  else if (!group.members?.[session.profile.sid]) msg = `'${esc(group.name)}' 명단에 등록되어 있지 않습니다.`;
  else {
    try { await doCheckin(gid, date, code); ok = true; msg = `${esc(group.name)}<br>${fmtDateKey(date)} 체크인 완료`; }
    catch (err) { msg = esc(err.message); }
  }
  if (!alive()) return;
  main.innerHTML = `
    <div class="page">
      <div class="result-big ${ok ? "ok" : "fail"}">
        <div class="result-icon">${ok ? "✅" : "⚠️"}</div>
        <div>${msg}</div>
        <a class="btn primary" href="#/att">내 출결 보기</a>
      </div>
    </div>`;
}

// ---------------- 교사: 그룹 목록 ----------------
async function renderTeacherHome(main, alive) {
  const groups = await loadGroups();
  if (!alive()) return;
  let tab = "night";
  try { tab = sessionStorage.getItem("att_tab") || tab; } catch {}
  let showInactive = false;

  main.innerHTML = `
    <div class="page">
      <div class="tabs">
        ${Object.entries(ATT_TYPES).map(([k, t]) => `<button class="tab" data-type="${k}">${t.label}</button>`).join("")}
      </div>
      <div class="result-head">
        <label class="check-line small"><input type="checkbox" id="showInactive"> 종료된 그룹 보기</label>
        <button class="btn small primary" id="btnNewGroup">+ 새로 만들기</button>
      </div>
      <div id="groupList" class="card-list"></div>
    </div>`;

  const draw = () => {
    $$("[data-type]", main).forEach(b => b.classList.toggle("active", b.dataset.type === tab));
    const list = groups
      .filter(g => g.type === tab && (showInactive || g.active !== false))
      .sort((a, b) => (Number(b.year) - Number(a.year)) || a.name.localeCompare(b.name, "ko"));
    $("#groupList", main).innerHTML = list.length ? list.map(g => `
      <a class="item-card" href="#/att/g/${g.id}">
        <div class="item-top">${g.active === false ? '<span class="badge st-closed">종료</span>' : ""}<span class="item-meta">${esc(g.year)}학년도 · ${esc(scheduleText(g))}</span></div>
        <div class="item-title">${esc(g.name)}</div>
        <div class="item-meta">학생 ${Object.keys(g.members || {}).length}명 · 담당 ${esc(g.createdBy || "")}</div>
      </a>`).join("") : emptyState(`등록된 ${ATT_TYPES[tab].label} 그룹이 없습니다.`);
  };

  $$("[data-type]", main).forEach(b => b.onclick = () => {
    tab = b.dataset.type;
    try { sessionStorage.setItem("att_tab", tab); } catch {}
    draw();
  });
  $("#showInactive", main).onchange = e => { showInactive = e.target.checked; draw(); };
  $("#btnNewGroup", main).onclick = async () => {
    const id = await groupDialog({ type: tab, year: schoolYear(), days: tab === "night" ? { 1: true, 2: true, 3: true, 4: true } : {} });
    if (id) go(`#/att/g/${id}`);
  };
  draw();
}

function groupDialog(g) {
  let savedId = null;
  return modal({
    title: g.id ? "그룹 설정" : "새 출석 그룹",
    wide: true,
    html: `
      <div class="field-row">
        <label class="field"><span>구분</span>
          <select id="gType">${Object.entries(ATT_TYPES).map(([k, t]) => `<option value="${k}" ${g.type === k ? "selected" : ""}>${t.label}</option>`).join("")}</select>
        </label>
        <label class="field"><span>학년도</span><input id="gYear" type="number" value="${esc(g.year || schoolYear())}"></label>
      </div>
      <label class="field"><span>이름</span><input id="gName" value="${esc(g.name || "")}" placeholder="예: 2학년 야간자율 A실 / 방과후 수학심화"></label>
      <div class="field"><span>운영 요일</span>
        <div class="checks">${[1, 2, 3, 4, 5, 6].map(d => `<label><input type="checkbox" class="gDay" value="${d}" ${g.days?.[d] ? "checked" : ""}> ${WEEK[d]}</label>`).join("")}</div>
      </div>
      <div class="field-row">
        <label class="field"><span>시작 시각</span><input id="gStart" type="time" value="${esc(g.startTime || "")}"></label>
        <label class="field"><span>종료 시각</span><input id="gEnd" type="time" value="${esc(g.endTime || "")}"></label>
      </div>
      <label class="field"><span>장소</span><input id="gPlace" value="${esc(g.place || "")}" placeholder="예: 본관 3층 자습실"></label>
      <p class="item-meta">시작 시각 ${LATE_AFTER_MINUTES}분 이후 체크인은 자동으로 '지각' 표시됩니다.</p>`,
    okText: "저장", cancelText: "취소",
    beforeOk: async box => {
      const name = $("#gName", box).value.trim();
      if (!name) throw new Error("이름을 입력하세요.");
      const days = {};
      $$(".gDay", box).forEach(c => { if (c.checked) days[c.value] = true; });
      const data = {
        type: $("#gType", box).value,
        year: Number($("#gYear", box).value) || schoolYear(),
        name,
        days: Object.keys(days).length ? days : null,
        startTime: $("#gStart", box).value || null,
        endTime: $("#gEnd", box).value || null,
        place: $("#gPlace", box).value.trim() || null
      };
      if (g.id) {
        await db.ref(`portal/att/groups/${g.id}`).update(data);
        savedId = g.id;
      } else {
        savedId = newKey("portal/att/groups");
        await db.ref(`portal/att/groups/${savedId}`).set({ ...data, active: true, createdBy: session.profile.name, createdAt: serverTime });
      }
      toast("저장되었습니다.");
    }
  }).then(ok => (ok ? savedId : null));
}

// ---------------- 교사: 그룹 상세 ----------------
export async function renderGroup(main, { gid }, alive) {
  if (!isTeacher()) { go("#/att"); return; }
  setTitle("🕘 출석부", "#/att");
  const [groupInit, studentMap] = await Promise.all([readVal(`portal/att/groups/${gid}`), getStudentMap()]);
  if (!alive()) return;
  if (!groupInit) { main.innerHTML = emptyState("그룹을 찾을 수 없습니다."); return; }

  let group = { ...groupInit, id: gid };
  let records = {};
  let tab = "roll";
  let date = dateKey();
  const now = new Date();
  let range = { from: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: dateKey() };

  main.innerHTML = `
    <div class="page wide">
      <div class="group-head">
        <div>
          <span class="badge type-${group.type}">${esc(ATT_TYPES[group.type]?.label || "")}</span>
          <h2 class="info-title" id="gTitle"></h2>
          <div class="item-meta" id="gMeta"></div>
        </div>
      </div>
      <div class="tabs">
        <button class="tab active" data-tab="roll">출석부</button>
        <button class="tab" data-tab="stats">통계</button>
        <button class="tab" data-tab="members">명단·설정</button>
      </div>
      <div id="groupBody"></div>
    </div>`;
  const body = $("#groupBody", main);

  const drawHead = () => {
    $("#gTitle", main).textContent = group.name;
    $("#gMeta", main).textContent = `${group.year}학년도 · ${scheduleText(group)} · 학생 ${Object.keys(group.members || {}).length}명`;
  };

  const recRef = db.ref(`portal/att/records/${gid}`);
  const grpRef = db.ref(`portal/att/groups/${gid}`);

  const memberList = () => Object.keys(group.members || {}).sort(sidCompare)
    .map(sid => ({ sid, ...(studentMap[sid] || { name: "(계정 없음)" }) }));

  // ---- 출석부 ----
  const drawRoll = () => {
    const members = memberList();
    // 명단에서 빠졌지만 그날 기록이 있는 학생도 표시
    Object.keys(records).forEach(sid => {
      if (records[sid]?.[date] && !group.members?.[sid]) members.push({ sid, ...(studentMap[sid] || { name: "" }), removed: true });
    });
    const counts = { none: 0 };
    Object.keys(ATT_STATUS).forEach(k => { counts[k] = 0; });
    members.forEach(m => { counts[effectiveStatus(records[m.sid]?.[date], group, date) || "none"]++; });

    body.innerHTML = `
      <div class="roll-bar">
        <input type="date" id="rollDate" value="${date}">
        <button class="btn primary" id="btnCode">📷 체크인 코드·QR</button>
      </div>
      <div class="stat-line">
        ${Object.entries(ATT_STATUS).map(([k, s]) => `<span style="color:${s.color}">${s.label} <b>${counts[k]}</b></span>`).join("")}
        <span>미체크 <b>${counts.none}</b></span>
      </div>
      <div class="btn-row">
        <button class="btn small ghost" id="btnAllAbsent" ${counts.none ? "" : "disabled"}>미체크 → 결석 처리</button>
        <button class="btn small ghost" id="btnAllPresent" ${counts.none ? "" : "disabled"}>미체크 → 출석 처리</button>
      </div>
      <div class="roll-list">
        ${members.length ? members.map(m => {
          const rec = records[m.sid]?.[date];
          const st = effectiveStatus(rec, group, date);
          return `
            <div class="roll-row ${st ? "" : "unchecked"}">
              <div class="roll-who">
                <b>${esc(m.name)}</b> <span class="item-meta">${esc(m.sid)}${m.removed ? " (명단 제외)" : ""}</span>
                <div class="item-meta">${rec?.at ? `${rec.by === "student" ? "📱 체크인" : "✍️ 교사"} ${fmtTime(rec.at)}` : ""}${rec?.note ? ` · ${esc(rec.note)}` : ""}</div>
              </div>
              <div class="roll-status">
                ${Object.entries(ATT_STATUS).map(([k, s]) => `<button class="st-btn ${st === k ? "on" : ""}" style="--c:${s.color}" data-sid="${esc(m.sid)}" data-st="${k}">${s.short}</button>`).join("")}
                <button class="st-btn memo" data-memo="${esc(m.sid)}" title="메모">✎</button>
              </div>
            </div>`;
        }).join("") : emptyState("명단이 비어 있습니다. [명단·설정] 탭에서 학생을 추가하세요.")}
      </div>`;

    $("#rollDate", body).onchange = e => { date = e.target.value || dateKey(); drawRoll(); };
    $("#btnCode", body).onclick = () => openCodeDialog(group, date);
    $$("[data-st]", body).forEach(b => b.onclick = () => setStatus(b.dataset.sid, b.dataset.st));
    $$("[data-memo]", body).forEach(b => b.onclick = () => editMemo(b.dataset.memo));
    const bulk = async status => {
      const targets = members.filter(m => !m.removed && !records[m.sid]?.[date]);
      if (!(await confirmBox("일괄 처리", `미체크 ${targets.length}명을 '${ATT_STATUS[status].label}'(으)로 처리할까요?`))) return;
      const updates = {};
      targets.forEach(m => {
        updates[`${m.sid}/${date}`] = { status, by: "teacher", updatedBy: session.profile.name, updatedAt: serverTime };
      });
      await recRef.update(updates);
      toast("처리했습니다.");
    };
    $("#btnAllAbsent", body).onclick = () => bulk("absent");
    $("#btnAllPresent", body).onclick = () => bulk("present");
  };

  const setStatus = async (sid, status) => {
    const rec = records[sid]?.[date];
    const current = effectiveStatus(rec, group, date);
    const ref = recRef.child(`${sid}/${date}`);
    if (current === status && rec?.by === "teacher") {
      // 같은 버튼을 다시 누르면 교사 입력 취소
      await ref.remove();
      return;
    }
    await ref.update({ status, by: "teacher", updatedBy: session.profile.name, updatedAt: serverTime });
  };

  const editMemo = async sid => {
    const rec = records[sid]?.[date] || {};
    await modal({
      title: `${studentMap[sid]?.name || sid} · ${fmtDateKey(date)} 메모`,
      html: `<input id="memoText" value="${esc(rec.note || "")}" placeholder="예: 병원 진료로 조퇴">`,
      okText: "저장", cancelText: "취소",
      beforeOk: async box => {
        const note = $("#memoText", box).value.trim();
        if (!records[sid]?.[date] && !note) return;
        await recRef.child(`${sid}/${date}`).update({
          note: note || null,
          ...(rec.status ? {} : { status: "excused", by: "teacher" }),
          updatedBy: session.profile.name, updatedAt: serverTime
        });
      }
    });
  };

  // ---- 통계 ----
  const drawStats = () => {
    const members = memberList();
    const sessionDates = new Set();
    Object.values(records).forEach(byDate => Object.keys(byDate || {}).forEach(d => {
      if (d >= range.from && d <= range.to) sessionDates.add(d);
    }));
    const dates = [...sessionDates].sort();
    const rows = members.map(m => {
      const c = Object.fromEntries(Object.keys(ATT_STATUS).map(k => [k, 0]));
      let none = 0;
      dates.forEach(d => {
        const st = effectiveStatus(records[m.sid]?.[d], group, d);
        if (st) c[st]++; else none++;
      });
      const attended = c.present + c.late + c.early;
      const rate = dates.length ? Math.round(attended / dates.length * 100) : 0;
      return { ...m, c, none, rate };
    });

    body.innerHTML = `
      <div class="roll-bar">
        <input type="date" id="stFrom" value="${range.from}"> ~ <input type="date" id="stTo" value="${range.to}">
        <button class="btn small ghost" id="btnStatCsv">CSV</button>
      </div>
      <p class="item-meta">기간 내 운영일 <b>${dates.length}</b>일 (출결 기록이 1건 이상 있는 날 기준) · 출석률 = (출석+지각+조퇴) / 운영일</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>학번</th><th>이름</th>${Object.values(ATT_STATUS).map(s => `<th>${s.label}</th>`).join("")}<th>미체크</th><th>출석률</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr data-detail="${esc(r.sid)}">
              <td>${esc(r.sid)}</td><td class="left">${esc(r.name)}</td>
              ${Object.keys(ATT_STATUS).map(k => `<td class="${r.c[k] && k !== "present" ? "warn" : ""}">${r.c[k]}</td>`).join("")}
              <td>${r.none}</td><td><b>${r.rate}%</b></td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    $("#stFrom", body).onchange = e => { range.from = e.target.value; drawStats(); };
    $("#stTo", body).onchange = e => { range.to = e.target.value; drawStats(); };
    $("#btnStatCsv", body).onclick = () => {
      const header = ["학번", "이름", ...Object.values(ATT_STATUS).map(s => s.label), "미체크", "출석률", ...dates];
      const csv = [header, ...rows.map(r => [
        r.sid, r.name, ...Object.keys(ATT_STATUS).map(k => r.c[k]), r.none, r.rate + "%",
        ...dates.map(d => { const st = effectiveStatus(records[r.sid]?.[d], group, d); return st ? ATT_STATUS[st].label : ""; })
      ])];
      downloadCsv(`${group.name}_출결_${range.from}_${range.to}.csv`, csv);
    };
    $$("[data-detail]", body).forEach(tr => tr.onclick = () => {
      const sid = tr.dataset.detail;
      const list = dates.map(d => {
        const rec = records[sid]?.[d];
        return `<div class="history-row"><span>${fmtDateKey(d)}</span><span>${fmtTime(rec?.at)}</span>${statusChip(effectiveStatus(rec, group, d))}</div>${rec?.note ? `<div class="item-meta right">${esc(rec.note)}</div>` : ""}`;
      }).join("");
      modal({ title: `${studentMap[sid]?.name || sid} 출결`, html: list || "<p>기록이 없습니다.</p>" });
    });
  };

  // ---- 명단·설정 ----
  const drawMembers = async () => {
    const students = await getStudents();
    const members = memberList();
    body.innerHTML = `
      <div class="form-card">
        <div class="field"><span>반 전체 추가</span>
          <div class="roll-bar">
            <select id="addGrade"><option value="">학년</option>${gradeOptions(students).map(g => `<option>${g}</option>`).join("")}</select>
            <select id="addClass"><option value="">반</option></select>
            <button class="btn small ghost" id="btnAddClass">추가</button>
          </div>
        </div>
        <label class="field"><span>학번으로 추가 (여러 명은 띄어쓰기·쉼표·줄바꿈으로 구분)</span>
          <textarea id="addSids" rows="3" placeholder="10101 10102 10205"></textarea>
        </label>
        <div class="btn-row end"><button class="btn small primary" id="btnAddSids">명단에 추가</button></div>
      </div>

      <div class="section-head"><h3>명단 (${members.length}명)</h3></div>
      <div class="member-grid">
        ${members.map(m => `<div class="member-chip"><span>${esc(m.sid)} ${esc(m.name)}</span><button data-remove="${esc(m.sid)}" aria-label="제외">✕</button></div>`).join("") || emptyState("명단이 비어 있습니다.")}
      </div>

      <div class="section-head"><h3>그룹 설정</h3></div>
      <div class="btn-row">
        <button class="btn small ghost" id="btnEditGroup">✏️ 이름·요일·시간 수정</button>
        <button class="btn small ghost" id="btnToggleActive">${group.active === false ? "▶️ 다시 운영" : "⏹ 운영 종료"}</button>
        <button class="btn small ghost danger" id="btnDeleteGroup">🗑 삭제</button>
      </div>`;

    $("#addGrade", body).onchange = e => {
      $("#addClass", body).innerHTML = `<option value="">반</option>` + classOptions(students, e.target.value).map(c => `<option>${c}</option>`).join("");
    };
    const addMembers = async sids => {
      if (!sids.length) return toast("추가할 학생이 없습니다.");
      const updates = {};
      sids.forEach(sid => { updates[sid] = true; });
      await grpRef.child("members").update(updates);
      toast(`${sids.length}명을 추가했습니다.`);
    };
    $("#btnAddClass", body).onclick = () => {
      const g = $("#addGrade", body).value, c = $("#addClass", body).value;
      if (!g || !c) return toast("학년과 반을 선택하세요.");
      addMembers(students.filter(s => s.grade === g && s.cls === c).map(s => s.sid));
    };
    $("#btnAddSids", body).onclick = () => {
      const tokens = $("#addSids", body).value.split(/[\s,]+/).filter(Boolean);
      const unknown = tokens.filter(t => !studentMap[t]);
      if (unknown.length) toast(`계정이 없는 학번 제외: ${unknown.join(", ")}`);
      addMembers(tokens.filter(t => studentMap[t]));
    };
    $$("[data-remove]", body).forEach(b => b.onclick = async () => {
      const sid = b.dataset.remove;
      if (!(await confirmBox("명단 제외", `${sid} ${esc(studentMap[sid]?.name || "")} 학생을 명단에서 뺄까요?<br>(기존 출결 기록은 남습니다)`))) return;
      await grpRef.child(`members/${sid}`).remove();
    });
    $("#btnEditGroup", body).onclick = () => groupDialog(group);
    $("#btnToggleActive", body).onclick = async () => {
      const resume = group.active === false;
      await grpRef.child("active").set(resume);
      toast(resume ? "다시 운영합니다." : "운영을 종료했습니다.");
    };
    $("#btnDeleteGroup", body).onclick = async () => {
      if (Object.keys(records).length) {
        modal({ title: "삭제할 수 없음", html: "<p>출결 기록이 있는 그룹은 삭제할 수 없습니다.<br>대신 <b>운영 종료</b>를 사용하세요.</p>" });
        return;
      }
      if (!(await confirmBox("그룹 삭제", `'${esc(group.name)}' 그룹을 삭제할까요?`, "삭제"))) return;
      await grpRef.remove();
      go("#/att");
    };
  };

  const draw = () => {
    if (tab === "roll") drawRoll();
    else if (tab === "stats") drawStats();
    else drawMembers();
  };

  $$(".tab", main).forEach(t => t.onclick = () => {
    $$(".tab", main).forEach(x => x.classList.toggle("active", x === t));
    tab = t.dataset.tab;
    draw();
  });
  drawHead();

  // 실시간 반영: 학생이 체크인하면 출석부가 바로 갱신됩니다.
  const onRecs = recRef.on("value", s => { records = s.val() || {}; if (tab !== "members") draw(); });
  const onGrp = grpRef.on("value", s => { if (s.val()) { group = { ...s.val(), id: gid }; drawHead(); draw(); } });
  onLeave(() => { recRef.off("value", onRecs); grpRef.off("value", onGrp); });
}

// 체크인 코드 + QR (교실 화면·프로젝터에 띄우는 용도)
async function openCodeDialog(group, date) {
  const codeRef = db.ref(`portal/att/codes/${group.id}/${date}`);
  let timer = null;

  const issue = async () => {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const data = { code, expiresAt: serverNow() + CHECKIN_CODE_MINUTES * 60000, createdBy: session.profile.name };
    await codeRef.set(data);
    return data;
  };

  let current = await codeRef.once("value").then(s => s.val());
  if (!current || current.expiresAt < serverNow()) current = await issue();

  await modal({
    title: `${group.name} · ${fmtDateKey(date)}`,
    wide: true,
    okText: "닫기",
    html: `
      <div class="code-screen">
        <div id="qrBox" class="qr-box"></div>
        <div>
          <div class="item-meta">체크인 코드</div>
          <div id="bigCode" class="big-code"></div>
          <div id="codeLeft" class="item-meta"></div>
          <button class="btn small ghost" id="btnNewCode">🔄 새 코드 발급</button>
          ${date !== dateKey() ? `<p class="warn-text">⚠️ 오늘이 아닌 날짜입니다. 학생 체크인은 오늘 날짜만 가능합니다.</p>` : ""}
        </div>
      </div>`,
    onOpen: box => {
      const paint = () => {
        $("#bigCode", box).textContent = current.code;
        const qrBox = $("#qrBox", box);
        qrBox.innerHTML = "";
        if (window.QRCode) new QRCode(qrBox, { text: checkinUrl(group.id, date, current.code), width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
        else qrBox.textContent = "QR 라이브러리를 불러오지 못했습니다.";
      };
      const tick = () => {
        const left = Math.max(0, current.expiresAt - serverNow());
        const min = Math.floor(left / 60000), sec = Math.floor(left / 1000) % 60;
        $("#codeLeft", box).textContent = left ? `남은 시간 ${min}:${String(sec).padStart(2, "0")}` : "만료됨 — 새 코드를 발급하세요";
        if (!box.isConnected) clearInterval(timer);
      };
      paint(); tick();
      timer = setInterval(tick, 1000);
      $("#btnNewCode", box).onclick = async () => { current = await issue(); paint(); tick(); };
    }
  });
  clearInterval(timer);
}

// 학생 프로필(교사)용 출결 요약
export async function loadStudentAttendance(sid) {
  const groups = (await loadGroups()).filter(g => g.members?.[sid]);
  const recs = await Promise.all(groups.map(g => readVal(`portal/att/records/${g.id}/${sid}`)));
  return groups.map((g, i) => ({ group: g, records: recs[i] || {}, counts: countStatuses(recs[i], g) }));
}

export { statusChip, scheduleText };
