// stateStore.js
// Built by S as a working fallback while N is unavailable until Sunday — per
// BUILD_PLAN.md's fallback principle. Matches N's owned contract exactly
// (PersonState), so if N delivers a real version later, swapping it in is a
// drop-in replacement: same function names, same shapes, zero rework upstream.
//
// Simple JSON-file persistence (per BUILD_PLAN.md: "in-memory or simple JSON
// storage") so state survives a restart during the demo without needing a DB.

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "people.json");

// Seed people so candidateSelector.js has someone real to negotiate with even
// before every teammate has posted in Slack. Replace userIds with real Slack
// user IDs (e.g. via `/who-am-i` or your workspace admin page) when ready —
// nothing downstream depends on the IDs being fake.
function seedPeople() {
  return {
    U_JORDAN: {
      userId: "U_JORDAN",
      displayName: "Jordan",
      status: "active",
      openCommitments: [],
      currentLoad: 2,
    },
    U_SAM: {
      userId: "U_SAM",
      displayName: "Sam",
      status: "active",
      openCommitments: [],
      currentLoad: 4,
    },
    U_ALEX: {
      userId: "U_ALEX",
      displayName: "Alex",
      status: "active",
      openCommitments: [],
      currentLoad: 5,
    },
  };
}

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(seedPeople(), null, 2));
  }
}

function loadAll() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

function saveAll(people) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(people, null, 2));
}

/** @returns {object|null} PersonState, or null if unknown */
function getPersonState(userId) {
  const people = loadAll();
  return people[userId] || null;
}

/** @returns {object[]} all PersonState objects */
function getAllPersonStates() {
  return Object.values(loadAll());
}

/** @returns {object} map of userId -> PersonState */
function getAllPersonStatesById() {
  return loadAll();
}

/** Create or update a person's state, merging with any existing record. */
function upsertPersonState(userId, partialState = {}) {
  const people = loadAll();
  const existing = people[userId] || {
    userId,
    displayName: userId,
    status: "active",
    openCommitments: [],
    currentLoad: 0,
  };
  const updated = { ...existing, ...partialState, userId };
  people[userId] = updated;
  saveAll(people);
  return updated;
}

function markOOO(userId, displayName) {
  return upsertPersonState(userId, displayName ? { displayName, status: "ooo" } : { status: "ooo" });
}

function markActive(userId) {
  return upsertPersonState(userId, { status: "active" });
}

/** Replace a person's openCommitments wholesale (e.g. after extraction.js runs) and sync currentLoad. */
function setCommitments(userId, commitments) {
  return upsertPersonState(userId, { openCommitments: commitments, currentLoad: commitments.length });
}

/** Move a single task from one person's openCommitments to another's, after a negotiation resolves. */
function reassignCommitment(taskId, fromUserId, toUserId) {
  const people = loadAll();
  const fromPerson = people[fromUserId];
  const toPerson = people[toUserId];
  if (!fromPerson || !toPerson) return null;

  const idx = (fromPerson.openCommitments || []).findIndex((c) => c.id === taskId);
  if (idx === -1) return null;

  const [task] = fromPerson.openCommitments.splice(idx, 1);
  toPerson.openCommitments = toPerson.openCommitments || [];
  toPerson.openCommitments.push(task);
  toPerson.currentLoad = toPerson.openCommitments.length;
  fromPerson.currentLoad = fromPerson.openCommitments.length;

  saveAll(people);
  return task;
}

module.exports = {
  getPersonState,
  getAllPersonStates,
  getAllPersonStatesById,
  upsertPersonState,
  markOOO,
  markActive,
  setCommitments,
  reassignCommitment,
};
