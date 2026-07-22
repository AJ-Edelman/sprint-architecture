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
