# Zoho CRM → PMS: PIF intake over webhook (Design A)

**Status: 🟡 ALL QUESTIONS ANSWERED — awaiting Karthik's explicit "approved" to build.**

Supersedes nothing; first server component in the project. Parked context in
`docs/HANDOVER.md` ("⏸ PARKED 2026-08-18 — Zoho CRM integration").

---

## 1. Karthik's answers, recorded verbatim (2026-08-19)

| # | Question | Answer |
|---|---|---|
| 1 | Which design | **"design 1A."** — Zoho is the front door. Webhook → Edge Function → `drives` row |
| 2 | Data centre | **"zoho.in"** |
| 3 | Invalid payload | **"if rejected, lands as a draft here. Triger email about approval or rejection to AE."** |
| 4 | Post-submission edits in Zoho | **"nO MORE EDITS AFTER SUBMISSION"** |
| 5 | Sent-back PIFs | **"Sent back is considered rejected. fresh form to be submitted. No editing of rejected ones."** |
| 6 | JD PDF | **"JD is attached in zoho crm itself"** |
| 7 | AE email mapping | **"no. the surrent emails are tests."** — real AE identities will come from Zoho |
| 8 | Zoho admin / sandbox | **"our internal colleague is zoho admin. can get details from him"** |

---

## 2. What this builds

The AE fills the PIF **in Zoho CRM** and never opens `/ae/pif` for entry.
On submission in Zoho, a webhook calls a Supabase **Edge Function** which:

1. **Authenticates the call** (shared secret in the URL is not enough —
   HMAC signature or at minimum a long random token in a header, held in
   Edge Function secrets, never in git).
2. **Validates the payload with `pifSubmitSchema` — the exact schema the UI
   uses.** Deno imports our TypeScript directly; there is no second copy of
   the rules to drift. Enums (`role_category`, `shift_type`, `drive_type`,
   `arrears_policy`, `marks_scale`, `joining_timeline`) must arrive as our
   canonical values; the endpoint **refuses, never coerces**.
3. **Resolves the AE**: Zoho record owner's email → `profiles` row with role
   `account_executive`. This becomes `created_by`, so `/my-drives` and the
   audit trail name a real person.
4. **Pulls the JD** from the Zoho record's attachments (Zoho API,
   `zoho.in` endpoints), enforces the same rules as the bucket (PDF, ≤ 5 MB),
   uploads to `job-descriptions/<drive_uuid>/…` **before** the row is
   written — same order, same reason as the UI (0051): an orphan object is
   invisible; a row with a dead link faces the approver.
5. **Inserts the drive**:
   - valid → `status = 'submitted'` — it appears in the Delivery Head's
     queue exactly like a UI-submitted PIF;
   - invalid → `status = 'draft'` (answer 3), problems recorded, AE emailed.
6. **Is idempotent on the Zoho record id.** New column
   `drives.zoho_record_id`, nullable, **unique**. A webhook retry finds the
   row and answers 200 without inserting. A fresh Zoho form (answer 5) is a
   fresh record id, so it correctly creates a new drive.

### Lifecycle consequences of answers 4 and 5

- **The webhook fires once per record.** Later edits in Zoho are not
  consumed — no update path exists at all (answer 4). If Zoho re-sends an
  edited record, the idempotency key swallows it.
- **DH sends back → terminal.** The rejected drive is never edited
  (answer 5). The AE raises a **fresh form in Zoho**; the corrected
  submission arrives as a new record with a new drive row.
- The AE is **emailed** on: validation refusal (with the named problems),
  DH approval, DH rejection (answer 3).

### Service-role write — the narrow gate

A webhook has no session, so this bypasses RLS — the class of hole 0047
closed. The Edge Function's write path is deliberately narrow:

- It can set `status` to `'submitted'` or `'draft'` and **nothing else** —
  never `approved`/`live` (the hole 0047 also closed for AEs).
- `created_by` is always a resolved, active `account_executive` profile.
  No resolution → no insert (see Q3).
