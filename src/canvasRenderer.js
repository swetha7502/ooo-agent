// canvasRenderer.js
// Built by S as B's fallback (B unavailable) — matches the contract B owned:
// "renders NegotiationTrace visualization." Deliberately built as staggered
// THREADED MESSAGES rather than Slack's Canvas API: Canvas would need a
// canvases:write scope and behavior I can't verify end-to-end without live
// Slack access, and BUILD_PLAN.md's own fallback rule explicitly sanctions
// "post the negotiation trace as plain Slack messages instead of a Canvas —
// less polished, but the demo still tells the full story." This is that
// fallback, built to actually be demo-ready rather than a stub — this is
// also the piece that makes the negotiation VISIBLE, which is the entire
// reason this idea beat Crisis Coordinator, so it's worth it being real.

const EVENT_EMOJI = {
  propose: ":speech_balloon:",
  counter: ":arrows_counterclockwise:",
  accept: ":white_check_mark:",
  escalate: ":rotating_light:",
};

const STAGGER_MS = 900; // small delay between events so it reads as a live back-and-forth, not a dump

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Posts the full negotiation trace for one task as a threaded sequence of
 * messages: a header, then each propose/counter/accept/escalate event with a
 * short delay between them, then a final status line.
 *
 * @param {object} client - Bolt/Slack WebClient (from the event/command handler)
 * @param {string} channelId
 * @param {object} trace - NegotiationTrace (see BUILD_PLAN.md contract)
 * @param {object} [task] - matching openCommitments entry, for a readable title
 * @returns {object} the header message result (has .ts, useful for threading further)
 */
async function renderTrace(client, channelId, trace, task) {
  const header = await client.chat.postMessage({
    channel: channelId,
    text: `:handshake: *Negotiating reassignment* — "${task ? task.title : trace.taskId}"`,
  });

  for (const event of trace.events) {
    await sleep(STAGGER_MS);
    const emoji = EVENT_EMOJI[event.type] || "";
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: header.ts,
      text: `${emoji} *${event.fromAgent}* → *${event.toAgent}*: ${event.message}`,
    });
  }

  await sleep(STAGGER_MS);
  const statusLine =
    trace.status === "pending_confirm"
      ? `:hourglass_flowing_sand: Awaiting confirmation from <@${trace.finalOwner}>.`
      : `:rotating_light: Escalated — no candidate accepted, needs a human. Use \`/escalated\` to see all open ones.`;

  await client.chat.postMessage({
    channel: channelId,
    thread_ts: header.ts,
    text: statusLine,
  });

  return header;
}

module.exports = { renderTrace };
