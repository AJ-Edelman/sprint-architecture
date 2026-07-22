---
name: sprint-plan
description: "Plan and execute a multi-agent coding sprint using the room-floor pattern: a push-assign coordinator, grunt/judgment authoring tiers, live status + append-only ledger as ground truth, a signals-only chatroom with presence, event-driven sequencing, and a mandatory retro. Model-agnostic — roles are classes, bindings resolve at runtime. Trigger: 'run a sprint', 'sprint this', 'plan a sprint', or a batch of backlog work that needs multiple agents."
---

# Sprint Plan — the room-floor pattern (model-agnostic)

A method for running several AI coding agents against a real backlog in parallel, with a
ground truth that isn't any agent's self-report, an honest terminal state for blocked work, and
a retro that feeds the process's own improvement. The PROCESS below is meant to be permanent;
the MODELS you bind to each role are meant to change freely.

## PARAMETERS (confirm at invocation)

Read these from the operator's request; if any is missing and the operator is present, confirm
in one short line before starting. If running unattended, use the stated defaults and record
what you chose in the plan document. See §0 for the mandatory once-per-run seat-maximums ask.

- **scope**: the backlog itself, or a pointer to its source (mandatory — no sprint without an
  enumerated scope).
- **agent classes to use**: which of the role classes below participate. Default: all.
- **cap**: an operator-set resource boundary — max concurrent seats, total seats, or a spend
  limit. Default: none. An operator cap is a hard boundary honored by *queueing* work behind it,
  never by killing work mid-stride. The coordinator never invents its own ceiling; only the
  operator sets one.
- **scale**: seat count. Default: `min(backlog width, cap if any)`. The coordinator may scale
  down if the apply/land step becomes the bottleneck — but says so openly rather than silently
  throttling.

## ROLE CLASSES (permanent) → BINDINGS (resolve at runtime, never hardcode)

Resolve the actual model or tool behind each class from whatever binding record your own setup
maintains (a tier map, a routing table, an operator ruling) — and state the resolved bindings in
the plan document so a reader knows exactly what ran. Never hardcode a specific vendor or model
name into this process; that defeats the point.

- **COORDINATION** — a thin director. Needs tool access: spawning/dispatching agents, sending
  messages, writing to the repo, posting to the shared channel. Push-assigns work — agents never
  self-claim from a queue. **Single-lander**: applies every returned diff *by hand* (never an
  unattended patch-apply script — see "why hand-apply" below), verifies the item's own check
  plus a neighbor-file sanity pass, lands, and batches deploys.
- **GRUNT / AUTHORING** — volume coding, extraction, mechanical sweeps. Returns diffs or tables
  only; no landing rights.
- **JUDGMENT / REVIEW / FIXER** — reviews every diff touching a shared file (read-only,
  verdict PASS/FAIL). Also the first fixer tier: two failed grunt rounds escalate authorship to
  this class. Two failed rounds *here* escalate to a Helm-level council.
- **HELM / SEAM** — holds the session. Owns accounting, first-landing calls, deploy calls,
  check-definition audits, and final escalation rulings. Whichever operator or model is actually
  driving the sprint.
- **MONITOR** — needed only once a floor exceeds roughly three concurrent lanes. Posts
  evidence-backed alarms (capacity, stall, ladder violation, score regression), verified against
  process/ledger state, never assumption. Smaller floors can rely on ordinary task notifications
  instead of a dedicated monitor.

Any binding can be swapped by operator decision without touching this process. If a binding's
seat is unavailable (dead, unauthenticated, rate-limited), the coordinator says so openly in the
shared channel and **queues** the work rather than silently substituting a different tier.

### Why hand-apply, not a script

An earlier version of this pattern used an unattended script to parse and apply agent-returned
diffs. It silently destroyed a night of finished work on a line-ending mis-parse. The fix was
not a better parser — it was removing the unattended step. The coordinator reads and applies
every diff itself. This is slower per item and is kept anyway, because the failure class it
removes (silent, undetected data loss) is categorically worse than the time it costs.

## 0. Invocation ask: ask once, non-blocking, else default to the invoker's own family

On invocation, before anything else, the driving agent asks the operator exactly one
question, once per run, phrased to cover every axis an operator might care about:
"Do you have a preference for specific models, families, or number of seats for
reviewers, coders, [the roles actually present in this run]? Otherwise defaults apply if
no response within a short, bounded window."

