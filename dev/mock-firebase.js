// 테스트용 가짜 Firebase compat (메모리 DB) — dev/mock-server.mjs 가 index.html 에 끼워 넣습니다. 실제 배포에는 쓰이지 않습니다.
(function () {
  const now = Date.now();
  const scores = [
    { name: "1학년", semesters: [
      { name: "1학기", subjects: [
        { name: "공통국어1", items: [ { category: "지필고사", items: [{ item: "중간", score: "88" }, { item: "합계", score: "85" }] }, { category: "종합", items: [{ item: "등급", score: "2" }] } ] },
        { name: "공통수학1", items: [ { category: "수행평가", items: [{ item: "과제", score: "18" }] }, { category: "종합", items: [{ item: "등급", score: "3" }] } ] } ] },
      { name: "2학기", subjects: [
        { name: "공통국어2", items: [ { category: "종합", items: [{ item: "등급", score: "1" }] } ] } ] },
      { name: "모의고사", subjects: [
        { name: "3월", items: [ { category: "등급", items: [{ item: "국어", score: "2" }, { item: "수학", score: "3" }, { item: "영어", score: "1" }] } ] },
        { name: "6월", items: [ { category: "등급", items: [{ item: "국어", score: "1" }, { item: "수학", score: "2" }, { item: "영어", score: "1" }] } ] } ] } ] }
  ];
  const pad = n => String(n).padStart(2, "0");
  const dk = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const yest = new Date(Date.now() - 86400000);
  const dd = n => dk(new Date(now + n * 86400000));   // 오늘 + n일
  let data = {
    info: { lastUpdated: "2026-09-10" },
    users: {
      uT1: { role: "teacher", loginId: "t1", name: "김교사", active: true },
      uT2: { role: "teacher", loginId: "t2", name: "박교사", active: true },
      uS1: { role: "student", loginId: "10101", sid: "10101", name: "홍길동", grade: "1", cls: "1", no: "1", active: true, mustChangePw: false, phone: "01012345678" },
      uS2: { role: "student", loginId: "10102", sid: "10102", name: "김철수", grade: "1", cls: "1", no: "2", active: true },
      uS3: { role: "student", loginId: "20301", sid: "20301", name: "이영희", grade: "2", cls: "3", no: "1", active: true },
      uS4: { role: "student", loginId: "20101", sid: "20101", name: "박민수", grade: "2", cls: "1", no: "1", active: true, sids: { "10103": 2025, "20101": 2026 } },
      uS7: { role: "student", loginId: "10103", sid: "10103", name: "새내기", grade: "1", cls: "1", no: "3", active: true, sids: { "10103": 2026 } },
      uG1: { role: "student", loginId: null, sid: null, name: "졸업한선배", active: false, graduated: 2026, sids: { "30101": 2025 } },
      rec2026_3102: { role: "student", name: "옛졸업생", grade: "3", cls: "1", no: "2", active: false, graduated: 2026, sids: { "3102": 2025 }, phone: "01099998888", photo: "https://puroome.github.io/record/images/old/2026_3102.jpg", importedFrom: "record" },
      rec2025_3101: { role: "student", name: "재작년졸업", grade: "3", cls: "1", no: "1", active: false, graduated: 2025, sids: { "3101": 2024 }, photo: "https://puroome.github.io/record/images/old/2025_3101.jpg", importedFrom: "record" },
      uS5: { role: "student", loginId: "20102", sid: "20102", name: "최지우", grade: "2", cls: "1", no: "2", active: true },
      uS6: { role: "student", loginId: "30101", sid: "30101", name: "정다은", grade: "3", cls: "1", no: "1", active: true }
    },
    students: { "10101": { name: "홍길동", scores }, "10102": { name: "김철수" } },
    portal: {
      alumniNotes: {
        rec2026_3102: {
          m1: { text: "○○대 간호학과 진학", createdBy: "박교사", createdByUid: "uT2", createdAt: now - 2e9 },
          m2: { text: "3학년 반장, 간호사 희망", kind: "school", createdBy: "김교사", createdByUid: "uT1", createdAt: now - 3e10 },
          m3: { text: "꼬리표 없는 예전 메모 (2025년 기록 → 재학 중)", createdBy: "박교사", createdByUid: "uT2", createdAt: new Date(2025, 9, 1).getTime() }
        },
        uS1: { m1: { text: "수학 동아리 회장, 진로 상담 필요", createdBy: "박교사", createdByUid: "uT2", createdAt: now - 5e8 } }
      },
      // 🪧 공지: 오늘 기준 날짜 (dd(n) = 오늘+n일)
      notices: {
        n1: { title: "2학기 방과후 수강 신청 안내", content: "9월 25일까지 담임 선생님께 신청서를 내 주세요.\n자세한 안내: https://example.com/afterschool", startDate: dd(-3), endDate: dd(6), createdBy: "김교사", createdByUid: "uT1", createdAt: now - 3e8 },
        n2: { title: "내일 체육복 등교", content: "체육한마당 연습이 있습니다.", startDate: dd(0), endDate: dd(1), createdBy: "박교사", createdByUid: "uT2", createdAt: now - 1e8 },
        n3: { title: "중간고사 시험 범위 공지", content: "", startDate: dd(5), endDate: dd(12), createdBy: "김교사", createdByUid: "uT1", createdAt: now - 5e7 },
        n4: { title: "1학기 도서 반납", content: "지난 공지", startDate: dd(-40), endDate: dd(-30), createdBy: "박교사", createdByUid: "uT2", createdAt: now - 9e9 }
      },
      programs: {
        p1: { category: "club", year: 2026, title: "로봇공학 동아리 (김교사·비공개)", description: "그날 활동을 적어 주세요.", allowFiles: true, closed: false, private: true, members: { "10101": true, "10102": true }, createdBy: "김교사", createdByUid: "uT1", createdAt: now - 5e8 },
        p2: { category: "bitnada", year: 2026, title: "빛나다 진로탐색 (박교사·공통)", allowFiles: true, private: false, days: { 5: true }, members: { "10101": true, "10102": true }, createdBy: "박교사", createdByUid: "uT2", createdAt: now - 4e8 },
        p25: { category: "bitnada", year: 2025, title: "작년 빛나다 (2025)", allowFiles: true, members: { "10103": true, "30101": true }, createdBy: "김교사", createdByUid: "uT1", createdAt: now - 3e10 },
        p3: { category: "contest", year: 2026, title: "심화탐구대회 (김교사)", allowFiles: true, private: false, startDate: "2026-09-01", endDate: "2026-09-30", members: { "10101": true }, createdBy: "김교사", createdByUid: "uT1", createdAt: now - 3e8 }
      },
      submissions: {
        p1: { "10102": { s1: { programId: "p1", category: "club", year: 2026, sid: "10102", name: "김철수", grade: "1", cls: "1", no: "2", title: "라인트레이서", content: "PID 제어", createdAt: now - 3e8, updatedAt: now - 3e8 } } },
        p25: {
          "10103": { old1: { programId: "p25", category: "bitnada", year: 2025, sid: "10103", name: "박민수", grade: "1", cls: "1", no: "3", title: "1학년 때 진로 탐색", content: "작년 기록", createdAt: now - 3e10, updatedAt: now - 3e10 } },
          "30101": { old2: { programId: "p25", category: "bitnada", year: 2025, sid: "30101", name: "졸업한선배", grade: "3", cls: "1", no: "1", title: "3학년 때 활동", content: "졸업생 기록", createdAt: now - 3e10, updatedAt: now - 3e10 } }
        },
        p2: { "10102": { s2: { programId: "p2", category: "bitnada", year: 2026, sid: "10102", name: "김철수", grade: "1", cls: "1", no: "2", title: "진로 탐색", content: "공통 자료", createdAt: now - 1e8, updatedAt: now - 1e8 } } }
      },
      att: {
        groups: {
          g25: { type: "night", year: 2025, name: "1학년 자율1", grade: "1", period: "s1", slots: { 1: { s1: true }, 2: { s1: true }, 3: { s1: true }, 4: { s1: true }, 5: { s1: true } }, members: { "10103": true }, active: false, createdBy: "김교사", createdByUid: "uT1" },
          g1: { type: "night", year: 2026, name: "1학년 자율1", grade: "1", period: "s1", slots: { 1: { s1: true }, 2: { s1: true }, 3: { s1: true }, 4: { s1: true }, 5: { s1: true } }, place: "본관 3층", members: { "10101": true, "10102": true }, active: true, createdBy: "김교사", createdByUid: "uT1" },
          g4: { type: "night", year: 2026, name: "2학년 자율2", grade: "2", period: "s2", slots: { 1: { s2: true }, 2: { s2: true }, 3: { s2: true }, 4: { s2: true } }, members: { "20301": true }, active: true, createdBy: "박교사", createdByUid: "uT2" },
          g5: { type: "night", year: 2026, name: "1학년 8교시", grade: "1", period: "p8", slots: { 5: { p8: true } }, members: { "10101": true }, active: true, createdBy: "박교사", createdByUid: "uT2" },
          g2: { type: "afterschool", year: 2026, name: "수학심화 (김교사)", slots: { 3: { p7: true, p8: true } }, members: { "10101": true }, active: true, createdBy: "김교사", createdByUid: "uT1" },
          g3: { type: "afterschool", year: 2026, name: "영어독해 (박교사)", slots: { 1: { p8: true } }, members: { "10102": true }, active: true, createdBy: "박교사", createdByUid: "uT2" }
        },
        sessions: {
          g1: { [dk(yest)]: { uid: "uT1", name: "김교사" }, [dk(new Date())]: { uid: "uT2", name: "박교사" } },
          g5: { [dk(new Date())]: { uid: "uT1", name: "김교사" } },
          g25: { "2025-11-03": { uid: "uT1", name: "김교사" }, "2025-11-04": { uid: "uT1", name: "김교사" } }
        },
        records: {
          g1: {
            "10102": { [dk(yest)]: { status: "present", at: yest.getTime(), by: "student", code: "1234" }, [dk(new Date())]: { status: "late", by: "teacher", note: "버스 지연" } },
            "10101": { [dk(yest)]: { status: "early", by: "teacher", note: "병원" } }
          },
          g5: { "10101": { [dk(new Date())]: { status: "present", by: "teacher" } } },
          g25: { "10103": { "2025-11-03": { status: "late", by: "teacher", note: "작년 지각" } } }
        }
      }
    }
  };
  const PASS = { "20101@gnhs-portal.app": "gn#1234", "10103@gnhs-portal.app": "gn#1234", "t1@gnhs-portal.app": "gn#1234", "t2@gnhs-portal.app": "gn#1234", "10101@gnhs-portal.app": "gn#1234", "10102@gnhs-portal.app": "gn#1234" };
  const UID = { "20101@gnhs-portal.app": "uS4", "10103@gnhs-portal.app": "uS7", "t1@gnhs-portal.app": "uT1", "t2@gnhs-portal.app": "uT2", "10101@gnhs-portal.app": "uS1", "10102@gnhs-portal.app": "uS2" };
  window.__mockData = () => data;

  const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const parts = p => String(p).split("/").filter(Boolean);
  const getAt = p => parts(p).reduce((o, k) => (o == null ? null : o[k]), data) ?? null;
  const resolve = v => {
    if (v && v[".sv"]) return Date.now();
    if (v && typeof v === "object") {
      const o = Array.isArray(v) ? [] : {};
      for (const k in v) { const r = resolve(v[k]); if (r !== null && r !== undefined) o[k] = r; }
      return Object.keys(o).length ? o : null;
    }
    return v;
  };
  const setAt = (p, v) => {
    const ks = parts(p); v = resolve(clone(v));
    let o = data;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== "object") o[ks[i]] = {}; o = o[ks[i]]; }
    if (v === null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v;
  };
  const listeners = [];
  const notify = () => setTimeout(() => listeners.forEach(l => l.cb(snap(l.path, getAt(l.path)))), 0);
  function snap(path, val, key) {
    val = clone(val);
    return {
      key: key ?? parts(path).pop() ?? null, val: () => val, exists: () => val !== null,
      forEach: fn => { Object.entries(val || {}).forEach(([k, v]) => fn(snap(path + "/" + k, v, k))); }
    };
  }
  let keyN = 0;
  function ref(path = "") {
    path = parts(path).join("/");
    return {
      key: parts(path).pop() || null,
      child: c => ref(path + "/" + c),
      push: () => ref(path + "/k" + Date.now().toString(36) + (keyN++)),
      once: async () => { await new Promise(r => setTimeout(r, 30)); return snap(path, path === ".info/serverTimeOffset" ? 0 : getAt(path)); },
      on: (ev, cb) => {
        if (path === ".info/serverTimeOffset") { cb(snap(path, 0)); return cb; }
        listeners.push({ path, cb }); setTimeout(() => cb(snap(path, getAt(path))), 20); return cb;
      },
      off: (ev, cb) => { const i = listeners.findIndex(l => l.cb === cb); if (i >= 0) listeners.splice(i, 1); },
      set: async v => { setAt(path, v); notify(); },
      update: async obj => { Object.entries(obj).forEach(([k, v]) => setAt(path + "/" + k, v)); notify(); },
      remove: async () => { setAt(path, null); notify(); },
      orderByChild: ch => ({ equalTo: val => ({ once: async () => {
        const f = {};
        Object.entries(getAt(path) || {}).forEach(([k, v]) => { if (v && v[ch] === val) f[k] = v; });
        return snap(path, f);
      } }) })
    };
  }
  const authCb = [];
  let current = null;
  function mkUser(email) {
    return {
      uid: UID[email], email, getIdToken: async () => "tok",
      updatePassword: async p => { PASS[email] = p; },
      reauthenticateWithCredential: async c => { if (PASS[email] !== c.p) throw { code: "auth/wrong-password" }; }
    };
  }
  try { const s = sessionStorage.getItem("mockUser"); if (s) current = mkUser(s); } catch {}
  const authObj = {
    get currentUser() { return current; },
    onAuthStateChanged: cb => { authCb.push(cb); setTimeout(() => cb(current), 10); },
    signInWithEmailAndPassword: async (e, p) => {
      if (PASS[e] !== p) throw { code: "auth/wrong-password" };
      current = mkUser(e); sessionStorage.setItem("mockUser", e); authCb.forEach(cb => cb(current));
    },
    signOut: async () => { current = null; sessionStorage.removeItem("mockUser"); authCb.forEach(cb => cb(null)); }
  };
  const auth = () => authObj;
  auth.EmailAuthProvider = { credential: (e, p) => ({ e, p }) };
  const database = () => ({ ref });
  database.ServerValue = { TIMESTAMP: { ".sv": "timestamp" } };
  window.firebase = { initializeApp: () => {}, auth, database };

  // Apps Script 중계 흉내: 급식·학사일정은 dev/neis-sample.json 표본(2026-08~10 급식, 2026학년도 일정)으로 답합니다.
  // 주소에 ?neisFail 을 붙이면 오류를 흉내 냅니다(재시도 버튼 확인용).
  const realFetch = window.fetch.bind(window);
  let sample = null;
  window.fetch = async (url, opt) => {
    if (String(url).includes("script.google.com") && opt && opt.body) {
      const req = JSON.parse(opt.body);
      if (req.action === "neis") {
        sample ||= await realFetch("/dev/neis-sample.json").then(r => r.json());
        await new Promise(r => setTimeout(r, 500));
        if (location.search.includes("neisFail")) return new Response(JSON.stringify({ error: "급식·학사일정을 불러오지 못했습니다(일시적 오류)." }));
        return new Response(JSON.stringify({ rows: sample[req.kind].filter(r => r.date >= req.from && r.date <= req.to) }));
      }
    }
    return realFetch(url, opt);
  };
})();
