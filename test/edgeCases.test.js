// edgeCases.test.js — additional edge-case probing (written by reviewer, not part of repo)
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
function resetData() {
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
}
resetData();

const engine = require("../src/negotiationEngine");
const stateStore = require("../src/stateStore");
const candidateSelector = require("../src/candidateSelector");

let pass = 0, fail = 0;
function check(name, cond, note = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${note ? "— " + note : ""}`); }
}

console.log("\n== 1. negotiationEngine edge cases ==");

// empty candidate list -> escalate
{
  const ooo = { userId: "A", displayName: "A", openCommitments: [{ id: "t1", title: "x", priority: "high", dueDate: null }] };
  const traces = engine.negotiate(ooo, {}, {});
  check("no candidates -> escalated", traces[0].status === "escalated");
}

// MAX_ROUNDS cap: 4 declining candidates, only 3 tried
{
  const task = { id: "t1", title: "x", priority: "low" };
  const cands = ["C1","C2","C3","C4"].map((u) => ({ userId: u, displayName: u }));
  const states = Object.fromEntries(cands.map((c) => [c.userId, { currentLoad: 9 }]));
  const { trace } = engine.negotiateTask({ displayName: "A" }, task, cands, states);
  const proposals = trace.events.filter((e) => e.type === "propose").length;
  check("MAX_ROUNDS caps at 3 proposals", proposals === 3, `got ${proposals}`);
  check("all-decline -> escalated", trace.status === "escalated");
}

// boundary loads
{
  const t = (p) => ({ id: "t", title: "x", priority: p });
  check("load 2 accepts any", engine.evaluateCandidate(t("low"), { currentLoad: 2 }).accepted === true);
  check("load 3 (== threshold) declines low", engine.evaluateCandidate(t("low"), { currentLoad: 3 }).accepted === false);
  check("load 3 accepts high (bump)", engine.evaluateCandidate(t("high"), { currentLoad: 3 }).accepted === true);
  check("load 4 accepts high (bump edge)", engine.evaluateCandidate(t("high"), { currentLoad: 4 }).accepted === true);
  check("load 5 declines even high", engine.evaluateCandidate(t("high"), { currentLoad: 5 }).accepted === false);
  check("load 3 declines medium", engine.evaluateCandidate(t("medium"), { currentLoad: 3 }).accepted === false);
  check("missing candidate state declines", engine.evaluateCandidate(t("high"), undefined).accepted === false);
  check("undefined currentLoad declines", engine.evaluateCandidate(t("high"), {}).accepted === false);
  // priority casing sensitivity
  check("priority 'High' (capitalized) gets bump?", engine.evaluateCandidate(t("High"), { currentLoad: 4 }).accepted === true, "case-sensitive priority compare");
}

// zero commitments -> empty traces; bad input throws
{
  check("zero commitments -> []", engine.negotiate({ openCommitments: [] }, {}, {}).length === 0);
  let threw = false;
  try { engine.negotiate(null, {}, {}); } catch { threw = true; }
  check("null oooPerson throws cleanly", threw);
}

console.log("\n== 2. candidateSelector edge cases ==");
{
  resetData();
  const states = {
    OOO1: { userId: "OOO1", displayName: "Me", status: "ooo", openCommitments: [], currentLoad: 0 },
    B: { userId: "B", displayName: "B", status: "active", openCommitments: [{ title: "deploy pipeline fix" }], currentLoad: 2 },
    C: { userId: "C", displayName: "C", status: "ooo", openCommitments: [], currentLoad: 0 },
    D: { userId: "D", displayName: "D", status: "active", openCommitments: [], currentLoad: 1 },
  };
  const ooo = { userId: "OOO1", openCommitments: [{ id: "t1", title: "deploy pipeline", priority: "high" }] };
  const res = candidateSelector.selectCandidates(ooo, states);
  const ids = res.t1.candidates.map((c) => c.userId);
  check("self excluded", !ids.includes("OOO1"));
  check("OOO people excluded", !ids.includes("C"));
  check("keyword overlap beats slightly lighter load", ids[0] === "B" || ids[0] === "D"); // just record ordering
  console.log("    ordering:", JSON.stringify(res.t1.candidates.map((c) => `${c.userId}:${c.confidence}`)));
  // empty title task
  const res2 = candidateSelector.selectCandidates({ userId: "OOO1", openCommitments: [{ id: "t2", title: "", priority: "low" }] }, states);
  check("empty-title task still gets candidates", res2.t2.candidates.length > 0);
  // load > maxLoad
  const s = candidateSelector.scoreCandidate({ title: "abc" }, { currentLoad: 99, openCommitments: [] });
  check("load 99 clamps to score 0 (not negative)", s.confidence === 0, `got ${s.confidence}`);
}

console.log("\n== 3. stateStore edge cases ==");
{
  resetData();
  stateStore.upsertPersonState("A", { displayName: "A", openCommitments: [{ id: "t1", title: "T1" }], currentLoad: 1 });
  stateStore.upsertPersonState("B", { displayName: "B" });

  check("reassign unknown task -> null", stateStore.reassignCommitment("nope", "A", "B") === null);
  check("reassign unknown fromUser -> null", stateStore.reassignCommitment("t1", "ZZZ", "B") === null);
  check("reassign unknown toUser -> null", stateStore.reassignCommitment("t1", "A", "ZZZ") === null);
  check("task untouched after failed reassigns", stateStore.getPersonState("A").openCommitments.length === 1);

  check("confirm nonexistent pending -> null", stateStore.confirmPendingNegotiation("nope") === null);

  // double-confirm
  stateStore.addPendingNegotiation({ taskId: "t1", status: "pending_confirm", finalOwner: "B", events: [] }, "A");
  const first = stateStore.confirmPendingNegotiation("t1");
  const second = stateStore.confirmPendingNegotiation("t1");
  check("first confirm moves task", first && first.id === "t1" && stateStore.getPersonState("B").openCommitments.length === 1);
  check("double-confirm returns null (idempotent)", second === null);

  // DANGEROUS EDGE: pending entry whose task no longer exists at fromUser
  stateStore.addPendingNegotiation({ taskId: "ghost", status: "pending_confirm", finalOwner: "B", events: [] }, "A");
  const ghost = stateStore.confirmPendingNegotiation("ghost");
  check("confirm of vanished task returns null...", ghost === null);
  check("...but pending entry was still deleted (silent drop)", stateStore.getPendingNegotiation("ghost") === null, "confirmPendingNegotiation deletes entry even when reassign fails");

  // resolveEscalation to unknown user preserves the escalation record
  stateStore.upsertPersonState("A", { openCommitments: [{ id: "t9", title: "T9" }], currentLoad: 1 });
  stateStore.addEscalatedNegotiation({ taskId: "t9", status: "escalated", events: [], finalOwner: null }, "A");
  check("resolveEscalation to unknown user -> null", stateStore.resolveEscalation("t9", "NOBODY") === null);
  check("escalation record preserved after failed resolve", stateStore.getAllEscalatedNegotiations().some((e) => e.taskId === "t9"));
  check("resolveEscalation to known user works", stateStore.resolveEscalation("t9", "B") !== null);

  // known limitation 1: currentLoad silently reset
  resetData();
  stateStore.upsertPersonState("X", { openCommitments: [{ id: "tx", title: "TX" }], currentLoad: 1 });
  stateStore.upsertPersonState("ALEXish", { displayName: "Alexish", currentLoad: 5, openCommitments: [] });
  stateStore.reassignCommitment("tx", "X", "ALEXish");
  const alexLoad = stateStore.getPersonState("ALEXish").currentLoad;
  check("KNOWN LIMITATION: seeded load 5 collapses to 1 after one real task", alexLoad === 1, `load now ${alexLoad}`);
}

console.log("\n== 4. mock-task-ID collision (two users OOO, both seeded task_001) ==");
{
  resetData();
  // Simulate what index.js runNegotiationFlow does for two commitment-less users:
  // both get seeded the SAME mock task ids.
  const { getMockOOOPerson } = require("../src/mockData");
  const mockTasks = getMockOOOPerson().openCommitments;
  stateStore.upsertPersonState("USER_A", { displayName: "UserA" });
  stateStore.upsertPersonState("USER_B", { displayName: "UserB" });
  stateStore.setCommitments("USER_A", JSON.parse(JSON.stringify(mockTasks)));
  stateStore.setCommitments("USER_B", JSON.parse(JSON.stringify(mockTasks)));

  stateStore.addPendingNegotiation({ taskId: "task_001", status: "pending_confirm", finalOwner: "USER_C", events: [] }, "USER_A");
  stateStore.addPendingNegotiation({ taskId: "task_001", status: "pending_confirm", finalOwner: "USER_D", events: [] }, "USER_B");
  const all = stateStore.getAllPendingNegotiations().filter((p) => p.taskId === "task_001");
  check("second user's pending OVERWRITES first user's (keyed by taskId)", all.length === 1 && all[0].fromUserId === "USER_B",
    "User A's pending negotiation for task_001 is silently lost");
}

console.log("\n== 5. double-booking guard (README item 10) ==");
{
  resetData();
  stateStore.upsertPersonState("P1", { displayName: "P1", openCommitments: [{ id: "p1t", title: "alpha", priority: "high" }], currentLoad: 1 });
  stateStore.upsertPersonState("P2", { displayName: "P2", openCommitments: [{ id: "p2t", title: "beta", priority: "high" }], currentLoad: 1 });
  stateStore.upsertPersonState("LIGHT", { displayName: "Light", openCommitments: [], currentLoad: 0 });
  stateStore.upsertPersonState("HEAVY", { displayName: "Heavy", openCommitments: [], currentLoad: 2 });

  // Negotiation 1 picks LIGHT and records the hold
  const states1 = stateStore.getAllPersonStatesById();
  const c1 = candidateSelector.selectCandidates(states1.P1, states1);
  const t1 = engine.negotiate(states1.P1, c1, states1);
  check("negotiation 1 lands on LIGHT", t1[0].finalOwner === "LIGHT");
  stateStore.addPendingNegotiation(t1[0], "P1");

  // Negotiation 2 must now skip LIGHT
  const states2 = stateStore.getAllPersonStatesById();
  const c2 = candidateSelector.selectCandidates(states2.P2, states2);
  const ids2 = c2.p2t.candidates.map((c) => c.userId);
  check("negotiation 2 skips held candidate LIGHT", !ids2.includes("LIGHT"), `candidates: ${ids2}`);
}

console.log("\n== 6. message trigger regex ==");
{
  const re = /\b(out of office|ooo|swamped|underwater|overloaded)\b/i;
  check("'I'm OOO tomorrow' matches (case-insensitive)", re.test("I'm OOO tomorrow"));
  check("'swamped' matches", re.test("totally swamped this week"));
  check("'smooo' does not match (word boundary)", !re.test("smooo"));
  check("'OOOh nice' does not false-positive", !re.test("OOOh nice"), "regex \\b(...ooo)\\b against 'OOOh'");
  check("'underwater basket weaving' FALSE POSITIVE", !re.test("I love underwater basket weaving"), "regex can't tell hobby from overload");
}

console.log("\n== 7. resolveEscalationUser parsing (logic replicated from index.js) ==");
{
  resetData();
  stateStore.upsertPersonState("U123ABC", { displayName: "Jordan Lee" });
  // replicate the function (index.js can't be required without starting the Slack app)
  function resolveEscalationUser(rawUser) {
    if (!rawUser) return null;
    const mentionMatch = rawUser.match(/<@([A-Z0-9]+)(\|[^>]+)?>/);
    if (mentionMatch) return mentionMatch[1];
    const plain = rawUser.replace(/^@/, "").trim().toLowerCase();
    const match = stateStore.getAllPersonStates().find((p) => p.userId.toLowerCase() === plain || (p.displayName || "").toLowerCase() === plain);
    return match ? match.userId : null;
  }
  check("real mention <@U123ABC>", resolveEscalationUser("<@U123ABC>") === "U123ABC");
  check("mention with label <@U123ABC|jordan>", resolveEscalationUser("<@U123ABC|jordan>") === "U123ABC");
  check("case-insensitive display name", resolveEscalationUser("jordan lee") === "U123ABC", "NOTE: index.js splits on whitespace so 'Jordan Lee' can never reach here in practice");
  check("@-prefixed name", resolveEscalationUser("@JORDAN LEE") === "U123ABC");
  check("unknown -> null", resolveEscalationUser("nobody") === null);
  // the real command splits text on whitespace: '/resolve-escalation t1 Jordan Lee' -> rawUser='Jordan'
  const [tid, rawUser] = "t1 Jordan Lee".trim().split(/\s+/);
  check("multi-word display name UNREACHABLE via command parsing", resolveEscalationUser(rawUser) === null,
    `command hands only '${rawUser}' to the resolver — 'Swetha Sriram' can never be matched by name`);
}

console.log("\n== 8. corrupted state file ==");
{
  resetData();
  stateStore.upsertPersonState("A", {});
  fs.writeFileSync(path.join(DATA_DIR, "people.json"), "{ not json !!");
  let threw = false;
  try { stateStore.getAllPersonStates(); } catch { threw = true; }
  check("corrupted people.json throws unhandled (no recovery)", threw, "JSON.parse crash propagates to caller");
}

resetData();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(0); // informational run; failures reported above
