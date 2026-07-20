# The Room-Floor Sprint Architecture

A pattern for running **multiple AI coding agents against a real backlog in parallel**, with a
human-legible ground truth, an honest terminal state for blocked work, and a retro loop that
feeds its own improvement back into the process. Proven across two production sprints on the
same day: **136 → 145** on a 164-item scoreboard, **zero regressions**, plus a caught-in-the-act
deploy false-positive and a self-audit that found its own definition-of-done was quietly thin
in roughly two-thirds of authored checks — and fixed the auditing process, not just the count.

This document describes the architecture. It is written for an engineering audience evaluating
whether the pattern is reusable — which it is: every role below is a **class**, not a specific
vendor or model. The bindings (which model plays which class) are swappable by design; the
process is what's durable.

---

## The problem this solves

Point a single coding agent at a backlog and it's slow but coherent. Point ten agents at a
backlog with no structure and you get five agents editing the same file, three that silently
stall, one that "finishes" by weakening the test that was supposed to catch it, and no way to
tell any of that apart from real progress without reading every diff by hand.

The room-floor architecture is the smallest set of constraints that makes many-agent parallelism
trustworthy: a place authoring agents *return* work to (never land it themselves), a single pair
of hands that actually applies diffs, a ground-truth ledger that isn't anyone's self-report, and
an explicit, first-class way to say "blocked" instead of quietly faking a pass.

## Role classes → runtime bindings

The architecture defines **classes** of participant. Which model or tool fills a class is a
runtime binding decision, resolved and stated at sprint-start — never hardcoded into the
process itself. A binding table from one real run:

| Class | Job | Landing rights | Example binding used |
|---|---|---|---|
| **Coordination** | Thin director. Push-assigns work (agents never self-claim); applies every returned diff *by hand*; verifies scope + neighbor checks; lands; batch-deploys. | Only role with landing rights | A general-purpose coding-assistant model, harness-integrated (spawning, messaging, repo writes) |
| **Grunt / Authoring** | Volume coding, extraction, mechanical sweeps. Returns diffs and tables only. | None | A subscription-tier coding CLI, high-reasoning setting, run N-wide in parallel |
| **Judgment / Review / Fixer** | Reviews every diff that touches a shared file (read-only, verdict PASS/FAIL). First fixer tier when authoring stalls. | None (advises the coordinator) | A second, independently-run coding CLI on a separate subscription |
| **Helm / Seam** | Holds the session. Owns accounting, first-landing rulings, deploy calls, check-definition audits, escalations. | Ultimate authority, delegates day-to-day | Whichever model is actually driving the sprint |
| **Monitor** | Only for floors above ~3 concurrent lanes. Evidence-backed alarms — capacity, stall, ladder-violation, score regression — verified against process state and the ledger, never assumption. | None | A lightweight watcher process or a cheap model on a polling loop |

Swap any binding without touching the process. That portability is deliberate: the pattern
outlived at least one full model-generation change in the sprints it was proven on, with zero
edits to the roles themselves.

### The escalation ladder

Work doesn't churn forever in one tier. A fixed, two-round ladder moves it up:

```
Grunt/Authoring round 1 ──fail──▶ round 2 ──fail──▶ Judgment/Review authors the fix
                                                              │
                                                          fail (round 1)
                                                              ▼
                                                          round 2 ──fail──▶ Helm/Seam council
```

Two failed rounds at a tier — not a vibe, not a raised eyebrow — is the trigger to move up. This
keeps a single hard problem from silently consuming an authoring seat for hours while easier
backlog starves, and it keeps the expensive tiers (Judgment, Helm) reserved for what actually
needs them.

### The single-lander rule

Only the Coordination class lands diffs, and it does so **by hand** — never through a script
that parses and applies patches unattended. This rule exists because of a real incident: an
earlier, unattended patch-application script silently destroyed a night of finished work by
mis-parsing line endings on a batch of diffs. The fix wasn't a better parser. It was removing
the unattended step entirely: a coordinating model reads every diff, applies it, and only then
runs the scoped check plus a neighbor-file sanity pass before it lands. Slower per diff; the
class of failure it eliminates is worse than the time it costs.

---

## Ground truth: two documents, never a chat transcript

