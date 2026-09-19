// =======================================================
// [설정] 학교·Firebase·Apps Script 정보 (이 파일만 고치면 됩니다)
// =======================================================

export const APP_NAME = "광남고 포털";

// record 앱과 같은 Firebase 프로젝트를 사용합니다 (성적 데이터 students/ 공유)
export const firebaseConfig = {
  apiKey: "AIzaSyDzAYguXSjmjNJFEYPplLKUj_twhOO0Llk",
  authDomain: "record-99cf0.firebaseapp.com",
  databaseURL: "https://record-99cf0-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "record-99cf0",
  storageBucket: "record-99cf0.firebasestorage.app",
  messagingSenderId: "127235673442",
  appId: "1:127235673442:web:7ebee7c66698c81b70703b"
};

// gas/Code.gs 를 웹 앱으로 배포한 URL (파일 업로드·다운로드 담당)
export const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxxgdSJ3gpBFbWpelF9dlbMrr8cZa4Ulfxtjiwdy5Vp2iriOpFBA8OcAF3S2zCc4ncC/exec";

// 로그인 ID → Firebase 인증용 이메일로 변환할 때 쓰는 가상 도메인
// ⚠️ gas/Code.gs 의 EMAIL_DOMAIN, PW_PREFIX 와 반드시 같아야 합니다.
export const EMAIL_DOMAIN = "gnhs-portal.app";
// Firebase 비밀번호 최소 길이(6자) 때문에 앞에 붙이는 고정 문자열 → 학생은 4자리 비밀번호 사용 가능
export const PW_PREFIX = "gn#";
export const MIN_PW_LENGTH = 4;

// 업로드 제한 (Apps Script 요청 크기 한계 고려)
export const MAX_FILE_MB = 10;

// 활동 자료 카테고리 (메뉴 순서대로)
// ⚠️ 키(bitnada/club/subject/contest)는 데이터에 저장되므로 바꾸지 마세요. label·desc 는 자유롭게.
export const CATEGORIES = {
  bitnada: { label: "빛나다",   icon: "✨", color: "#f9ab00", desc: "야간자율 프로그램" },
  club:    { label: "동아리",   icon: "🎨", color: "#34a853", desc: "정규 창체 활동" },
  subject: { label: "교과",     icon: "📚", color: "#4285f4", desc: "정규 교과 활동" },
  contest: { label: "심화탐구", icon: "🔬", color: "#a142f4", desc: "학기말 발표대회" }
};

// ENGLISH 메뉴의 앱 — 새 탭에서 바로 엽니다 (각 앱의 Google 로그인·승인은 앱이 알아서)
export const ENGLISH_APPS = {
  voca:  { label: "Voca",  icon: "🔤", desc: "학년별 어휘 학습·퀴즈", color: "#e53935", url: "https://puroome.github.io/voca/index.html" },
  novel: { label: "Novel", icon: "📖", desc: "원서 읽기·어휘·퀴즈", color: "#1e88e5", url: "https://puroome.github.io/novel/" }
};

export const ATT_TYPES = {
  afterschool: { label: "방과후" },
  night:       { label: "야간자율" }
};

// 교시·시간은 고정입니다. 화면에는 이름(7교시·자율1 …)만 보여 주고 시각은 지각 판정에만 씁니다.
export const ATT_PERIODS = {
  p7: { label: "7교시", start: "15:50", end: "16:40" },
  p8: { label: "8교시", start: "16:50", end: "17:40" },
  s1: { label: "자율1", start: "18:30", end: "20:00" },
  s2: { label: "자율2", start: "20:15", end: "22:00" }
};

// 구분별로 요일마다 운영할 수 있는 교시 (1=월 … 5=금)
export const ATT_DAY_PERIODS = {
  afterschool: { 1: ["p8"], 2: ["p8"], 3: ["p7", "p8"], 4: ["p7", "p8"], 5: ["p7"] },
  night:       { 1: ["s1", "s2"], 2: ["s1", "s2"], 3: ["s1", "s2"], 4: ["s1", "s2"], 5: ["p8", "s1"] }
};

export const ATT_STATUS = {
  present: { label: "출석", short: "출", color: "#34a853" },
  late:    { label: "지각", short: "지", color: "#f9ab00" },
  early:   { label: "조퇴", short: "조", color: "#fa7b17" },
  absent:  { label: "결석", short: "결", color: "#ea4335" }
};

// 야간자율은 각 학년 1반 학생만 대상입니다 (학년을 고르면 이 반 학생이 자동 등록)
export const NIGHT_CLASS = "1";

// 체크인 코드 유효 시간(분)
export const CHECKIN_CODE_MINUTES = 30;
// 첫 교시 시작 시각 이후 이 시간(분)이 지나 체크인하면 '지각'
export const LATE_AFTER_MINUTES = 15;

// 동아리 활동 시간 (고정 안내용)
export const CLUB_SCHEDULE = { day: 3, label: "매주 수요일 5교시 (13:40~14:30)" };
// 제출 시작일·마감일을 쓰는 카테고리 (빛나다·동아리는 그날 활동을 바로 기록)
export const CATEGORY_HAS_PERIOD = { contest: true, subject: true };
