// Add ".js" to relative imports in the emitted declarations, so projects using
// Node's ESM resolution (moduleResolution node16/nodenext) can read the types.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

for (const name of readdirSync("dist")) {
  if (!name.endsWith(".d.ts")) continue;
  const path = `dist/${name}`;
  const src = readFileSync(path, "utf8");
  const out = src.replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (m, a, spec, b) => (spec.endsWith(".js") ? m : `${a}${spec}.js${b}`));
  if (out !== src) writeFileSync(path, out);
}
