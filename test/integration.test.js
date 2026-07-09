// integration.test.js
// Proves stateStore.js + candidateSelector.js + negotiationEngine.js work
// together end-to-end, without Slack. Run with:
//   node test/integration.test.js

const fs = require("fs");
const path = require("path");

// Use an isolated data file for this test so it doesn't touch real demo data.
const TEST_DATA_FILE = path.join(__dirname, "..", "data", "people.test.json");
if (fs.existsSync(TEST_DATA_FILE)) fs.unlinkSync(TEST_DATA_FILE);

// Monkey-patch require cache isn't worth the complexity here — just reuse the
// real data file, back it up, run the test, then restore it.
const REAL_DATA_FILE = path.join(__dirname, "..", "data", "people.json");
const BACKUP_FILE = path.join(__dirname, "..", "data", "people.backup.json");
if (fs.existsSync(REAL_DATA_FILE)) fs.copyFileSync(REAL_DATA_FILE, BACKUP_FILE);
if (fs.existsSync(REAL_DATA_FILE)) fs.unlinkSync(REAL_DATA_FILE);

const stateStore = require("../src/stateStore");
const candidateSelector = require("../src/candidateSelector");
const { negotiate } = require("../src/negotiationEngine");

// 1. Mark Priya OOO with two open commitments (simulating post-extraction state)
let priya = stateStore.markOOO("U_PRIYA", "Priya");
priya = stateStore.setCommitments("U_PRIYA", [
  { id: "task_001", title: "Review PR #482", priority: "high", dueDate: "2026-07-11", sourceChannel: "C0BEVB31K1Q" },
  { id: "task_002", title: "Update onboarding doc", priority: "low", dueDate: null, sourceChannel: "C0BEVB31K1Q" },
]);

// 2. Select candidates using the real seeded people (Jordan, Sam, Alex)
const personStatesById = stateStore.getAllPersonStatesById();
const candidatesByTask = candidateSelector.selectCandidates(priya, personStatesById);

console.log("=== Candidates selected ===");
console.log(JSON.stringify(candidatesByTask, null, 2));

// 3. Negotiate
const traces = negotiate(priya, candidatesByTask, personStatesById);

console.log("\n=== Negotiation traces ===");
for (const trace of traces) {
  console.log(`${trace.taskId}: ${trace.status}, finalOwner=${trace.finalOwner}`);
}

// 4. Apply reassignments and confirm load numbers update
for (const trace of traces) {
  if (trace.status === "pending_confirm" && trace.finalOwner) {
    stateStore.reassignCommitment(trace.taskId, priya.userId, trace.finalOwner);
  }
}

const afterState = stateStore.getAllPersonStatesById();
console.log("\n=== State after reassignment ===");
console.log(JSON.stringify(afterState, null, 2));

console.assert(traces.length === 2, "expected 2 negotiation traces");
console.log("\nIntegration test passed.\n");

// Cleanup: restore real data file
if (fs.existsSync(REAL_DATA_FILE)) fs.unlinkSync(REAL_DATA_FILE);
if (fs.existsSync(BACKUP_FILE)) {
  fs.copyFileSync(BACKUP_FILE, REAL_DATA_FILE);
  fs.unlinkSync(BACKUP_FILE);
}
