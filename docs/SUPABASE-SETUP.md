# Connecting the app to Supabase — step by step

Written for a non-technical reader. Follow the steps **in order**. After each
step there is a **"You should see"** line — if you see something different,
stop and report it rather than continuing.

Anything in a grey box is a command. Copy it exactly, paste into Terminal,
press Enter.

---

## ⚠️ Before you start — three things to confirm

**1. `karthikraja@faceprep.in` must be able to sign in with Google.**
This app has **no password login**. Sign-in is Google-only, and the database
allows exactly one account at the start: `karthikraja@faceprep.in`
(seeded by migration `0002`). If that address is not a Google Workspace or
Gmail account, **nobody will be able to log in** and we must change the seed
before pushing.

**2. The Supabase project must be brand new and empty.**
These migrations create tables from scratch. Running them on a database that
already has tables will fail partway and leave a mess.

**3. Region must be `ap-south-1` (Mumbai).**
Student data stays in India. This cannot be changed after the project is
created — you would have to delete and recreate.

---

## What is actually going to be installed

Ten files in `supabase/migrations/` run in order. Together they are the whole
database. Plain English:

| File | What it creates |
|---|---|
| `0001_enums.sql` | The fixed vocabularies — user roles, statuses, drive types. Mirrors `src/domain/types.ts` exactly |
| `0002_identity.sql` | Colleges, degrees, branches; staff accounts; **the founding Admin invite**; settings (offer bands, absence limit, 5 MB upload cap) |
| `0003_students.sql` | `students`, role preferences, documents, semester marks, skill scores |
| `0004_drives.sql` | `drives` (the PIF and DAF are one record), eligible degrees/branches, target campuses, rounds |
| `0005_applications.sql` | `applications` + frozen snapshots, shortlists, recruiter exports, round participants, results, attendance |
| `0006_outcomes.sql` | Offers, placement-record overrides, opt-out requests, disbarment decisions, notifications, email deliveries |
| `0007_audit.sql` | `audit_log` — append-only. Nobody can edit or delete an entry, not even an Admin |
| `0008_rls.sql` | Row Level Security — the rules deciding who may see which rows. This is what stops one student seeing another's marks |
| `0009_guards.sql` | The login allowlist, locking of verified academic fields, irreversibility rules |
| `0010_storage.sql` | Three **private** file buckets: `marksheets`, `resumes`, `offer-letters`. 5 MB cap. Never public |

**Do not copy-paste these into the Supabase SQL Editor by hand.** The command
in Step 6 runs them in the right order *and* records which have run. If you
paste them manually that record is not written, and every future update will
try to run them again and fail.

No extensions need enabling. Nothing needs turning on in the dashboard first.

---

## Step 1 — Create the Supabase project

1. Go to <https://supabase.com/dashboard> and sign in.
2. Click **New project**.
3. **Name:** `fpc-pms`
4. **Database Password:** click Generate. **Copy it into your password manager
   now.** You need it in Step 4 and it is not shown again.
5. **Region:** `South Asia (Mumbai) ap-south-1` ← must be this.
6. Click **Create new project**, wait ~2 minutes until it stops saying
   "Setting up project".

**You should see:** a project dashboard, and the URL in your browser looks like
`https://supabase.com/dashboard/project/abcdefghijklmnop`.

That last part, `abcdefghijklmnop`, is your **Project Ref**. Copy it — Step 4
needs it. (It is not a secret; the password is.)

---

## Step 2 — Open Terminal in the project folder

Open the **Terminal** app, then paste:

```
cd ~/fpc-pms && export PATH="$HOME/.npm-global/bin:$PATH"
```

**You should see:** no output, just a new prompt. Silence means success.

> You must re-run this line every time you open a new Terminal window.

---

## Step 3 — Log the tool in to Supabase

```
pnpm supabase login
```

A browser tab opens asking you to authorise. Approve it, return to Terminal.

**You should see:** `Finished supabase login.`

---

## Step 4 — Link this folder to your project

Replace `<PROJECT_REF>` with the value from Step 1:

```
pnpm supabase link --project-ref <PROJECT_REF>
```

It will ask for the **database password** from Step 1. Type or paste it — the
screen stays blank as you type, that is normal — press Enter.

