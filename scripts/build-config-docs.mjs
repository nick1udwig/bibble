import { copyFile, cp, mkdir, rm } from "node:fs/promises";

await rm("docs/config", { force: true, recursive: true });
await mkdir("docs/config", { recursive: true });
await cp("src/config", "docs/config", { recursive: true });
await copyFile("src/common/settings.js", "docs/config/settings.js");
await copyFile("src/config-root.html", "docs/index.html");

for (const file of ["font-metrics.js", "reader-layout.js"]) {
  await copyFile("src/common/" + file, "docs/config/" + file);
  await copyFile("src/common/" + file, "src/config/" + file);
}
