// ENGLISH: voca · novel 앱으로 바로 가는 링크
// 학생들은 원래 쓰던 자기 기기로 포털에 들어오므로, 그 브라우저에 남아 있는 voca·novel 로그인으로 바로 들어갑니다.
// 처음 쓰는 학생은 앱 주소로 직접 들어갔을 때와 똑같이 Google 로그인 → 각 앱의 승인 절차를 밟습니다.
// (예전에는 Apps Script 가 1회용 로그인 토큰을 만들어 붙였는데, 1.5~4초씩 기다리게 해서 없앴습니다)
import { ENGLISH_APPS } from "./config.js";
import { esc } from "./ui.js";
import { setTitle } from "./nav.js";

export function renderEnglish(main) {
  setTitle("🌏 ENGLISH");
  main.innerHTML = `
    <div class="page">
      <div class="menu-grid">
        ${Object.values(ENGLISH_APPS).map(app => `
          <a class="menu-card" href="${esc(app.url)}" target="_blank" rel="noopener" style="--accent:${app.color}">
            <span class="menu-icon">${app.icon}</span>
            <span class="menu-label">${esc(app.label)}</span>
            <span class="menu-desc">${esc(app.desc)}</span>
          </a>`).join("")}
      </div>
    </div>`;
}
