// mockData.js
// Hardcoded fake data matching the frozen PersonState + ReassignmentCandidate
// contracts (see BUILD_PLAN.md). Used so S can build and test negotiationEngine.js
// and index.js without waiting on N's stateStore.js / candidateSelector.js.
//
// Swap rule: once N's real modules land, replace calls to these mock functions
// with calls to N's exports. Nothing downstream (negotiationEngine, index.js)
// should need to change, since the shape is identical.

// --- Mock PersonState objects (normally owned by N's stateStore.js) ---
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
  U_JORDAN: {
    userId: "U_JORDAN",
    displayName: "Jordan",
    status: "active",
    openCommitments: [],
    currentLoad: 2, // under threshold -> should accept
  },
  U_SAM: {
    userId: "U_SAM",
    displayName: "Sam",
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

// --- Mock ReassignmentCandidate objects (normally owned by N's candidateSelector.js) ---
// Keyed by taskId, ordered by confidence desc (highest confidence tried first).
const mockCandidatesByTask = {
  task_001: {
    taskId: "task_001",
    candidates: [
      { userId: "U_SAM", displayName: "Sam", confidence: 0.8, reason: "past PR reviewer on this repo" },
      { userId: "U_JORDAN", displayName: "Jordan", confidence: 0.6, reason: "same team, lighter load" },
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
