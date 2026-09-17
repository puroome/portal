// ENGLISH: voca · novel 앱으로 통합 로그인해서 들어가기
// 포털 Apps Script 가 그 앱 프로젝트용 1회용 로그인 토큰(5분)을 만들어 주면,
// 새 탭에서 앱주소#sso=토큰 으로 열고 앱이 그 토큰으로 로그인합니다.
import { ENGLISH_APPS } from "./config.js";
import { session } from "./auth.js";
import { $$, esc, alertBox } from "./ui.js";
import { setTitle } from "./nav.js";
import { callScript } from "./script-api.js";

export function renderEnglish(main) {
  setTitle("🌏 ENGLISH");
  const hasGoogle = !!session.profile.googleEmail;

  main.innerHTML = `
    <div class="page">
      <p class="page-desc">
        ${hasGoogle
          ? `스쿨포털 계정으로 바로 들어갑니다. (연결된 학교 계정: ${esc(session.profile.googleEmail)})`
          : "⚠️ 학교 Google 계정이 연결되어 있지 않아 들어갈 수 없습니다. 담당 선생님께 등록을 요청하세요."}
      </p>
      <div class="menu-grid">
        ${Object.entries(ENGLISH_APPS).map(([key, app]) => `
          <button class="menu-card" data-app="${key}" style="--accent:${app.color}" ${hasGoogle ? "" : "disabled"}>
            <span class="menu-icon">${app.icon}</span>
            <span class="menu-label">${esc(app.label)}</span>
            <span class="menu-desc">${esc(app.desc)}</span>
          </button>`).join("")}
      </div>
    </div>`;

  $$("[data-app]", main).forEach(btn => btn.onclick = () => openApp(btn.dataset.app, btn));
}

async function openApp(key, btn) {
  const app = ENGLISH_APPS[key];
  // 토큰을 기다린 뒤에 창을 열면 팝업 차단에 걸리므로 먼저 빈 탭을 엽니다.
  const win = window.open("", "_blank");
  if (win) win.document.write(`<p style="font-family:sans-serif;padding:24px">${esc(app.label)} 여는 중...</p>`);
  btn.disabled = true;
  try {
    const { token } = await callScript("englishToken", { app: key });
    const url = `${app.url}#sso=${encodeURIComponent(token)}`;
    if (win) win.location.href = url;
    else location.href = url;
  } catch (err) {
    if (win) win.close();
    alertBox(`${app.label} 열기 실패`, esc(err.message));
  } finally {
    btn.disabled = false;
  }
}

