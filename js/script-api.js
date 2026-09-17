// gas/Code.gs 웹 앱 호출 (로그인 토큰을 함께 보내 서버에서 사용자를 확인)
import { auth } from "./firebase.js";
import { SCRIPT_URL } from "./config.js";

export async function callScript(action, payload) {
  if (!SCRIPT_URL.startsWith("https://")) throw new Error("config.js 에 SCRIPT_URL 이 설정되지 않았습니다.");
  const idToken = await auth.currentUser.getIdToken();
  // text/plain 으로 보내야 CORS 사전요청(preflight) 없이 Apps Script 로 전달됩니다.
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, idToken, ...payload })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
