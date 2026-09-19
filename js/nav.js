// 화면 제목·뒤로가기·이동 헬퍼 (각 모듈에서 공통 사용)
import { $ } from "./ui.js";

let cleanups = [];

// 화면을 떠날 때 실행할 정리 작업(실시간 구독 해제 등) 등록
export function onLeave(fn) { cleanups.push(fn); }

export function runCleanups() {
  cleanups.forEach(fn => { try { fn(); } catch {} });
  cleanups = [];
}

// 뒤로가기 화살표 개수 = 홈에서 몇 단계 들어왔는지 (< 메뉴 · << 관리 등 · <<< 제출 자료 등)
// → "화살표 수만큼 나가면 홈" 이 한눈에 보이도록 (사용자 요청)
const BACK_PATHS = {
  1: "M15 5l-7 7 7 7",
  2: "M12 5l-7 7 7 7M19 5l-7 7 7 7",
  3: "M10 5l-7 7 7 7M16 5l-7 7 7 7M22 5l-7 7 7 7"
};

// depth: 생략하면 홈으로 돌아가면 1단계, 다른 화면으로 돌아가면 2단계
export function setTitle(title, backHash = "#/home", depth = backHash === "#/home" ? 1 : 2) {
  // 메뉴 이름만 (앞의 이모지는 빼고 보여 줌 — 사용자 요청)
  $("#pageTitle").textContent = String(title).replace(/^[\p{Extended_Pictographic}\u200D\uFE0F\s]+/u, "");
  $("#pageTitle").onclick = null;
  $("#pageTitle").classList.remove("clickable");
  // 홈 버튼은 첫 화면에서만 감춥니다.
  $("#homeBtn").hidden = !backHash;
  const back = $("#backBtn");
  back.hidden = !backHash;
  back.querySelector("path")?.setAttribute("d", BACK_PATHS[Math.min(Math.max(depth, 1), 3)]);
  back.onclick = () => {
    // 앱 안에서 이동해 왔으면 브라우저 뒤로가기, 아니면 지정된 상위 화면으로
    if (history.state?.inApp) history.back();
    else location.hash = backHash;
  };
}

export function go(hash) {
  location.hash = hash;
}
