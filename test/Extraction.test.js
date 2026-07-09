// extraction.test.js
// Run locally (needs GROQ_API_KEY in .env, since this sandbox can't reach
// api.groq.com):
//   node test/extraction.test.js

require("dotenv").config();
const { classifyOOOSignal, extractCommitments } = require("../src/extraction");

async function main() {
  console.log("=== classifyOOOSignal ===\n");
  const signalTests = [
    "heads down on a family thing until Monday, can't get to anything",
    "just pushed the fix for the login bug",
    "drowning in tickets this week, not sure I can keep up",
  ];
  for (const text of signalTests) {
    const result = await classifyOOOSignal(text);
    console.log(`"${text}"\n  ->`, result, "\n");
  }

  console.log("=== extractCommitments ===\n");
  const messages = [
    "I'll review PR #482 by Thursday, it's blocking the release",
    "also need to update the onboarding doc at some point, no rush",
  ];
  const commitments = await extractCommitments(messages, "C0BEVB31K1Q");
  console.log(JSON.stringify(commitments, null, 2));
}

main().catch((err) => {
  console.error("Test failed:", err.message);
  process.exit(1);
});