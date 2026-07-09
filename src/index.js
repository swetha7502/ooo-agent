// index.js
// Owner: S. Bolt app entry point (Socket Mode), event wiring, orchestration.
// Day 1: triggers fire correctly and run negotiationEngine against MOCK data.
// Day 2+: swap mock calls for N's stateStore.js/candidateSelector.js and
// B's canvasRenderer.js/confirmListener.js as they land — call signatures
// below are written to match the frozen contracts exactly, so the swap
// should be a one-line import change per module, not a rewrite.

require("dotenv").config();
const { App } = require("@slack/bolt");
const { negotiate } = require("./negotiationEngine");
const { classifyOOOSignal, extractCommitments } = require("./extraction");
const stateStore = require("./stateStore");
const candidateSelector = require("./candidateSelector");
const canvasRenderer = require("./canvasRenderer");
const confirmListener = require("./confirmListener");

// Last-resort fallback only — used if stateStore/candidateSelector throw.
// N's real modules, if delivered later, are a drop-in swap for stateStore.js
// and candidateSelector.js above; nothing else needs to change.
const { getMockOOOPerson, getMockCandidatesByTask } = require("./mockData");

// Last-resort fallback only — used if client/channelId aren't available
// (e.g. some future non-Slack trigger) or the real render/confirm calls throw.
function stubRenderTrace(trace) {
  console.log(`[canvasRenderer STUB] would render trace for ${trace.taskId}:`, JSON.stringify(trace, null, 2));
}

