# Dispatch accounting: make authorized capacity real

Configured capacity can be high while throughput is low if requested processes are counted as
working agents, failed launches disappear into empty logs, or authors stay assigned while review
is pending. The fix is an append-only attempt record per assignment.

```json
{
  "attemptId": "A-042",
  "itemId": "bounded-acceptance-unit",
  "role": "author",
  "provider": "local-or-mediated",
  "state": "working",
  "pidOrLog": "durable process evidence",
  "ownedPaths": ["non-overlapping path set"],
  "check": "acceptance probe",
  "receipt": "evidence location",
  "commitSha": null,
  "nextEvent": "ready_for_review"
}
```

States are event transitions: `requested`, `admitted`, `session_started`, `working`,
`ready_for_review`, `integrating`, `completed`, and `exit_failed`. A pre-session exit is an
explicit `exit_failed`, with log/reason, and immediately requeues. An empty log is not evidence
of a capacity cap.

## Count work, not machinery

`effectiveActiveAuthors` counts only distinct acceptance units in `working`. Exclude wrappers,
monitors, mediators, exited attempts, and authors awaiting review after a recoverable commit.
Report requested/admitted/session-started, working, ready-for-review/integrating, and exit-failed
separately so dispatch health and verification-spine depth cannot be confused.

## Release and backfill

An author owns one small unit: non-overlapping paths, one check, one receipt, and one closure
event. At `ready_for_review`, it has committed and releases capacity. Review, integration,
deployment, and requester-vantage checks are separate items. Whenever independent work is queued
and an authorized author seat is free, the ledger must show a new `admitted` attempt or a cited
provider/spine blocker. Completion, failed launch, verdict, and landing all trigger backfill.

For floors above three lanes, give a lightweight coordinator/sentinel the liveness record; it is
not an author seat. Use worktrees for bounded paths if the main checkout is dirty. Authorized
external coding models return a typed implementation packet (owned paths, patch/artifact, test,
receipt); a local applier uses it only in an isolated worktree and an independent verifier decides
whether it lands. Raw external output is never unattended-applied to the shared checkout.

## A controller, not a reminder

Telling a monitor or language model to “backfill” is not enough. A durable controller—not a
human helm—must own an executable queue:

1. Materialize every eligible cited plan row into a bounded queue item before the first wave,
   with a conservative ownership family, acceptance event, and next event. A queue with only its
   initial manual wave will drain and put backfill back on the helm.
2. Atomically reserve and record `requested → admitted → session_started → working` with PID/log
   evidence. Inject the immutable attempt ID into the worker.
3. Require `ready_for_review` with a commit SHA, receipt, and check before normal worker exit.
   Unexpected exit becomes `exit_failed` with a requeue record.
4. On either terminal event, release the author slot and immediately evaluate the next
   non-conflicting item. Review/integration are separate queue items.

### Durable event handling

Run the controller's direct persistent watch command under a service manager, never through a
short-lived wrapper. At boot, reconcile stopped or absent attempt PIDs from the durable queue
before admitting more work; a queue label is not liveness evidence. An exit event must be retried
if it collides with a queue lock or transient queue read failure, and only be considered handled
once its terminal state is durable. A normal author handoff also creates a bounded independent
review item from its commit, receipt, and check (or records the exact review blocker). That rule
prevents capacity from draining into unreviewed handoffs. Worker-side handoff commands submit
state only; only the supervised controller admits work, so a child cannot be orphaned outside the
process that records its exit.

The concurrent-model limit is a single operator-configured spend guard. Do not evade it by
arguing whether a lightweight controller is a “seat.” A mediated item launches only through the
approved mediation wall; missing mediation is an observable blocker, not permission to fall back
to a direct credential.

Certify with three real event observations—not elapsed time and not dry-runs: one admission, one
session-start/working record, and one terminal handoff or exit followed by automatic release and
the next dispatch decision.
