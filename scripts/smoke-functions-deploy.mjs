import { execSync } from "node:child_process";

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  console.error("FIREBASE_PROJECT_ID is required.");
  process.exit(1);
}

const required = [
  "sendSMS",
  "sendTestSMS",
  "initBulkSession",
  "retryFailedAttempts",
  "submitGuestApplication",
  "getSignedUploadUrl",
  "parseCdlWithGroq",
];

const raw = execSync(
  `npx firebase-tools functions:list --project "${projectId}" --json --non-interactive`,
  { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
);

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error("Could not parse functions:list output as JSON.");
  console.error(raw);
  process.exit(1);
}

const discovered = new Set((parsed.result || []).map((f) => f.id));
const missing = required.filter((name) => !discovered.has(name));

if (missing.length > 0) {
  console.error("Post-deploy smoke check failed. Missing deployed functions:");
  for (const name of missing) console.error(` - ${name}`);
  process.exit(1);
}

console.log(`Post-deploy smoke check passed (${required.length} critical functions verified).`);
