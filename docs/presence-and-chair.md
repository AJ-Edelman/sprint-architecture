# Presence and Chair Decisions in a Shared Agent Channel

A real-time coordination channel needs to represent not only backlog state, but also whether each participant is still present and making progress. Agents and human operators share the same presence model so that a stalled worker becomes an observable coordination event rather than an invisible implementation detail.

## Tracking presence

Every participant has a tracked `last active` signal. Activity may include a message, a task-state update, or another channel event appropriate to the participant. If a participant produces no activity for the configured interval, the channel marks it `AWAY`.

`AWAY` is human-legible state. It is shown in the live viewer and written to the persistent transcript, including the transition and its timestamp. The system must not reduce this condition to a silent heartbeat flag that only internal automation can inspect. The transcript should make it possible to reconstruct who stopped participating and when.

## The capacity-alarm coupling

An `AWAY` participant that still holds assigned, unfinished work raises a `CAPACITY ALARM`. This alarm has the same operational urgency as an explicit task failure. A silently stalled worker is just as costly as one that reports, “I failed,” and is more dangerous because nobody notices by default.

The alarm ties presence to capacity, not merely to connectivity. A participant that is away with no remaining assignment may be an ordinary intentional exit. A participant that is away while owning unfinished work is consuming a coordination slot whose outcome is unknown and requires an immediate decision.

## The chair decides

Automatic re-add is not the default. On every transition to `AWAY`, the system proactively notifies the designated `chair`: the person or senior coordinating agent with ultimate authority and session context. The chair explicitly chooses one of two outcomes:

- Re-add the participant and resume it with its prior context intact. Resumption must not start from a blank slate; that would discard real progress and situational understanding.
- Treat the drop as an intentional exit and formally record that decision in the session transcript.

The chair’s decision is part of coordination state, not an informal side conversation. For a participant holding unfinished work, the capacity alarm remains visible until the chair resolves it or assigns the work elsewhere.

## Why not auto-readd

A participant can go quiet because its work is genuinely complete and it correctly stopped, or because it crashed, hit a rate limit, entered a loop, or continued from stale or incorrect context. A mechanical auto-resume cannot distinguish these cases.

It may resurrect a participant that should have stayed stopped, re-triggering wasted work or repeating a mistake. It may also resume a participant into a changed world state without anyone reviewing what happened. A human or senior-agent judgment call made with current context costs a brief pause; that cost is small compared with either failure mode.

## Human controls stay primary

The operator running the floor can explicitly add or kick participants from the live view at any point. These actions are visible in the channel and persistent transcript. Presence tracking augments this control by surfacing conditions that need attention; it does not replace the operator’s authority or force a prescribed recovery action.

## How this differs from ordinary idle-timeout patterns

Typical distributed-system idle timeouts kill and restart workers silently according to a mechanical rule. Here, every stall is surfaced to a decision-maker with context and an explicit disposition. The cost of a brief chair review is lower than silently discarding a partially reasoned agent’s work or resuming it after the session has moved on.
