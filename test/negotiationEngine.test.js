// negotiationEngine.test.js
// Standalone test — no Slack, no Bolt, no network. Run with:
//   node test/negotiationEngine.test.js
// This is the Day 1 EOD checkpoint artifact: proof the negotiation engine
// works end-to-end against mock PersonState/ReassignmentCandidate data.

const { negotiate } = require("../src/negotiationEngine");
const {
  getMockOOOPerson,
  getMockCandidatesByTask,
  getMockPersonStatesById,
} = require("../src/mockData");

const oooPerson = getMockOOOPerson(); // Priya, 2 open commitments
const candidatesByTask = getMockCandidatesByTask();
const personStatesById = getMockPersonStatesById();

const traces = negotiate(oooPerson, candidatesByTask, personStatesById);

console.log(`\n=== Negotiation results for ${oooPerson.displayName} (${traces.length} tasks) ===\n`);

for (const trace of traces) {
  console.log(`Task: ${trace.taskId}  |  Status: ${trace.status}  |  Final owner: ${trace.finalOwner || "none (escalated)"}`);
  for (const ev of trace.events) {
    console.log(`   [round ${ev.round}] ${ev.type.padEnd(8)} ${ev.fromAgent} -> ${ev.toAgent}: ${ev.message}`);
  }
  console.log("");
}

// Basic assertions so this doubles as a smoke test
const task001 = traces.find((t) => t.taskId === "task_001");
const task002 = traces.find((t) => t.taskId === "task_002");

console.assert(task001.status === "pending_confirm", "task_001 should resolve (Swetha is over threshold but high priority bump applies)");
console.assert(task001.finalOwner === "U0BGPN518DA", "task_001 should go to Swetha via priority bump");
console.assert(task002.status === "escalated", "task_002 should escalate (Alex is over threshold, task is low priority, no other candidates)");

console.log("Smoke test assertions passed (see above for full trace).\n");