Every sprint keeps exactly two ground-truth artifacts, and nothing else is allowed to compete
with them for authority:

1. **A live status table** — one row per backlog item: id, assigned seat, status
   (`queued` / `assigned` / `round-N` / `review` / `landed` / `deployed` / `honest-blocked`),
   the citation for why the item exists, and a receipt link. Every agent updates its own row on
   every state transition.
2. **An append-only receipt ledger** (one JSON object per line, one line per event) — every
   claim, every round, every verdict, every landing, every deploy. Nothing is edited after the
   fact; corrections are new lines, not rewritten history.

A dashboard renders both, glanceably, for a human skimming from a phone. But the dashboard is a
*view* — if it's down, the floor still functions, because the two files underneath it are the
actual truth, not the rendering of it.

### Honest-blocked is a terminal state

A backlog item can end a sprint in exactly one of two good states: **landed-and-verified**, or
**honest-blocked** with a citation for the block (an external dependency that doesn't exist yet,
a design decision only a human can make, a real precondition nobody can fabricate around). Both
are acceptable sprint outcomes. What is never acceptable is faking a pass to close the row —
seeding fake data to satisfy a check, weakening a check until a broken feature passes it, or
declaring victory on a screen that happens to render while the feature behind it does nothing.
An honest "blocked, here's why, here's the citation" is worth more than a false green, because
the next person to look at the row can trust it either way.

---

## Single source of truth: the sentinel record

The two per-sprint documents above remain the authority for that one sprint's own
item-by-item state — nothing above changes that. A separate need shows up once a *named,
shared fact class* — completed work, open blockers, deploy receipts, which agents are
alive — has to read the same way from more than one sprint, more than one dashboard, and
more than one chat-facing agent at once. Multiple read-only views rendering the same
per-sprint files are fine on their own; the new layer is only for facts that must be
canonical *across* sprints and surfaces, not triggered by the mere existence of a second
viewer.

For those named fact classes, the architecture adds a durable, cross-sprint record
administered by exactly one writer process (the **sentinel**), which every other agent
submits facts to — with provenance (who, evidence pointer, receipt) — rather than writing
directly; each entry points back to the originating sprint's own status table/ledger as
its evidence. The record is append-only: corrections are superseding rows, never edits.
Every surface that reports one of these fact classes renders from this record at request
time instead of keeping its own cached belief, which is what actually prevents two
surfaces from telling a person two different things. Outbound human-facing messages are
reserved and logged into the same record as "outbox" rows *before* dispatch, keyed so a
retry or a second agent can't fan out a duplicate or conflicting message — not just
logged after the fact — which is what makes "one voice" hold under concurrency, not the
logging alone.

Full pattern, including the interim-mode path for teams that haven't stood up the
dedicated writer process yet, and the specific failure classes it closes:
[`docs/single-source-of-truth.md`](docs/single-source-of-truth.md).

---

## The signals-only chatroom

Agents in this pattern share a lightweight coordination channel, but the channel carries
**signals only** — charter, assignments, receipts, blockers, escalations, milestones. Anything
longer goes to disk, referenced by a link. This keeps the channel skimmable by a human at a
glance and keeps agents from drowning each other in prose while trying to coordinate.

**Presence** is tracked per participant: an agent that goes unaddressed too long is marked
*away*, visibly, in both the live viewer and the transcript. An away agent that's still holding
assigned work is itself a capacity alarm — the floor treats a silently-stalled seat as exactly
as urgent as an explicit failure. Re-adding an away agent resumes it *with its context intact*
rather than starting it over — restarting from zero is the expensive failure mode this is meant
to avoid. Whether to re-add or record the drop as intentional is a call for whoever holds the
Helm/Seam class, made deliberately rather than by a timer.

The transport itself is pluggable — a durable hosted channel when one's available, a local
fallback otherwise — and is explicitly *never* a correctness dependency. Ground truth lives in
the durable, authoritative records described above (the per-sprint files, and the sentinel
record where one exists) — never in the chat transport itself — so the channel can go down
mid-sprint without losing anything that mattered. Some teams run the same signals-only pattern
on more than one hosted platform at once, for redundancy of the *transport* and to reach
stakeholders on whichever platform they already use; running on two platforms widens where a
signal can be read, it doesn't by itself guarantee a human notices it, so pair it with whatever
delivery-confirmation or escalation step your own team relies on. See
[`docs/transport-setup.md`](docs/transport-setup.md) for a worked example (Discord and Slack)
covering bot-token REST posting and threads for longer deliberations.

