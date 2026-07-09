// candidateSelector.js
// Built by S as a working fallback while N is unavailable until Sunday — per
// BUILD_PLAN.md's fallback principle. Matches N's owned contract exactly
// (ReassignmentCandidate). Simple, deterministic version per the plan
// ("start with a simple version (keyword/channel-history match), add RTS API
// lookup only if time allows") — no RTS lookup here; that's the natural
// next step for N to bolt on if there's time.
//
// Scoring is deterministic on purpose (same rationale as negotiationEngine.js):
// a live demo should never produce a surprise. Two signals, blended:
//   - load: lower currentLoad -> higher score (weighted more heavily)
//   - keyword overlap: task title words that also appear in the candidate's
//     own current commitment titles -> small confidence boost ("related
//     past work"), a cheap stand-in for real skill/history matching.

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function keywordOverlapScore(task, candidateState) {
  const taskWords = new Set(tokenize(task.title));
  if (taskWords.size === 0) return 0;

  const candidateWords = new Set(
    (candidateState.openCommitments || []).flatMap((c) => tokenize(c.title))
  );

  let overlap = 0;
  for (const w of taskWords) {
    if (candidateWords.has(w)) overlap += 1;
  }
  return overlap / taskWords.size; // 0..1
}

function loadScore(candidateState, maxLoad = 6) {
  const load = candidateState.currentLoad ?? 0;
  return Math.max(0, 1 - load / maxLoad); // lower load -> higher score, 0..1
}

/** @returns {{confidence: number, reason: string}} */
function scoreCandidate(task, candidateState) {
  const kw = keywordOverlapScore(task, candidateState);
  const load = loadScore(candidateState);
  const confidence = Math.round((0.7 * load + 0.3 * kw) * 100) / 100;
  const reason =
    kw > 0
      ? `lighter load (${candidateState.currentLoad}) with related past work`
      : `lighter load (${candidateState.currentLoad})`;
  return { confidence, reason };
}

/** All active (non-OOO) candidates for one task, best match first. */
function selectCandidatesForTask(task, oooPerson, allPersonStates, maxCandidates = 3) {
  const pool = allPersonStates.filter(
    (p) => p.userId !== oooPerson.userId && p.status !== "ooo"
  );

  const scored = pool.map((p) => {
    const { confidence, reason } = scoreCandidate(task, p);
    return { userId: p.userId, displayName: p.displayName, confidence, reason };
  });

  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, maxCandidates);
}

/**
 * @param {object} oooPerson - PersonState of the person going OOO
 * @param {object} allPersonStatesById - map of userId -> PersonState (from stateStore.getAllPersonStatesById())
 * @returns {object} map of taskId -> ReassignmentCandidate
 */
function selectCandidates(oooPerson, allPersonStatesById) {
  const allPersonStates = Object.values(allPersonStatesById);
  const candidatesByTask = {};

  for (const task of oooPerson.openCommitments || []) {
    candidatesByTask[task.id] = {
      taskId: task.id,
      candidates: selectCandidatesForTask(task, oooPerson, allPersonStates),
    };
  }

  return candidatesByTask;
}

module.exports = {
  selectCandidates,
  selectCandidatesForTask,
  scoreCandidate,
};
