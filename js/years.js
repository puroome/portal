// 학년도별 학번 계산 (화면·Firebase 와 떨어져 있어 테스트로 규칙을 못박습니다 — tests/years.test.mjs)
//   user.sid  = 지금 학번,  user.sids = { 학번: 학년도 }  (계정 시트의 ID 열 + 연도 열)
//   sids 가 없는 예전 계정은 지금 학번 하나로만 판단합니다.

// 그 학년도에 이 사람이 쓰던 학번 (없으면 null)
export function sidInYear(user, year) {
  if (!user) return null;
  const y = Number(year);
  if (!user.sids) return user.sid ? String(user.sid) : null;
  const hit = Object.entries(user.sids).filter(([, yy]) => Number(yy) === y).map(([sid]) => sid);
  if (!hit.length) return null;
  // 같은 해에 두 학번이 적혀 있으면(드묾) 지금 학번을 우선합니다.
  return hit.includes(String(user.sid)) ? String(user.sid) : hit[0];
}

// 지금 학번이 속한 학년도 (sids 가 없으면 fallback)
export function currentYearOf(user, fallback) {
  if (user?.sids && user.sid && user.sids[user.sid] !== undefined) return Number(user.sids[user.sid]);
  return fallback;
}

// 이 학년도가 지금 학년도인가 (새로 제출·체크인할 수 있는 해)
export function isCurrentYear(user, year, fallback) {
  return Number(year) === Number(currentYearOf(user, fallback));
}
