#!/usr/bin/env node
// balancer-reference.mjs
//
// REFERENCE IMPLEMENTATION — not a product. This is a small, dependency-free
// worked example of the spine-aware load-balancing algorithm described in
// docs/load-balancer.md. It exists to make the algorithm concrete and testable,
// not to be run unmodified against a real fleet of agents. Wire `spawnHook`
// (bottom of file) to whatever actually dispatches/stops agents in your stack.
//
// Usage:
//   node scripts/balancer-reference.mjs [seats.json] [work-queue.json] [review-queue.json]
//
// Inputs (all plain JSON, no schema library required):
//
//   seats.json — the operator config (see docs/load-balancer.md):
//     {
//       "ceiling": 12,
//       "spineCapacity": 6,
//       "roles": [
//         { "task": "coding", "model": "<binding>", "maxSeats": 6, "effort": "high" },
//         ...
//       ]
//     }
//
//   work-queue.json — an array of jobs the balancer might staff:
//     [ { "id": "job-1", "task": "coding", "status": "queued" | "active", "seat": "seat-1"? }, ... ]
//
//   review-queue.json — an array of items currently awaiting review/verification,
//   i.e. work that has left authoring but hasn't cleared the acceptance spine yet:
//     [ { "id": "rev-1", "status": "pending" | "in_review" }, ... ]
//
// If seats.json is absent, this reference implements the invocation-time default from
// docs/load-balancer.md ("Invocation: ask once, non-blocking, else default to the
// invoker's own family"). A real deployment asks the operator once, up front, in a short
// non-blocking window ("preference for models, families, or seat counts per role,
// otherwise defaults apply") while unrelated setup proceeds in the background, and only
// falls back to defaults if nothing comes back before the window closes. This offline
// script has no one to ask, so it goes straight to that same fallback: a tier per task
// chosen by anticipated complexity, using the invoking model's own family for each tier.
//
// Every model family names its own tiers differently — the point isn't the label, it's
// the complexity mapping underneath it. Two illustrative (fictional) ladders, each with
// more granularity than this script needs:
//   family A: quick-tier / standard-tier / flagship-tier / council-tier
//   family B: spark-tier / core-tier / prime-tier / synod-tier
// Both collapse onto the same three complexity buckets this script uses generically below
// (fast, judgment, deliberation) — a family with extra intermediate tiers of its own can
// fold its lighter judgment-class model into "judgment" here without losing anything this
// script cares about. Substitute your own family's actual model names for the
// "<invoking-model-family:*>" placeholders. See DEFAULT_TIER_BY_TASK below.

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// 1. Load inputs
// ---------------------------------------------------------------------------

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw new Error(`could not read/parse ${path}: ${err.message}`);
  }
}

// Default tier-by-task-complexity map (docs/load-balancer.md, "Invocation"): mechanical
// work gets the fast/cheap tier, review or diagnosis gets the judgment tier, design or
// arbitration gets the strongest, most deliberative tier. Extend this map for task types
// your own setup uses beyond the four illustrated here.
const DEFAULT_TIER_BY_TASK = {
  coding: "fast",
  authoring: "fast",
  review: "judgment",
  diagnosis: "judgment",
  integration: "judgment",
  design: "deliberation",
  arbitration: "deliberation",
};
const DEFAULT_MAX_SEATS_BY_TIER = { fast: 4, judgment: 2, deliberation: 1 };

// Builds a seats config from the invoking model's own family when the operator hasn't
// supplied one — one role per distinct task seen in the work queue (or the illustrated
// default task set, if the queue is itself empty), each staffed at its default tier.
function defaultSeatsConfig(workQueue) {
  const tasks = [...new Set(workQueue.map((j) => j.task))];
  const roles = (tasks.length ? tasks : Object.keys(DEFAULT_TIER_BY_TASK)).map((task) => {
    const tier = DEFAULT_TIER_BY_TASK[task] ?? "fast";
    return {
      task,
      model: `<invoking-model-family:${tier}>`,
      maxSeats: DEFAULT_MAX_SEATS_BY_TIER[tier],
      effort: tier,
    };
  });
  return { ceiling: 8, spineCapacity: 6, roles };
}

const [seatsPath, workQueuePath, reviewQueuePath] = [
  process.argv[2] || "seats.json",
  process.argv[3] || "work-queue.json",
  process.argv[4] || "review-queue.json",
];

