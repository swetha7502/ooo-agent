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

// --- Day 1 stubs (see BUILD_PLAN.md Section 4: Fallback rules) ---
// Replace these requires with N's real modules once delivered.
const {
  getMockOOOPerson,
  getMockCandidatesByTask,
  getMockPersonStatesById,
} = require("./mockData");

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
  // Day 2+: const oooPerson = await stateStore.getPersonState(oooUserId);
  const oooPerson = getMockOOOPerson();
  const personStatesById = getMockPersonStatesById();

  // Try real extraction against the person's recent messages. Fall back to
  // the mock person's openCommitments if GROQ_API_KEY is missing, the API
  // call fails, or no messages/commitments are found — never let extraction
  // block the demo (per BUILD_PLAN.md fallback principle).
  if (process.env.GROQ_API_KEY && client && channelId) {
    try {
      const recentMessages = await fetchRecentUserMessages(client, channelId, oooUserId);
      if (recentMessages.length > 0) {
        const extracted = await extractCommitments(recentMessages, channelId);
        if (extracted.length > 0) {
          oooPerson.openCommitments = extracted;
          console.log(`[index.js] Extracted ${extracted.length} real commitment(s) via Groq for ${oooPerson.displayName}`);
        }
      }
    } catch (err) {
      console.warn("[index.js] extractCommitments failed, falling back to mock commitments:", err.message);
    }
  }

  // Day 2+: const candidatesByTask = await candidateSelector.selectCandidates(oooPerson);
  const candidatesByTask = getMockCandidatesByTask();

  console.log(`[index.js] Running negotiation flow for ${oooPerson.displayName} (${oooPerson.openCommitments.length} open commitments)`);

  const traces = negotiate(oooPerson, candidatesByTask, personStatesById);

  for (const trace of traces) {
    stubRenderTrace(trace);
    stubListenForConfirm(trace);
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