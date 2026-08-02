import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const defaultLoops = 20;
const firebaseCliPath = resolve(
  process.cwd(),
  'node_modules',
  '.bin',
  isWindows ? 'firebase.cmd' : 'firebase',
);
const vitestCliPath = resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
const rulesTestArgs = [
  '--run',
  'src/tests/firestore.rules.security.test.js',
  'src/tests/storage.rules.security.test.js',
];

function fail(message) {
  console.error(`\n[rules:stress] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
}

function parseJavaMajor(versionText) {
  const directVersion = versionText.match(/version\s+"(\d+)/i);
  if (directVersion) return Number(directVersion[1]);

  const openJdkVersion = versionText.match(/openjdk\s+(\d+)/i);
  if (openJdkVersion) return Number(openJdkVersion[1]);

  return NaN;
}

function quoteForShell(value) {
  if (isWindows) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildRulesTestCommand() {
  return `${quoteForShell(process.execPath)} ${quoteForShell(vitestCliPath)} ${rulesTestArgs.join(' ')}`;
}

function parseLoops() {
  const cliValue = process.argv.find((arg) => arg.startsWith('--loops='))?.split('=')[1];
  const envValue = process.env.RULES_STRESS_LOOPS;
  const raw = cliValue || envValue || String(defaultLoops);
  const loops = Number(raw);

  if (!Number.isInteger(loops) || loops <= 0) {
    fail(`RULES_STRESS_LOOPS must be a positive integer (received "${raw}").`);
  }

  return loops;
}

function preflight() {
  console.log('[rules:stress] Preflight: checking Node, npm, Firebase CLI, Vitest, and Java 21...');
  console.log(`[rules:stress] Node ${process.version}`);

  const npmViaExecPath = process.env.npm_execpath
    ? run(process.execPath, [process.env.npm_execpath, '--version'])
    : null;
  const npmVersion = npmViaExecPath && npmViaExecPath.status === 0
    ? npmViaExecPath
    : run(npmCmd, ['-v']);

  if (npmVersion.error || npmVersion.status !== 0) {
    fail('npm is not available on PATH. Install Node.js + npm before running rules stress tests.');
  }
  console.log(`[rules:stress] npm ${npmVersion.stdout.trim()}`);

  if (!existsSync(firebaseCliPath)) {
    fail('Local Firebase CLI not found at node_modules/.bin/firebase. Run npm ci before running rules stress tests.');
  }
  console.log('[rules:stress] Local Firebase CLI detected');

  if (!existsSync(vitestCliPath)) {
    fail('Vitest entrypoint not found at node_modules/vitest/vitest.mjs. Run npm ci before running rules stress tests.');
  }
  console.log('[rules:stress] Vitest entrypoint detected');

  const javaVersion = run('java', ['-version']);
  if (javaVersion.error || javaVersion.status !== 0) {
    fail('Java is not available on PATH. Install Java 21 to run Firestore/Storage emulators.');
  }

  const javaText = `${javaVersion.stdout || ''}\n${javaVersion.stderr || ''}`;
  const javaMajor = parseJavaMajor(javaText);
  if (javaMajor !== 21) {
    fail(`Java 21 is required, but detected Java ${Number.isNaN(javaMajor) ? 'unknown' : javaMajor}.`);
  }
  console.log('[rules:stress] Java 21 detected');
}

function runStress(loops) {
  const rulesTestCommand = buildRulesTestCommand();

  for (let runNumber = 1; runNumber <= loops; runNumber += 1) {
    console.log(`[rules:stress] Rules regression run ${runNumber}/${loops}`);
    const result = run(
      firebaseCliPath,
      ['emulators:exec', '--only', 'firestore,storage', rulesTestCommand],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
          FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
        },
      },
    );

    if (result.error) {
      fail(`Failed to start firebase emulators: ${result.error.message}`);
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }

  console.log(`[rules:stress] Success: ${loops}/${loops} emulator runs passed.`);
}

const loops = parseLoops();
preflight();
runStress(loops);
