// 명단 고르기 (방과후·야간자율 반, 활동 프로그램에서 함께 씁니다)
//  - 기본: 학년·반을 고르면 그 반 학생 버튼이 모두 켜진 채로 나오고, 버튼을 눌러 빼거나 넣습니다.
//  - 고정 모드(야간자율): 학년을 고르면 그 학년 1반 학생이 자동으로 들어가고, 버튼으로만 빼고 넣습니다.
import { esc, sidCompare } from "./ui.js";
import { getStudents, gradeOptions, classOptions } from "./directory.js";

export function memberPickerHtml(label = "명단", fixed = false) {
  return `
    <div class="field member-picker">
      <span>${esc(label)}</span>
      <div class="roll-bar" ${fixed ? "hidden" : ""}>
        <select class="mpGrade"><option value="">학년</option></select>
        <select class="mpClass"><option value="">반</option></select>
      </div>
      <div class="item-meta mpCount"></div>
      <div class="mpStudents member-grid"></div>
      <div class="mpChosen"></div>
    </div>`;
}

// initial: {학번: true}   opts.fixed: { grade, cls } 면 그 반만 다룹니다.
// opts.defaultOn === false 면 반을 골라도 학생 버튼이 꺼진 채로 나옵니다(동아리처럼 몇 명만 고를 때).
export async function bindMemberPicker(box, initial = {}, opts = {}) {
  const root = box.querySelector(".member-picker");
  const students = await getStudents();
  const byId = Object.fromEntries(students.map(s => [s.sid, s]));
  const selected = new Set(Object.keys(initial || {}));
  const gradeSel = root.querySelector(".mpGrade");
  const classSel = root.querySelector(".mpClass");
  const listEl = root.querySelector(".mpStudents");
  const chosenEl = root.querySelector(".mpChosen");
  const countEl = root.querySelector(".mpCount");
  let fixed = opts.fixed || null;
  const defaultOn = opts.defaultOn !== false;

  gradeSel.innerHTML = `<option value="">학년</option>` + gradeOptions(students).map(g => `<option>${g}</option>`).join("");

  const classStudents = () => {
    const g = fixed ? String(fixed.grade) : gradeSel.value;
    const c = fixed ? String(fixed.cls) : classSel.value;
    return g && c ? students.filter(s => s.grade === g && s.cls === c) : [];
  };

  // 차수: 반을 하나 고를 때마다 1차·2차·3차… (반마다 한 묶음). 이미 저장된 명단은 반 순서대로 묶습니다.
  //   위(지금 반)  : "총 48명 (2차 23명 추가)"
  //   아래(앞의 반): "1차 25명 확정" + 파란 버튼(누르면 빠짐) — 차수마다 따로
  const keyOf = sid => { const s = byId[sid]; return s ? `${s.grade}-${s.cls}` : "?"; };
  const curKey = () => fixed ? `${fixed.grade}-${fixed.cls}` : (gradeSel.value && classSel.value ? `${gradeSel.value}-${classSel.value}` : "");
  const order = [...new Set([...selected].map(keyOf))].sort(sidCompare);
  // 처음 고르는 반이면 차수에 넣고 true (다시 고른 반은 뺐던 학생을 되살리지 않도록 전체 켜기를 안 함)
  const touch = () => { const k = curKey(); if (!k || order.includes(k)) return false; order.push(k); return true; };

  const draw = () => {
    const list = classStudents();
    listEl.innerHTML = list.length
      ? list.map(s => `<button type="button" class="member-toggle ${selected.has(s.sid) ? "on" : ""}" data-sid="${esc(s.sid)}">${esc(s.no)}. ${esc(s.name)}</button>`).join("")
      : fixed ? `<span class="item-meta">그 학년 학생을 찾지 못했습니다.</span>` : "";

    // 학생이 남아 있는 묶음만 차수를 매깁니다(지금 반은 비어 있어도 번호를 줌)
    const cur = curKey();
    const inKey = {};
    [...selected].forEach(sid => { (inKey[keyOf(sid)] ||= []).push(sid); });
    const batches = order.filter(k => k === cur || inKey[k]?.length);
    const nth = k => batches.indexOf(k) + 1;
    countEl.textContent = cur
      ? `총 ${selected.size}명 (${nth(cur)}차 ${inKey[cur]?.length || 0}명 추가)`
      : `총 ${selected.size}명`;

    // 지금 보고 있는 반 밖에서 확정된 학생: 차수마다 따로, 위의 선택 버튼과 같은 파란 채움(누르면 빠짐)
    chosenEl.innerHTML = batches.filter(k => k !== cur).map(k => {
      const sids = inKey[k].slice().sort(sidCompare);
      return `<div class="item-meta" style="margin:8px 0 4px">${nth(k)}차 ${sids.length}명 확정</div>
        <div class="member-grid">${sids.map(sid => `
          <button type="button" class="member-toggle on" data-remove="${esc(sid)}" title="눌러서 빼기">${esc(sid)} ${esc(byId[sid]?.name || "")}</button>`).join("")}</div>`;
    }).join("");
  };

  const addAllOfClass = () => classStudents().forEach(s => selected.add(s.sid));

  classSel.onchange = () => { if (touch() && defaultOn) addAllOfClass(); draw(); };   // 기본은 반 전체를 넣고 시작
  gradeSel.onchange = () => {
    classSel.innerHTML = `<option value="">반</option>` + classOptions(students, gradeSel.value).map(c => `<option>${c}</option>`).join("");
    draw();
  };
  listEl.onclick = e => {
    const btn = e.target.closest("[data-sid]");
    if (!btn) return;
    const sid = btn.dataset.sid;
    if (selected.has(sid)) selected.delete(sid); else selected.add(sid);
    draw();
  };
  chosenEl.onclick = e => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    selected.delete(btn.dataset.remove);
    draw();
  };

  touch();
  draw();
  return {
    get: () => (selected.size ? Object.fromEntries([...selected].map(sid => [sid, true])) : null),
    size: () => selected.size,
    // 야간자율: 학년을 바꾸면 그 학년 반 학생으로 갈아 끼웁니다.
    setFixedClass: (grade, cls, { selectAll = true, clear = true } = {}) => {
      if (clear) classStudents().forEach(s => selected.delete(s.sid));
      fixed = { grade, cls };
      touch();
      if (selectAll) addAllOfClass();
      draw();
    }
  };
}
