// timeoutEdge.test.js — verifies the 45s auto-escalate timeout end-to-end (reviewer-written)
const fs = require("fs");
const path = require("path");
const DATA_DIR = path.join(__dirname, "..", "data");
if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });

const stateStore = require("../src/stateStore");
const confirmListener = require("../src/confirmListener");

const posted = [];
const mockClient = {
  chat: {
    postMessage: async (args) => {
      posted.push(args);
      return { ok: true, channel: args.channel, ts: `${Date.now()}.${posted.length}` };
    },
  },
};

(async () => {
  stateStore.upsertPersonState("FROM", { displayName: "From", openCommitments: [{ id: "tt1", title: "Timeout task" }], currentLoad: 1 });
  stateStore.upsertPersonState("OWNER", { displayName: "Owner" });

  const trace = { taskId: "tt1", status: "pending_confirm", finalOwner: "OWNER", events: [] };
  stateStore.addPendingNegotiation(trace, "FROM");
  await confirmListener.postConfirmRequest(mockClient, "CCHAN", trace);

  console.log("Confirm prompt posted, waiting 47s for the fake timeout to fire...");
  await new Promise((r) => setTimeout(r, 47000));

  const stillPending = stateStore.getPendingNegotiation("tt1");
  const escalated = stateStore.getAllEscalatedNegotiations().find((e) => e.taskId === "tt1");
  const timeoutMsg = posted.find((p) => (p.text || "").includes("auto-escalating"));
  const ownerStill = stateStore.getPersonState("FROM").openCommitments.some((c) => c.id === "tt1");

  console.log("pending cleared:", stillPending === null);
  console.log("escalation recorded:", !!escalated, escalated ? `(status=${escalated.status}, finalOwner=${escalated.finalOwner})` : "");
  console.log("timeout message posted in-thread:", !!timeoutMsg);
  console.log("task NOT moved (still with original owner):", ownerStill);

  const ok = stillPending === null && escalated && escalated.finalOwner === null && timeoutMsg && ownerStill;
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(ok ? "TIMEOUT TEST PASSED" : "TIMEOUT TEST FAILED");
  process.exit(ok ? 0 : 1);
})();
