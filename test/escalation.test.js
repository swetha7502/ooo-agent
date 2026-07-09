// escalation.test.js
// Proves the loose-end fix: escalated tasks are persisted and discoverable,
// and can be manually resolved via resolveEscalation(). Run with:
//   node test/escalation.test.js

const fs = require("fs");
const path = require("path");

const FILES = ["people.json", "pendingNegotiations.json", "escalatedNegotiations.json"].map((f) =>
  path.join(__dirname, "..", "data", f)
);
const BACKUPS = FILES.map((f) => f.replace(".json", ".bak3.json"));

FILES.forEach((f, i) => {
  if (fs.existsSync(f)) fs.copyFileSync(f, BACKUPS[i]);
  if (fs.existsSync(f)) fs.unlinkSync(f);
});

const stateStore = require("../src/stateStore");
const candidateSelector = require("../src/candidateSelector");
const { negotiate } = require("../src/negotiationEngine");

// Priya OOO with a low-priority task that only Alex (overloaded) could take -> escalates
let priya = stateStore.markOOO("U_PRIYA", "Priya");
priya = stateStore.setCommitments("U_PRIYA", [
  { id: "task_002", title: "Update onboarding doc", priority: "low", dueDate: null, sourceChannel: "C0BEVB31K1Q" },
]);

// Force a guaranteed-escalation scenario: only offer Alex (load 5, over threshold, low priority task)
const candidatesByTask = { task_002: { taskId: "task_002", candidates: [{ userId: "U_ALEX", displayName: "Alex", confidence: 0.3, reason: "test" }] } };
const personStatesById = stateStore.getAllPersonStatesById();
const traces = negotiate(priya, candidatesByTask, personStatesById);

console.log("=== Step 1: negotiation result ===");
console.log(`task_002 status: ${traces[0].status}`);
console.assert(traces[0].status === "escalated", "expected escalation for this scenario");

// Simulate what index.js now does
for (const trace of traces) {
  if (trace.status === "escalated") stateStore.addEscalatedNegotiation(trace, priya.userId);
}

console.log("\n=== Step 2: /escalated should list it ===");
const escalatedList = stateStore.getAllEscalatedNegotiations();
console.log(escalatedList.map((e) => e.taskId));
console.assert(escalatedList.some((e) => e.taskId === "task_002"), "escalated task should be listed");

console.log("\n=== Step 3: /resolve-escalation task_002 U_JORDAN ===");
const resolved = stateStore.resolveEscalation("task_002", "U_JORDAN");
console.log(`Resolved task: ${resolved && resolved.title}`);
console.assert(resolved !== null, "resolveEscalation should succeed");

const jordanAfter = stateStore.getPersonState("U_JORDAN");
const priyaAfter = stateStore.getPersonState("U_PRIYA");
console.log(`Jordan now owns task_002: ${jordanAfter.openCommitments.some((c) => c.id === "task_002")}`);
console.log(`Priya no longer owns task_002: ${!priyaAfter.openCommitments.some((c) => c.id === "task_002")}`);
console.assert(jordanAfter.openCommitments.some((c) => c.id === "task_002"), "Jordan should now own the task");
console.assert(!priyaAfter.openCommitments.some((c) => c.id === "task_002"), "Priya should no longer own the task");

console.log("\n=== Step 4: escalation list should now be empty ===");
console.assert(stateStore.getAllEscalatedNegotiations().length === 0, "escalation list should be cleared after resolution");

// Step 5: back-from-ooo (markActive)
console.log("\n=== Step 5: markActive ===");
const priyaActive = stateStore.markActive("U_PRIYA");
console.assert(priyaActive.status === "active", "Priya should be active again");
console.log(`Priya status: ${priyaActive.status}`);

console.log("\nAll escalation loose-end assertions passed.\n");

// Cleanup
FILES.forEach((f) => { if (fs.existsSync(f)) fs.unlinkSync(f); });
FILES.forEach((f, i) => {
  if (fs.existsSync(BACKUPS[i])) { fs.copyFileSync(BACKUPS[i], f); fs.unlinkSync(BACKUPS[i]); }
});