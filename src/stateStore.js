// stateStore.js
// Tracks each person's OOO status, open commitments, and current workload.
// Simple JSON-file persistence so state survives a restart during a demo
// without needing a real database.

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "people.json");

// Seed people so candidateSelector.js has someone real to negotiate with even
// before every teammate has posted in Slack.
function seedPeople() {
  return {
    U0BHE8YRQ9E: {
      userId: "U0BHE8YRQ9E",
      displayName: "bgk02",
      status: "active",
      openCommitments: [],
      currentLoad: 2,
    },
    U0BGPN518DA: {
      userId: "U0BGPN518DA",
      displayName: "Swetha Sriram",
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

// If a data file is corrupted (crash mid-write, hand-editing), reset it to a
// fallback instead of throwing on every subsequent command until someone
// deletes the file by hand. This is demo state, so losing it beats crashing.
function safeParse(file, fallback) {
  const raw = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[stateStore] ${path.basename(file)} is corrupted (${err.message}) — resetting it.`);
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function loadAll() {
  ensureDataFile();
  return safeParse(DATA_FILE, seedPeople());
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
  // Shift load by one instead of recomputing from openCommitments.length —
  // seeded people carry a fictional baseline load (untracked work) that a
  // recompute would silently discard, flipping e.g. a load-5 persona to the
  // lightest candidate after receiving a single tracked task.
  toPerson.currentLoad = (toPerson.currentLoad ?? 0) + 1;
  fromPerson.currentLoad = Math.max(0, (fromPerson.currentLoad ?? 0) - 1);

  saveAll(people);
  return task;
}

const PENDING_FILE = path.join(__dirname, "..", "data", "pendingNegotiations.json");

function ensurePendingFile() {
  const dir = path.dirname(PENDING_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, JSON.stringify({}, null, 2));
}

function loadPending() {
  ensurePendingFile();
  return safeParse(PENDING_FILE, {});
}

function savePending(pending) {
  ensurePendingFile();
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
}

/**
 * Record a NegotiationTrace as awaiting human confirmation. Does NOT move the
 * task between people — that only happens via confirmPendingNegotiation(),
 * once a real ✅ (from confirmListener.js, or manually via /confirm-reassign
 * in the meantime) is received.
 */
function addPendingNegotiation(trace, fromUserId) {
  const pending = loadPending();
  pending[trace.taskId] = { ...trace, fromUserId, createdAt: new Date().toISOString() };
  savePending(pending);
  return pending[trace.taskId];
}

function getPendingNegotiation(taskId) {
  const pending = loadPending();
  return pending[taskId] || null;
}

function getAllPendingNegotiations() {
  return Object.values(loadPending());
}

/** Person has at least one negotiation awaiting confirmation right now. */
function hasPendingNegotiations(userId) {
  return getAllPendingNegotiations().some((p) => p.fromUserId === userId);
}

/**
 * Whether a candidate is currently the tentative (unconfirmed) finalOwner of
 * any pending negotiation — i.e. holding a task offer open. Prevents a second,
 * near-simultaneous negotiation from picking the same candidate before either
 * one has been confirmed. The hold is released automatically once the
 * pending entry is cleared, via confirmPendingNegotiation or
 * rejectPendingNegotiation (reject, or the confirm-listener timeout).
 */
function isCandidateHeld(userId) {
  return getAllPendingNegotiations().some((p) => p.finalOwner === userId);
}

/** Attach the Slack message ref (channel + ts) that a pending negotiation's confirm prompt was posted as, so reaction_added can look it up. */
function setPendingNegotiationMessageRef(taskId, channel, ts) {
  const pending = loadPending();
  if (!pending[taskId]) return null;
  pending[taskId].messageChannel = channel;
  pending[taskId].messageTs = ts;
  savePending(pending);
  return pending[taskId];
}

/** Find the pending negotiation whose confirm prompt matches a given message. */
function findPendingNegotiationByMessage(channel, ts) {
  return getAllPendingNegotiations().find((p) => p.messageChannel === channel && p.messageTs === ts) || null;
}

/** Called once a real ✅ confirmation is received — actually moves the task. */
function confirmPendingNegotiation(taskId) {
  const pending = loadPending();
  const entry = pending[taskId];
  if (!entry) return null;

  const task = reassignCommitment(taskId, entry.fromUserId, entry.finalOwner);
  if (!task) return null; // reassign failed (task/users gone) — keep the pending entry so it isn't silently lost

  delete pending[taskId];
  savePending(pending);
  return task;
}

/** Called on a ❌, or a timeout — drops the pending entry without reassigning. */
function rejectPendingNegotiation(taskId) {
  const pending = loadPending();
  delete pending[taskId];
  savePending(pending);
}

const ESCALATED_FILE = path.join(__dirname, "..", "data", "escalatedNegotiations.json");

function ensureEscalatedFile() {
  const dir = path.dirname(ESCALATED_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ESCALATED_FILE)) fs.writeFileSync(ESCALATED_FILE, JSON.stringify({}, null, 2));
}

function loadEscalated() {
  ensureEscalatedFile();
  return safeParse(ESCALATED_FILE, {});
}

function saveEscalated(escalated) {
  ensureEscalatedFile();
  fs.writeFileSync(ESCALATED_FILE, JSON.stringify(escalated, null, 2));
}

/** Record a NegotiationTrace that escalated (no candidate accepted) so it's discoverable later. */
function addEscalatedNegotiation(trace, fromUserId) {
  const escalated = loadEscalated();
  escalated[trace.taskId] = { ...trace, fromUserId, createdAt: new Date().toISOString() };
  saveEscalated(escalated);
  return escalated[trace.taskId];
}

function getAllEscalatedNegotiations() {
  return Object.values(loadEscalated());
}

/** A human manually decides who takes an escalated task — moves it and clears the escalation record. */
function resolveEscalation(taskId, toUserId) {
  const escalated = loadEscalated();
  const entry = escalated[taskId];
  if (!entry) return null;

  const task = reassignCommitment(taskId, entry.fromUserId, toUserId);
  if (!task) return null; // reassignCommitment failed (unknown users / task not found)

  delete escalated[taskId];
  saveEscalated(escalated);
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
  addPendingNegotiation,
  getPendingNegotiation,
  getAllPendingNegotiations,
  hasPendingNegotiations,
  isCandidateHeld,
  setPendingNegotiationMessageRef,
  findPendingNegotiationByMessage,
  confirmPendingNegotiation,
  rejectPendingNegotiation,
  addEscalatedNegotiation,
  getAllEscalatedNegotiations,
  resolveEscalation,
};