const workQueue = loadJson(workQueuePath, []);
const reviewQueue = loadJson(reviewQueuePath, []);

let seatsConfig;
try {
  seatsConfig = loadJson(seatsPath);
} catch {
  seatsConfig = defaultSeatsConfig(workQueue);
  console.log(
    `(no operator config at ${seatsPath} — defaulting to the invoking model's own family, ` +
      `tiers assigned by anticipated task complexity; see docs/load-balancer.md "Invocation")`
  );
}

// ---------------------------------------------------------------------------
// 2. Derive the numbers the balancing formula needs
// ---------------------------------------------------------------------------

// How many concurrent workstreams the acceptance spine can absorb right now,
// before review backlog starts growing instead of draining.
const reviewBacklogDepth = reviewQueue.filter((r) => r.status === "pending").length;
const spineHeadroom = Math.max(0, seatsConfig.spineCapacity - reviewBacklogDepth);

// Per role: how many seats are already active, and how many independent jobs
// (queued, not yet claimed by a seat) exist to hand to a newly spawned seat.
function activeSeatsFor(task) {
  return workQueue.filter((j) => j.task === task && j.status === "active").length;
}
function independentJobsFor(task) {
  return workQueue.filter((j) => j.task === task && j.status === "queued").length;
}

// ---------------------------------------------------------------------------
// 3. The balancing formula (docs/load-balancer.md, "The balancer loop")
// ---------------------------------------------------------------------------
//   target(role) = min(role.maxSeats, independentJobs(role), spineHeadroom)
//
// spineHeadroom is a shared, sprint-wide resource — every role competing for
// it is what actually prevents authoring seats from flooding review. Roles
// are evaluated in the order given in seats.json, and each role's claim on
// spineHeadroom is subtracted before the next role is evaluated, so the
// overall sprint-wide `ceiling` and the spine's absorption capacity both hold
// even when several roles want to grow at once.

function computeTargets(config, spineHeadroomStart) {
  let headroomLeft = spineHeadroomStart;
  let ceilingLeft = config.ceiling;
  const targets = [];

  for (const role of config.roles) {
    const independentJobs = independentJobsFor(role.task);
    const raw = Math.min(role.maxSeats, independentJobs, headroomLeft, ceilingLeft);
    const target = Math.max(0, raw);
    targets.push({ role, target, active: activeSeatsFor(role.task), independentJobs });
    headroomLeft -= target;
    ceilingLeft -= target;
  }
  return targets;
}

const targets = computeTargets(seatsConfig, spineHeadroom);

// ---------------------------------------------------------------------------
// 4. Pluggable spawn/taper hook — REPLACE THIS in a real deployment.
// ---------------------------------------------------------------------------
// Taper means "stop assigning new work to the excess seat and let it finish
// its current item" — never kill work mid-diff. This reference hook only
// prints the decision; a real hook would call your own dispatch/stop API.

function spawnHook(action, { role, seatIndex }) {
  const label = `${role.task}#${seatIndex}`;
  if (action === "spawn") {
    console.log(`SPAWN  ${label}  model=${role.model}  effort=${role.effort ?? "default"}`);
  } else if (action === "taper") {
    console.log(`TAPER  ${label}  (finish current item, then release; do not kill)`);
  }
}

// ---------------------------------------------------------------------------
// 5. Emit the rebalancing plan
// ---------------------------------------------------------------------------

console.log(
  `spine: capacity=${seatsConfig.spineCapacity} reviewBacklog=${reviewBacklogDepth} headroom=${spineHeadroom}`
);
console.log("role        active target independentJobs action");
console.log("----------- ------ ------ --------------- ------");

for (const { role, target, active, independentJobs } of targets) {
  const delta = target - active;
  const action = delta > 0 ? `spawn ${delta}` : delta < 0 ? `taper ${-delta}` : "hold";
  console.log(
    `${role.task.padEnd(11)} ${String(active).padEnd(6)} ${String(target).padEnd(6)} ${String(
      independentJobs
    ).padEnd(15)} ${action}`
  );

  for (let i = 0; i < delta; i++) spawnHook("spawn", { role, seatIndex: active + i + 1 });
  for (let i = 0; i < -delta; i++) spawnHook("taper", { role, seatIndex: active - i });
}
