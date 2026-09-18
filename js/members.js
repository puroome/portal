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

  const draw = () => {
    const list = classStudents();
    listEl.innerHTML = list.length
      ? list.map(s => `<button type="button" class="member-toggle ${selected.has(s.sid) ? "on" : ""}" data-sid="${esc(s.sid)}">${esc(s.no)}. ${esc(s.name)}</button>`).join("")
      : `<span class="item-meta">${fixed ? "그 학년 학생을 찾지 못했습니다." : "학년과 반을 고르면 학생 명단이 나옵니다."}</span>`;
    countEl.textContent = `선택 ${selected.size}명${list.length ? ` / ${fixed ? `${fixed.grade}학년 ${fixed.cls}반` : "이 반"} ${list.length}명` : ""}`;

    // 지금 보고 있는 반 밖에서 선택된 학생도 확인·해제할 수 있게 따로 보여 줍니다.
    const shown = new Set(list.map(s => s.sid));
    const others = [...selected].filter(sid => !shown.has(sid)).sort(sidCompare);
    chosenEl.innerHTML = others.length
      ? `<div class="item-meta" style="margin:8px 0 4px">${fixed ? "다른 학년에서 선택됨" : "다른 반에서 선택됨"} ${others.length}명</div>
         <div class="member-grid">${others.map(sid => `
           <span class="member-chip"><span>${esc(sid)} ${esc(byId[sid]?.name || "")}</span><button type="button" data-remove="${esc(sid)}">✕</button></span>`).join("")}</div>`
      : "";
  };

  const addAllOfClass = () => classStudents().forEach(s => selected.add(s.sid));

  classSel.onchange = () => { if (defaultOn) addAllOfClass(); draw(); };   // 기본은 반 전체를 넣고 시작
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

  draw();
  return {
    get: () => (selected.size ? Object.fromEntries([...selected].map(sid => [sid, true])) : null),
    size: () => selected.size,
    // 야간자율: 학년을 바꾸면 그 학년 반 학생으로 갈아 끼웁니다.
    setFixedClass: (grade, cls, { selectAll = true, clear = true } = {}) => {
      if (clear) classStudents().forEach(s => selected.delete(s.sid));
      fixed = { grade, cls };
      if (selectAll) addAllOfClass();
      draw();
    }
  };
}
