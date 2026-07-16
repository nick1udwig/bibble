import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const KJV_SOURCE = require("../src/common/kjv-source");
const outputPath = process.argv[2] || "/tmp/bibble-kjv.json";
const download = spawnSync("curl", ["-fsSL", "--retry", "3", KJV_SOURCE.url], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024
});

if (download.error) {
  throw download.error;
}
if (download.status !== 0) {
  throw new Error(`KJV download failed: ${String(download.stderr || "curl exited unsuccessfully").trim()}`);
}

const text = String(download.stdout || "").replace(/^\uFEFF/, "");
const books = JSON.parse(text);

if (!Array.isArray(books) || books.length !== 66) {
  throw new Error(`Expected 66 books, got ${Array.isArray(books) ? books.length : typeof books}`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, text);
console.log(`Fetched ${books.length} books from ${KJV_SOURCE.url} to ${outputPath}`);