function stubListenForConfirm(trace) {
  if (trace.status === "pending_confirm") {
    console.log(`[confirmListener STUB] would post ✅/❌ prompt for task ${trace.taskId} -> ${trace.finalOwner}`);
  }
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

confirmListener.registerConfirmListener(app);

// Guards against duplicate triggers (double "swamped" messages, testing
// /go-ooo twice back to back, etc.) re-running extraction/negotiation and
// clobbering commitments that are already mid-negotiation. In-memory is fine
// for a demo — resets on restart, which just re-opens the cooldown.
const lastTriggeredAt = new Map();
const COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Pulls a user's recent messages from a channel via conversations.history,
 * for feeding into extraction.js's extractCommitments(). Falls back to an
 * empty array (caller then falls back to mock/known commitments) if the
 * Slack API call fails for any reason.
 */
async function fetchRecentUserMessages(client, channelId, userId, limit = 50) {
  try {
    const result = await client.conversations.history({ channel: channelId, limit });
    return (result.messages || [])
      .filter((m) => m.user === userId && m.text && !m.subtype)
      .map((m) => m.text);
  } catch (err) {
    console.warn(`[index.js] Could not fetch history for ${userId} in ${channelId}:`, err.message);
    return [];
  }
}

/**
 * Runs the full negotiation flow for a given OOO person and posts results.
 * This is the core orchestration path — trigger -> extraction -> candidate
 * selection -> negotiation -> canvas update -> confirm listener.
 */
async function runNegotiationFlow(oooUserId, say, client, channelId) {
  // Guard 1: cooldown — ignore rapid duplicate triggers for the same person.
  const now = Date.now();
  const last = lastTriggeredAt.get(oooUserId);
  if (last && now - last < COOLDOWN_MS) {
    console.log(`[index.js] Ignoring duplicate trigger for ${oooUserId} (cooldown active)`);
    if (say) {
      await say(`Already running a negotiation for you recently — give it a few minutes before triggering again.`);
    }
    return [];
  }

  // Guard 2: don't re-extract/re-negotiate over commitments that are already
  // mid-negotiation and awaiting a human's ✅/❌ — that would silently
  // overwrite a pending decision.
  if (stateStore.hasPendingNegotiations(oooUserId)) {
    console.log(`[index.js] ${oooUserId} already has pending negotiations awaiting confirmation, skipping re-trigger`);
    if (say) {
      await say(`You already have reassignment(s) awaiting confirmation — check for a pending :white_check_mark:/:x: prompt before triggering again.`);
    }
    return [];
  }

  lastTriggeredAt.set(oooUserId, now);

  // Get or create this person's real state, and mark them OOO.
  let oooPerson;
  try {
    let displayName;
    if (client) {
      try {
        const info = await client.users.info({ user: oooUserId });
        displayName = info.user?.real_name || info.user?.name;
      } catch (err) {
        console.warn("[index.js] Could not fetch user display name:", err.message);
      }
    }
    oooPerson = stateStore.markOOO(oooUserId, displayName);
  } catch (err) {
    console.warn("[index.js] stateStore.markOOO failed, falling back to mock person:", err.message);
    oooPerson = getMockOOOPerson();
  }

  // Try real extraction against the person's recent messages. Fall back to
  // existing/mock commitments if GROQ_API_KEY is missing, the API call fails,
  // or nothing is found — never let extraction block the demo.
  if (process.env.GROQ_API_KEY && client && channelId) {
    try {
      const recentMessages = await fetchRecentUserMessages(client, channelId, oooPerson.userId);
      if (recentMessages.length > 0) {
        const extracted = await extractCommitments(recentMessages, channelId);
        if (extracted.length > 0) {
          oooPerson = stateStore.setCommitments(oooPerson.userId, extracted);
          console.log(`[index.js] Extracted ${extracted.length} real commitment(s) via Groq for ${oooPerson.displayName}`);
        }
      }
    } catch (err) {
      console.warn("[index.js] extractCommitments failed, keeping existing commitments:", err.message);
    }
  }

  // Demo safety net: if this person still has zero open commitments (fresh
  // user, no Slack history, no GROQ_API_KEY set), seed them with the mock
  // commitments so the negotiation flow always has something to demo.
  if (!oooPerson.openCommitments || oooPerson.openCommitments.length === 0) {
    const fallback = getMockOOOPerson();
    oooPerson = stateStore.setCommitments(oooPerson.userId, fallback.openCommitments);
    console.log("[index.js] No real commitments found, seeded mock commitments for demo purposes");
  }

  let personStatesById;
  try {
    personStatesById = stateStore.getAllPersonStatesById();
  } catch (err) {
    console.warn("[index.js] stateStore.getAllPersonStatesById failed, falling back to mock:", err.message);
    personStatesById = require("./mockData").getMockPersonStatesById();
  }

  let candidatesByTask;
  try {
    candidatesByTask = candidateSelector.selectCandidates(oooPerson, personStatesById);
  } catch (err) {
    console.warn("[index.js] candidateSelector failed, falling back to mock candidates:", err.message);
    candidatesByTask = getMockCandidatesByTask();
  }

  console.log(`[index.js] Running negotiation flow for ${oooPerson.displayName} (${oooPerson.openCommitments.length} open commitments)`);

  const traces = negotiate(oooPerson, candidatesByTask, personStatesById);

  for (const trace of traces) {
    const task = (oooPerson.openCommitments || []).find((t) => t.id === trace.taskId);

    if (client && channelId) {
      try {
        await canvasRenderer.renderTrace(client, channelId, trace, task);
      } catch (err) {
        console.warn(`[index.js] canvasRenderer.renderTrace failed for ${trace.taskId}, falling back to console log:`, err.message);
        stubRenderTrace(trace);
      }
    } else {
      stubRenderTrace(trace);
    }

    // BUGFIX: previously this called stateStore.reassignCommitment() here,
    // immediately, before anyone had actually confirmed anything — meaning
    // the bot silently reassigned work with zero human consent. Correct
    // behavior: record it as pending and wait for a real ✅ (reaction, via
    // confirmListener.js, or manually via /confirm-reassign).
    if (trace.status === "pending_confirm" && trace.finalOwner) {
      stateStore.addPendingNegotiation(trace, oooPerson.userId);

      if (client && channelId) {
        try {
          await confirmListener.postConfirmRequest(client, channelId, trace);
        } catch (err) {
          console.warn(`[index.js] confirmListener.postConfirmRequest failed for ${trace.taskId}, falling back to console log:`, err.message);
          stubListenForConfirm(trace);
        }
      } else {
        stubListenForConfirm(trace);
      }
    }

    // Loose end fix: escalated traces used to just get announced once and
    // then vanish — no way to find them later. Now persisted so /escalated
    // can list them and /resolve-escalation can act on them.
    if (trace.status === "escalated") {
      stateStore.addEscalatedNegotiation(trace, oooPerson.userId);
    }
  }

  const resolvedCount = traces.filter((t) => t.status === "pending_confirm").length;
  const escalatedCount = traces.filter((t) => t.status === "escalated").length;

  if (say) {
    const confirmNote = resolvedCount > 0 ? ` Use \`/confirm-reassign <taskId>\` or \`/reject-reassign <taskId>\` to act on pending ones.` : "";
    await say(
      `:zap: Ran negotiation for *${oooPerson.displayName}*: ${resolvedCount} task(s) awaiting confirmation, ${escalatedCount} escalated to a human.${confirmNote}`
    );
  }

  return traces;
}

// --- Trigger 1: explicit slash command, e.g. /go-ooo ---
app.command("/go-ooo", async ({ command, ack, say, client }) => {
  await ack();
  console.log(`[index.js] /go-ooo triggered by ${command.user_id}`);
  await runNegotiationFlow(command.user_id, say, client, command.channel_id);
});

// --- Manual confirm gate (interim, until B's confirmListener.js exists) ---
// This is a real, working confirmation step — not a stub — it's just
// command-based instead of reaction-based. Swapping in confirmListener.js
// later means replacing these two commands with a reaction_added listener
// that calls the same stateStore.confirmPendingNegotiation/rejectPendingNegotiation
// functions, so nothing else needs to change.
app.command("/confirm-reassign", async ({ command, ack, say }) => {
  await ack();
  const taskId = command.text.trim();
  if (!taskId) {
    await say("Usage: `/confirm-reassign <taskId>`");
    return;
  }
  const pending = stateStore.getPendingNegotiation(taskId);
  if (!pending) {
    await say(`No pending negotiation found for task \`${taskId}\`.`);
    return;
  }
  // Authorization: only the proposed new owner can confirm — this is them
  // agreeing to take the task, so it can't be done on their behalf.
  if (command.user_id !== pending.finalOwner) {
    await say(`Only <@${pending.finalOwner}> can confirm this reassignment.`);
    return;
  }
  const task = stateStore.confirmPendingNegotiation(taskId);
  await say(`:white_check_mark: Confirmed — "${task.title}" is now owned by <@${pending.finalOwner}>.`);
});

app.command("/reject-reassign", async ({ command, ack, say }) => {
  await ack();
  const taskId = command.text.trim();
  if (!taskId) {
    await say("Usage: `/reject-reassign <taskId>`");
    return;
  }
  const pending = stateStore.getPendingNegotiation(taskId);
  if (!pending) {
    await say(`No pending negotiation found for task \`${taskId}\`.`);
    return;
  }
  // Authorization: either the proposed new owner (declining) or the original
  // OOO person (cancelling) can reject — nobody else.
  if (command.user_id !== pending.finalOwner && command.user_id !== pending.fromUserId) {
    await say(`Only <@${pending.finalOwner}> or <@${pending.fromUserId}> can reject this reassignment.`);
    return;
  }
  stateStore.rejectPendingNegotiation(taskId);
  await say(`:x: Rejected — task \`${taskId}\` was not reassigned. It stays with the original owner for now.`);
});

// --- Loose end fix: escalated tasks used to vanish after the initial
// announcement, with no way to find them later. These three commands close
// that gap: list them, manually resolve one, and let someone come back from OOO. ---

app.command("/escalated", async ({ ack, say }) => {
  await ack();
  const escalated = stateStore.getAllEscalatedNegotiations();
  if (escalated.length === 0) {
    await say("No escalated tasks right now.");
    return;
  }
  const lines = escalated.map((e) => `• \`${e.taskId}\` (from <@${e.fromUserId}>) — no candidate accepted, needs manual assignment`);
  await say(`:rotating_light: *Escalated tasks awaiting manual assignment:*\n${lines.join("\n")}\n\nUse \`/resolve-escalation <taskId> <@user>\` to assign one.`);
});

app.command("/resolve-escalation", async ({ command, ack, say }) => {
  await ack();
  const [taskId, rawUser] = command.text.trim().split(/\s+/);
  const userIdMatch = rawUser ? rawUser.match(/<@([A-Z0-9]+)(\|[^>]+)?>/) : null;
  const toUserId = userIdMatch ? userIdMatch[1] : rawUser;

  if (!taskId || !toUserId) {
    await say("Usage: `/resolve-escalation <taskId> <@user>`");
    return;
  }
  const task = stateStore.resolveEscalation(taskId, toUserId);
  if (!task) {
    await say(`Could not resolve escalation for \`${taskId}\` — check the task ID and that <@${toUserId}> is a known user.`);
    return;
  }
  await say(`:white_check_mark: "${task.title}" manually assigned to <@${toUserId}>.`);
});

app.command("/back-from-ooo", async ({ command, ack, say }) => {
  await ack();
  const userId = command.user_id;
  const stillPending = stateStore.hasPendingNegotiations(userId);
  const stillEscalated = stateStore.getAllEscalatedNegotiations().some((e) => e.fromUserId === userId);

  stateStore.markActive(userId);

  if (stillPending || stillEscalated) {
    await say(
      `Welcome back — marked you active again. Heads up: you still have ${stillPending ? "pending confirmation(s)" : ""}${stillPending && stillEscalated ? " and " : ""}${stillEscalated ? "escalated task(s)" : ""} outstanding.`
    );
  } else {
    await say(`Welcome back — marked you active again.`);
  }
});

// --- Trigger 2: message-based overload/OOO signal detection ---
// Regex catches the obvious phrasing fast and free. If it misses AND
// GROQ_API_KEY is set, fall back to extraction.js's classifier to catch
// phrasing like "heads-down on family stuff till Monday" that regex can't.
const OOO_TRIGGER_PATTERN = /\b(out of office|ooo|swamped|underwater|overloaded)\b/i;

app.message(async ({ message, say, client }) => {
  if (!message.text || message.subtype) return; // ignore edits/joins/etc.

  let isSignal = OOO_TRIGGER_PATTERN.test(message.text);
  let matchedVia = "regex";

  if (!isSignal && process.env.GROQ_API_KEY) {
    try {
      const result = await classifyOOOSignal(message.text);
      if (result.isSignal && result.confidence >= 0.7) {
        isSignal = true;
        matchedVia = `groq (${result.reason})`;
      }
    } catch (err) {
      console.warn("[index.js] classifyOOOSignal failed, relying on regex only:", err.message);
    }
  }

  if (isSignal) {
    console.log(`[index.js] Message trigger matched via ${matchedVia} from ${message.user}: "${message.text}"`);
    await runNegotiationFlow(message.user, say, client, message.channel);
  }
});

(async () => {
  await app.start();
  console.log("⚡️ OOO Negotiation Agent is running (Socket Mode, Day 1 mock data)");
})();

module.exports = { app, runNegotiationFlow };