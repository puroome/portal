// 학생 명부 (교사 전용: users 노드에서 학생 계정을 추림)
// 학번은 해마다 다른 학생에게 다시 쓰입니다. 그래서 지난 학년도 자료를 볼 때는 "그 해의 학번"으로 찾습니다.
//   users/{uid}/sids = { 학번: 학년도 }  ← 계정 시트의 ID 열 + "2025년" 같은 연도 열
import { readVal } from "./firebase.js";
import { sidCompare, schoolYear, esc } from "./ui.js";
import { sidInYear } from "./years.js";
import { PHOTO_BASE } from "./config.js";

let usersCache = null;

async function loadUsers(force = false) {
  if (usersCache && !force) return usersCache;
  usersCache = Object.entries((await readVal("users")) || {})
    .map(([uid, u]) => ({ ...u, uid }))
    .filter(u => u.role === "student");
  return usersCache;
}

// 학번에서 학년·반·번호 추정 (지난 학년도 학번은 시트에 반·번호가 없으므로)
export function parseSid(sid) {
  const s = String(sid || "");
  if (/^\d{5}$/.test(s)) return { grade: s[0], cls: String(Number(s.slice(1, 3))), no: String(Number(s.slice(3))) };
  if (/^\d{4}$/.test(s)) return { grade: s[0], cls: s[1], no: String(Number(s.slice(2))) };
  return { grade: "", cls: "", no: "" };
}

const toEntry = u => ({ uid: u.uid, sid: String(u.sid), name: u.name || "", grade: String(u.grade ?? ""), cls: String(u.cls ?? ""), no: String(u.no ?? ""), sids: u.sids || null, phone: String(u.phone || "") });

// 지금 재학 중인 학생 (지금 학번 기준)
export async function getStudents(force = false) {
  const users = await loadUsers(force);
  return users
    .filter(u => u.sid && u.active !== false)
    .map(toEntry)
    .sort((a, b) => sidCompare(a.sid, b.sid));
}

// 졸업생 (users/{uid}/graduated = 졸업연도). record 앱에서 옮겨 온 졸업생도 포함.
export async function getGraduates() {
  return (await loadUsers()).filter(u => u.graduated);
}

// { 학번: 학생 } — year 를 주면 그 학년도에 그 학번을 쓴 학생(졸업생 포함)으로 찾습니다.
export async function getStudentMap(year) {
  const users = await loadUsers();
  const map = {};
  users.forEach(u => {
    const nowSid = u.sid ? String(u.sid) : null;
    if (!year) {
      if (nowSid && u.active !== false) map[nowSid] = toEntry(u);
      return;
    }
    const sid = sidInYear(u, year);
    if (!sid) return;
    // 지금 학번이면 시트의 학년·반·번호를, 지난 학번이면 학번에서 추정한 값을 씁니다.
    const detail = sid === nowSid && (!u.sids || Number(u.sids[sid]) === Number(year))
      ? { grade: String(u.grade ?? ""), cls: String(u.cls ?? ""), no: String(u.no ?? "") }
      : parseSid(sid);
    map[sid] = { uid: u.uid, sid, name: u.name || "", ...detail, nowSid, graduated: u.graduated || null, sids: u.sids || null };
  });
  return map;
}

// 지금 학번으로 학생의 연도별 학번 전체를 얻습니다. { 학번: 학년도 }
export async function getStudentSids(nowSid) {
  const users = await loadUsers();
  const u = users.find(x => String(x.sid) === String(nowSid));
  if (!u) return { [nowSid]: schoolYear() };
  return u.sids || { [nowSid]: schoolYear() };
}

// 학번(일부)·이름(일부)·"2-3"(반) 형태로 검색
export function filterStudents(list, q) {
  q = String(q || "").trim();
  if (!q) return list;
  const cls = q.match(/^(\d+)\s*[-학년\s]\s*(\d+)\s*반?$/);
  if (cls) return list.filter(s => s.grade === cls[1] && s.cls === cls[2]);
  return list.filter(s => s.sid.includes(q) || s.name.includes(q));
}

export function gradeOptions(list) {
  return [...new Set(list.map(s => s.grade))].filter(Boolean).sort(sidCompare);
}

export function classOptions(list, grade) {
  return [...new Set(list.filter(s => !grade || s.grade === grade).map(s => s.cls))].filter(Boolean).sort(sidCompare);
}

// ---------------- 학생 사진 카드 (학생별 모아보기·성적확인 검색 결과 공용) ----------------
// 사진은 포털의 images/{학번}.jpg (DB 를 읽지 않음 — 이름 규칙으로 바로 만듦). 파일이 없으면 👤
const studentPhoto = sid => Promise.resolve(sid ? `${PHOTO_BASE}${encodeURIComponent(sid)}.jpg` : "");

// 사진 + 그 아래 "이름 (학번)". 사진은 그린 뒤 hydratePhotos 로 채웁니다.
export function studentCard(s, href) {
  return `
    <a class="student-card" href="${href}">
      <span class="sc-photo" data-photo-sid="${esc(s.sid)}"><span class="sc-none" aria-hidden="true">👤</span></span>
      <span class="sc-name">${esc(s.name)} <small>(${esc(s.sid)})</small></span>
    </a>`;
}

export function hydratePhotos(container) {
  // data-photo-url 이 있으면 그 주소(졸업생), 없으면 images/{학번}.jpg
  container.querySelectorAll("[data-photo-sid], [data-photo-url]").forEach(async box => {
    const url = box.dataset.photoUrl ?? await studentPhoto(box.dataset.photoSid);
    if (!url || !box.isConnected) return;
    // 칸 안에 투명하게 겹쳐 붙여야 lazy 로딩이 동작합니다(숨겨 둔 lazy 이미지는 브라우저가 불러오지 않음).
    // 다 불러오면 보이게 하고 👤 를 치우며, 실패하면 이미지를 빼서 👤 를 남깁니다.
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.onload = () => { img.classList.add("on"); box.querySelector(".sc-none")?.remove(); };
    img.onerror = () => img.remove();
    box.appendChild(img);
    img.src = url;
  });
}
