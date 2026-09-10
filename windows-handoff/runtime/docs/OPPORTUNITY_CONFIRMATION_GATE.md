# Opportunity Confirmation Gate

## Purpose

This gate separates frozen Opportunity Analysis results from human business decisions. It never approves a candidate from score, sales, ranking, AI output, or an existing sourcing package.

```text
Opportunity candidate → human decision → persistent current state + append-only event → downstream eligibility
```

## Decision states

- `approved`: eligible for future Track B and Track C queue creation.
- `rejected`: not eligible.
- `needs_more_evidence`: not eligible until a later human transition to `approved`.
- `unconfirmed`: derived when no confirmation row exists; not eligible.

## Data model and audit semantics

`opportunity_confirmations` stores exactly one current state per snapshot candidate. Identity is enforced with the candidate integer primary key and the existing `(snapshot_id, platform, goods_id)` unique business key.

`opportunity_confirmation_events` is append-only. A real state/evidence change records the previous and new decisions, reason, reviewer, review time, and event creation time. Repeating the same decision, reason, and reviewer is idempotent and creates no duplicate event.

The frozen snapshot status remains `awaiting_confirmation`; candidate confirmations do not rewrite analysis output or mark the entire snapshot complete.

## Human workflow and CLI

Apply pending migrations through the normal guarded migration command before using the gate:

```bash
npm run migrate -- --config config.json
```

List the human confirmation package:

```bash
npm run opportunity:confirmation -- list --snapshot <snapshot_id>
```

Record an explicit human decision:

```bash
npm run opportunity:confirmation -- confirm \
  --snapshot <snapshot_id> \
  --candidate <candidate_id> \
  --goods-id <goods_id> \
  --decision approved|rejected|needs_more_evidence \
  --reason "<human reason>" \
  --reviewed-by "<human identity>"
```

Read eligibility without creating a queue:

```bash
npm run opportunity:confirmation -- eligibility \
  --snapshot <snapshot_id> --candidate <candidate_id> --goods-id <goods_id>
```

## Eligibility and safety

`checkEligibility()` and `isOpportunityApproved()` are the shared service gates for future Track B and Track C queue creators. They fail closed for missing or stale snapshots, missing candidates, malformed identity, snapshot/candidate mismatch, goods-id mismatch, absent confirmation, `rejected`, and `needs_more_evidence`. Only a matching persisted `approved` confirmation is eligible.

This implementation does not create a Negative Review Queue, sourcing run, sourcing item, or supplier candidate. Existing historical Review Queue rows and existing 1688 packages remain untouched and are not evidence of approval.