- **Specified** (models, families, seat counts — any combination) — that config (the
  schema in §7) governs for the rest of the run.
- **Defaults** (no reply within the window) — the crew is drawn from the invoking model's
  own family. Different model families name their own internal tiers differently — one
  might call them fast/mid/flagship, another quick/standard/pro — the balancer only cares
  about the complexity mapping, not the vendor-specific label: a fast/cheap tier for
  mechanical work, a judgment tier for review and diagnosis, and the strongest,
  deliberative tier for design or arbitration calls.
- **Non-blocking mechanic.** The wait never stalls the run: every family-agnostic step
  proceeds in the background while the window is open — backlog decomposition, the plan
  document, shared-channel setup, ledger creation, worklist claims. The only thing that
  waits is seat *spawning*, and it waits for whichever comes first: the window closing, or
  an operator reply arriving early. Net delay to the run: zero.
- **Why this doesn't violate "never time-based" (§5).** The window is short, bounded, and
  gates exactly one decision — the initial spawn — the same exception class as the
  bounded retry-backoff already permitted for event-detection elsewhere in this pattern.
  It is not a scheduling primitive: nothing about ongoing sequencing, review, or
  rebalancing runs on a clock; only the one-time "did an answer arrive yet" check does,
  and only until the run's first seat needs to spawn.
- The question is asked once per run, never once per batch or per item.
- Running unattended with no operator to answer: apply the same default rule immediately
  (no need to wait out the window) and record the chosen crew and tier assignments in the
  plan document, matching the general autonomous-mode discipline in PARAMETERS above.

## 1. Before anything

- State the plan in plain language, visible to whoever is running the sprint, before starting
  work — even if the work itself is read-only to begin with.
- **Citation law**: every backlog item cites the record that defines "done" for it (a spec, a
  ruling, a ticket, a prior decision — whatever your process treats as authoritative). No
  citable definition of done means it isn't a queue item yet; it's a question back to whoever
  owns the backlog.
- The acceptance bar is the actual job, not the shape of a form — specs should quote the
  feature's real intent, not paraphrase it into something vaguer.

## 2. The plan document (single pane of truth)

One file per sprint, containing:

- The objective in the requester's own words, with citations, plus the resolved bindings and
  parameters actually used.
- A **live status table** — one row per backlog item: id · assigned seat · status
  (`queued` / `assigned` / `round-N` / `review` / `landed` / `deployed` / `honest-blocked`) ·
  citation · receipt link. Every agent updates its own row on every state transition.
- An **append-only ledger** — one JSON object per line, one line per event (claim, round,
  verdict, landing, deploy). Never edited after the fact; corrections are new lines.
- Ground truth is the status table plus the ledger — never a chat transcript, never an agent's
  self-report.

**Honest-blocked is a valid terminal state** (gated on an operator decision, a missing external
dependency, or a real precondition nothing can fabricate around — always cited). Faking a pass
around a genuine block is the worst failure this pattern is built to prevent.

## 3. The sentinel record (single source of truth)

