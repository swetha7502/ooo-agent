// canvasRenderer.js
// Renders a NegotiationTrace as a threaded sequence of staggered Slack
// messages — a "negotiation trace" / activity log, not Slack's actual Canvas
// API. Keeping it to plain postMessage calls avoids needing a canvases:write
// scope, and it's what actually makes a negotiation visible during a demo.

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
 * @param {object} trace - NegotiationTrace
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
