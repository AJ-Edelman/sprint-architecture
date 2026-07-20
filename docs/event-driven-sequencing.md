# Event-Driven Sequencing in Multi-Agent Coding Sprints

The architecture is driven by completion events, not by a wall clock. A phase starts only when the preceding phase has produced a definitive completion event, so coordination follows the actual state of the work.

## Completion events, not clocks

Nothing runs on a wall-clock or schedule-based phase transition. The authoring wave finishing triggers the review wave; the review wave finishing triggers the next dependent phase. The system never waits a fixed interval and then checks whether it is time to proceed.

A fixed schedule has two failure modes. It can fire too early, producing wasted checks, false urgency, and noisy alarms while work is legitimately incomplete. Or it can wait after work has finished early, forcing the sprint to run at the schedule's speed instead of the work's speed. Event chaining runs at exactly the speed of the real work: no faster and no slower.

## The one narrow exception: bounded retry as event-detection

Short, bounded retry backoff is allowed when an event may have occurred but its observation has not yet completed. The delay is capped low, for example below one minute, and exists only to poll for an already-possible event. It is not a scheduling primitive and must never decide when work should happen.

## No invented ceilings

No participant, including the senior coordinating role, may invent a resource ceiling mid-sprint. A limit on concurrent workers or spending is valid only when explicitly set by the sprint's operator or owner. The system honors that boundary by queueing work behind it. It does not kill in-flight work to enforce a limit retroactively.

## Evidence-based stops, not round-count stops

Workers and lanes stop only when evidence indicates a real problem, such as no receipts or progress landing for a sustained stretch, the same item bouncing between escalation tiers repeatedly, or a progress claim contradicted by the ground-truth ledger. An arbitrary round or iteration count is not a stop condition. A number-based stop is a guess; an evidence-based stop is a diagnosis.

## Backfilling on the same event loop

When a worker seat becomes free and backlog remains, the seat-freed event immediately assigns the next backlog item. Backfilling is not deferred to a scheduled tick or batched into a later round.

## Resume, never respawn

A parked or paused agent that needs to continue resumes through a direct mechanism with its prior context intact. Re-spawning it from scratch discards reasoning progress, intermediate findings, and task history without providing a coordination benefit.