The plan document (§2) stays authoritative for its own sprint's item-by-item state; that
doesn't change. A separate need shows up once a *named, shared fact class* — completed work,
open blockers, human-action items, deploy receipts, which agents are alive — has to read
identically across more than one sprint, dashboard, or chat-facing agent at once (multiple
read-only views of the same per-sprint files don't by themselves trigger this). For those named
fact classes, add a durable, cross-sprint record that every relevant surface reads from. See
[`docs/single-source-of-truth.md`](docs/single-source-of-truth.md) for the full pattern;
summarized:

- **One running record** for the specific fact classes more than one surface must agree on —
  not a wholesale replacement for the per-sprint plan document.
- **Sentinel-administered**: exactly one writer process owns the record. Every other agent
  SUBMITS a fact with provenance (who, evidence pointer, receipt) rather than writing directly,
  pointing back to the originating sprint's own status table/ledger row as its evidence; the
  sentinel validates before recording, and rejects rather than silently drops or accepts a
  submission that fails validation.
- **Append-only**: corrections are superseding rows, never in-place edits.
- **Everyone pulls**: dashboards, chat-facing agents, and reporters render from the record at
  request time for those fact classes; none of them keep a private cached tally.
- **One voice**: every outbound human-facing message is *reserved* in the same record (an
  idempotency-keyed outbox entry) before it's dispatched, not just logged afterward — that
  ordering is what actually prevents two agents, or a retry, from sending a duplicate or
  conflicting message; logging alone doesn't.
- **Interim mode**: before the dedicated writer process exists, use one designated interim file
  per fact class with exactly one responsible writer — not several hand-scripts writing the same
  file — and hold the rules that matter: provenance on every entry (reviewed manually if nothing
  validates it automatically yet), no second hand-maintained copy, and every surface reads at
  request time rather than caching. Any append-only store works underneath (SQLite with
  write-ahead logging, JSON-lines, a managed database with an audit table) — the discipline is
  what matters, not the storage engine.

## 4. The shared channel + the dashboard

- The coordination channel carries **signals only** — charter, assignments, receipts, blockers,
  escalations, milestones. Anything longer lives on disk and gets linked, not pasted.
- **Transport is pluggable.** Prefer a durable, already-adopted channel your team uses; fall back
  to a local/ephemeral one if nothing durable is available. The channel is *never* the only copy
  of the truth and *never* a correctness dependency — the floor keeps functioning if the channel
  goes down, because the plan document and ledger (or the sentinel record, §3) are what actually
  matter. Some teams run the channel on two platforms at once for redundancy and audience reach —
  see [`docs/transport-setup.md`](docs/transport-setup.md) for a worked example (Discord and
  Slack), including bot-token REST posting and threads for deliberations.
- **Presence**: track last-seen per participant. An agent unaddressed too long is marked *away*,
  visibly, in both the live view and the transcript. Whoever holds the Helm/Seam class is
  prodded on any drop and decides: resume the agent *with its context intact* (never restart
  from zero — that's the expensive failure mode), or record the exit as intentional.
  Auto-resuming is not the default; a deliberate call is. An away agent still holding assigned
  work is itself a capacity alarm.
- **Human/operator controls**: whoever is running the floor should be able to add or remove
  participants from the live view at any time.
- **Dashboard**: every sprint serves some form of glanceable, remotely-reachable progress view —
  the status table and ledger events rendered for a skim, not a read — linking back to the
  shared channel. Verify it's actually reachable from the vantage point the requester will use
  before reporting that it exists.

## 5. Laws that bind every sprint

- **No time-based anything.** Sequence on completion events, not schedules. Retry backoff is
  short and bounded, used only as an event-detection mechanism — never a scheduling primitive.
  The §0 invocation-ask window is the same bounded class: short, capped, gates only the
  initial spawn decision, and never governs ongoing sequencing or rebalancing.
- **No invented ceilings.** Lanes stop for *evidence* of a lost thread (no receipts landing,
  escalation-ladder churn, a claim contradicted by the ledger) — never because a counter crossed
  a round number that merely felt sufficient. Operator caps queue work; they never kill it.
- **Checks are the definition of done.** Never weaken a check to make a stuck item pass. If the
  bar genuinely needs to move, that's a deliberate, cited decision at the Helm/Seam level (a
  "check-pivot" note explaining the change), audited afterward — not something any authoring
  agent quietly does on its own.
- **No fabricated data.** A feature that can't honestly demonstrate itself yet fails honestly
  rather than being propped up with seeded or fake state.
- **Data safety.** Tests and probes never touch real production state, and never consume from
  live/production channels in a way that has side effects (read-only health checks only).
  Existing data is never silently deleted; take a backup before any change that touches a
  production control plane.
- **Every cross-system seam gets an explicit owner**, and every crossing is recorded.
- **Requester-facing output is verified from the requester's own vantage point** — not just
  "the server returned 200" — before it's reported as working.
- **Route load to the cheapest tier that can actually do the work.** Reserve expensive or
  rate-limited capacity for judgment calls; send volume/mechanical work to fixed-cost or
  high-throughput seats.

## 6. Sequencing and scaling

Fan out everything independent, in parallel, immediately. Chain dependent phases on
**completion events** from the phase before them — never on a schedule. Backfill any seat that
frees up while backlog remains, within whatever cap is in force. When a parked or paused agent
needs to resume, resume it with its context intact rather than starting a fresh one from
scratch.

## 7. Dynamic seat balancing (spine-aware, replaces a fixed sprint-start seat count)

A seat count picked once at sprint start is a guess that goes stale the moment backlog shape or
review depth changes. Rebalance continuously instead, against the one thing that actually caps
throughput: the serialized acceptance spine (checkout → integration → review → test → deploy),
never the count of agents willing to author. Full pattern, worked evidence, the operator-config
schema, and a dependency-free reference script:
[`docs/load-balancer.md`](docs/load-balancer.md) /
[`scripts/balancer-reference.mjs`](scripts/balancer-reference.mjs). Summarized:

- **Optimize for an empty review queue and continuously verified landings — never for occupied
  seats.** "All seats busy" isn't a health signal; it can mean the spine is drowning just as
  easily as it can mean things are going well.
- **Saturate the spine, never flood it**: WIP caps per role, exclusive file ownership per active
  seat, continuous (not batched/committee) review, and roughly 4–6 seats as the practical ceiling
  for any genuinely serial chain — concurrency cannot outrun a dependency chain's slowest link.
- **Rebalance on events, not a timer**: queue-width change, review-backlog depth change, a seat
  completing its item (the backfill event from §6), or detected bottleneck (landings stalled
  behind review while seats sit idle).
- **The operator sets a maximum ceiling only.** A small, operator-editable config —
  `{ceiling, spineCapacity, roles: [{task, model, maxSeats, effort}]}` — states per-role model
  bindings and per-role seat ceilings; the balancer rebalances freely within those bounds and
  never proposes or invents a ceiling of its own (the same discipline as the "no invented
  ceilings" law in §5). This is the config the §0 invocation ask either receives from the
  operator or, absent an answer, fills from the invoking model's own family with tiers
  assigned by anticipated task complexity.
- **On usage-metered providers, the same ceilings are the spend control**: the balancer never
  runs more concurrent paid seats than the spine can actually absorb, so cost tracks landable
  throughput rather than however many lanes happen to be idle and willing to generate output.

### 7.1 Dispatch accounting and recovery

Configured capacity is not actual throughput. The ledger holds an immutable attempt record per
assignment (attempt ID, item, role/provider, state, process/log evidence, owned paths, check,
receipt, commit SHA, next event, and failure reason). States are `requested → admitted →
session_started → working → ready_for_review → integrating → completed`; a pre-session exit is
`exit_failed` and immediately requeued. Never infer a seat cap from empty logs.

Count only `working` bounded acceptance units as active author capacity. Exclude wrappers,
monitors, mediators, failed exits, and authors awaiting review after a recoverable commit. An
author releases its seat at `ready_for_review`; review/integration/requester-vantage acceptance
are distinct items. With independent queued work and a free authorized author slot, dispatch on
the completion/exit/verdict event or record the precise blocker.

For floors above three lanes, use a lightweight coordinator/sentinel to administer this record;
it is not an author seat. Keep judgment capacity for review/fixes. Use isolated worktrees for
bounded owned paths when the shared checkout is dirty. Authorized mediated external models can
author typed implementation packets, but a local applier and independent verifier remain
responsible for isolated application and landing. See [dispatch accounting](docs/dispatch-accounting.md).

### 7.2 Executable controller requirement

A monitor instructed to “backfill” is not a dispatcher. The floor needs a durable controller that
materializes every eligible cited plan row into bounded, conflict-safe queue items before the first
wave; atomically records `requested → admitted → session_started → working`; injects each attempt
ID into its worker; and requires `ready_for_review` with commit, receipt, and check before normal
exit. Unexpected exit is `exit_failed` and requeues. Terminal events release author capacity and
trigger the next dispatch decision without a helm choosing a lane. The configured concurrent-model
limit is the spend guard; a mediated item may launch only through its approved wall.

Certify the controller using three event observations: live admission, live session-start/working,
and live terminal handoff or exit followed by automatic release and dispatch decision. Dry-runs
validate controller code but do not certify a sprint floor.

## 8. Finish + retro (mandatory)

A sprint is finished when every item is landed-and-verified or honest-blocked-with-citation, a
full verification sweep has run, and one summary has gone back to whoever asked for the
sprint: net movement plus links to what changed, each verified from their own vantage point.

**Retro runs before wind-down, every time:**

- Name the failure classes actually encountered this sprint — not generically, specifically.
- Turn any mid-sprint decisions the requester/operator made into a dated, citable record.
- Fold durable lessons into your own process memory.
- Edit this skill document itself when the *pattern* changed — including binding changes, with
  the date they changed.

A sprint that doesn't feed its own retro loop is a sprint that will make the same mistake again,
with a different model sitting in the same seat next time.
