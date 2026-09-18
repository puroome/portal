// 화면 제목·뒤로가기·이동 헬퍼 (각 모듈에서 공통 사용)
import { $ } from "./ui.js";

let cleanups = [];

// 화면을 떠날 때 실행할 정리 작업(실시간 구독 해제 등) 등록
export function onLeave(fn) { cleanups.push(fn); }

export function runCleanups() {
  cleanups.forEach(fn => { try { fn(); } catch {} });
  cleanups = [];
}

export function setTitle(title, backHash = "#/home") {
  $("#pageTitle").textContent = title;
  // 홈 버튼은 첫 화면에서만 감춥니다.
  $("#homeBtn").hidden = !backHash;
  const back = $("#backBtn");
  back.hidden = !backHash;
  back.onclick = () => {
    // 앱 안에서 이동해 왔으면 브라우저 뒤로가기, 아니면 지정된 상위 화면으로
    if (history.state?.inApp) history.back();
    else location.hash = backHash;
  };
}

export function go(hash) {
  location.hash = hash;
}