**You should see:** `Finished supabase link.`

> Never paste that password into a chat window. Only into this prompt.

---

## Step 5 — Preview what will run (changes nothing)

```
pnpm supabase db push --dry-run
```

**You should see:** a list of all ten migrations, `0001_enums` through
`0010_storage`, described as would-be-applied.

- If it lists **fewer than ten**, stop and report it.
- If it says the remote database already has migrations, the project is **not
  empty** — stop. Do not continue.

---

## Step 6 — Install the database

```
pnpm supabase db push
```

Type `Y` when it asks for confirmation.

**You should see:** each migration listed as applied, ending with
`Finished supabase db push.`

**If it fails partway:** stop. Do not re-run it. Report the exact error. A
half-applied database needs deliberate cleanup, and re-running will produce a
confusing second error that hides the real one.

---

## Step 7 — Check it worked

In the dashboard, open **Table Editor** (left sidebar).

**You should see:** tables including `students`, `drives`, `applications`,
`offers`, `audit_log`, `profiles`, `staff_invitations`.

Then open **Table Editor → `staff_invitations`**.

**You should see:** exactly one row — `karthikraja@faceprep.in`, role `admin`.
That row is what lets you log in. If it is missing, sign-in cannot work.

Also open **Storage** in the sidebar.

**You should see:** three buckets — `marksheets`, `resumes`, `offer-letters`,
all marked **Private**. If any says Public, stop and report it.

---

## Step 8 — Regenerate the app's type definitions

```
pnpm db:types && pnpm test:run
```

**You should see:** `Tests  344 passed (344)` (or more).

If the test count drops or anything fails, stop and report it — that means the
database and the app have drifted apart.

---

## Step 9 — Set up Google sign-in

This has three parts: Google Cloud Console (9a), the Supabase dashboard (9b),
and one setting people always forget (9c).

> Google renames these screens every few months. If a menu name below does not
> match exactly, look for the nearest equivalent — the *order* of operations is
> what matters.

---

### ⚠️ The one decision that matters: Internal vs External

Google asks who is allowed to use your app.

| Choice | Who can sign in |
|---|---|
| **Internal** | **Only `@faceprep.in` accounts.** Every student is blocked |
| **External** | Any Google account — college addresses, personal Gmail |

**Choose External.** Students sign in with college or personal Gmail addresses,
not `faceprep.in` ones. Internal would lock out every student in the system.

(Internal is only offered at all if `faceprep.in` is Google Workspace. Ignore
it either way.)

**"External" does not mean the public can use the PMS.** Two separate gates
stand in the way: Google's own test-user list while the app is unpublished,
and — permanently — the database allowlist from `0009_guards.sql`, which
refuses any address that is not a rostered student or an invited staff member.

---

### 9a. Google Cloud Console

1. Go to <https://console.cloud.google.com/> and sign in as
   `karthikraja@faceprep.in`.

2. Top-left project dropdown → **New Project**.
   Name it `FACE Prep PMS` → **Create**. Wait for it to finish, then make sure
   that new project is the one selected in the dropdown.

3. Left menu → **APIs & Services → OAuth consent screen**.
   (Newer console: **Google Auth Platform → Get started**.)

4. Fill in:
   - **App name:** `FACE Prep Campus PMS`
   - **User support email:** `hello@faceprep.in`
   - **Audience / User type:** **External** ← see the box above
   - **Developer contact email:** `karthikraja@faceprep.in`

   Save and continue through the remaining pages. **Do not add any scopes.**
   The app only needs the default email and profile, and adding more would
   trigger a Google verification review you do not want.

5. Go to **Audience** (older console: *OAuth consent screen → Test users*).
   Under **Test users** click **Add users** and add every address you intend to
   sign in with while testing:
   - `karthikraja@faceprep.in`
   - the Gmail addresses you put in `scripts/seed-test-students.sql`

   While the app is unpublished, **only these addresses can sign in.** An
   address missing here gets "access blocked" from Google before our database
   is ever consulted.

6. Left menu → **Credentials** → **Create credentials** → **OAuth client ID**.

7. **Application type:** **Web application**. **Name:** `Supabase`.

8. Find **Authorised redirect URIs** → **Add URI** → paste **exactly** this:

