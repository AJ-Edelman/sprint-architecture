# The Spine-Aware Load Balancer

More authoring seats does not mean more finished work. Past a certain width, adding seats makes
throughput *worse*, not better. This document describes why, and the balancing pattern that
replaces "pick a seat count at sprint start" with continuous, evidence-driven rebalancing.

## The insight: seats aren't the bottleneck, the spine is

Every run of this architecture funnels finished work through the same narrow, **serialized**
path: shared checkout, integration, review, test, verification, deploy. Call this the
**acceptance spine**. It is sequential by construction — one lander applying diffs by hand, one
review pass per shared file, one verification gate before a landing counts — because that
sequencing is exactly what makes the ground truth trustworthy (see the main
[README](../README.md) and [`failure-classes.md`](failure-classes.md) for why a more "automated"
pipeline without this discipline failed in practice).

A sequential path has a throughput ceiling that does not move no matter how many agents feed it.
Authoring is embarrassingly parallel; acceptance is not. Once authoring output exceeds what the
spine can absorb, the excess doesn't get discarded — it queues, and the queue itself starts
costing throughput: review backlogs grow, landings wait longer, rebase/merge collisions multiply,
and the coordinator spends its attention untangling collisions instead of landing diffs.

**Evidence from a real run:** a serial acceptance chain sustained roughly **6 verified landings
per hour** when fed by **4 concurrent authoring seats**. The same team, on the same chain, then
widened to **15 concurrent lanes** — and throughput *fell* to roughly **2 verified landings per
hour**: a 3:1 regression from more than tripling the seat count. Nothing about the chain changed.
What changed is that 15 lanes flooded a pipeline sized to safely absorb about 4–6 concurrent
workstreams, so finished diffs arrived faster than the spine could integrate and verify them.

The lesson generalizes past this one pattern: **when a pipeline has a serialized stage, the
system's throughput is the serialized stage's throughput, full stop.** Seat count only helps up to
the point where it keeps that stage continuously fed; beyond that point it is pure overhead.

## The balancing law

1. **Optimize for an empty review queue and continuously verified landings — never for occupied
   seats.** "All seats busy" is not a health signal; it can just as easily mean the spine is
   drowning. The signal that matters is whether verified landings are flowing continuously with
   an unblocked, non-growing review queue behind them.
2. **Seats saturate the spine; they must never flood it.** Concretely: enforce WIP caps per role,
   give each active seat exclusive ownership of the files it's touching (no two seats editing the
   same file), run review continuously rather than in batches or committees, and treat any
   genuinely serial chain as capacity-bound at roughly **4–6 seats** regardless of how many
   authoring agents are theoretically available — concurrency cannot accelerate a dependency
   chain past the speed of its slowest sequential link.
3. **Rebalancing is continuous, not a one-time sizing decision.** A seat count chosen at sprint
   start is a guess that goes stale the moment backlog shape or review depth changes. The
   balancer re-evaluates on every trigger below, for the life of the run.
4. **An operator sets a maximum ceiling; the balancer works freely beneath it.** The ceiling is
   the only externally imposed number. The balancer never invents its own floor or ceiling —
   inventing either is the same defect class as an autoscaler making decisions no human asked for.

## The balancer loop

On every rebalancing trigger, for each role:

```
target_seats(role) = min(
  role.maxSeats,                       // operator ceiling for this role
  independent_jobs_available(role),    // don't spawn seats with nothing exclusive to do
  spineCapacity - reviewBacklogDepth   // don't spawn past what the spine can absorb right now
)
```

- If `target_seats > active_seats`, **spawn** the difference — up to the operator's ceiling,
  never past it.
- If `target_seats < active_seats`, **taper** the difference: stop assigning new work to the
  excess seats and let them finish their current item, rather than killing in-flight work.
  Taper is a flow-control decision, never a mid-diff kill.
- If `target_seats == active_seats`, do nothing. A balancer that rebalances when nothing changed
  is itself a form of churn.

Total seats across all roles are additionally clamped to the operator's overall `ceiling`, so a
role that could theoretically use more of its own per-role allowance still can't exceed the
sprint-wide cap.

### Rebalancing triggers

The loop above runs whenever one of these fires — never on a fixed timer:

- **Queue-width change** — new backlog lands, or a batch drains.
- **Review-backlog depth change** — the spine's headroom shrinks or grows.
- **Seat completion** — a seat finishes its item and needs either its next assignment or a taper
  decision (this is also the backfill event described in the main architecture).
- **Bottleneck detection** — landings stall behind review even though seats sit idle: a direct
  signal that spine headroom, not seat count, is the live constraint.

## The operator-config schema

The balancer never invents priorities. Which model or agent class fills which role, and how many
seats each role may use at most, is a config the operator can edit at any time:

```json
{
  "ceiling": 12,
  "spineCapacity": 6,
  "roles": [
    { "task": "coding",      "model": "<binding>", "maxSeats": 6, "effort": "high" },
    { "task": "authoring",   "model": "<binding>", "maxSeats": 4, "effort": "medium" },
    { "task": "review",      "model": "<binding>", "maxSeats": 2, "effort": "high" },
    { "task": "integration", "model": "<binding>", "maxSeats": 1, "effort": "max" }
  ]
}
```

- `ceiling` — the hard sprint-wide seat cap. Set only by the operator.
- `spineCapacity` — how many concurrent workstreams the acceptance spine can absorb before review
  backlog starts growing (see the evidence above: roughly 4–6 for a genuinely serial chain).
- `roles[].task` — one of the role classes from the main architecture (`coding`, `review`,
  `authoring`, `integration`, or others your setup defines).
- `roles[].model` — the runtime binding for that role (swappable at any time; the process doesn't
  change when the binding does — see the main [README](../README.md)).
- `roles[].maxSeats` — the operator's per-role ceiling. The balancer rebalances *within* this
  bound; it never proposes raising it.
- `roles[].effort` — an optional hint (reasoning effort, model tier, etc.) passed through to
  whatever spawns the seat.

The operator sets ceilings. The balancer decides, continuously, how to spend them.

## Reference implementation

[`scripts/balancer-reference.mjs`](../scripts/balancer-reference.mjs) is a small, dependency-free
Node script that reads this schema plus a work-queue file and a review-queue file, computes the
target seat count per role using the formula above, and calls a pluggable spawn/taper hook. It is
a reference for the algorithm — clearly marked as such in the file — not a production scheduler.
Wire the spawn hook to whatever actually dispatches agents in your own stack.

## Metered-spend note

On usage-metered providers (pay-per-token routing, for example), the same ceilings and spine logic
double as spend control at no extra mechanism: the balancer never runs more concurrent paid seats
than the verification spine can actually absorb, so cost tracks real, landable throughput instead
of tracking however many lanes happen to be idle and willing to generate output. A wider fan-out
that the spine can't absorb isn't just wasted seats under this model — under metered billing it is
wasted spend, purchased on purpose by a system that wasn't watching the only queue that mattered.

## Relation to the rest of this architecture

This replaces a fixed, sprint-start seat count with continuous, spine-aware rebalancing — it does
not replace anything else in the pattern. The coordination class still single-lands every diff by
hand (see the main [README](../README.md)); the balancer only decides how many authoring and
review seats are active at any given moment, never how a diff gets applied or verified.
