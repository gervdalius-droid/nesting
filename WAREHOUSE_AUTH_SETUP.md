# Shared login + warehouse protection — setup guide

This makes the **Nesting** app and the **GVS db (warehouse)** app share one login,
so only known workers can read/write the warehouse and nobody can ruin the stock.

**Both apps are now updated:**
- **Nesting** (`github/nesting/index.html`) — a name + PIN screen gates the whole app.
- **GVS db** (`github/db/index.html`) — the **worker** login now asks for a PIN and signs
  the worker into their own Supabase account (instead of the shared anon key). Admin login
  was already a real account and is unchanged. The **same name + PIN works in both apps.**

The login screens are only the **first half**. They become *real protection* only after
you do **Part B** (turn on Row-Level Security in Supabase). Until Part B is done, the
embedded `anon` key still lets anyone read/write the warehouse.

---

## How workers log in

Workers just type their **Vardas (name)** and punch a **4-digit PIN** on the on-screen
number pad. **No email, no typed password.** Everything else is generated for them.

Behind the scenes the app maps name + PIN to a normal Supabase account:

```
email    = slug(name) + "." + slug(WORKSHOP_CODE) + "@dedesbaldai.lt"
password = PIN + "_dedes"          (so it meets Supabase's 6-char minimum)
```

- `WORKSHOP_CODE` is baked into `index.html` (default `gvs`) — workers never type it.
- `slug` = lowercase, every run of non-letter/number characters becomes a single `-`.
- `_dedes` is the `AUTH_PIN_SALT` constant in `index.html`.

So **when you create an account, the email and password are fully determined by the
worker's name and PIN** — use this table:

| Vardas | PIN  | Supabase email to create     | Supabase password to set |
|--------|------|------------------------------|--------------------------|
| Jonas  | 1234 | `jonas.gvs@dedesbaldai.lt`    | `1234_dedes`             |
| Aistė  | 5678 | `aiste.gvs@dedesbaldai.lt`    | `5678_dedes`             |
| Petras | 4321 | `petras.gvs@dedesbaldai.lt`   | `4321_dedes`             |

> Formula for any worker: email = `<name>.gvs@dedesbaldai.lt` (lowercase),
> password = `<their PIN>_dedes`.

> **Names must be unique** (the email is built from the name). If you have two
> people called Jonas, use e.g. `Jonas` and `JonasK`.

> No real email is ever sent — `dedesbaldai.lt` is just an internal label.
> To change the domain, workshop code, PIN length, or salt, edit `AUTH_DOMAIN`,
> `WORKSHOP_CODE`, `PIN_LEN`, `AUTH_PIN_SALT` near the top of the auth section
> in `index.html` (then recreate accounts to match).

> ⚠ **A 4-digit PIN is low-entropy (10 000 combos).** It's fine for an internal
> shop tool because (a) Supabase rate-limits login attempts, and (b) RLS limits
> what any logged-in user can do. For more safety, set `PIN_LEN=6` in `index.html`
> and create 6-digit PINs.

---

## Part A — Create worker accounts (warehouse project `byvtqycd`)

1. Supabase dashboard → project **byvtqycdgboqbmpoysyt** → **Authentication → Users**.
2. **Add user → Create new user**.
3. Email + password = the values from the table above (e.g. `jonas.gvs@dedesbaldai.lt` / `1234_dedes`).
4. **Tick "Auto Confirm User"** (so login works without an email click).
5. Repeat for every worker. To change someone's PIN, edit their password to `<newPIN>_dedes`.
   To remove access, delete or ban the user here.

> Turn **off** public sign-ups so strangers can't self-register:
> Authentication → Providers/Settings → disable "Enable email signups" (or set
> "Confirm email" on). Only you (admin) add accounts.

---

## Part B — Lock the warehouse tables with RLS

Run this in Supabase → **SQL Editor** on project **byvtqycd**. After this, only
logged-in users can touch the warehouse; the anonymous key is refused.

```sql
-- 1. Turn on row-level security (default = deny everything)
alter table public.fabflow_stock    enable row level security;
alter table public.fabflow_offcuts  enable row level security;
alter table public.fabflow_cut_jobs enable row level security;

-- 2. Logged-in users may READ stock and offcuts
create policy "auth read stock"   on public.fabflow_stock
  for select to authenticated using (true);
create policy "auth read offcuts" on public.fabflow_offcuts
  for select to authenticated using (true);

-- 3. Logged-in users may READ and CREATE cut jobs (reservations)
create policy "auth read cut_jobs"   on public.fabflow_cut_jobs
  for select to authenticated using (true);
create policy "auth insert cut_jobs" on public.fabflow_cut_jobs
  for insert to authenticated with check (true);
```

> Want stricter rules later (e.g. each user only sees their own `workspace_code`)?
> Replace `using (true)` with `using (workspace_code = (auth.jwt() ->> 'workspace_code'))`
> after you store the code in user metadata. Start with the simple version above.

### ⚠ Order matters: create accounts (Part A) BEFORE you turn on RLS (Part B)

Once RLS is on, anyone using the **anon key** is refused. So:

1. **Part A first** — create every worker's account. Until a worker has an account,
   their name + PIN login will fail in *both* apps. (Admins already have accounts.)
2. **Then Part B** — enable RLS on the warehouse tables.

What still uses the anon key after this change (and why it's fine):
- The GVS **engineer** and **read-only view** logins still use the anon key. They read
  the general key-value table (`fabflow`), which we do **not** put RLS on — only the three
  warehouse tables get RLS. They don't write stock, so they're unaffected.
- If you later want engineers to also reserve/edit warehouse stock, tell me and I'll give
  them the same PIN login (one-line change, same pattern as the worker login).

---

## What changed in the Nesting app (`index.html`)

- A **login overlay** (name + on-screen PIN pad) now blocks the app until you sign in.
- Login calls Supabase Auth on the **warehouse** project and stores a session
  (auto-refreshed; "Atsijungti" button in the header logs out).
- Every warehouse request now sends the **logged-in user's token** instead of the
  shared anon key (`whHeaders()`), so RLS can identify the user.
- Cut-job reservations are stamped with the real user in `created_by`.

## Quick test

1. Open the app → you should see the **name + PIN** screen, not the project picker.
2. Wrong name or PIN → "Neteisingas vardas arba PIN."
3. Correct name + PIN → app opens, header shows `👤 Name`.
4. After **Part B**, anyone hitting the warehouse without logging in is rejected by Supabase.