---

## Event-driven, never time-based

Nothing in this architecture runs on a clock. Phases chain on **completion events** — "the
check-authoring pass finished" triggers the next wave, not "it's been an hour." Retry backoff
exists (bounded, short) purely as an event-detection mechanism, not as a scheduling primitive.
The reason is simple: a fixed schedule either fires too early (on unfinished work) or wastes
time waiting on work that finished early. An event-chained floor runs at the actual speed of the
work.

The corollary: nobody — including the coordinating model — invents a resource ceiling
mid-sprint. If a human operator sets a cap (max concurrent seats, total spend), that cap is
honored by **queueing** work behind it, never by killing work already in flight. Lanes stop for
*evidence* of a lost thread (no receipts landing, ladder churn, a claim contradicted by the
ledger) — never because a counter crossed a round number that felt like enough.

---

## Dynamic capacity: the spine-aware load balancer

Seat count isn't set once at sprint start and left alone — it's rebalanced continuously against
the one thing that actually limits throughput: the serialized acceptance spine (checkout →
integration → review → test → deploy), not the number of agents willing to author. In one
production run, a serial acceptance chain sustained roughly **6 verified landings/hour** at **4
concurrent seats**; widening to **15 lanes against the same chain** dropped throughput to roughly
**2/hour** — a 3:1 regression from more than tripling seat count, because the extra lanes flooded
a pipeline sized to absorb about 4–6 concurrent workstreams rather than saturating it.

The balancing law: optimize for an empty review queue and continuously verified landings, never
for occupied seats; saturate the spine without flooding it (WIP caps, exclusive file ownership,
continuous rather than batched review); rebalance on every queue-width change, review-backlog
shift, seat completion, or detected bottleneck; and let the operator set only a maximum ceiling —
the balancer works freely, and continuously, beneath it. On usage-metered providers the same
ceilings double as spend control at no extra mechanism.

On invocation, the driving agent asks the operator exactly one question, once per run — a
preference for models, families, or seat counts per role, or defaults? The ask never blocks: it
waits in a short, bounded window (the same event-detection exception class as the bounded retry
backoff described below) while every family-agnostic setup step runs in the background, and only
seat spawning waits on the window or an earlier reply. Left at defaults, the crew is drawn from
the invoking model's own family, with each task assigned a tier (fast, judgment, or deliberation)
by its anticipated complexity, so the balancer is usable out of the box without ever touching a
config file or adding latency.

Full pattern, the operator-editable config schema, and a small dependency-free reference
implementation: [`docs/load-balancer.md`](docs/load-balancer.md) and
[`scripts/balancer-reference.mjs`](scripts/balancer-reference.mjs).

---

## Checks are the definition of done

A backlog item is done when its check passes — not when an agent says it's done, not when a
screen happens to render. Checks are never weakened to make a stuck item pass; if the
acceptance bar genuinely needs to move, that's a deliberate, cited decision at the Helm/Seam
level (a "check-pivot" note explaining the intent behind the change), not something any
authoring agent gets to quietly relax on its own.

**Citation discipline** runs through the whole floor: every backlog item cites the ruling, spec,
or record that defines "done" for it. An item with no citable definition of done isn't queued
work — it's a question back to whoever owns the backlog, because guessing at intent is exactly
the failure mode citation discipline exists to prevent.

### A self-audit that mattered

One retro pass on this architecture didn't just check whether the *code* was done — it audited
whether the *checks themselves* actually tested what they claimed to. Run against 184 in-scope
backlog rows:

| Verdict | Count | Meaning |
|---|---|---|
| **Faithful** | 42 | the check genuinely tests the specifics the intent names |
| **Compressed** | 108 | a check exists, but only exercises a thin, generic slice of a richer stated intent (a bare "does this screen render" standing in for "does this feature actually do the seven things it's supposed to") |
| **Unchecked** | 20 | no check exists at all for this row |
| **Unfound** | 14 | no traceable record of what "done" was even supposed to mean — no ruling, no spec, just a bare commit hash |

