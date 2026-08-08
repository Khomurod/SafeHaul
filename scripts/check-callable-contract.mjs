/**
 * Every callable the frontend calls must be exported by the backend.
 *
 * The name extraction is exported as well as run, because
 * `scripts/check-release-health.mjs` asks a related but different question — do
 * those callables actually EXIST IN CLOUD — and the two must read the same list.
 * A monitor that maintains its own copy of "what the frontend calls" eventually
 * disagrees with the contract check, and the way you find out is a button that
 * does nothing.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from this file rather than the working directory, so callers can run
// it from anywhere.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

/** Every callable name the frontend invokes, sorted. */
export function readFrontendCallables() {
  // Built per call: a global regex carries lastIndex between uses, and a shared
  // one silently skips matches on the second caller.
  const callableRegex = /httpsCallable\(\s*functions\s*,\s*['"`]([A-Za-z0-9_]+)['"`]/g;
  const found = new Set();
  for (const file of walk(resolve(repoRoot, "src"))) {
    const contents = readFileSync(file, "utf8");
    let match;
    while ((match = callableRegex.exec(contents)) !== null) found.add(match[1]);
  }
  return [...found].sort();
}

/** Every function name `functions/index.js` exports, sorted. */
export function readBackendExports() {
  const exportRegex = /exports\.([A-Za-z0-9_]+)\s*=/g;
  const index = readFileSync(resolve(repoRoot, "functions", "index.js"), "utf8");
  const found = new Set();
  let match;
  while ((match = exportRegex.exec(index)) !== null) found.add(match[1]);
  return [...found].sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const frontendCallables = readFrontendCallables();
  const exportedFunctions = new Set(readBackendExports());
  const missing = frontendCallables.filter((name) => !exportedFunctions.has(name));

  if (missing.length > 0) {
    console.error("Callable contract check failed. Missing exports for frontend callables:");
    for (const name of missing) console.error(` - ${name}`);
    process.exit(1);
  }

  console.log(
    `Callable contract check passed (${frontendCallables.length} frontend callables verified).`,
  );
}
