# Single Source of Truth: the Sentinel Record

Multi-agent systems don't just need a per-sprint status table. The trigger for this layer
isn't "a second dashboard exists" — multiple read-only views rendering the same
per-sprint files are fine on their own. The trigger is a **named fact class** (completed
work, open blockers, human-action items, deploy receipts, which agents are alive) that has
to read identically no matter which dashboard, chat-facing agent, or automated reporter is
answering "what's actually true right now." For that fact class, the system needs exactly
one record that every one of those surfaces reads from, administered by exactly one
writer — not a new record for every additional reader.

## The problem this closes

Once a coordination system grows past a single sprint's live status table and ledger,
three failure classes reliably appear:

1. **Two writers, one state key.** Two independent processes (a dashboard updater and a
   reporting agent, say) both believe they own the same piece of state and both write to
   it. Whichever writes last wins, silently, and the loser's information is gone with no
   record it ever existed.
2. **Stale parallel records.** A dashboard caches its own view of "what's landed" or
   "what's blocked"; a chat-facing agent answering questions keeps a separate view. The
   two drift apart the moment either one misses an update, and nothing detects the drift
   until a human notices the two answers disagree.
3. **Rogue or misrouted writes.** A compromised, buggy, or simply misrouted agent process
   writes directly into shared state — overwriting a correct fact with an incorrect one,
   with nothing checking whether the writer was authorized or whether the fact it's
   asserting is even plausible.

All three share a root cause: more than one process has direct write access to the same
shared fact.

## The pattern

**One running record.** All the facts that more than one surface needs to agree on —
completed work with its proof, open blockers, human-action items, deploy/landing
receipts, which agents are alive — live in exactly one record. A second, hand-maintained
copy of any of these facts is treated as a defect, not a convenience, the moment it's
discovered.

**Sentinel-administered.** Exactly one writer process — the **sentinel** — owns the
record. Nothing else has write access to the underlying store (enforce this at the
file/permission/API level, not by convention alone). Every other agent that has a fact to
record **submits** it to the sentinel rather than writing it directly, and includes
**provenance**: who is submitting, a pointer to the evidence, and a receipt. The sentinel
validates the submission — is the submitter authorized for this fact class, is the
evidence pointer real, does the receipt check out — before it accepts and records
anything. A submission that fails validation is rejected, not silently dropped or
silently accepted.

**Append-only; corrections supersede.** The record is never edited in place. A correction
is a new row that supersedes the old one, not a rewrite of history. This is what makes
the record trustworthy under the concurrent-writer and rogue-writer failure classes
above: even a bad or malicious write becomes one more row in an audit trail, not a silent
overwrite of the truth — and reverting it is exactly one more superseding row, not an
archaeology project.

**Everyone pulls; nobody keeps a private tally.** Every surface that reports state —
dashboards, chat-facing answering agents, status reporters, automated summaries — reads
(renders) directly from the sentinel's record at the moment it's asked, rather than
maintaining its own cached belief about what's true. This is the actual fix for "stale
parallel records": if there's only ever one place state lives, there's nothing for two
surfaces to disagree about.

**One voice: outbound messages are reserved, not just logged.** Every outbound message
sent to a human — a chat reply, a notification, a status card — is *reserved* in the same
record (an "outbox" entry) before it's actually dispatched, not merely logged after the
fact. The reservation key is derived from what the message is *about* — recipient plus the
fact/event being communicated — not just a per-attempt random id, so two agents that both
try to tell the same recipient about the same underlying fact contend for the same key
rather than each getting their own. The sentinel grants exactly one reservation per key:
the first valid request wins and is the message that gets sent; a second agent proposing a
different message about the same recipient+fact is rejected against the existing
reservation (it can submit a superseding correction if the fact itself changed, following
the same append-only rule as everything else in the record). A retry of the *same* attempt
reuses its own reservation's key rather than minting a new one, so an ambiguous delivery
outcome (timeout, unclear ack) resolves to "retry the same reservation," not "send a
second message." Delivery attempts and their outcomes, per transport, are recorded against
the reserved entry, and any surface that later needs to know what's already been
communicated, and by which agent, checks the same record instead of guessing or repeating
itself. This is what keeps a multi-agent system from presenting contradictory or duplicate
answers to the same person through different channels — the reservation-before-dispatch
ordering does the actual work; the log is just how everyone else finds out about it
afterward.

## Interim mode

A system doesn't need the full sentinel infrastructure standing up before this pattern
starts paying for itself — but interim mode has to preserve the two properties that
actually close the failure classes above, not just the record's existence. Before a
dedicated writer process and validated-submission API exist:

- Designate **one interim file per fact class** (for example: a plain append-only log for
  human-action items, a separate file for score/verdict state), and name **exactly one
  process or role responsible for writing to it**. Two hand-scripts writing the same
  interim file is not interim mode — it's the two-writer failure class the whole pattern
  exists to prevent, just without the sentinel's protection.
- Every entry still carries provenance (who, evidence pointer, receipt), even if nothing
  automatically validates it yet — a human or the designated writer reviews it manually
  before it's appended.
- No second copy of a fact class is hand-maintained anywhere else.
- Every surface reads the interim file at request time rather than caching its own
  belief.

If a fact class genuinely needs more than one concurrent writer before the real sentinel
exists, that's a signal to prioritize standing up the sentinel for that fact class next —
not to relax the one-writer rule.

Migrate fact classes into the real sentinel-administered store as it comes online, one at
a time — the discipline is what protects you; the storage engine is an implementation
detail. Any append-only store works underneath (a single SQLite file with write-ahead
logging, a flat JSON-lines file, a managed database with an audit table) — the
requirement is "one writer, provenance-checked submissions, append-only history," not a
specific product.

## Relationship to the per-sprint ledger

The room-floor architecture's per-sprint live status table and append-only ledger (see
the main [README](../README.md)) remain the authoritative record for that one sprint's
own item-by-item state — the sentinel does not replace or compete with them at that
level. The sentinel record is a layer above, scoped narrowly to the specific, named fact
classes that must read identically across more than one sprint, dashboard, or reporting
surface (for example: cross-sprint completed-work totals, the current open-blocker list,
which agents are alive right now, the outbox of what's already been said to a human).
Each sentinel entry for one of those fact classes points back to the originating sprint's
own status table/ledger row as its evidence, rather than restating or duplicating it. A
sprint's ledger submits its landing/deploy/blocker events into the sentinel only for the
fact classes that are actually shared across surfaces — it isn't required to route
everything through the sentinel, and it doesn't stop being the source of truth for its own
sprint's day-to-day item state.

## Failure classes this kills

Representative failure modes in systems that lacked this layer:

- **Overwrite via shared identifier.** Two processes both used the same identifier to key
  a piece of state; the second write silently clobbered the first, discarding a real
  human-facing reply that had already been sent.
- **Misrouted instructions treated as ground truth.** An instruction intended for one
  coordination lane was misrouted into another lane's channel and briefly treated as
  authoritative, because the receiving lane had no provenance check to determine whether
  that instruction actually came from an authorized source.

Both are the same root cause, either accidental or adversarial: any writer that isn't
provenance-checked can silently become the loudest voice in the room.