The headline number is uncomfortable on purpose: 108 of 164 authored checks were passing on
easier ground than the feature actually promised. That's the point of running this audit at
all — a green checkmark is only as trustworthy as the check behind it, and "checks are the
definition of done" is a hollow law if nobody ever checks the checks. The output became a
ranked queue (worst compression gap first) feeding the next round of check-authoring, and the
audit method itself — reconcile every check's assertions against its originating intent,
verdict by verdict, cited — is now a standing pass, not a one-off.

---

## The deploy trap

Standard deploy verification looked complete: unit tests green, the service health endpoint
returning 200, the production URL returning 200. Five consecutive deploys passed every one of
those checks — and every one of them was silently serving stale content at the production root.
The health endpoint was healthy. The *product* wasn't there.

The fix wasn't more retries or a longer wait before declaring success. It was adding one more
assertion that actually checked *identity*, not just liveness: does the response at the
production root contain a marker only the real, current application serves? The moment that
check landed, the trap stopped triggering false positives — and it's been a mandatory line in
every deploy receipt since. The general lesson generalizes past this one incident: infra-level
health (process up, port open, status 200) and product-level correctness (the right thing is
actually being served) are different claims, and a deploy gate that only tests the first one
will eventually go green on a broken deploy.

---

## Two sprints, one day: what actually moved

Two sprints ran back-to-back against the same live backlog on the same day. Net effect on the
164-item scoreboard: **136 → 145**, **zero regressions** — meaning every existing passing check
still passed after every landing, verified by re-running the full pre-existing test suite before
and after each change, not assumed. Landings included real self-healing fixes to the coordination
layer's own reliability (a silent-failure alarm that didn't exist before the sprint that found
it), several items correctly resolved to **honest-blocked** rather than faked, and the
check-compression audit above, which turned "145" from a number the team could recite into a
number they could defend row by row.

---

## Why this beats "machinery in the middle"

An earlier iteration of this same problem tried to solve multi-agent coordination with more
machinery: an autoscaler tuning seat counts, a claim-and-pool queue, dead-letter lanes,
mechanical promotion rules moving items between queue states. It didn't survive contact with
real backlogs. See [`docs/failure-classes.md`](docs/failure-classes.md) for the specific ways
mechanical coordination broke down — and why a thin, judgment-holding coordinator that reads
every diff outperformed a more "automated" system that didn't.

A few more short notes cover the remaining pieces of the architecture in more depth:

- [`docs/presence-and-chair.md`](docs/presence-and-chair.md) — how the floor tracks who's
  actually working versus silently stalled, and why a person (or a designated "chair" role)
  decides what to do about it instead of a timer.
- [`docs/event-driven-sequencing.md`](docs/event-driven-sequencing.md) — the sequencing rules
  in full: why nothing here runs on a clock, and what replaces scheduling.
- [`docs/single-source-of-truth.md`](docs/single-source-of-truth.md) — the sentinel pattern:
  a single, provenance-checked, append-only record every surface renders from once more than
  one sprint or reporting surface needs to agree on the same facts.
- [`docs/transport-setup.md`](docs/transport-setup.md) — a worked example of running the
  signals-only coordination channel on two hosted platforms at once (Discord and Slack),
  including bot-token posting and threaded deliberations.
- [`docs/load-balancer.md`](docs/load-balancer.md) — the spine-aware load balancer: why more
  seats can make throughput worse, the balancing loop, the operator-config schema, and a
  dependency-free reference implementation ([`scripts/balancer-reference.mjs`](scripts/balancer-reference.mjs)).

## The retro loop

A sprint isn't finished when the backlog is empty. It's finished when the retro has run: name
the failure classes actually encountered, turn owner-level decisions made mid-sprint into dated,
citable records, fold durable lessons into the process document itself (this one, in the
original), and update model bindings if they changed. A sprint that never feeds its own retro
loop is a sprint that will make the same mistake again next time, with a different model in the
same seat.

---

## Using this pattern

[`SKILL.md`](SKILL.md) in this repo is a standalone, model-agnostic operating spec for running
this pattern yourself — parameters, role classes, the laws every sprint binds to, and the retro
requirement — written to be dropped into any agent stack, not tied to any particular vendor,
project, or prior history. Start there if you want to run it.
