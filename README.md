# OOO Negotiation Agent

Per-person Slack agents that negotiate task reassignment when someone goes
OOO or signals overload. Each side of a reassignment is represented by its
own agent (the OOO person's agent proposes, the candidate's agent
accepts/declines based on their own workload) — a human always confirms the
final handoff before it's real.

## Architecture

- `src/extraction.js` — Groq API (llama-3.3-70b) classifies OOO/overload
  signals in messages and extracts structured open commitments.
- `src/negotiationEngine.js` — pure, deterministic accept/counter/escalate
  logic (no network calls), so a live demo never produces a surprise outcome.
- `src/stateStore.js` — tracks each person's OOO status, open commitments,
  and workload; simple JSON-file persistence.
- `src/candidateSelector.js` — scores candidates by workload + keyword
  overlap with their existing tasks; skips anyone currently holding another
  unconfirmed offer (see "Known limitations" below).
- `src/canvasRenderer.js` — renders a negotiation as a threaded sequence of
  Slack messages (a "negotiation trace," not Slack's actual Canvas API).
- `src/confirmListener.js` — ✅/❌ reaction-based confirm/reject flow, with a
  45s fake timeout that auto-escalates to a human if nobody responds.
- `src/index.js` — Bolt app entry point; wires up `/go-ooo` and message-based
  triggers, orchestrates the flow, and provides manual
  `/confirm-reassign`, `/reject-reassign`, `/escalated`, `/resolve-escalation`,
  `/back-from-ooo` commands alongside the reaction-based confirm flow.

## Setup

1. `npm install`
2. Create a `.env` file (gitignored) with:
   ```
   GROQ_API_KEY=gsk_...
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   ```
3. Install the app into your Slack workspace using `app-manifest.json`
   (Slack API dashboard → create app from manifest), then grab the bot token
   and app-level token into `.env` above.
4. `npm start`

Demo state lives in `data/*.json` (gitignored, auto-created). Delete those
files any time to reset to the seeded starting state — safe, nothing
persists there that matters outside a single demo run.

## Automated tests

No test framework — plain Node scripts, run individually:

```
node test/negotiationEngine.test.js   # negotiation accept/counter/escalate rules
node test/confirmGate.test.js         # reassignment only happens after explicit confirm
node test/escalation.test.js          # escalated tasks persist + /resolve-escalation
node test/integration.test.js         # stateStore + candidateSelector + negotiationEngine together
node test/bModules.test.js            # canvasRenderer + confirmListener against a mock Slack client
node test/Extraction.test.js          # needs GROQ_API_KEY in .env, hits the real Groq API
```

All six should pass clean. Each backs up and restores `data/*.json` around
itself, so they're safe to run against a live demo's data directory.

## Manual live-sandbox testing

Unit tests don't touch real Slack. Once the bot is running
(`npm start`) and connected (Socket Mode), work through this checklist. Seed
data assumptions below are for a **fresh** `data/` directory (delete
`data/*.json` and restart for predictable numbers): `bgk02` load 2, `Swetha
Sriram` load 4, `Alex` (fake account, no real Slack user) load 5.
`LOAD_THRESHOLD = 3`, `PRIORITY_BUMP = 1`, `COOLDOWN_MS = 3 min`,
`FAKE_TIMEOUT_MS = 45s`.

Some of these are inherently two-person tests (that's the point of the
feature) — marked below.

### Solo tests (one real account, e.g. `bgk02`)

**1. Basic negotiation trigger**
- Run `/go-ooo`.
- Expected: mock commitments seeded (`task_001` high priority, `task_002`
  low priority). Candidates considered = Swetha (load 4), Alex (load 5) —
  you're excluded from your own negotiation.
  - `task_001`: Swetha's load is over threshold but the task is
    high-priority, so she accepts → trace ends "awaiting confirmation from
    Swetha."
  - `task_002`: Swetha declines (low priority, no bump), Alex declines too →
    escalates.
  - Final message: *"Ran negotiation for bgk02: 1 task(s) awaiting
    confirmation, 1 escalated to a human."*

**2. Escalation list**
- Run `/escalated`.
- Expected: lists `task_002` (from you).

**3. Resolve an escalation**
- Run `/resolve-escalation task_002 Alex` — type `Alex` as plain text, no
  `@`, since Alex has no real Slack account to mention/autocomplete.
- Expected: *"'Update onboarding doc' manually assigned to `<@U_ALEX>`."*
  `/escalated` should now be empty.

**4. Manual confirm authorization check**
- With `task_001` still pending (within 45s of step 1), run
  `/confirm-reassign task_001`.
- Expected: rejected — *"Only <@Swetha> can confirm this reassignment."*
  Proves you can't confirm someone else's offer on their behalf.
- If you wait past 45s first, expect instead: *"No pending negotiation found
  for task task_001."* — also correct, since it already auto-escalated.

**5. Message-trigger, regex path**
- Post a plain message containing a trigger word, e.g. "I'm swamped this
  week" (no slash command).
- Expected: negotiation fires automatically. Terminal shows
  `[index.js] Message trigger matched via regex from ...`.

**6. Message-trigger, Groq/AI path**
- Post something the regex genuinely won't catch — the regex list is
  `out of office|ooo|swamped|underwater|overloaded`, so avoid those words.
  E.g.: "heads-down on family stuff till Monday."
- Expected: still triggers negotiation. Terminal shows `matched via groq
  (...)` with Groq's classification reason — confirms the AI classifier, not
  just regex, is catching it.

**7. Cooldown guard**
- Run `/go-ooo` twice within ~3 minutes.
- Expected: second attempt replies *"Already running a negotiation for you
  recently — give it a few minutes before triggering again."*

**8. Back from OOO**
- Run `/back-from-ooo`.
- Expected: *"Welcome back — marked you active again."* Plus a note about
  outstanding pending/escalated items if any remain.

### Needs a second real account (e.g. Swetha)

**9. Reaction confirm (✅/❌)**
- Have Swetha react ✅ on a confirm prompt addressed to her (or trigger her
  own `/go-ooo` — since you (load 2) will be her top candidate and accept
  immediately).
- Expected: bot posts *"Confirmed by <@Swetha> — ... is now theirs."*
  in-thread; the task actually moves (check load numbers via a fresh
  `/go-ooo` or `/escalated`).
- Also test: have someone **other than** the named candidate react ✅ —
  expected to be silently ignored, nothing happens.

**10. Concurrent-negotiation race (double-booking guard)**
- Hard to reproduce live with only two real accounts, because whichever
  person goes OOO always gets the *other* real person as their top
  candidate — there's no natural overlap to double-book on. Verified instead
  via a scripted test: two simulated OOO triggers for different people both
  targeting the same lightest-loaded candidate; confirmed the second
  negotiation skips a candidate who's already the unconfirmed tentative
  owner of another pending offer, and escalates instead of double-booking.

## Known limitations (accepted, not fixed)

1. **`currentLoad` gets silently reset by real reassignments.** Seed values
   (2 / 4 / 5) represent an assumed starting workload, but
   `stateStore.reassignCommitment()` recalculates `currentLoad` as
   `openCommitments.length` on every reassignment. The first time a seeded
   person actually receives a tracked task, their load "resets" to just that
   count, discarding the fictional baseline. Practical effect: a
   deliberately-overloaded persona (e.g. Alex, seeded at load 5) can
   suddenly look like the *lightest*-loaded candidate after receiving even
   one real task, and start accepting offers that persona was meant to
   reliably decline. Workaround: reset `data/*.json` right before an actual
   demo run rather than mid-rehearsal.
2. **`/resolve-escalation`'s user argument isn't always a real Slack
   mention.** Slack's slash-command text field doesn't reliably convert
   `@name` into `<@USERID>` markup the way a regular message does, even when
   picked from the autocomplete dropdown. The command accepts a real mention
   (`<@U123>`) or a plain display name matched case-insensitively against
   known people in `stateStore` — but a typo or unknown name still just
   produces a generic "couldn't find that user" message.
3. **Two negotiations triggered back-to-back for different OOO people could
   still both target the same candidate** in scenarios where the top
   candidate for both isn't the same person as either OOO trigger (e.g. via
   a third seeded person) faster than either negotiation completes its
   synchronous candidate-selection + hold-recording step. In practice this
   window is now essentially closed (see item 10 above), but it relies on
   `stateStore.addPendingNegotiation` running before any `await` in
   `index.js`'s `runNegotiationFlow` — don't reorder that without
   re-verifying.
