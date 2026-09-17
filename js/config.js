// =======================================================
// [설정] 학교·Firebase·Apps Script 정보 (이 파일만 고치면 됩니다)
// =======================================================

export const APP_NAME = "광남고 스쿨포털";

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
export const CATEGORIES = {
  bitnada: { label: "빛나다프로그램", icon: "✨", color: "#f9ab00" },
  club:    { label: "동아리",        icon: "🎨", color: "#34a853" },
  subject: { label: "교과",          icon: "📚", color: "#4285f4" },
  contest: { label: "심화탐구대회",   icon: "🔬", color: "#a142f4" }
};

// ENGLISH 메뉴의 앱 (포털 로그인으로 바로 입장 — gas/Code.gs 의 ENGLISH_APPS 와 키가 같아야 함)
export const ENGLISH_APPS = {
  voca:  { label: "Voca",  icon: "🔤", desc: "학년별 어휘 학습·퀴즈", color: "#e53935", url: "https://puroome.github.io/voca/index.html" },
  novel: { label: "Novel", icon: "📖", desc: "원서 읽기·어휘·퀴즈", color: "#1e88e5", url: "https://puroome.github.io/novel/" }
};

export const ATT_TYPES = {
  afterschool: { label: "방과후" },
  night:       { label: "야간자율" }
};

export const ATT_STATUS = {
  present: { label: "출석", short: "출", color: "#34a853" },
  late:    { label: "지각", short: "지", color: "#f9ab00" },
  early:   { label: "조퇴", short: "조", color: "#fa7b17" },
  excused: { label: "인정결", short: "인", color: "#4285f4" },
  absent:  { label: "결석", short: "결", color: "#ea4335" }
};

// 체크인 코드 유효 시간(분)
export const CHECKIN_CODE_MINUTES = 30;
// 시작 시각 이후 이 시간(분)이 지나 체크인하면 '지각'으로 표시
export const LATE_AFTER_MINUTES = 10;
