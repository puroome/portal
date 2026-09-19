// 성적확인: record 앱의 성적 화면을 이식 (데이터: students/{학번}/scores — record 앱의 Apps Script 가 올린 것)
import { readVal } from "./firebase.js";
import { session, isTeacher } from "./auth.js";
import { $, $$, esc, modal, emptyState } from "./ui.js";
import { setTitle, go, onLeave } from "./nav.js";
import { getStudents, filterStudents, studentCard, hydratePhotos } from "./directory.js";

let scoreData = [];
let chart = null;

export async function renderGrades(main, { sid }, alive) {
  if (isTeacher()) {
    if (!sid) return renderTeacherSearch(main, alive);
    setTitle("📊 성적", "#/grades");
  } else {
    if (sid && sid !== session.profile.sid) { go("#/grades"); return; }
    sid = session.profile.sid;
    setTitle("📊 성적");
  }

  // 업데이트 시각(info/lastUpdated)은 보여 주지 않음 (사용자 요청)
  const [scores, students] = await Promise.all([
    readVal(`students/${sid}/scores`),
    isTeacher() ? getStudents() : Promise.resolve(null)
  ]);
  if (!alive()) return;
  const st = students ? students.find(s => s.sid === sid) : session.profile;
  scoreData = scores || [];

  main.innerHTML = `
    <div class="page grades">
      ${isTeacher() ? `
      <div class="grade-head">
        <div><span class="student-name">${esc(st?.name || "")}</span> <span class="student-id">${esc(sid)}</span></div>
        <a class="btn small primary" href="#/student/${encodeURIComponent(sid)}">🔗모아보기</a>
      </div>` : ""}
      <div id="gradeTabs" class="tab-header"></div>
      <div id="gradeContent"></div>
    </div>`;
  renderAccordionTree(scoreData, $("#gradeContent", main), $("#gradeTabs", main));
  onLeave(() => { if (chart) { chart.destroy(); chart = null; } });
}

async function renderTeacherSearch(main, alive) {
  setTitle("📊 성적");
  const students = await getStudents();
  if (!alive()) return;
  main.innerHTML = `
    <div class="page">
      <p class="page-desc">학번 · 이름 · 학년-반 형식으로 검색하세요.</p>
      <input id="gSearch" type="search" class="search-input" placeholder="예: 3129, 홍길동, 3-1" autocomplete="off">
      <div id="gResults" class="student-results"></div>
    </div>`;
  const draw = q => {
    const list = q.trim() ? filterStudents(students, q).slice(0, 100) : [];
    const box = $("#gResults", main);
    box.innerHTML = q.trim()
      ? (list.length ? list.map(s => studentCard(s, `#/grades/${encodeURIComponent(s.sid)}`)).join("") : emptyState("일치하는 학생이 없습니다."))
      : "";
    hydratePhotos(box);
  };
  const input = $("#gSearch", main);
  input.oninput = e => draw(e.target.value);
  input.onkeydown = e => {
    if (e.key !== "Enter") return;
    const list = filterStudents(students, input.value);
    if (list.length === 1) go(`#/grades/${encodeURIComponent(list[0].sid)}`);
  };
  input.focus();
}

