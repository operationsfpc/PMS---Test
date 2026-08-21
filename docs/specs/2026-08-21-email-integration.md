# Email Integration — Resend

Spec for approval. Agreed in discussion 2026-08-21. No code until Karthik approves.

## 1. Requirement (PRD §21.2)

Queued email delivery capable of a full-cohort announcement (2,000+ recipients)
without loss; **per-student delivery status visible to the Central CPC**.
Gmail/Workspace cannot meet this (~2,000/day cap, no delivery webhooks), so
Gmail keeps the *mailbox/identity* role and Resend becomes the transport.

## 2. Confirmed decisions

| # | Decision | Source |
|---|---|---|
| 1 | Provider: **Resend** | Karthik, this session |
| 2 | Sending domain lives under **`faceprep.in`** (Cloudflare DNS, we have access; mailboxes are genuinely Google Workspace there). `mail.faceprep.in` rejected — already has a live A record (legacy webmail). Chosen: **`email.faceprep.in`** | Karthik |
| 3 | **One sender address for all email** | Karthik |
| 4 | Open/click tracking **OFF** (DPDP posture; PRD needs delivery only) | Karthik |
| 5 | Karthik creates the Resend account and supplies keys via `.env` — never chat | Karthik |
| 6 | Start on **free tier** (3,000/mo, 100/day) — dev only; upgrade to $20/mo **before the first real cohort invite** | Karthik |

## 3. Sender identity

- Verify subdomain **`email.faceprep.in`** in Resend (SPF + DKIM records via
  Cloudflare DNS, set to **DNS only**, not proxied). Subdomain isolates
  bulk-sending reputation from the root domain's existing senders (root SPF
  already includes Zoho + Google).
- From: **`FACE Prep Campus <placements@email.faceprep.in>`**
- Reply-To: **`placements@faceprep.in`** — confirmed existing Google Workspace
  mailbox (faceprep.in MX → aspmx.l.google.com).
- `faceprepcampus.com` is not involved in email at all (its mail is Hostinger;
  it stays the web host only).

## 4. Architecture (three layers, as always)

```
notifications insert (existing triggers, 0043/0048)
        │ trigger: creates email_deliveries row (status 'queued')
        │          + pgmq.send('email_outbox', delivery_id)
        ▼
pg_cron (every minute) ──► Edge Function `email-dispatch`
        │  reads up to 100 msgs, one Resend /emails/batch call
        │  (paced ≤ 2 req/s), writes provider_message_id, status 'sent'
        │  failure → message returns to queue (pgmq visibility timeout) → retry
        ▼
Resend ──► webhook (Svix-signed) ──► Edge Function `email-events`
        │  verifies signature, maps event via Layer 0, updates email_deliveries
        ▼
email_deliveries.status  (read by Central CPC — RLS from 0043 already correct:
                          staff read, only service role writes)
```

### Layer 0 — `src/domain/email-delivery.ts` (100% coverage)

Pure functions, zero imports:

- `EmailDeliveryStatus` union: `queued → sent → delivered | delayed | bounced | complained | failed`
- `applyDeliveryEvent(current, event)` — legal-transition state machine.
  Never regresses (`delivered` can't fall back to `delayed`; late/duplicate
  webhook events are idempotent no-ops).
- `composeNotificationEmail(notification)` — subject/body from a notification
  (plain, mobile-friendly).
- `EmailProvider` interface type + `toBatches(deliveries, 100)` batching rule.

Edge Functions import these files directly (Deno imports TS fine); the
functions themselves are thin I/O wrappers so all logic stays Vitest-tested.

### Layer 2 — migration `0058_email_outbox.sql`

- `create extension pgmq`; queue `email_outbox`.
- `email_deliveries`: CHECK constraint on `status`, index on
  `provider_message_id`, `updated_at` trigger.
- Trigger on `notifications` insert → `email_deliveries` + enqueue.
  (Opt-out already enforced upstream: opted-out students never get the
  notification row, so they never get email.)
- pg_cron job calling `email-dispatch` via pg_net.

### Supabase Auth

Point Auth SMTP at `smtp.resend.com` (same account/key) — fixes the built-in
~3/hour limit before the first roster invite. Dashboard config, not code.

## 5. Safety rails

- **Dev guard:** `EMAIL_ALLOWLIST` env (comma-separated). When set, dispatch
  refuses any recipient not on it — dev/free-tier can never email real
  students. Unset in production only.
- Webhook rejects bad/missing Svix signatures with 401; never trusts payload
  identity beyond `provider_message_id` lookup.
- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` live in git-ignored `.env.local`
  (Karthik pastes) → pushed with `supabase secrets set`. Never in chat, code,
  or client bundle.

## 6. TDD plan (RED → GREEN → REFACTOR per step)

1. Domain: `applyDeliveryEvent` transition table — every event × every status.
2. Domain: `composeNotificationEmail`, `toBatches`.
3. Contract: webhook handler logic (pure part) against recorded Resend event
   payload shapes; signature-failure path.
4. Dispatch logic (pure part): batch building, allowlist guard, retry marking.
5. PGlite: migration 0058 — trigger creates delivery + queue message; status
   CHECK rejects junk.
6. pgTAP: unchanged policies still hold with the new trigger (student cannot
   read others' deliveries; staff read).

## 7. Out of scope (this slice)

- Central CPC **delivery-report UI** (per-announcement status table) — next
  slice, mockup first per the standing rule.
- Digest/batching of multiple notifications into one email.
- Paid-tier upgrade (tracked: must precede first real cohort invite).

## 8. What Karthik does

1. Create Resend account; add the DNS records Resend shows for
   `email.faceprep.in` in Cloudflare (DNS only, not proxied).
2. Paste `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` into `.env.local`.
3. Approve this spec.
