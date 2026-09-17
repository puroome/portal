// Firebase compat SDK(index.html 에서 로드)의 전역 firebase 객체를 초기화합니다.
import { firebaseConfig } from "./config.js";

firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db = firebase.database();
export const serverTime = firebase.database.ServerValue.TIMESTAMP;

export async function readVal(path) {
  const snap = await db.ref(path).once("value");
  return snap.val();
}

export function newKey(path) {
  return db.ref(path).push().key;
}

// 서버 시계와의 오차(체크인 코드 만료 판단용)
let serverOffset = 0;
db.ref(".info/serverTimeOffset").on("value", s => { serverOffset = s.val() || 0; });
export function serverNow() { return Date.now() + serverOffset; }
