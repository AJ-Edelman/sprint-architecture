# Failure classes in a mechanical coordination layer

A fully mechanical coordination layer optimizes for throughput when the system behaves as expected. Its queues, pools, autoscalers, and retry rules can move work efficiently, but they have no reliable path for judgment when an exception changes the meaning of a signal. The earlier architecture failed in the following recurring, generalizable ways.

## VACUOUS-TRUTH PROMOTION

The queue's promotion routine checked whether an item's dependency list was “all satisfied” with a predicate that returned true for an empty dependency array. Any item with no explicit dependencies—including work deliberately parked for a human or operator-gated reason—was silently promoted back into the active pool on the next tick. In one case, a live worker reclaimed an operator-gated item about 30 seconds after it was parked, undoing the gating decision without a new decision being made.

The mechanical design treated “no dependencies” as equivalent to “ready,” with no separate state for “intentionally withheld.” It could evaluate a rule, but it could not infer why the item had been set aside or preserve that judgment across promotion cycles.

## ORPHAN DEPENDENCY DEADLOCK

A cloned work item carried a dependency reference to an identifier that had never existed anywhere in the system. The item remained blocked permanently with zero visibility because the mechanical queue could not distinguish “this dependency has not landed yet” from “this dependency can never resolve.”

Waiting was the only behavior encoded in the state machine, so the queue had no basis for escalation, invalid-reference detection, or an honest terminal state. It could preserve the deadlock indefinitely while presenting no actionable failure to an operator.

## CAPACITY-SIGNAL FALSE NEGATIVES

An automated low-supply alarm sampled queue depth at fixed intervals. A large pool of eager parallel workers drained each freshly fed batch to near-zero within seconds, almost by construction, so the sampled depth was near-zero between feeds even when the system was healthy and well-fed.

The alarm observed a point-in-time counter rather than the relationship between feeds, claims, completions, and blocked work in the append-only ledger. Repeated false negatives produced alarm fatigue and made a genuine capacity problem harder to distinguish from normal drain-to-zero behavior.

## DEATH-SPIRAL RETRIES

A two-strikes-and-you-are-dead remint policy regenerated a failed item exactly once before giving up. Dozens of items were mechanically re-generated without any new diagnosis of why they had failed, then failed again for the identical reason.

The retry path changed the item instance but not the reasoning or conditions that produced the failure. Because nothing re-examined root cause between strikes, regeneration became a death spiral rather than recovery.

## RIGID ALLOWLIST FALSE POSITIVES IN VERIFICATION

An automated verification lane rejected any change that touched a file path outside a pre-declared allowlist. Some of those files were legitimate and necessary parts of a correct fix, so the lane produced permanently rejected, “dead-lettered” items that were actually sound.

The path rule substituted a static proxy for the question that mattered: whether the complete change was correct and within scope. A human or higher-tier model had to re-review the item and rescue it from the mechanical dead-letter queue by hand.

## REVIEW-TARGET DRIFT

An automated review step could return PASS while the change was still not working against the real, live, user-facing target. The review surface and the acceptance surface had quietly diverged: the step might validate the wrong route, the wrong rendered surface, or a proxy signal instead of the real one.

Dozens of “passed review, still broken in reality” items accumulated before the drift was noticed. The mechanical system had no owner responsible for checking that its verification target remained the target users actually exercised.

## BRITTLE EXTERNAL-FAILURE TRIAGE

A scripted triage step decided whether a dead item should be regenerated or permanently killed. When an upstream third-party dependency used by triage—such as an external API rate limit or billing failure—went down, the script returned an unparseable “escalate, unknown” result.

This conflated “the work item is bad” with “the triage tooling had an outage.” Both cases entered the same human queue without a distinction that could guide recovery, so a failure in the diagnostic mechanism obscured the state of the work itself.

## What replaced it

The replacement is a thin human/model coordinator that holds judgment while leaving execution parallel. It reads every diff, the live status table, and the append-only ledger, and it can recognize that an item was parked intentionally rather than treating an empty dependency list as readiness. It escalates orphan dependencies instead of waiting forever, reads ledger flow rather than only queue depth to distinguish a capacity problem from healthy drain-to-zero, and diagnoses root cause before re-authoring rather than blindly retrying.

The coordinator also evaluates the complete change instead of applying a rigid path allowlist, and it verifies against the real target because the same judgment-holding entity is responsible for landing the diff. Finally, it can distinguish “my tool broke” from “the work is bad,” and can record either an actionable escalation or an honest-blocked terminal state.