// ---------------- 이하 record 앱 렌더링 로직 ----------------
function renderAccordionTree(data, contentContainer, tabTargetDiv) {
  if (!data || data.length === 0) {
    contentContainer.innerHTML = emptyState("등록된 성적 데이터가 없습니다.");
    return;
  }

  data.forEach((gradeNode, index) => {
    const tabBtn = document.createElement("button");
    tabBtn.className = "tab-btn" + (index === 0 ? " active" : "");
    tabBtn.textContent = gradeNode.name;
    tabBtn.onclick = () => {
      $$(".tab-btn", tabTargetDiv).forEach(b => b.classList.remove("active"));
      tabBtn.classList.add("active");
      $$(".tab-content", contentContainer).forEach(c => c.classList.remove("active"));
      $("#grade-content-" + index, contentContainer).classList.add("active");
    };
    tabTargetDiv.appendChild(tabBtn);

    const gradeContentDiv = document.createElement("div");
    gradeContentDiv.id = "grade-content-" + index;
    gradeContentDiv.className = "tab-content" + (index === 0 ? " active" : "");

    (gradeNode.semesters || []).forEach(semNode => {
      const semWrapper = document.createElement("div");
      semWrapper.className = "semester-wrapper";

      let cleanSemName = semNode.name.replace("[학기]", "").replace("학기", "").trim();
      if (cleanSemName === "1" || cleanSemName === "2") cleanSemName += "학기";
      else if (cleanSemName.indexOf("모의") > -1) cleanSemName = "모의고사";
      else cleanSemName = semNode.name.replace("[학기]", "").trim();

      const semBtn = document.createElement("button");
      semBtn.className = "semester-btn";
      semBtn.innerHTML = `<span>${esc(cleanSemName)}</span><span class="semester-arrow"></span>`;
      const semPanel = document.createElement("div");
      semPanel.className = "semester-panel";
      semBtn.onclick = () => { semBtn.classList.toggle("active"); semPanel.classList.toggle("open"); };

      if (semNode.subjects) {
        semNode.subjects.forEach(subNode => {
          let gradeText = "";
          const totalCat = (subNode.items || []).find(c => c.category === "종합");
          const gradeItem = totalCat?.items.find(i => i.item === "등급");
          if (gradeItem && gradeItem.score) gradeText = gradeItem.score;

          let leftHtml = `<div class="accordion-header-group"><span class="subject-name">${esc(subNode.name)}</span>`;
          if (gradeText) leftHtml += `<span class="grade-badge">${esc(gradeText)}등급</span>`;
          const normSubject = normalizeInternalSubjectName(subNode.name);
          if (normSubject && hasInternalHistory(normSubject)) {
            leftHtml += `<span class="trend-badge" data-internal="${normSubject}">${trendSvg}</span>`;
          }
          leftHtml += "</div>";

          const subBtn = document.createElement("button");
          subBtn.className = "accordion-btn";
          subBtn.innerHTML = leftHtml + '<span class="arrow"></span>';
          const subPanel = document.createElement("div");
          subPanel.className = "panel";
          subBtn.onclick = e => {
            const trend = e.target.closest("[data-internal]");
            if (trend) { showInternalTrendGraph(trend.dataset.internal); return; }
            subBtn.classList.toggle("active");
            subPanel.style.maxHeight = subPanel.style.maxHeight ? null : subPanel.scrollHeight + "px";
          };

          const tableWrap = document.createElement("div");
          tableWrap.className = "panel-content";
          tableWrap.innerHTML = getTableHTML(subNode.items || []);
          $$("[data-mock]", tableWrap).forEach(b => b.onclick = () => showTrendGraph(b.dataset.mock));
          subPanel.appendChild(tableWrap);

          semPanel.appendChild(subBtn);
          semPanel.appendChild(subPanel);
        });
      } else {
        semPanel.innerHTML = '<div class="item-meta" style="padding:15px">과목 없음</div>';
      }

      semWrapper.appendChild(semBtn);
      semWrapper.appendChild(semPanel);
      gradeContentDiv.appendChild(semWrapper);
    });
    contentContainer.appendChild(gradeContentDiv);
  });
}

const trendSvg = '<svg class="trend-svg" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>';

function normalizeSubjectName(name) {
  if (!name) return "";
  const n = name.replace(/\s/g, "");
  if (n.includes("화법과작문") || n.includes("언어와매체") || n.includes("국어")) return "국어";
  if (n.includes("확률과통계") || n.includes("미적분") || n.includes("기하") || n.includes("수학")) return "수학";
  if (n.includes("영어")) return "영어";
  return name;
}

function normalizeInternalSubjectName(name) {
  if (!name) return null;
  const n = name.replace(/\s/g, "");
  if (["공통국어1", "공통국어2", "문학", "독서", "화법과언어", "국어", "화법과작문"].includes(n) || n.indexOf("공통국어") > -1) return "국어";
  if (["공통수학1", "공통수학2", "대수", "미적분Ⅰ", "미적분I", "확률과통계", "수학", "수학Ⅰ", "수학I", "수학Ⅱ", "수학II", "미적분"].includes(n) || n.indexOf("공통수학") > -1) return "수학";
  if (["공통영어1", "공통영어2", "영어Ⅰ", "영어I", "영어Ⅱ", "영어II", "영어독해와작문", "영어"].includes(n) || n.indexOf("공통영어") > -1) return "영어";
  return null;
}

function internalGrade(subNode) {
  const totalCat = (subNode.items || []).find(c => c.category === "종합");
  const gradeItem = totalCat?.items.find(i => i.item === "등급");
  return gradeItem && !isNaN(parseFloat(gradeItem.score)) ? parseFloat(gradeItem.score) : null;
}

function hasInternalHistory(target) {
  return scoreData.some(g => (g.semesters || []).some(sem => (sem.subjects || []).some(sub =>
    normalizeInternalSubjectName(sub.name) === target && internalGrade(sub) !== null)));
}

function showInternalTrendGraph(target) {
  const map = {};
  let hasCommon = false;
  scoreData.forEach(gradeNode => {
    const gradeNum = parseInt(gradeNode.name.replace(/[^0-9]/g, "")) || 0;
    (gradeNode.semesters || []).forEach(semNode => {
      const semNum = semNode.name.indexOf("1") > -1 ? 1 : (semNode.name.indexOf("2") > -1 ? 2 : 0);
      (semNode.subjects || []).forEach(sub => {
        if (sub.name.indexOf("공통") > -1) hasCommon = true;
        if (normalizeInternalSubjectName(sub.name) === target) {
          const g = internalGrade(sub);
          if (g !== null) map[gradeNum + "-" + semNum] = g;
        }
      });
    });
  });
  const slots = ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2"];
  const scores = slots.map(s => map[s] ?? null);
  if (!scores.some(s => s !== null)) return;
  openChart(`${target} (내신) 등급 추이`,
    slots.map(s => s.endsWith("-1") ? s[0] + "학년" : ""),
    slots.map(s => `${s[0]}학년 ${s[2]}학기`),
    scores, hasCommon ? 5 : 9, "#34a853");
}

