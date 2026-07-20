# Dual-Transport Setup: Running the Coordination Channel on Two Platforms

The room-floor architecture treats the coordination channel as pluggable and
non-authoritative (see the [README](../README.md#the-signals-only-chatroom)) — ground
truth lives in the durable, authoritative records the core architecture describes (the
per-sprint plan document and ledger, and the sentinel record for any fact class shared
across surfaces — see [`single-source-of-truth.md`](single-source-of-truth.md)), never
in the chat channel itself. That said, most teams want a durable,
human-reachable channel for the floor to post signals to, and it's common to want that
channel available on more than one platform — for example, a team that already lives on
one chat platform for day-to-day work but prefers a dedicated space for a busy,
high-frequency sprint floor. This doc describes running the same signals-only channel
pattern on two chat platforms at once, using Discord and Slack as the concrete example
since both offer a free tier and a straightforward bot-token REST API.

## Why dual-transport

- **Redundancy.** If one platform has an outage or a bot token expires, the floor can keep
  posting to the other, so the *transport* survives a single-platform failure. Neither
  transport is a correctness dependency (per the core architecture) — nothing that
  mattered is lost either way — but availability of a channel isn't the same as a human
  noticing a message on it; pair dual-transport with whatever delivery-confirmation or
  escalation step your team already relies on for anything time-sensitive.
- **Audience fit.** A dedicated server/workspace for the sprint floor keeps high-frequency
  agent chatter out of a team's primary work channel, while a bridge into the team's
  existing platform keeps stakeholders who don't want a second app in the loop.
- **Free-tier realities.** Free tiers on hosted chat platforms commonly cap how much
  message history is visible or searchable, and the specifics (the window length, whether
  older messages are hidden versus deleted) vary by platform and change over time — check
  each platform's current published limits rather than assuming a number. Whatever the
  limit is, it's acceptable for a live signals channel precisely because the channel is
  not the source of truth — the durable records described above are unaffected by any
  chat platform's retention policy.

## Setup pattern (generic)

The same steps apply to either platform, with platform-specific substitutions noted:

1. **Create a dedicated space.** A new server (Discord) or a new channel in an existing
   workspace (Slack) scoped to this sprint floor — keeps signal traffic separated from
   unrelated conversation.
2. **Create a bot/app identity.** Register a bot user through the platform's developer
   portal. Grant it the minimum access needed to read and post messages in the target
   space, and to create threads if using threaded deliberations (see below) — the exact
   mechanism differs by platform (for example, one common hosted platform gates this
   through OAuth install-time scopes, another through a mix of installation scope and
   per-channel/per-space permissions granted separately), so check the current developer
   documentation for whichever platform you're integrating rather than assuming a single
   model covers both. Store the resulting bot token as a secret, never committed to a
   repo or pasted into a message.
3. **Invite/install the bot** into the dedicated space.
4. **Posting pattern: bot-token REST calls, not a persistent client.** For a coordination
   floor that posts signals (not a full two-way chat client), a simple authenticated REST
   call per message is sufficient and avoids running a long-lived socket connection:
   - Both platforms expose a "post message to channel" REST endpoint that accepts the bot
     token in an auth header, plus a JSON body with the target channel ID and message
     text — but the exact header format differs per platform (as of this writing, one
     common hosted platform expects `Authorization: Bot <token>`, another expects
     `Authorization: Bearer <token>`), so check the current API reference for whichever
     platform you're integrating rather than assuming one format works for both.
   - Wrap each platform's call behind a **common function signature** (channel id + text
     in, HTTP call out) so any agent role in the floor — coordinator, monitor, chair —
     can post a signal without needing to know which platform-specific auth header or
     endpoint shape sits behind it.
5. **Record the channel identifiers** (workspace/server id, channel id) in your own
   sprint config — never hardcode a specific team's identifiers into a shared or public
   process document; treat them the same as any other credential-adjacent config.

## Threads for deliberations

When a signal needs a longer, multi-turn exchange attached to it — a design
deliberation, a multi-round review debate — rather than a single-line signal, open a
**thread** on the originating message rather than posting the exchange inline in the main
channel. Both platforms support threads keyed to a parent message. This preserves the
"signals only in the main channel" rule from the core architecture: the thread carries
the detail, the parent message stays a one-line pointer to it, and anyone skimming the
main channel isn't forced to scroll through a multi-round exchange to find the next
signal.

## What stays the same regardless of platform

- The channel carries signals only; detail lives on disk (per the core architecture).
- The channel is never the only copy of anything; ground truth is the plan document plus
  the ledger (or the sentinel record once more than one sprint/surface is involved).
- Presence tracking, the chair's re-add/drop decision, and the capacity-alarm coupling
  (see [`presence-and-chair.md`](presence-and-chair.md)) apply identically regardless of
  which platform's bot API is posting the message.
