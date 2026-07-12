// liveSim.test.js — drives the REAL index.js handlers through the README's
// manual live-testing checklist, with @slack/bolt mocked out. Everything the
// bot would do against Slack is captured in-memory instead.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });

// --- Mock @slack/bolt before index.js loads it ---
const handlers = { commands: {}, messages: [], events: {} };
class MockApp {
  constructor(opts) { this.opts = opts; }
  command(name, fn) { handlers.commands[name] = fn; }
  message(fn) { handlers.messages.push(fn); }
  event(name, fn) { handlers.events[name] = fn; }
  async start() { return; }
}
const boltPath = require.resolve("@slack/bolt");
require.cache[boltPath] = { id: boltPath, filename: boltPath, loaded: true, exports: { App: MockApp } };

delete process.env.GROQ_API_KEY; // force regex + mock-commitment paths (no network)
process.env.SLACK_BOT_TOKEN = "xoxb-fake";
process.env.SLACK_APP_TOKEN = "xapp-fake";

// Capture every message the bot "posts"
const posted = [];
let tsCounter = 0;
const mockClient = {
  chat: {
    postMessage: async (args) => {
      posted.push(args);
      return { ok: true, channel: args.channel, ts: `100${++tsCounter}.000` };
    },
  },
  users: {
    info: async ({ user }) => ({ user: { real_name: `Real ${user}`, name: user } }),
  },
  conversations: {
    history: async () => ({ messages: [] }), // no history -> mock-commitment fallback
  },
};

const BGK = "U0BHE8YRQ9E";    // seeded load 2
const SWETHA = "U0BGPN518DA"; // seeded load 4
const CHAN = "C_TEST";

const said = [];
const responded = [];
const say = async (text) => { said.push(typeof text === "string" ? text : text.text); };
const respond = async (msg) => { responded.push(typeof msg === "string" ? msg : msg.text); };
const runCommand = (name, user_id, text = "") =>
  handlers.commands[name]({ command: { user_id, channel_id: CHAN, text }, ack: async () => {}, say, respond, client: mockClient });
const sendMessage = async (user, text) => {
  for (const fn of handlers.messages) await fn({ message: { user, text, channel: CHAN }, say, client: mockClient });
};
const react = (reaction, user, ts) =>
  handlers.events["reaction_added"]({ event: { reaction, user, item: { type: "message", channel: CHAN, ts } }, client: mockClient });

