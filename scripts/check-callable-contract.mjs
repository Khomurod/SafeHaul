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
    // A test is not the app: its sample code may name callables nothing calls.
    if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.[jt]sx?$/.test(entry.name)) out.push(abs);
  }
  return out;
};

/**
 * The callable names one source file invokes: `httpsCallable(functions, 'name')`,
 * and a name passed to a local wrapper that hands its first parameter to
 * `httpsCallable` (`const call = (name, data) => httpsCallable(functions, name)…`,
 * then `call('name', …)`).
 */
export function callablesIn(contents) {
  // Built per call: a global regex carries lastIndex between uses, and a shared
  // one silently skips matches on the second caller.
  const literal = /httpsCallable\(\s*functions\s*,\s*['"`]([A-Za-z0-9_]+)['"`]/g;
  const wrapper = /(?:const|let)\s+(\w+)\s*=\s*(?:useCallback\(\s*)?(?:async\s*)?\(\s*(\w+)\b[^)]*\)\s*=>[\s\S]{0,400}?httpsCallable\(\s*functions\s*,\s*\2\s*\)/g;
  const found = new Set();
  let match;
  while ((match = literal.exec(contents)) !== null) found.add(match[1]);
  while ((match = wrapper.exec(contents)) !== null) {
    const use = new RegExp(`\\b${match[1]}\\(\\s*['"\`]([A-Za-z0-9_]+)['"\`]`, "g");
    let call;
    while ((call = use.exec(contents)) !== null) found.add(call[1]);
  }
  return found;
}

/** Every callable name the frontend invokes, sorted. */
export function readFrontendCallables() {
  const found = new Set();
  for (const file of walk(resolve(repoRoot, "src"))) {
    for (const name of callablesIn(readFileSync(file, "utf8"))) found.add(name);
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
