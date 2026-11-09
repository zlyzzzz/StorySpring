import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));

// Syntax-check dependencies too: checking index.mjs alone does not parse imports.
for (const folder of [root, path.join(root, "server"), path.join(root, "scripts")]) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:js|mjs)$/.test(entry.name)) continue;
    execFileSync(process.execPath, ["--check", path.join(folder, entry.name)], {
      stdio: "inherit",
    });
  }
}
console.log("All application JavaScript files passed syntax checks.");
