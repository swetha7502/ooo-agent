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

// Last-resort fallback only — used if stateStore/candidateSelector throw.
// N's real modules, if delivered later, are a drop-in swap for stateStore.js
// and candidateSelector.js above; nothing else needs to change.
const { getMockOOOPerson, getMockCandidatesByTask } = require("./mockData");

// TODO(B): replace with real src/canvasRenderer.js — renderTrace(trace) -> posts/updates a Canvas
function stubRenderTrace(trace) {
  console.log(`[canvasRenderer STUB] would render trace for ${trace.taskId}:`, JSON.stringify(trace, null, 2));
}

// TODO(B): replace with real src/confirmListener.js — listenForConfirm(trace) -> watches for ✅/❌
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
    stubRenderTrace(trace);
    stubListenForConfirm(trace);

    // Apply the reassignment to the state store so load numbers stay accurate
    // for future negotiations, even before B's confirmListener.js exists to
    // gate this on an actual ✅ reaction.
    if (trace.status === "pending_confirm" && trace.finalOwner) {
      try {
        stateStore.reassignCommitment(trace.taskId, oooPerson.userId, trace.finalOwner);
      } catch (err) {
        console.warn(`[index.js] Could not persist reassignment for ${trace.taskId}:`, err.message);
      }
    }
  }

  const resolvedCount = traces.filter((t) => t.status === "pending_confirm").length;
  const escalatedCount = traces.filter((t) => t.status === "escalated").length;

  if (say) {
    await say(
      `:zap: Ran negotiation for *${oooPerson.displayName}*: ${resolvedCount} task(s) resolved pending confirm, ${escalatedCount} escalated to a human.`
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