- It writes `drives`, `drive_rounds`, the JD object, and its own intake log.
  It is not a general-purpose insert and must never grow into one.

---

## 3. Deliverables

| # | Piece | Notes |
|---|---|---|
| D1 | Migration `0052` | `drives.zoho_record_id text unique`, `drives.intake_source` (`'pms' \| 'zoho'`, default `'pms'`), intake-problems storage (see Q5 design detail) |
| D2 | Edge Function `zoho-pif-intake` | Deno; imports `@domain` + `pif-schema`; secrets: webhook token, Zoho OAuth client id/secret/refresh token (self-client, `zoho.in`) |
| D3 | JD relay | Zoho attachment → `job-descriptions/<drive_uuid>/` with the bucket's own rules re-checked server-side |
| D4 | AE notifications | **In-app for v1** (§4 Q2): intake refusal lands in `notifications` for the resolved AE — or, when the owner cannot be resolved, the refusal reaches Zoho as the webhook response. Email later, behind `EmailProvider` |
| D5 | DH decision notifications | On approve/reject of a Zoho-sourced drive, notify the AE in-app (answer 3, email deferred per Q2). DB trigger, same pattern as 0043's student notifications |
| D6 | Zoho side | **Deals module** fields mirroring `pifSubmitSchema` — **picklists must carry our canonical enum values** (all six enum fields, see §4 Q4), not display labels; **workflow rule** fires the webhook. Built with the Zoho admin (answer 8) |
| D7 | Tests | Vitest for every mapping/refusal rule (payload → schema verdict is pure); db tests for `0052` (idempotency, unique key, forced status); a proof against the deployed function before SHIPPED is claimed |

**Build order (TDD, per the standing rule):** payload-mapping domain rules
first (RED), then the migration with db tests, then the Edge Function, then
email, then the Zoho-side wiring with the admin.

---

## 4. Open questions — ANSWERED 2026-08-19, verbatim

1. **Refused draft** — **"a"**. The draft is a record, not a work item: the
   AE fixes in Zoho and submits fresh. Refused drafts are **left in place**
   (visible history; nothing auto-deletes a row an AE might want to read).
2. **Email** — **"app notifications for now. will get to emails a little
   later."** D4/D5 therefore write to the existing `notifications` table
   (the same panel students already have; AEs gain it). The `EmailProvider`
   seam stays in the design so email can be added without reshaping intake.
3. **AE identity** — **"agree to your suggestion"**: map Zoho record owner
   email → active `account_executive` profile; **no match → refuse** the
   intake (Zoho gets a 4xx with a named reason; nothing is inserted).
4. **Zoho admin details** — **Sandbox: No · OAuth: Yes · Module: Deals** ·
   picklist agreement: "these are the ones we discussed regarding — drive
   type and mode".
   - ⚠️ **No sandbox** ⇒ the function is developed against recorded payload
     fixtures (pure, fully testable), and the end-to-end proof runs against
     the **live** CRM using a clearly-named dummy Deal; every drive row it
     creates is deleted as part of the proof.
   - 🔴 **The picklist agreement must cover SIX fields, not two.** Beyond
     `drive_type` and `drive_mode`: **`role_category`** (the load-bearing
     one — 0050 routes the audience by it; a display label instead of
     `software_technical` etc. refuses the whole intake), `arrears_policy`,
     `shift_type`, `marks_scale` (+ `joining_timeline`). Flagged to Karthik
     in chat; the full value lists go to the Zoho admin as a checklist
     before the Deals fields are built.
5. **Webhook trigger** — **workflow rule** on the Deal. A rule can re-fire
   on later edits; answer 4 ("no more edits after submission") plus the
   `zoho_record_id` idempotency key mean any re-fire is swallowed with a
   200 and no second drive.

---

## 5. Risks accepted with Design A (recorded, not relitigated)

1. First server component — a deployment surface we own and monitor.
2. RLS bypass confined to the narrow gate above.
3. Refusals happen off-screen — mitigated by the draft landing + email.
4. Retries — mitigated by the `zoho_record_id` unique key.
