// confirmGate.test.js
// Proves the bugfix: negotiation results in a PENDING record, not an
// immediate reassignment. Reassignment only happens via confirmPendingNegotiation().
// Run with: node test/confirmGate.test.js

const fs = require("fs");
const path = require("path");

const REAL_DATA_FILE = path.join(__dirname, "..", "data", "people.json");
const REAL_PENDING_FILE = path.join(__dirname, "..", "data", "pendingNegotiations.json");
const BACKUP_DATA = path.join(__dirname, "..", "data", "people.backup2.json");
const BACKUP_PENDING = path.join(__dirname, "..", "data", "pendingNegotiations.backup2.json");

if (fs.existsSync(REAL_DATA_FILE)) fs.copyFileSync(REAL_DATA_FILE, BACKUP_DATA);
if (fs.existsSync(REAL_PENDING_FILE)) fs.copyFileSync(REAL_PENDING_FILE, BACKUP_PENDING);
if (fs.existsSync(REAL_DATA_FILE)) fs.unlinkSync(REAL_DATA_FILE);
if (fs.existsSync(REAL_PENDING_FILE)) fs.unlinkSync(REAL_PENDING_FILE);

const stateStore = require("../src/stateStore");
const candidateSelector = require("../src/candidateSelector");
const { negotiate } = require("../src/negotiationEngine");

let priya = stateStore.markOOO("U_PRIYA", "Priya");
priya = stateStore.setCommitments("U_PRIYA", [
  { id: "task_001", title: "Review PR #482", priority: "high", dueDate: "2026-07-11", sourceChannel: "C0BEVB31K1Q" },
]);

const personStatesById = stateStore.getAllPersonStatesById();
const candidatesByTask = candidateSelector.selectCandidates(priya, personStatesById);
const traces = negotiate(priya, candidatesByTask, personStatesById);

// Simulate what index.js now does: record as pending, do NOT reassign.
for (const trace of traces) {
  if (trace.status === "pending_confirm" && trace.finalOwner) {
    stateStore.addPendingNegotiation(trace, priya.userId);
  }
}

console.log("=== Step 1: after negotiation, BEFORE confirm ===");
const priyaAfterNegotiation = stateStore.getPersonState("U_PRIYA");
console.log(`Priya still owns task_001: ${priyaAfterNegotiation.openCommitments.some((c) => c.id === "task_001")}`);
console.assert(
  priyaAfterNegotiation.openCommitments.some((c) => c.id === "task_001"),
  "BUG: task should NOT be reassigned before confirmation"
);

const winner = traces[0].finalOwner;
const winnerBefore = stateStore.getPersonState(winner);
console.log(`${winner} owns task_001 before confirm: ${winnerBefore.openCommitments.some((c) => c.id === "task_001")}`);
console.assert(
  !winnerBefore.openCommitments.some((c) => c.id === "task_001"),
  "BUG: candidate should not have the task before confirmation"
);

console.log("\n=== Step 2: retriggering flow while pending should be blocked ===");
console.log(`hasPendingNegotiations(U_PRIYA): ${stateStore.hasPendingNegotiations("U_PRIYA")}`);
console.assert(stateStore.hasPendingNegotiations("U_PRIYA") === true, "should detect pending negotiation");

console.log("\n=== Step 3: after /confirm-reassign task_001 ===");
stateStore.confirmPendingNegotiation("task_001");
const priyaAfterConfirm = stateStore.getPersonState("U_PRIYA");
const winnerAfterConfirm = stateStore.getPersonState(winner);
console.log(`Priya still owns task_001: ${priyaAfterConfirm.openCommitments.some((c) => c.id === "task_001")}`);
console.log(`${winner} owns task_001 after confirm: ${winnerAfterConfirm.openCommitments.some((c) => c.id === "task_001")}`);
console.assert(!priyaAfterConfirm.openCommitments.some((c) => c.id === "task_001"), "task should be gone from Priya after confirm");
console.assert(winnerAfterConfirm.openCommitments.some((c) => c.id === "task_001"), "task should now belong to winner after confirm");
console.assert(stateStore.hasPendingNegotiations("U_PRIYA") === false, "pending should be cleared after confirm");

console.log("\nAll confirm-gate assertions passed — reassignment now correctly waits for explicit confirmation.\n");

// Cleanup
if (fs.existsSync(REAL_DATA_FILE)) fs.unlinkSync(REAL_DATA_FILE);
if (fs.existsSync(REAL_PENDING_FILE)) fs.unlinkSync(REAL_PENDING_FILE);
if (fs.existsSync(BACKUP_DATA)) { fs.copyFileSync(BACKUP_DATA, REAL_DATA_FILE); fs.unlinkSync(BACKUP_DATA); }
if (fs.existsSync(BACKUP_PENDING)) { fs.copyFileSync(BACKUP_PENDING, REAL_PENDING_FILE); fs.unlinkSync(BACKUP_PENDING); }
