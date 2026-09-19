// 테스트용 서버: 실제 Firebase 대신 dev/mock-firebase.js(메모리 DB)로 앱을 띄웁니다.
//   node dev/mock-server.mjs   →   http://localhost:5178
// 테스트 계정(비밀번호 모두 1234): 교사 t1(김교사)·t2(박교사) / 학생 10101·10102·20101·10103
// 새로고침하면 데이터가 처음 상태로 돌아갑니다. 실제 DB 는 전혀 건드리지 않습니다.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEV = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DEV, "..");
const PORT = Number(process.env.PORT) || 5178;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png" };

http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  try {
    if (url === "/" || url === "/index.html") {
      // 실제 Firebase SDK 대신 가짜 Firebase 를 끼워 넣습니다.
      const html = (await readFile(path.join(ROOT, "index.html"), "utf8"))
        .replace(/<script src="https:\/\/www\.gstatic\.com[^>]*><\/script>\s*/g, "")
        .replace("</head>", '<script src="/dev/mock-firebase.js"></script></head>');
      res.writeHead(200, { "Content-Type": types[".html"], "Cache-Control": "no-store" });
      return res.end(html);
    }
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT)) throw new Error("bad path");
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("404");
  }
}).listen(PORT, () => console.log(`가짜 Firebase 테스트 서버: http://localhost:${PORT}`));