function showTrendGraph(subjectName) {
  const target = normalizeSubjectName(subjectName);
  if (!["국어", "수학", "영어"].includes(target)) return;
  const trend = [];
  scoreData.forEach(gradeNode => {
    const gradeNum = parseInt(gradeNode.name.replace(/[^0-9]/g, "")) || 0;
    (gradeNode.semesters || []).forEach(semNode => {
      (semNode.subjects || []).forEach(sub => {
        const month = parseInt(sub.name.replace(/[^0-9]/g, ""));
        if (isNaN(month)) return;
        const cat = (sub.items || []).find(c => c.category === "등급");
        const item = cat?.items.find(it => normalizeSubjectName(it.item) === target);
        if (item && !isNaN(parseFloat(item.score))) trend.push({ grade: gradeNum, month, score: parseFloat(item.score), key: gradeNum * 100 + month });
      });
    });
  });
  if (!trend.length) return;
  trend.sort((a, b) => a.key - b.key);
  let last = -1;
  openChart(`${target} (모의고사) 등급 추이`,
    trend.map(d => (d.grade !== last ? (last = d.grade, d.grade + "학년") : "")),
    trend.map(d => `${d.grade}학년 ${d.month}월`),
    trend.map(d => d.score), 9, "#4285f4");
}

function openChart(title, labels, fullLabels, data, yMax, color) {
  if (!window.Chart) return;
  modal({
    title,
    wide: true,
    okText: null,
    closeX: true,        // 닫기 줄 대신 모서리 ✕
    dismissible: true,   // 바깥을 누르면 닫힘
    className: "chart-modal",
    html: '<div style="position:relative;height:300px;width:100%"><canvas id="trendChart"></canvas></div>',
    onOpen: box => {
      if (chart) chart.destroy();
      chart = new Chart($("#trendChart", box).getContext("2d"), {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "등급", data, borderColor: color, backgroundColor: color + "4d", borderWidth: 2,
            pointBackgroundColor: "#fff", pointBorderColor: color, pointRadius: 5, fill: true, tension: 0.2, spanGaps: true
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          layout: { padding: { top: 10, right: 10 } },
          scales: {
            y: { min: 0.5, max: yMax, reverse: true, ticks: { stepSize: 1, callback: v => (v < 1 ? "" : Math.floor(v)) } },
            x: { grid: { display: false }, ticks: { autoSkip: false } }
          },
          plugins: {
            legend: { display: false },
            tooltip: { displayColors: false, callbacks: { title: ctx => fullLabels[ctx[0].dataIndex], label: ctx => ctx.parsed.y + "등급" } }
          }
        }
      });
    }
  });
}

function getTableHTML(categoryList) {
  const isMockExam = categoryList.some(c => c.category === "등급");
  let html = "<table><tbody>";
  if (!categoryList.length) return html + '<tr><td colspan="2">결과 없음</td></tr></tbody></table>';

  categoryList.forEach(({ category, items }) => {
    let categoryScore = "";
    const displayItems = [];
    (items || []).forEach(it => {
      if (category === "종합" && it.item === "등급") return;
      if (String(it.item).replace(/\s/g, "") === "합계") categoryScore = it.score;
      else displayItems.push(it);
    });
    if (!displayItems.length && categoryScore === "") return;

    if (!isMockExam) {
      let bg = "bg-default";
      if (category.indexOf("고사") > -1 || category.indexOf("시험") > -1) bg = "bg-exam";
      else if (category.indexOf("수행") > -1) bg = "bg-perform";
      html += `<tr class="category-row ${bg}"><td>${esc(category)}</td><td>${esc(categoryScore)}</td></tr>`;
    }

    displayItems.forEach(({ item, score }) => {
      const isTarget = ["국어", "수학", "영어"].includes(normalizeSubjectName(item));
      const icon = isMockExam && isTarget ? `<span class="trend-badge" data-mock="${esc(item)}">${trendSvg}</span>` : "";
      const dim = String(item).indexOf("객관식") > -1 || String(item).indexOf("주관식") > -1 ? ' class="dim"' : "";
      if (isMockExam) {
        html += `<tr class="item-row"><td colspan="2"><div class="mock-line"><b>${esc(item)}</b><span class="grade-badge">${esc(score)}등급</span>${icon}</div></td></tr>`;
      } else {
        html += `<tr class="item-row"><td><span>${esc(item)}</span>${icon}</td><td${dim}>${esc(score)}</td></tr>`;
      }
    });
  });
  return html + "</tbody></table>";
}
