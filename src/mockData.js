// mockData.js
// Hardcoded fake data matching the PersonState + ReassignmentCandidate
// shapes. Used to exercise negotiationEngine.js and index.js, and as a
// fallback when real Slack/API data isn't available (e.g. no GROQ_API_KEY
// set, or a fresh user with no tracked commitments yet).

// --- Mock PersonState objects (normally sourced from stateStore.js) ---
const mockPeople = {
  U_PRIYA: {
    userId: "U_PRIYA",
    displayName: "Priya",
    status: "ooo",
    openCommitments: [
      {
        id: "task_001",
        title: "Review PR #482",
        priority: "high",
        dueDate: "2026-07-11",
        sourceChannel: "C0BEVB31K1Q",
      },
      {
        id: "task_002",
        title: "Update onboarding doc",
        priority: "low",
        dueDate: "2026-07-14",
        sourceChannel: "C0BEVB31K1Q",
      },
    ],
    currentLoad: 3,
  },
  U0BHE8YRQ9E: {
    userId: "U0BHE8YRQ9E",
    displayName: "bgk02",
    status: "active",
    openCommitments: [],
    currentLoad: 2, // under threshold -> should accept
  },
  U0BGPN518DA: {
    userId: "U0BGPN518DA",
    displayName: "Swetha Sriram",
    status: "active",
    openCommitments: [],
    currentLoad: 4, // over threshold -> only accepts high priority (bump)
  },
  U_ALEX: {
    userId: "U_ALEX",
    displayName: "Alex",
    status: "active",
    openCommitments: [],
    currentLoad: 5, // over threshold + bump -> always counters/declines
  },
};

// --- Mock ReassignmentCandidate objects (normally sourced from candidateSelector.js) ---
// Keyed by taskId, ordered by confidence desc (highest confidence tried first).
const mockCandidatesByTask = {
  task_001: {
    taskId: "task_001",
    candidates: [
      { userId: "U0BGPN518DA", displayName: "Swetha Sriram", confidence: 0.8, reason: "past PR reviewer on this repo" },
      { userId: "U0BHE8YRQ9E", displayName: "bgk02", confidence: 0.6, reason: "same team, lighter load" },
    ],
  },
  task_002: {
    taskId: "task_002",
    candidates: [
      { userId: "U_ALEX", displayName: "Alex", confidence: 0.5, reason: "wrote the original doc" },
    ],
  },
};

function getMockPersonStates() {
  return Object.values(mockPeople);
}

function getMockPersonStatesById() {
  return mockPeople;
}

function getMockOOOPerson() {
  return mockPeople.U_PRIYA;
}

function getMockCandidatesByTask() {
  return mockCandidatesByTask;
}

module.exports = {
  mockPeople,
  mockCandidatesByTask,
  getMockPersonStates,
  getMockPersonStatesById,
  getMockOOOPerson,
  getMockCandidatesByTask,
};