let pass = 0, fail = 0;
const check = (name, cond, note = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${!cond && note ? " — " + note : ""}`);
};
const lastSaid = () => said[said.length - 1] || "";

(async () => {
  require("../src/index.js"); // registers handlers on MockApp, "starts" the app
  await new Promise((r) => setTimeout(r, 50));
  const stateStore = require("../src/stateStore");

  console.log("\n== Checklist 1: /go-ooo basic negotiation (as bgk02) ==");
  await runCommand("/go-ooo", BGK);
  let pendings = stateStore.getAllPendingNegotiations();
  let escalated = stateStore.getAllEscalatedNegotiations();
  check("1 task awaiting confirmation", pendings.length === 1, JSON.stringify(pendings.map(p => p.taskId)));
  check("pending owner is Swetha (high-prio bump at load 4)", pendings[0] && pendings[0].finalOwner === SWETHA);
  check("1 task escalated (low prio, nobody under threshold)", escalated.length === 1);
  check("summary says 1 confirm + 1 escalated", /1 task\(s\) awaiting confirmation, 1 escalated/.test(lastSaid()), lastSaid());
  check("negotiation trace was rendered (header + events + status)", posted.filter(p => !p.thread_ts).length >= 2 && posted.some(p => p.thread_ts));
  check("confirm prompt posted with ✅/❌ instructions", posted.some(p => /react :white_check_mark:/.test(p.text || "")));
  const pendingTaskId = pendings[0].taskId;
  const escTaskId = escalated[0].taskId;
  // users.info mock returns real_name "Real U0BHE8YRQ9E" -> slug "real-u0bhe8yrq9e"
  check("task ids are namespaced per user (fix 1, readable slug)", pendingTaskId === "task_001_real-u0bhe8yrq9e", pendingTaskId);

  console.log("\n== Checklist 7: cooldown guard ==");
  said.length = 0;
  await runCommand("/go-ooo", BGK);
  check("second /go-ooo within 3 min is blocked", /Already running a negotiation/.test(lastSaid()), lastSaid());

  console.log("\n== Checklist 2: /escalated lists the escalated task ==");
  said.length = 0;
  await runCommand("/escalated", BGK);
  check("escalated list contains the task", lastSaid().includes(escTaskId), lastSaid());

  console.log("\n== Checklist 4: confirm authorization ==");
  said.length = 0;
  await runCommand("/confirm-reassign", BGK, pendingTaskId); // bgk02 is NOT the proposed owner
  check("non-owner cannot confirm", new RegExp(`Only <@${SWETHA}> can confirm`).test(lastSaid()), lastSaid());
  check("task did NOT move", stateStore.getPersonState(BGK).openCommitments.some(c => c.id === pendingTaskId));

  console.log("\n== Checklist 9a: manual confirm by the right person ==");
  said.length = 0;
  await runCommand("/confirm-reassign", SWETHA, pendingTaskId);
  check("Swetha's confirm succeeds", /Confirmed/.test(lastSaid()), lastSaid());
  check("task moved to Swetha", stateStore.getPersonState(SWETHA).openCommitments.some(c => c.id === pendingTaskId));
  check("Swetha's load bumped 4 -> 5 (fix 6: baseline kept)", stateStore.getPersonState(SWETHA).currentLoad === 5, `load=${stateStore.getPersonState(SWETHA).currentLoad}`);

  console.log("\n== Checklist 3: /resolve-escalation (plain name 'Alex') ==");
  said.length = 0;
  await runCommand("/resolve-escalation", BGK, `${escTaskId} Alex`);
  check("resolved by plain single-word name", /manually assigned to <@U_ALEX>/.test(lastSaid()), lastSaid());
  check("escalation list now empty", stateStore.getAllEscalatedNegotiations().length === 0);

  console.log("\n== Fix 3 live: /resolve-escalation with MULTI-WORD name ==");
  // create a fresh escalation to resolve by "Swetha Sriram"
  stateStore.upsertPersonState(BGK, { openCommitments: [...stateStore.getPersonState(BGK).openCommitments, { id: "mw_task", title: "Multiword test" }] });
  stateStore.addEscalatedNegotiation({ taskId: "mw_task", status: "escalated", events: [], finalOwner: null }, BGK);
  said.length = 0;
  await runCommand("/resolve-escalation", BGK, "mw_task Swetha Sriram");
  check("'Swetha Sriram' resolves correctly", new RegExp(`assigned to <@${SWETHA}>`).test(lastSaid()), lastSaid());

  console.log("\n== Checklist 8: /back-from-ooo ==");
  said.length = 0;
  await runCommand("/back-from-ooo", BGK);
  check("welcome-back message", /Welcome back/.test(lastSaid()), lastSaid());
  check("status flipped to active", stateStore.getPersonState(BGK).status === "active");

  console.log("\n== Checklist 5: message trigger via regex ('swamped') as Swetha ==");
  said.length = 0;
  posted.length = 0;
  await sendMessage(SWETHA, "I'm completely swamped this week");
  check("negotiation fired from plain message", /Ran negotiation for/.test(lastSaid()), lastSaid());
  check("Swetha marked ooo", stateStore.getPersonState(SWETHA).status === "ooo");
  // Swetha now owns REAL tasks (the one she confirmed + mw_task), so the bot
  // negotiates over those instead of seeding mocks — verify that, and verify
  // her negotiation is over tasks she actually owns (no phantom mock seeding).
  const swethaPendings = stateStore.getAllPendingNegotiations().filter(p => p.fromUserId === SWETHA);
  const swethaOwns = new Set(stateStore.getPersonState(SWETHA).openCommitments.map(c => c.id));
  check("negotiates her REAL tasks (no mock re-seed once commitments exist)", swethaPendings.length > 0 && swethaPendings.every(p => swethaOwns.has(p.taskId)),
    JSON.stringify(swethaPendings.map(p => p.taskId)));

  console.log("\n== Non-trigger message must NOT fire ==");
  said.length = 0;
  await sendMessage(BGK, "just pushed the login fix, looks good");
  check("benign message ignored (no GROQ key, regex miss)", said.length === 0, said.join(" | "));

  console.log("\n== Checklist 9b: reaction-based confirm with authorization ==");
  const rp = stateStore.getAllPendingNegotiations().find(p => p.fromUserId === SWETHA && p.messageTs);
  if (rp) {
    await react("white_check_mark", "U_RANDOM", rp.messageTs); // wrong person
    check("✅ from wrong user silently ignored", stateStore.getPendingNegotiation(rp.taskId) !== null);
    await react("white_check_mark", rp.finalOwner, rp.messageTs); // right person
    check("✅ from proposed owner confirms + moves task", stateStore.getPendingNegotiation(rp.taskId) === null
      && stateStore.getPersonState(rp.finalOwner).openCommitments.some(c => c.id === rp.taskId));
  } else {
    check("reaction test setup (pending with messageTs exists)", false, "no pending negotiation with a recorded message ref");
  }

  console.log("\n== Reject flow: ❌ from the original OOO person ==");
  const rj = stateStore.getAllPendingNegotiations().find(p => p.messageTs);
  if (rj) {
    await react("x", rj.fromUserId, rj.messageTs);
    check("❌ clears the pending without moving the task", stateStore.getPendingNegotiation(rj.taskId) === null
      && stateStore.getPersonState(rj.fromUserId).openCommitments.some(c => c.id === rj.taskId));
  } else {
    console.log("  (no second pending left to reject — skipping, covered in bModules.test.js)");
  }

  console.log("\n== Bot not in channel: /go-ooo asks for an invite ==");
  const okHistory = mockClient.conversations.history;
  mockClient.conversations.history = async () => { const e = new Error("An API error occurred: not_in_channel"); e.data = { error: "not_in_channel" }; throw e; };
  const pendingsBefore = stateStore.getAllPendingNegotiations().length;
  responded.length = 0;
  await runCommand("/go-ooo", "U_FRESH_USER");
  check("ephemeral invite prompt sent", responded.some(t => /\/invite @ooo-negotiator/.test(t)), responded.join(" | "));
  check("no negotiation state created", stateStore.getAllPendingNegotiations().length === pendingsBefore);
  mockClient.conversations.history = okHistory;

  console.log(`\n==== LIVE-SIM RESULT: ${pass} passed, ${fail} failed ====`);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("HARNESS CRASH:", e); process.exit(2); });
