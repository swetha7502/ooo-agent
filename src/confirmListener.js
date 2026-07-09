// confirmListener.js
// Built by S as B's fallback (B unavailable) — matches the contract B owned:
// "reaction listener + short fake timeout (30–60 sec for demo, not real
// scheduling)." This is a real, working reaction-based confirm/reject flow,
// not a stub — it's a genuine alternative to (not a replacement for) the
// manual /confirm-reassign and /reject-reassign commands in index.js; having
// both gives the demo two ways to confirm in case one has issues live.

const stateStore = require("./stateStore");

const CONFIRM_EMOJI = "white_check_mark";
const REJECT_EMOJI = "x";
const FAKE_TIMEOUT_MS = 45 * 1000; // within BUILD_PLAN.md's 30–60s window

// taskId -> Timeout handle, so a real confirm/reject can cancel the fake timeout.
const pendingTimeouts = new Map();

function clearPendingTimeout(taskId) {
  const t = pendingTimeouts.get(taskId);
  if (t) {
    clearTimeout(t);
    pendingTimeouts.delete(taskId);
  }
}

/**
 * Posts the ✅/❌ confirmation prompt for a resolved negotiation, records the
 * message ref against the pending negotiation (so reaction_added can find
 * it), and starts the fake timeout — auto-escalates if nobody reacts in time.
 *
 * @param {object} client - Bolt/Slack WebClient
 * @param {string} channelId
 * @param {object} trace - NegotiationTrace with status "pending_confirm"
 */
async function postConfirmRequest(client, channelId, trace) {
  if (trace.status !== "pending_confirm" || !trace.finalOwner) return null;

  const result = await client.chat.postMessage({
    channel: channelId,
    text: `<@${trace.finalOwner}>, react :white_check_mark: to confirm taking "\`${trace.taskId}\`" or :x: to reject. Auto-escalates in ${FAKE_TIMEOUT_MS / 1000}s if there's no response.`,
  });

  stateStore.setPendingNegotiationMessageRef(trace.taskId, result.channel, result.ts);

  const timeout = setTimeout(async () => {
    const stillPending = stateStore.getPendingNegotiation(trace.taskId);
    if (!stillPending) return; // already confirmed or rejected in the meantime

    stateStore.rejectPendingNegotiation(trace.taskId);
    stateStore.addEscalatedNegotiation(trace, stillPending.fromUserId);

    try {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: result.ts,
        text: `:alarm_clock: No response within ${FAKE_TIMEOUT_MS / 1000}s — auto-escalating \`${trace.taskId}\` to a human. Use \`/escalated\` to see it.`,
      });
    } catch (err) {
      console.warn("[confirmListener] Could not post timeout message:", err.message);
    }
    pendingTimeouts.delete(trace.taskId);
  }, FAKE_TIMEOUT_MS);

  pendingTimeouts.set(trace.taskId, timeout);
  return result;
}

/**
 * Call once at startup to wire the reaction_added listener onto the Bolt app.
 * Enforces the same authorization rule as the manual slash commands: only
 * the proposed new owner can confirm; either the new owner or the original
 * OOO person can reject.
 */
function registerConfirmListener(app) {
  app.event("reaction_added", async ({ event, client }) => {
    if (event.reaction !== CONFIRM_EMOJI && event.reaction !== REJECT_EMOJI) return;
    if (event.item.type !== "message") return;

    const pending = stateStore.findPendingNegotiationByMessage(event.item.channel, event.item.ts);
    if (!pending) return; // reaction on some unrelated message, ignore

    const isFinalOwner = event.user === pending.finalOwner;
    const isFromUser = event.user === pending.fromUserId;

    if (event.reaction === CONFIRM_EMOJI) {
      if (!isFinalOwner) return; // only the proposed owner can accept
      clearPendingTimeout(pending.taskId);
      const task = stateStore.confirmPendingNegotiation(pending.taskId);
      if (task) {
        await client.chat.postMessage({
          channel: event.item.channel,
          thread_ts: event.item.ts,
          text: `:white_check_mark: Confirmed by <@${event.user}> — "${task.title}" is now theirs.`,
        });
      }
    } else if (event.reaction === REJECT_EMOJI) {
      if (!isFinalOwner && !isFromUser) return; // only the proposed owner or original owner can reject
      clearPendingTimeout(pending.taskId);
      stateStore.rejectPendingNegotiation(pending.taskId);
      await client.chat.postMessage({
        channel: event.item.channel,
        thread_ts: event.item.ts,
        text: `:x: Rejected by <@${event.user}> — task \`${pending.taskId}\` was not reassigned.`,
      });
    }
  });
}

module.exports = { postConfirmRequest, registerConfirmListener };
