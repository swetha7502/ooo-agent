// negotiationEngine.js
// Pure decision logic for reassignment negotiation — no Slack or network
// calls, so it's fully unit-testable on its own. Consumes a PersonState and
// ReassignmentCandidate list, produces NegotiationEvent[] and a
// NegotiationTrace per task.
//
// Rule set is intentionally simple and DETERMINISTIC (not LLM-generated) so the
// live demo never produces a surprise outcome:
//
//   1. Load threshold: a candidate whose currentLoad is below LOAD_THRESHOLD
//      accepts immediately.
//   2. Priority bump: if the task is "high" priority, a candidate may accept
//      even one unit over threshold (currentLoad <= LOAD_THRESHOLD + PRIORITY_BUMP).
//   3. Otherwise the candidate counters (declines), and the engine moves to the
//      next candidate in the list, up to MAX_ROUNDS.
//   4. If no candidate accepts within MAX_ROUNDS, the task escalates to a human.

const LOAD_THRESHOLD = 3; // currentLoad strictly below this = normal capacity
const PRIORITY_BUMP = 1; // high-priority tasks can push a candidate 1 unit over threshold
const MAX_ROUNDS = 3; // hard cap on negotiation rounds per task

/**
 * Decide whether a candidate accepts a given task, using the two-variable rule.
 * @param {object} task - single item from PersonState.openCommitments
 * @param {object} candidateState - PersonState of the candidate being asked
 * @returns {{accepted: boolean, reasonNote: string}}
 */
function evaluateCandidate(task, candidateState) {
  if (!candidateState) {
    return { accepted: false, reasonNote: "no state available for candidate" };
  }

  const { currentLoad } = candidateState;

  if (currentLoad < LOAD_THRESHOLD) {
    return { accepted: true, reasonNote: `load ${currentLoad} is under threshold (${LOAD_THRESHOLD})` };
  }

  if (task.priority === "high" && currentLoad <= LOAD_THRESHOLD + PRIORITY_BUMP) {
    return {
      accepted: true,
      reasonNote: `load ${currentLoad} exceeds threshold but task is high priority (bump allows up to ${LOAD_THRESHOLD + PRIORITY_BUMP})`,
    };
  }

  return { accepted: false, reasonNote: `load ${currentLoad} exceeds threshold, task priority "${task.priority}" doesn't justify a bump` };
}

/**
 * Negotiate reassignment for a single task against an ordered candidate list.
 * @param {object} oooPerson - PersonState of the person going OOO
 * @param {object} task - single openCommitments entry belonging to oooPerson
 * @param {object[]} candidateList - ReassignmentCandidate.candidates, ordered by confidence desc
 * @param {object} personStatesById - map of userId -> PersonState, for looking up candidate load
 * @returns {{events: object[], trace: object}} NegotiationEvent[] and a NegotiationTrace
 */
function negotiateTask(oooPerson, task, candidateList, personStatesById) {
  const events = [];
  const fromAgent = `${oooPerson.displayName}'s Agent`;
  let round = 0;
  let finalOwner = null;
  let status = "escalated";

  const candidates = candidateList || [];

  for (let i = 0; i < candidates.length && round < MAX_ROUNDS; i++) {
    round += 1;
    const candidate = candidates[i];
    const candidateState = personStatesById[candidate.userId];
    const toAgent = `${candidate.displayName}'s Agent`;

    events.push({
      taskId: task.id,
      round,
      type: "propose",
      fromAgent,
      toAgent,
      message: `Proposing ${candidate.displayName} take "${task.title}", due ${task.dueDate}`,
      timestamp: new Date().toISOString(),
    });

    const { accepted, reasonNote } = evaluateCandidate(task, candidateState);

    if (accepted) {
      events.push({
        taskId: task.id,
        round,
        type: "accept",
        fromAgent: toAgent,
        toAgent: fromAgent,
        message: `${candidate.displayName} accepts "${task.title}" (${reasonNote})`,
        timestamp: new Date().toISOString(),
      });
      finalOwner = candidate.userId;
      status = "pending_confirm"; // awaits human confirmation via confirmListener.js
      break;
    } else {
      events.push({
        taskId: task.id,
        round,
        type: "counter",
        fromAgent: toAgent,
        toAgent: fromAgent,
        message: `${candidate.displayName} declines "${task.title}" (${reasonNote})`,
        timestamp: new Date().toISOString(),
      });
      // loop continues to next candidate, if any and if rounds remain
    }
  }

  if (!finalOwner) {
    events.push({
      taskId: task.id,
      round: round + 1 <= MAX_ROUNDS ? round + 1 : round,
      type: "escalate",
      fromAgent,
      toAgent: "Human",
      message: `No candidate accepted "${task.title}" within ${MAX_ROUNDS} rounds — escalating to a human.`,
      timestamp: new Date().toISOString(),
    });
    status = "escalated";
  }

  const trace = {
    taskId: task.id,
    status,
    events,
    finalOwner,
  };

  return { events, trace };
}

/**
 * Negotiate reassignment for every open commitment belonging to an OOO person.
 * @param {object} oooPerson - PersonState of the person going OOO
 * @param {object} candidatesByTaskId - map of taskId -> ReassignmentCandidate
 * @param {object} personStatesById - map of userId -> PersonState
 * @returns {object[]} array of NegotiationTrace, one per task
 */
function negotiate(oooPerson, candidatesByTaskId, personStatesById) {
  if (!oooPerson || !Array.isArray(oooPerson.openCommitments)) {
    throw new Error("negotiate() requires a PersonState with an openCommitments array");
  }

  return oooPerson.openCommitments.map((task) => {
    const candidateEntry = candidatesByTaskId[task.id];
    const candidateList = candidateEntry ? candidateEntry.candidates : [];
    const { trace } = negotiateTask(oooPerson, task, candidateList, personStatesById);
    return trace;
  });
}

module.exports = {
  negotiate,
  negotiateTask,
  evaluateCandidate,
  LOAD_THRESHOLD,
  PRIORITY_BUMP,
  MAX_ROUNDS,
};
