// 학생 명부 (교사 전용: users 노드에서 학생 계정만 추림)
import { readVal } from "./firebase.js";
import { sidCompare } from "./ui.js";

let cache = null;

export async function getStudents(force = false) {
  if (cache && !force) return cache;
  const users = (await readVal("users")) || {};
  cache = Object.values(users)
    .filter(u => u.role === "student" && u.sid && u.active !== false)
    .map(u => ({ sid: String(u.sid), name: u.name || "", grade: String(u.grade ?? ""), cls: String(u.cls ?? ""), no: String(u.no ?? "") }))
    .sort((a, b) => sidCompare(a.sid, b.sid));
  return cache;
}

export async function getStudentMap() {
  const list = await getStudents();
  return Object.fromEntries(list.map(s => [s.sid, s]));
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
