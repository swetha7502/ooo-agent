// extraction.js
// Talks to Groq's OpenAI-compatible chat completions API (llama-3.3-70b) for
// two jobs:
//   1. classifyOOOSignal(messageText) -> does this message indicate the person
//      is going OOO or is overloaded? Backs up (doesn't replace) the keyword
//      regex in index.js, since regex alone misses phrasing like
//      "gonna be heads-down on family stuff till Monday".
//   2. extractCommitments(messages, sourceChannel) -> pulls open commitments
//      out of a person's recent messages, matching the openCommitments
//      contract: { id, title, priority, dueDate, sourceChannel }.

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

async function callGroq(systemPrompt, userPrompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in .env");
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  // Groq/OpenAI format, NOT Anthropic's data?.content?.[0]?.text
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Groq API returned no content");
  }
  return content;
}

function stripJsonFences(text) {
  return text.replace(/```json|```/g, "").trim();
}

// --- Job 1: OOO / overload signal classification ---

const OOO_SIGNAL_SYSTEM_PROMPT = `You classify Slack messages for a workplace OOO/overload detection agent.
Given a single message, decide if the sender is signaling that they are going
out-of-office, unavailable, or overloaded to the point that their work should
be reassigned.

Respond ONLY with JSON, no preamble, no markdown fences:
{"isSignal": true|false, "confidence": 0.0-1.0, "reason": "short reason"}

Examples:
Message: "heads down on a family thing until Monday, can't get to anything"
{"isSignal": true, "confidence": 0.9, "reason": "explicit unavailability with a return timeframe"}

Message: "just pushed the fix for the login bug"
{"isSignal": false, "confidence": 0.95, "reason": "routine status update, no unavailability signal"}

Message: "drowning in tickets this week, not sure I can keep up"
{"isSignal": true, "confidence": 0.85, "reason": "explicit overload language"}

Message: "lol this meeting could have been an email"
{"isSignal": false, "confidence": 0.98, "reason": "unrelated commentary"}`;

async function classifyOOOSignal(messageText) {
  const raw = await callGroq(OOO_SIGNAL_SYSTEM_PROMPT, messageText);
  const parsed = JSON.parse(stripJsonFences(raw));
  return parsed; // { isSignal, confidence, reason }
}

// --- Job 2: commitment extraction ---

const COMMITMENT_SYSTEM_PROMPT = `You extract open work commitments from a person's recent Slack messages, for
a task-reassignment negotiation agent. Given a list of messages from ONE
person, identify distinct open commitments (tasks they've said they own or
are working on that are NOT yet marked done).

For each commitment, output:
- title: short human-readable task description
- priority: "high" | "medium" | "low" — infer from urgency language
  ("urgent", "ASAP", "blocking", a near-term deadline = high; no signal = medium;
  "whenever", "no rush", far-future/no deadline = low)
- dueDate: ISO date string "YYYY-MM-DD" if a deadline is mentioned or clearly
  implied, otherwise null

Respond ONLY with a JSON array, no preamble, no markdown fences:
[{"title": "...", "priority": "high|medium|low", "dueDate": "YYYY-MM-DD"|null}]

If no open commitments are found, respond with [].

Example input messages:
["I'll review PR #482 by Thursday, it's blocking the release", "also need to update the onboarding doc at some point, no rush"]

Example output:
[
  {"title": "Review PR #482", "priority": "high", "dueDate": "2026-07-11"},
  {"title": "Update onboarding doc", "priority": "low", "dueDate": null}
]`;

async function extractCommitments(messages, sourceChannel) {
  if (!messages || messages.length === 0) return [];

  const userPrompt = JSON.stringify(messages);
  const raw = await callGroq(COMMITMENT_SYSTEM_PROMPT, userPrompt);
  const parsed = JSON.parse(stripJsonFences(raw));

  // Map into the exact openCommitments contract shape, generating ids.
  return parsed.map((item, i) => ({
    id: `task_${Date.now()}_${i}`,
    title: item.title,
    // The model is told to answer lowercase, but don't trust it: the engine
    // compares priority === "high" strictly, so "High" would lose the bump.
    priority: String(item.priority || "medium").toLowerCase(),
    dueDate: item.dueDate,
    sourceChannel,
  }));
}

module.exports = {
  classifyOOOSignal,
  extractCommitments,
};