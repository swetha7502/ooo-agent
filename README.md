# OOO Negotiation Agent

![Thumbnail](pictures\Automated_Task_Reassignment_Negotiation_Agent.png)

Every team has that moment: someone goes OOO or just gets slammed, and their open tasks either sit untouched or get dumped on whoever happens to be free. We wanted Slack to handle that handoff itself, but not as one bot bossily reassigning work top-down. Instead, we built it as two agents negotiating on behalf of two people. The person going OOO has an agent proposing their tasks. The candidate teammate has an agent deciding whether to accept, based on their own actual workload. A human still has the final say, ✅ or ❌, before anything actually moves. When the OOO person's back, the bot flags whether anything's still pending or was left unassigned, and they can mention the bot directly to search the workspace live for anything they need to catch up on.

## Try it yourself — no setup needed

The bot's already live, you just need to join and talk to it.

1. Join the workspace: `[INSERT SLACK WORKSPACE INVITE LINK HERE]`
2. Create your own channel (e.g. `#test-yourname`) instead of testing in a shared one — keeps your run clean from anyone else's in-progress test.
3. Invite the bot in: `/invite @ooo-negotiator`
4. Work through the checklist further down whenever you're ready.

It's deployed and stays connected the whole time, nothing needs to be started or restarted on our end for you to try it.

## Architecture

| File | What it does |
|---|---|
| `src/extraction.js` | Calls Groq (llama-3.3-70b) to detect OOO/overload signals and pull structured tasks out of a message |
| `src/negotiationEngine.js` | Pure, deterministic accept/counter/escalate logic — no network calls, no surprises in a live demo |
| `src/stateStore.js` | Tracks each person's OOO status, open tasks, and workload |
| `src/candidateSelector.js` | Scores candidates by workload + overlap with their existing tasks, skips anyone already holding another unconfirmed offer |
| `src/canvasRenderer.js` | Renders a negotiation as a threaded sequence of messages (not Slack's actual Canvas API, despite the name) |
| `src/confirmListener.js` | Handles the ✅/❌ confirm flow, auto-escalates to a human after 45s of silence |
| `src/index.js` | Bolt entry point — wires up every trigger and command below |

![Architecture diagram](pictures\Autonomous_Task_Handoff_Protocol_Flow.png)

## Commands

| Command | What it does |
|---|---|
| `/go-ooo` | Starts a negotiation for your open tasks |
| `/confirm-reassign <taskId>` | Accepts a task offered to you |
| `/reject-reassign <taskId>` | Declines a task offered to you |
| `/escalated` | Lists tasks nobody accepted, still needing a human to assign |
| `/resolve-escalation <taskId> <@user>` | Manually assigns an escalated task |
| `/back-from-ooo` | Marks you active again and flags whether anything's still pending confirmation or unassigned |
| `@ooo-negotiator <question>` | Searches the workspace live, see below |

## Real-time search

Mention the bot with a question and it searches the workspace live to help you decide who to reassign something to:

```
@ooo-negotiator who's discussed the onboarding document?
```

It comes back with up to 5 matching messages, each with a link straight to that message so you can jump right to it.

## Local setup

Only needed if you want to run your own copy.

1. `git clone` this repo, then `npm install`
2. Create a `.env` file with:
   ```
   GROQ_API_KEY=gsk_...
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   ```
3. Create a Slack app from `app-manifest.json`, install it, copy the bot token and app-level token into `.env`.
4. `npm start`

Demo data lives in `data/*.json`, delete it anytime to reset to a clean seeded state.

## Automated tests

Yep, we've got automated tests — see `test/` for the full suite.

## Manual test checklist

Seed data assumes a fresh `data/` folder: `Bob` load 2, `Charlie` load 4, `Alex` (a placeholder account, no real Slack user behind it) load 5. Anyone new who triggers `/go-ooo`, a message trigger, or `/back-from-ooo` gets registered on the spot, no setup needed, so your own account will show up as its own person the moment you try any command. If you're testing after someone else already has, load numbers may look different, that's expected.

**Solo**

1. **`/go-ooo`** — starts a negotiation. If you have no tracked tasks, two mock ones get seeded for you. Expect: high-priority task offered to the lightest-loaded candidate, low-priority task escalates if nobody's under threshold. Ends with a summary line.
2. **`/escalated`** — lists any tasks still needing manual assignment.
3. **`/resolve-escalation <taskId> Alex`** — assigns an escalated task to a teammate by plain display name (no `@` needed if they're already known to the bot — `Alex` always works since it has no real account to mention). Expect: confirmation message, task disappears from `/escalated`.
4. **`/confirm-reassign <taskId>`** on a task not offered to you — expect a rejection message, proving only the actual proposed owner can confirm.
5. Post **"I'm swamped this week"** with no slash command — expect a negotiation to fire automatically.
6. Post **"heads-down on family stuff till Monday"** — expect it to still fire, this time via the AI classifier, not the keyword list.
7. Run **`/go-ooo` twice** within 45 seconds — expect the second to be blocked with a cooldown message.
8. **`/back-from-ooo`** — expect a welcome-back message that also flags if you still have pending confirmations or escalated tasks outstanding (it tells you *that* something's outstanding, not the specifics of what or who).
9. **`@ooo-negotiator who's discussed the onboarding document?`** — expect up to 5 matching messages with links. Also try mentioning the bot with no question, expect it to ask you for one.
10. Run `/go-ooo` in a channel the bot's not in — expect a prompt to invite it first, instead of the flow silently half-running.

**Needs a second real person**

11. Have the proposed candidate react ✅ on their confirm prompt — expect "Confirmed by..." and the task actually moves. Try reacting as someone else, expect it to be ignored.
12. Concurrent negotiations targeting the same candidate — this one's hard to trigger live reliably, it's verified by an automated test instead, confirming the second negotiation escalates instead of double-booking.


