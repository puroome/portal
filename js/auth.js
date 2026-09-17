// 로그인 / 로그아웃 / 비밀번호 변경
import { auth, db, readVal } from "./firebase.js";
import { EMAIL_DOMAIN, PW_PREFIX, MIN_PW_LENGTH } from "./config.js";
import { modal, toast, $ } from "./ui.js";

// 로그인한 사용자의 프로필 (users/{uid})
export const session = { user: null, profile: null };
export const isTeacher = () => session.profile?.role === "teacher";

export function loginIdToEmail(loginId) {
  return `${String(loginId).trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

export async function login(loginId, pw) {
  if (!/^[a-zA-Z0-9._-]+$/.test(loginId)) throw new Error("ID는 영문·숫자만 입력할 수 있습니다.");
  try {
    await auth.signInWithEmailAndPassword(loginIdToEmail(loginId), PW_PREFIX + pw);
  } catch (err) {
    const code = err.code || "";
    console.warn("로그인 실패:", code, err.message);
    if (code.includes("too-many-requests")) throw new Error("로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.");
    if (code.includes("network")) throw new Error("네트워크 연결을 확인하세요.");
    if (["auth/invalid-credential", "auth/invalid-login-credentials", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(code)) {
      throw new Error("ID 또는 비밀번호가 올바르지 않습니다.");
    }
    if (code.includes("user-disabled")) throw new Error("사용이 중지된 계정입니다. 담당 선생님께 문의하세요.");
    // 설정 문제(로그인 방법 미사용, 승인되지 않은 도메인 등)는 원인 코드를 그대로 보여줌
    throw new Error(`로그인 오류: ${code || err.message}`);
  }
}

export async function loadProfile(user) {
  const profile = await readVal(`users/${user.uid}`);
  if (!profile || profile.active === false) {
    await auth.signOut();
    throw new Error("등록되지 않았거나 사용이 중지된 계정입니다. 담당 선생님께 문의하세요.");
  }
  session.user = user;
  session.profile = { ...profile, uid: user.uid };
  return session.profile;
}

export function logout() {
  session.user = null;
  session.profile = null;
  return auth.signOut();
}

// 비밀번호 변경 (forced=true 이면 첫 로그인 강제 변경: 취소 불가)
export function changePasswordDialog(forced = false) {
  return modal({
    title: forced ? "🔐 비밀번호를 변경해주세요" : "비밀번호 변경",
    html: `
      ${forced ? `<p>처음 로그인하셨습니다. 본인만 아는 비밀번호로 바꿔주세요.</p>` : ""}
      ${forced ? "" : `<input type="password" id="pwOld" placeholder="현재 비밀번호" autocomplete="current-password">`}
      <input type="password" id="pwNew1" placeholder="새 비밀번호 (${MIN_PW_LENGTH}자 이상)" autocomplete="new-password">
      <input type="password" id="pwNew2" placeholder="새 비밀번호 확인" autocomplete="new-password">`,
    okText: "변경",
    cancelText: forced ? null : "취소",
    beforeOk: async box => {
      const p1 = $("#pwNew1", box).value, p2 = $("#pwNew2", box).value;
      if (p1.length < MIN_PW_LENGTH) throw new Error(`비밀번호는 ${MIN_PW_LENGTH}자 이상이어야 합니다.`);
      if (p1 !== p2) throw new Error("새 비밀번호가 서로 다릅니다.");
      const user = auth.currentUser;
      if (!forced) {
        const cred = firebase.auth.EmailAuthProvider.credential(user.email, PW_PREFIX + $("#pwOld", box).value);
        try { await user.reauthenticateWithCredential(cred); }
        catch { throw new Error("현재 비밀번호가 올바르지 않습니다."); }
      }
      try {
        await user.updatePassword(PW_PREFIX + p1);
      } catch (err) {
        if ((err.code || "").includes("requires-recent-login")) throw new Error("보안을 위해 다시 로그인한 뒤 변경해주세요.");
        throw err;
      }
      await db.ref(`users/${user.uid}/mustChangePw`).set(false);
      session.profile.mustChangePw = false;
      toast("비밀번호가 변경되었습니다.");
    }
  });
}
