import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const frontendPath = resolve(root, "src");
const functionsIndexPath = resolve(root, "functions", "index.js");

const walk = (dir) => {
  const entries = readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", ".git"].includes(entry.name)) continue;
      out.push(...walk(abs));
      continue;
    }
    if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(abs);
  }
  return out;
};

const frontendFiles = walk(frontendPath);
const callableRegex = /httpsCallable\(\s*functions\s*,\s*['"`]([A-Za-z0-9_]+)['"`]/g;
const exportRegex = /exports\.([A-Za-z0-9_]+)\s*=/g;

const frontendCallables = new Set();
for (const file of frontendFiles) {
  const contents = readFileSync(file, "utf8");
  let match;
  while ((match = callableRegex.exec(contents)) !== null) {
    frontendCallables.add(match[1]);
  }
}

const functionsIndex = readFileSync(functionsIndexPath, "utf8");
const exportedFunctions = new Set();
let expMatch;
while ((expMatch = exportRegex.exec(functionsIndex)) !== null) {
  exportedFunctions.add(expMatch[1]);
}

const missing = [...frontendCallables].filter((name) => !exportedFunctions.has(name)).sort();

if (missing.length > 0) {
  console.error("Callable contract check failed. Missing exports for frontend callables:");
  for (const name of missing) console.error(` - ${name}`);
  process.exit(1);
}

console.log(`Callable contract check passed (${frontendCallables.size} frontend callables verified).`);
