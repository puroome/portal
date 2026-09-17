// Google Drive 파일 처리 (gas/Code.gs 웹 앱 경유)
import { MAX_FILE_MB } from "./config.js";
import { callScript } from "./script-api.js";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

export function checkFileSize(file) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`'${file.name}' 파일이 ${MAX_FILE_MB}MB를 넘습니다.`);
  }
}

// meta: { sid, name, subId, programId, programTitle, category }
export async function uploadFile(file, meta) {
  checkFileSize(file);
  const data = await fileToBase64(file);
  const res = await callScript("upload", {
    ...meta,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    data
  });
  return { id: res.id, name: file.name, mime: file.type || "", size: file.size };
}

export async function openFile(fileInfo) {
  const win = window.open("", "_blank");
  if (win) win.document.write("<p style='font-family:sans-serif;padding:20px'>파일을 불러오는 중...</p>");
  try {
    const res = await callScript("download", { fileId: fileInfo.id });
    const bytes = Uint8Array.from(atob(res.data), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: res.mimeType });
    const url = URL.createObjectURL(blob);
    const viewable = /^(image\/|application\/pdf|text\/|video\/|audio\/)/.test(res.mimeType);
    if (viewable && win) {
      win.location.href = url;
    } else {
      if (win) win.close();
      const a = document.createElement("a");
      a.href = url;
      a.download = fileInfo.name;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}

export function deleteFile(fileId) {
  return callScript("remove", { fileId });
}

export function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + "KB";
  return (bytes / 1024 / 1024).toFixed(1) + "MB";
}