```
https://poscikalmgfpvbjfytgw.supabase.co/auth/v1/callback
```

   Character for character. No trailing slash, no `http://`, no spaces. This is
   the single most common failure and it produces a `redirect_uri_mismatch`
   error at sign-in.

   *Authorised JavaScript origins can be left empty — the browser never talks
   to Google directly in this flow; Supabase does.*

9. Click **Create**. A panel shows your **Client ID** and **Client Secret**.
   Keep it open for the next part, and save both to your password manager.

---

### 9b. Supabase dashboard

1. <https://supabase.com/dashboard> → project **FPC-PMS**.
2. **Authentication** → **Sign In / Providers** (older UI: *Providers*).
3. Find **Google**, toggle it **on**.
4. Paste the **Client ID** and **Client Secret** from step 9a.9.
5. **Save**.

> 🔒 These go in the dashboard only. Never paste the Client Secret into a chat
> window, a file, or a commit. If it leaks, delete the OAuth client in Google
> Cloud and create a new one.

---

### 9c. The setting everyone forgets

Supabase needs to know where to send people *after* Google approves them.
Miss this and sign-in appears to work, then dumps the user on a blank page or
back at localhost with an error.

1. **Authentication** → **URL Configuration**.
2. **Site URL:** `http://localhost:5173`
3. **Redirect URLs** → **Add URL:** `http://localhost:5173/**`
   (the `/**` matters — it permits any path under localhost)
4. **Save**.

When the app is deployed for real, add the production URL here too. Both can
coexist.

---

### Before real students use it: publish the app

While the app is in **Testing**, only the test users from 9a.5 can sign in — a
hard limit of 100. Real students will exceed that.

When you are ready: **Google Auth Platform → Audience → Publish app**.

Because the app requests only basic email and profile scopes, publishing does
**not** require Google's verification review. If Google ever asks for
verification, it means an extra scope crept in — tell me and I will remove it.

Publishing does not widen access to the PMS itself: `0009_guards.sql` still
refuses anyone who is not on the roster or invited.

---

## Step 10 — Point the app at your project

1. In the dashboard: **Project Settings → API**.
2. Copy the **Project URL** and the **anon / public** key.
3. In Terminal:

```
cp .env.example .env.local && open -e .env.local
```

4. A text editor opens. Replace the placeholders so it reads:

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<the long anon key>
```

5. Save and close.

> The `anon` key is safe in this file — it is designed to be public, and RLS
> from Step 6 is what protects the data. Never use the `service_role` key here.

---

## Step 11 — Run the app

```
pnpm dev
```

Open <http://localhost:5173>.

⚠️ **You cannot sign in yet — and that is expected.**

The **login screen and auth guard have not been built**. There is a Supabase
client at `src/lib/supabase.ts`, but nothing in the app calls it to sign in.
Use the **"Preview as" role switcher** in the header to browse the screens;
they are still served by the MSW mock backend, not by Mumbai.

So after Step 10 the position is:

| Piece | State |
|---|---|
| Database on Mumbai | ✅ live, RLS on, allowlist armed |
| Google sign-in configured in Supabase | ✅ once Step 9 is done |
| `.env.local` pointing at Mumbai | ✅ |
| **Login screen in the app** | ❌ **not built — this is the next coding task** |

Once the login screen exists, the expected behaviour is:

- `karthikraja@faceprep.in` signs in and lands as Admin.
- **Anyone else is refused** with "Address … is not registered. Ask your
  placement coordinator for an invitation." That is `0009_guards.sql` working
  correctly — students can only log in once their roster is uploaded, staff
  only once an Admin invites them.

---

## If something goes wrong

Report **the exact error text** plus which step number you were on. Do not
re-run a failed `db push`.

The most likely stumbles, in order:

1. **Wrong database password** in Step 4 → re-run Step 4.
2. **Project not empty** in Step 5 → do not push; we decide together.
3. **Redirect URI mismatch** at Step 11 → the URI in Google Cloud must match
   Step 9a character for character, including `https://` and no trailing slash.
4. **Sign-in refused for `karthikraja@faceprep.in`** → that address is not a
   Google account, or `staff_invitations` is empty. Check Step 7.
</content>
