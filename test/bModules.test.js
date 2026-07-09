// bModules.test.js
// Tests canvasRenderer.js and confirmListener.js against a MOCK Slack client
// (no real Slack needed) — proves message sequencing/threading and reaction
// authorization logic are correct. Run with: node test/bModules.test.js

const fs = require("fs");
const path = require("path");

const FILES = ["people.json", "pendingNegotiations.json", "escalatedNegotiations.json"].map((f) =>
  path.join(__dirname, "..", "data", f)
);
const BACKUPS = FILES.map((f) => f.replace(".json", ".bak4.json"));
FILES.forEach((f, i) => {
  if (fs.existsSync(f)) fs.copyFileSync(f, BACKUPS[i]);
  if (fs.existsSync(f)) fs.unlinkSync(f);
});

const stateStore = require("../src/stateStore");
const { renderTrace } = require("../src/canvasRenderer");
const { postConfirmRequest, registerConfirmListener } = require("../src/confirmListener");

// --- Mock Slack client: records every postMessage call instead of hitting the network ---
let msgCounter = 0;
const postedMessages = [];
function makeMockClient() {
  return {
    chat: {
      postMessage: async ({ channel, thread_ts, text }) => {
        msgCounter += 1;
        const msg = { ts: `mock_ts_${msgCounter}`, channel, thread_ts, text };
        postedMessages.push(msg);
        return msg;
      },
    },
  };
}

async function main() {
  // --- Test 1: canvasRenderer posts header + one message per event + status line, all threaded ---
  const client = makeMockClient();
  const trace = {
    taskId: "task_001",
    status: "pending_confirm",
    finalOwner: "U_SAM",
    events: [
      { type: "propose", fromAgent: "Priya's Agent", toAgent: "Sam's Agent", message: "Proposing Sam take it" },
      { type: "accept", fromAgent: "Sam's Agent", toAgent: "Priya's Agent", message: "Sam accepts" },
    ],
  };
  const task = { id: "task_001", title: "Review PR #482" };

  const header = await renderTrace(client, "C123", trace, task);

  console.log("=== Test 1: canvasRenderer.renderTrace ===");
  console.log(`Messages posted: ${postedMessages.length} (expected 4: header + 2 events + status)`);
  console.assert(postedMessages.length === 4, "should post header + 2 events + 1 status = 4 messages");
  console.assert(postedMessages[0].thread_ts === undefined, "header should not be threaded to itself");
  console.assert(postedMessages.slice(1).every((m) => m.thread_ts === header.ts), "all follow-up messages should be threaded under the header");
  console.log("Threading correct: all follow-ups reference header.ts\n");

  // --- Test 2: postConfirmRequest records the message ref on the pending negotiation ---
  stateStore.markOOO("U_PRIYA", "Priya");
  stateStore.setCommitments("U_PRIYA", [{ id: "task_001", title: "Review PR #482", priority: "high", dueDate: null, sourceChannel: "C123" }]);
  stateStore.addPendingNegotiation(trace, "U_PRIYA");

  const confirmMsg = await postConfirmRequest(client, "C123", trace);
  const pendingAfterPost = stateStore.getPendingNegotiation("task_001");

  console.log("=== Test 2: confirmListener.postConfirmRequest ===");
  console.log(`Pending negotiation messageTs recorded: ${pendingAfterPost.messageTs === confirmMsg.ts}`);
  console.assert(pendingAfterPost.messageTs === confirmMsg.ts, "message ref should be recorded on the pending negotiation");

  // --- Test 3: reaction authorization — wrong user's ✅ should be ignored ---
  const mockApp = { event: (name, handler) => { mockApp._handler = handler; } };
  registerConfirmListener(mockApp);

  await mockApp._handler({
    event: { reaction: "white_check_mark", user: "U_RANDOM_INTRUDER", item: { type: "message", channel: "C123", ts: confirmMsg.ts } },
    client,
  });
  const stillPendingAfterWrongUser = stateStore.getPendingNegotiation("task_001");
  console.log("\n=== Test 3: unauthorized confirm is ignored ===");
  console.log(`Still pending after wrong user reacted: ${stillPendingAfterWrongUser !== null}`);
  console.assert(stillPendingAfterWrongUser !== null, "unauthorized user's confirm should NOT resolve the negotiation");

  // --- Test 4: correct user's ✅ actually confirms it ---
  await mockApp._handler({
    event: { reaction: "white_check_mark", user: "U_SAM", item: { type: "message", channel: "C123", ts: confirmMsg.ts } },
    client,
  });
  const pendingAfterRealConfirm = stateStore.getPendingNegotiation("task_001");
  const samAfter = stateStore.getPersonState("U_SAM");
  console.log("\n=== Test 4: authorized confirm (Sam) resolves it ===");
  console.log(`Pending cleared: ${pendingAfterRealConfirm === null}`);
  console.log(`Sam now owns task_001: ${samAfter.openCommitments.some((c) => c.id === "task_001")}`);
  console.assert(pendingAfterRealConfirm === null, "pending negotiation should be cleared after real confirm");
  console.assert(samAfter.openCommitments.some((c) => c.id === "task_001"), "Sam should now own the task");

  console.log("\nAll B-module tests passed.\n");
}

main()
  .catch((err) => {
    console.error("Test failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    FILES.forEach((f) => { if (fs.existsSync(f)) fs.unlinkSync(f); });
    FILES.forEach((f, i) => {
      if (fs.existsSync(BACKUPS[i])) { fs.copyFileSync(BACKUPS[i], f); fs.unlinkSync(BACKUPS[i]); }
    });
  });
