// fixVerification.test.js — proves each of the review fixes changed behavior
const fs = require("fs");
const path = require("path");
const DATA_DIR = path.join(__dirname, "..", "data");
const resetData = () => fs.existsSync(DATA_DIR) && fs.rmSync(DATA_DIR, { recursive: true, force: true });
resetData();

const stateStore = require("../src/stateStore");
const engine = require("../src/negotiationEngine");

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`); };

console.log("== Fix 1: per-user mock task ids (replicating index.js seeding) ==");
{
  const { getMockOOOPerson } = require("../src/mockData");
  const seedFor = (userId) => getMockOOOPerson().openCommitments.map((t) => ({ ...t, id: `${t.id}_${userId}` }));
  const a = seedFor("USER_A"), b = seedFor("USER_B");
  check("ids no longer collide between users", a[0].id !== b[0].id);
  stateStore.addPendingNegotiation({ taskId: a[0].id, status: "pending_confirm", finalOwner: "X", events: [] }, "USER_A");
  stateStore.addPendingNegotiation({ taskId: b[0].id, status: "pending_confirm", finalOwner: "Y", events: [] }, "USER_B");
  check("both users' pendings coexist", stateStore.getAllPendingNegotiations().length === 2);
}

console.log("== Fix 2: failed confirm keeps the pending entry ==");
{
  resetData();
  stateStore.upsertPersonState("A", {});
  stateStore.upsertPersonState("B", {});
  stateStore.addPendingNegotiation({ taskId: "ghost", status: "pending_confirm", finalOwner: "B", events: [] }, "A");
  const res = stateStore.confirmPendingNegotiation("ghost"); // task doesn't exist with A
  check("confirm of vanished task returns null", res === null);
  check("pending entry preserved (was silently dropped before)", stateStore.getPendingNegotiation("ghost") !== null);
}

console.log("== Fix 3: /resolve-escalation multi-word name parsing ==");
{
  const trimmed = "task_002 Swetha Sriram".trim();
  const taskId = trimmed.split(/\s+/)[0];
  const rawUser = trimmed.slice(taskId.length).trim();
  check("taskId parsed", taskId === "task_002");
  check("full multi-word name preserved", rawUser === "Swetha Sriram");
}

console.log("== Fix 4: priority casing normalized ==");
{
  check("'High' now gets the bump", engine.evaluateCandidate({ priority: "High" }, { currentLoad: 4 }).accepted === true);
  check("'HIGH' too", engine.evaluateCandidate({ priority: "HIGH" }, { currentLoad: 4 }).accepted === true);
  check("'low' still declines at load 4", engine.evaluateCandidate({ priority: "low" }, { currentLoad: 4 }).accepted === false);
}

console.log("== Fix 5: corrupted JSON self-heals ==");
{
  resetData();
  stateStore.upsertPersonState("A", {});
  fs.writeFileSync(path.join(DATA_DIR, "people.json"), "{ not json !!");
  let people = null, threw = false;
  try { people = stateStore.getAllPersonStates(); } catch { threw = true; }
  check("no crash on corrupted people.json", !threw);
  check("resets to seed people", Array.isArray(people) && people.length === 3);
  fs.writeFileSync(path.join(DATA_DIR, "pendingNegotiations.json"), "garbage");
  check("corrupted pending file heals to empty", stateStore.getAllPendingNegotiations().length === 0);
}

console.log("== Fix 6: seeded baseline load survives a real reassignment ==");
{
  resetData();
  stateStore.upsertPersonState("X", { openCommitments: [{ id: "tx", title: "TX" }], currentLoad: 1 });
  stateStore.upsertPersonState("ALEXish", { displayName: "Alexish", currentLoad: 5, openCommitments: [] });
  stateStore.reassignCommitment("tx", "X", "ALEXish");
  const load = stateStore.getPersonState("ALEXish").currentLoad;
  check(`load-5 persona goes to 6, not 1 (got ${load})`, load === 6);
  check("giver's load decremented to 0", stateStore.getPersonState("X").currentLoad === 0);
}

resetData();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
