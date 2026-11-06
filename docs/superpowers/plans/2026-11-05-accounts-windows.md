# Glassy accounts on Windows: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-launch intro, then optional accounts on Windows: Google, a passkey, a phone number, or email and password with six-digit codes, a unique username, and a profile with a picture and bio that other signed-in people can find, plus report, block, export and delete.

**Architecture:** One Supabase backend, defined entirely by migration files and tested on GitHub Actions against a throwaway local Supabase. In the app, `@supabase/supabase-js` runs only in the main process under `account/`, and the renderer talks to it through validated `account:*` IPC. Everything stays switched off in releases until the launch list is done.

**Tech Stack:** Supabase (Postgres, Auth, Storage, Edge Functions on Deno), pgTAP, Electron 44 `safeStorage`, `node:test`, the app's off-screen `GLASS_SHOT` harness.

**Spec:** `docs/superpowers/specs/2026-11-05-accounts-design.md`, `docs/superpowers/specs/2026-11-05-intro-design.md`

**Out of this plan:** Apple sign-in, Mac accounts, iPhone screens (all wait for Apple Developer membership), authenticator codes, sync, playlists on profiles. The iPhone session builds the same intro, terms-first flow, passkeys and phone number for iPhone. Those get their own plans.

## Global Constraints

- Usernames: lowercase, `^[a-z0-9._]{1,18}$` and at least one of `[a-z0-9]`. Typed capitals become lowercase. Change once every 30 days. Old name held 30 days.
- Bio: plain text, at most 160 characters, shown as text only, links not clickable.
- Passwords: at least 15 characters, at most 72, no required symbols.
- Email codes are 6 digits. Email templates contain the code and no links.
- Terms are read before sign-in: I agree lights up only after scrolling to the end, and Continue without an account skips them.
- Phone sign-in: US and Canada only at first, with a low hourly cap for the whole project.
- Passkeys run in the system browser on a page on our own domain, behind their own switch, because Supabase's are in beta.
- Minimum age 13. Teens (13 to 17) are left out of search and can't change that. A full date of birth is never stored.
- Pictures: JPEG, 512 by 512, at most 512 KB, bucket `avatars`, path `{user id}/{random}.jpg`.
- A person's email is never visible to anyone else. No token reaches the renderer or a log.
- Only the project URL and publishable key ever appear in the app or repo. The builder never holds a secret key, and no secret is ever pasted in a chat.
- `signOut({ scope: 'local' })` for Sign out. `scope: 'global'` only for Sign out everywhere.
- Never set `nodeIntegration: true`, `contextIsolation: false` or `sandbox: false`. Render user content as text with `esc()`, never as raw HTML.
- Signed out or offline, nothing local changes, slows or nags. No sign-in prompt at launch.
- UI follows the app's rules: liquid glass, everything glides, plain language, no emojis.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never mention the removed music service.
- All work is on `main` behind the off switch. Ship no public feature until Task 9's launch list is complete.

## Review Focus

- **No internet, or Supabase down, at launch:** the player starts as normal with no error, and the Account section shows one calm line. Pinned in Task 7.
- **Saved sign-in unreadable** (corrupt file, or Windows can't decrypt it): treated as signed out, file removed, no crash. Pinned in Task 5.
- **Google sign-in abandoned:** browser closed, listener port busy, or a second click. The listener closes after 5 minutes at most, the next port is tried, and a new attempt cancels the old one. Pinned in Task 6.
- **Account deleted or signed out from another device:** the next refresh fails, the app shows signed out, and the local library is untouched. Pinned in Task 5.
- **HTML in a bio or a search result:** `<img src=x onerror=alert(1)>` shows as literal text. Pinned in Task 8.

---

### Task 0: The first-launch intro

Can ship in a public release straight away, because its account screen is skipped while accounts are off.

**Files:**
- Create: `renderer/intro.js`, `tests/ui/intro.js`
- Modify: `renderer/index.html`, `renderer/styles.css`, `renderer/settings.js` (Replay intro)

**Interfaces:**
- Produces: `Intro.maybeShow()` at startup, `Intro.replay()`, and `Intro.accountStep = null`, a slot Task 7 fills

- [ ] **Step 1: Write the failing test:**

```js
// new install (fresh userData, empty library): the intro shows
// library or playlists already present: no intro, and localStorage is marked seen
// seen once: not shown again; Settings > Replay shows it again
// Skip from any screen lands in the app with nothing broken
// accounts off: no account screen
// when the intro ends the canvas is removed and no animation frame is still requested
// reduced motion on: no moving background, screens crossfade
// a song opened from Explorer on first launch: the intro doesn't block it, and it plays once the intro ends
```

- [ ] **Step 2: Run, confirm the failure, write it, run, confirm the pass.** Colors and flow come from the intro spec. Run: `node scripts/ui-test.js tests/ui/intro.js`. Move `scripts/ui-test.js` here from Task 7.

- [ ] **Step 3: Read screenshots of every screen and a frame strip of the entry animation.** Check it glides, with no jump where the panels take over.

- [ ] **Step 4: Commit, then ship with notes,** per the standing release rule.

### Task 1: Usernames, ages and profiles in the database

**Files:**
- Create: `supabase/config.toml`, `supabase/migrations/20261106000100_accounts.sql`, `supabase/tests/database/accounts.test.sql`, `.github/workflows/supabase.yml`

**Interfaces:**
- Produces, all callable by `authenticated` only, each returning JSON `{ ok: true, ... }` or `{ ok: false, code }`:
  - `set_age(date_of_birth date)`: codes `under_13`, `already_set`
  - `set_username(name text)`: codes `invalid`, `taken`, `reserved`, `held`, `blocked`, `too_soon`, `needs_age`, `needs_terms`, `rate_limited`
  - `username_available(name text)`: `{ ok, available, code? }`
  - `accept_terms(version text)`
  - `account_status()`: `{ ok, needs: 'age'|'terms'|'username'|null, profile }`
  - `get_profile(name text)`: `{ ok, profile: { id, username, bio, avatar_path } | null }`
  - `search_profiles(prefix text)`: `{ ok, profiles: [...] }`, at most 20, adults only
  - `update_profile(bio text, avatar_path text)`
  - `report_profile(profile_id uuid, reason text)`, `block_user(id uuid)`, `unblock_user(id uuid)`, `my_blocks()`

**Tables:** `public.profiles` (`id`, `username`, `username_changed_at`, `bio`, `avatar_path`, `hidden`, `created_at`, `updated_at`). `private.ages` (`id`, `turns_18_on date null`: null means adult; for teens, the first of the month after their 18th birthday, so it can't reveal the birthday). `private.reserved_usernames` (`name`, `held_until timestamptz null`). `private.blocked_words`. `private.rate_limits`. `public.blocks`, `public.reports`, `public.consents`, `private.moderation_actions`.

**Access:** row-level security on every table, with explicit grants and nothing granted to `anon`. Signed-in people can select only their **own** `profiles` row directly, and everyone else's goes through the functions. If others could select the table, teens could be listed by querying it, and scraping would skip the rate limits. The age isn't on `profiles` at all, so nobody can read it.

- [ ] **Step 1: Write `accounts.test.sql` with pgTAP.** Using two test users set through `request.jwt.claims`:

```sql
-- the username rule itself
select lives_ok($$insert into profiles(id, username) values (u1(), 'f')$$);
-- each must fail the check: '.', '_', '..', '', 'Fent', 'a b', 'a-b', 'é', 'aaaaaaaaaaaaaaaaaaa' (19)
-- each must pass: '7', 'a.b_c', 'aaaaaaaaaaaaaaaaaa' (18)

-- set_username
is(set_username('Fent')->>'ok', 'true');  is(username_of(u1()), 'fent');
is(as_u2(set_username('FENT'))->>'code', 'taken');
is(set_username('admin')->>'code', 'reserved');
is(set_username('fent2')->>'code', 'too_soon');      -- within 30 days
-- with username_changed_at moved back 31 days, change works, the old name is 'held' for u2,
-- and is free after held_until passes

-- ages
is(set_age(current_date - interval '12 years')->>'code', 'under_13');
is(set_age(current_date - interval '14 years')->>'ok', 'true');
is(set_age(current_date - interval '20 years')->>'code', 'already_set');
is(set_username('x')->>'code', 'needs_terms');       -- age done, terms not

-- reads, as anon: profiles is empty and every function is denied
-- as u2: direct select of u1's profile returns 0 rows; get_profile('fent') returns it
-- search_profiles('fe') finds an adult, not a teen; get_profile finds a teen by exact name
-- hidden and blocked (either direction) are left out of both, and a blocked user's get_profile returns null
-- u1 can't update username or hidden directly (privilege error), and can't update u2's bio
-- bio of 161 characters refused by update_profile; avatar_path outside '{uid}/' refused
-- private schema: every table denied to anon and authenticated
-- reports: u2 can call report_profile, and can't select from reports
-- the 31st search_profiles call in a minute returns rate_limited
```

- [ ] **Step 2: Write `.github/workflows/supabase.yml`.** Triggered on pushes and PRs touching `supabase/**`, on `ubuntu-latest`: `actions/checkout@v4`, `supabase/setup-cli@v1`, `supabase start`, `supabase db reset`, `supabase test db`, `supabase db lint --level warning`, then a gitleaks scan of the whole repo.

- [ ] **Step 3: Push and confirm the tests fail** because the functions don't exist.

Run: `gh run watch --exit-status`
Expected: the `supabase test db` step fails.

- [ ] **Step 4: Write the migration.** Security-definer functions live in `private` with `set search_path = ''`, behind thin public wrappers. The unique index on `username` settles races: catch `unique_violation` and return `taken`. Rate limits per user per minute: `search_profiles` 30, `get_profile` 120, `username_available` 60, `report_profile` 10. Seed `reserved_usernames` with `admin`, `administrator`, `support`, `help`, `glassy`, `glass`, `official`, `root`, `system`, `moderator`, `mod`, `staff`, `fent`, `null`, `undefined`. Teens' `turns_18_on` passing lifts the search exclusion by itself, because the filter compares it with today.

- [ ] **Step 5: Push and confirm the workflow passes.** Expected: all tests pass, and lint reports no warnings.

- [ ] **Step 6: Commit** the migration, tests, config and workflow.

### Task 2: Pictures and removing a profile

**Files:**
- Create: `supabase/migrations/20261106000200_avatars.sql`, `supabase/tests/database/avatars.test.sql`, `docs/accounts/moderation-runbook.md`

**Interfaces:**
- Consumes: `profiles`, `private.moderation_actions`
- Produces: bucket `avatars`; `private.remove_profile(id uuid, reason text)`, run by the owner from the dashboard

- [ ] **Step 1: Write the failing tests.**

```sql
-- bucket: public = true, file_size_limit = 524288, allowed_mime_types = '{image/jpeg}'
-- as u1: insert into storage.objects under '{u1}/a.jpg' works; under '{u2}/a.jpg' is refused
-- as u1: can't update or delete objects under '{u2}/'
-- as anon: select from storage.objects returns 0 rows (nobody can list the bucket)
-- remove_profile(u1, 'reason'): hidden = true, avatar_path null, one moderation_actions row with the reason
-- remove_profile isn't callable by authenticated
```

- [ ] **Step 2: Push, confirm the failure, write the migration, push, confirm the pass.**

- [ ] **Step 3: Write the runbook** in plain language. Handling a report: read it in the dashboard, run `remove_profile`, delete the picture in Storage (hiding alone leaves it at its public address), email the person the reason. Non-consensual intimate images: act within 48 hours. Someone found to be under 13: delete the account.

- [ ] **Step 4: Commit.**

### Task 3: Sign-in settings and code-only emails

**Files:**
- Modify: `supabase/config.toml`
- Create: `supabase/templates/confirmation.html`, `recovery.html`, `email_change.html`, `reauthentication.html`, `supabase/tests/integration/auth.test.mjs`
- Modify: `.github/workflows/supabase.yml` (runs `node --test supabase/tests/integration`)

**Settings:** `minimum_password_length = 15`, `password_requirements = ""`, `enable_confirmations = true`, `secure_password_change = true`, `otp_length = 6`, `flow_type` PKCE on the client, additional redirect URLs `http://127.0.0.1:53682/auth/callback`, `:53683`, `:53684`, Google on (credentials from `env()`), Apple off.

- [ ] **Step 1: Write the failing tests** against the local stack, reading mail from its Mailpit API:

```js
test('14 characters refused, 15 accepted');
test('sign-up email holds a 6 digit code and no href', ...assert.match(body, /\b\d{6}\b/); assert.doesNotMatch(body, /href=/));
test('verifyOtp type signup with that code gives a session');
test('can\'t sign in before confirming');
test('reset for a known and an unknown email answer identically');
test('reset code, then updateUser with a new password, then the old password fails');
test('changing a password needs a reauthentication code');
```

- [ ] **Step 2: Push, confirm the failure, write the settings and templates, push, confirm the pass.** The templates use `{{ .Token }}`, in the app's plain voice.

- [ ] **Step 3: Commit.**

### Task 4: Delete account and download my data

**Files:**
- Create: `supabase/functions/delete-account/index.ts`, `supabase/functions/export-data/index.ts`, `supabase/tests/integration/functions.test.mjs`

**Interfaces:**
- Produces: `POST delete-account` with `{ username }`, answering `200 { ok: true }`, `401 { code: 'reauth' }`, `400 { code: 'wrong_username' }`. `POST export-data`, answering a JSON file of the caller's profile, consents, blocks and reports.

- [ ] **Step 1: Write the failing tests:**

```js
test('no JWT: 401');
test('sign-in older than 10 minutes: 401 reauth');   // checks the newest amr timestamp in the JWT
test('wrong username: 400 and nothing is deleted');
test('right username: auth user, profile, ages, consents, blocks and picture files are all gone');
test('deleting user A leaves user B and B\'s files alone');
test('export-data returns only the caller\'s rows and never another person\'s email');
```

- [ ] **Step 2: Push, confirm the failure, write the functions, push, confirm the pass.** Build a client from the caller's JWT to identify them, and use the secret-key client read from the environment only for the deletion, with an explicit check of the caller's id. Never log headers or tokens.

- [ ] **Step 3: Commit.**

### Task 5: The account core in the main process

**Files:**
- Create: `account/config.js`, `account/username.js`, `account/store.js`, `account/client.js`, `account/fake.js`, `account/ipc.js`, `tests/account/username.test.js`, `tests/account/store.test.js`, `tests/account/client.test.js`, `tests/account/ipc.test.js`
- Modify: `main.js`, `preload.js`, `package.json` (add `@supabase/supabase-js`, add `account/**/*` to `build.files`, add `"test": "node --test tests/"`)

**Interfaces:**
- `config.enabled(): boolean`: true only when `process.platform === 'win32'` and (`GLASS_ACCOUNTS` is set or the shipped `ENABLED` constant is true). `ENABLED` starts false. When false, `main.js` never requires the rest of `account/`, so startup costs nothing.
- `username.js`, usable from both main and renderer (`module.exports` guarded): `normalize(s) -> string` (trims, lowercases), `problem(s) -> null | 'invalid'`.
- `store.js`: `createStore({ safeStorage, file }) -> { getItem(k), setItem(k, v), removeItem(k) }`, async, using `encryptStringAsync` and `decryptStringAsync`, in `userData/account-session.bin`.
- `client.js`: `createAccount({ supabase, openBrowser }) -> api`, with `state()`, `signUp(email, password)`, `verifySignup(email, code)`, `signIn(email, password)`, `resetStart(email)`, `resetFinish(email, code, password)`, `google()`, `setAge(date)`, `acceptTerms(version)`, `usernameAvailable(name)`, `setUsername(name)`, `updateProfile({ bio })`, `savePicture(jpegBuffer)`, `getProfile(name)`, `search(prefix)`, `report(id, reason)`, `block(id)`, `unblock(id)`, `signOut(everywhere)`, `exportData()`, `deleteAccount(username)`, `onChange(cb)`.
- Every method resolves `{ ok: true, ... }` or `{ ok: false, code, message }`, with extra codes `offline`, `bad_code`, `weak_password`, `reauth`, `unknown`. State is `{ signedIn, needs, profile: { id, username, bio, avatarUrl } | null, email }`, and never holds a token.
- `fake.js`: same API, in memory, chosen by `GLASS_ACCOUNT_FAKE=1`, with `GLASS_ACCOUNT_FAKE=offline` failing every call with `offline`.
- `ipc.js`: `register(ipcMain, api, win)` handles `account:<method>`, refuses senders other than the app's own window and file URL, and checks argument types and lengths before calling `api`. Pushes `account:changed`.
- `preload.js`: `glass.account = { state, signUp, ..., onChanged(cb) }`.

- [ ] **Step 1: Write the failing tests:**

```js
// username
assert.equal(normalize('  Fent '), 'fent');
for (const ok of ['f', '7', 'a.b_c', 'a'.repeat(18)]) assert.equal(problem(ok), null);
for (const bad of ['', '.', '_', '..', 'a b', 'a-b', 'é', 'а' /* Cyrillic */, 'a'.repeat(19)]) assert.equal(problem(bad), 'invalid');
// store
test('round trip through a fake safeStorage');
test('a corrupt file reads as null and is removed');
test('safeStorage unavailable: getItem returns null, nothing throws');
// client, with a stub supabase
test('signOut() calls scope local; signOut(true) calls scope global');
test('a failed refresh (account deleted elsewhere) emits signedIn false and removes the session');
test('a network failure maps to code offline; state stays as it was');
test('state and every result never contain access_token or refresh_token', ...JSON.stringify(result));
// ipc
test('a call from a foreign sender is refused');
test('a non-string or over-long argument is refused before reaching the api');
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npm.cmd test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the modules.** In `main.js`, one guarded line after the window helpers: `if (require('./account/config').enabled()) require('./account/ipc').start({ app, ipcMain, shell, safeStorage, getWin: () => win });`.

- [ ] **Step 4: Run `npm.cmd test`, expect a pass, and run `node scripts/smoke.js <scratch dir>`, expect "Smoke test passed".** With accounts off, the app is unchanged.

- [ ] **Step 5: Commit.**

### Task 6: Google sign-in through the browser

**Files:**
- Create: `account/oauth.js`, `tests/account/oauth.test.js`
- Modify: `account/client.js`

**Interfaces:**
- `signInWithBrowser({ authUrl, projectHost, open, ports = [53682, 53683, 53684], timeoutMs = 300000 }) -> Promise<{ code } | { error }>`. Errors: `cancelled`, `timeout`, `no_port`, `bad_url`.

- [ ] **Step 1: Write the failing tests:**

```js
test('binds 127.0.0.1 only, never 0.0.0.0');
test('a busy first port moves on to the next');
test('all ports busy: error no_port');
test('refuses an authUrl that is not https://<projectHost>/auth/v1/authorize: bad_url, browser not opened');
test('a callback with a code resolves it, answers a plain page, and closes the listener');
test('any other path gets 404 and the listener keeps waiting');
test('no callback within timeoutMs: error timeout and the listener is closed');
test('a second call cancels the first: first resolves cancelled, its port is free');
```

- [ ] **Step 2: Run, confirm the failure, write it, run, confirm the pass.** `client.google()` calls `signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } })`, passes the URL here, then `exchangeCodeForSession`. The answer page is one calm line, "You can go back to Glassy", with no scripts.

- [ ] **Step 3: Commit.**

### Task 6a: Phone number sign-in

**Files:**
- Modify: `supabase/config.toml` (SMS settings from `env()`, `sms_sent` rate limit 30 an hour), `account/client.js`, `account/fake.js`
- Test: `tests/account/client.test.js`, `supabase/tests/integration/auth.test.mjs`

**Interfaces:**
- Produces: `phoneStart(number)`, `phoneVerify(number, code)`, `linkPhone(number)`, `linkPhoneVerify(number, code)`. New code `phone_region` for numbers outside `+1`.

- [ ] **Step 1: Write the failing tests:**

```js
test('a non +1 number is refused with phone_region before anything is sent');
test('hitting the provider cap returns rate_limited, and email sign-in still works');
test('a wrong code returns bad_code');
test('a phone number never appears in get_profile, search_profiles or export-data of another user');
test('a session signed in by text alone can\'t delete the account without a fresh code');
```

- [ ] **Step 2: Run, confirm the failure, write it, run, confirm the pass. Commit.**

### Task 6b: Passkeys

**Files:**
- Create: `web/passkey/index.html`, `web/passkey/passkey.js` (static page for the owner's domain, using the Supabase JS client with `experimental: { passkey: true }`)
- Modify: `account/config.js` (`passkeysEnabled`, off by default), `account/oauth.js` (reused for the return trip), `account/client.js`

**Interfaces:**
- Produces: `passkeySignIn()`, `passkeyAdd()`. Both open the page through `signInWithBrowser` with the page's exact address allow-listed, and return the same results as `google()`.

- [ ] **Step 1: Read the current Supabase passkey docs first,** since the API is in beta, and note anything that differs from this task.

- [ ] **Step 2: Write the failing tests:** the page only redirects to `http://127.0.0.1:53682` to `53684` or `glassy://`; any other return address is refused; a code comes back and is exchanged like Google's; `passkeysEnabled` false hides both buttons and starts nothing.

- [ ] **Step 3: Run, confirm the failure, write it, run, confirm the pass. Commit.** A real Windows Hello test waits for Task 9, when the domain exists.

### Task 7: Sign-in screens in Settings

**Files:**
- Create: `renderer/account.js`, `tests/ui/account-signin.js`
- Modify: `renderer/settings.js`, `renderer/index.html` (script tag before `settings.js`; add the Supabase storage host to `img-src` from `account/config.js`'s value when accounts ship), `renderer/styles.css`

**Interfaces:**
- Consumes: `glass.account.*`, `Art.layer`, `esc`, `toast`
- Produces: `window.Account = { sectionHTML(), mount(form), openPicker(), state() }`. `scripts/ui-test.js <eval file>` runs an eval off-screen and muted with `GLASS_ACCOUNT_FAKE=1`, failing on any renderer error.

**Screens, as glass sheets over Settings:** the Account section goes above Glass in Settings. The sign-up screen follows the layout in the accounts spec and `docs/superpowers/mockups/intro-preview.html`, with Apple left out of the button row for now. Signing up with any method opens the scrolling terms first, and I agree lights up at the end. Then the method's own steps, then date of birth, then a username picker with a live check. The same screen fills `Intro.accountStep`. Forgot password goes email, code, new password. Each step glides into the next inside one sheet.

- [ ] **Step 1: Write the failing test** in `tests/ui/account-signin.js`:

```js
// accounts off (no GLASS_ACCOUNTS): no Account section, window.glass.account undefined
// fake on, signed out: the screen shows email and password fields, Google, passkey and phone buttons, and no Apple button
// 'Have an account? Sign in' switches the wording and shows Forgot password; Continue without an account closes it with nothing sent
// choosing a method opens the terms; I agree stays off until scrolled to the end, and no sign-in call happens before it
// terms version changed since accepted: asked again at next sign-in
// app launch shows no sheet and no prompt
// password of 14 characters: inline hint, nothing sent
// wrong code: inline message, the box stays
// date of birth 12 years ago: "can't create an account", sheet closes signed out, trying again on this device refuses
// the picker turns 'Fent' into 'fent'; '.' shows the rule; 19 characters can't be typed; 'taken' and 'reserved' show plain messages
// finishing shows the username and picture in Settings
// GLASS_ACCOUNT_FAKE=offline: one calm line in the section, the song keeps playing, no renderer error
```

- [ ] **Step 2: Run, confirm the failure.** Run: `node scripts/ui-test.js tests/ui/account-signin.js`. Expected: FAIL.

- [ ] **Step 3: Write the screens.** Message text is plain: "That code didn't work. Try again or send a new one." The over-18 or under-18 answer is never shown back or hinted at on the date screen.

- [ ] **Step 4: Run, confirm the pass, and read a screenshot of each step.** Check it against the taste rules, and that every transition glides.

- [ ] **Step 5: Commit.**

### Task 8: Profiles, people search, report, block, export, delete

**Files:**
- Create: `renderer/people.js`, `tests/ui/account-profile.js`
- Modify: `renderer/account.js`, `renderer/extras.js` (add a People group to the typed search results using `sectionItem`), `renderer/app.js` (a profile page item in `buildItemsInner`, built like the artist hero in `extras.js`), `renderer/index.html`, `renderer/styles.css`

**Interfaces:**
- Consumes: `glass.account.*`, `Art.pickAndAdjust`, `sectionItem`, `backItem`, `esc`
- Produces: `People.open(username)`, `People.results(query) -> items`

- [ ] **Step 1: Write the failing test:**

```js
// bio '<img src=x onerror=alert(1)>' appears as literal text; no img element, no alert, in both Settings and the profile page
// a 161st bio character can't be typed; a counter shows what's left
// picking a picture uses Adjust cover, saves, and the new picture shows in Settings
// signed out, the search tab shows no People group and sends nothing
// signed in, typing 'fe' shows matches under People after a short pause; one query per pause, not per key
// opening a person shows picture, username, bio and a place for playlists; never an email
// profile menu: Report asks for a reason and confirms; Block removes them from results; Unblock is under Settings
// changing a username within 30 days shows "You can change it again on <date>"
// Sign out: signed out, the library, queue and playback untouched. Sign out everywhere asks first
// Delete account: asks for the typed username; code reauth asks to sign in again; afterwards signed out, library, queue and playlists all intact
// Download my data saves a JSON file
```

- [ ] **Step 2: Run, confirm the failure, write it, run, confirm the pass, and read screenshots.**

- [ ] **Step 3: Commit.**

### Task 9: Deploy path, legal drafts and the launch list

**Files:**
- Create: `.github/workflows/supabase-deploy.yml`, `docs/legal/terms.md`, `docs/legal/privacy.md`, `docs/legal/guidelines.md`, `docs/accounts/launch-list.md`, `docs/accounts/owner-setup.md`
- Modify: `account/config.js` (development URL and publishable key, once the owner has them)

- [ ] **Step 1: Write `supabase-deploy.yml`.** `workflow_dispatch` with an `environment` input of `development` or `production`, using that GitHub environment's secrets, runs `supabase link`, `supabase db push` and `supabase functions deploy`. It never echoes a secret. The production environment requires the owner's approval.

- [ ] **Step 2: Write `owner-setup.md`** as click-by-click steps: the Supabase development project, Google client, GitHub environments and secrets, domain and email sender, text message provider with a spending alert, and hosting the passkey page. It repeats that secrets are typed into dashboards only.

- [ ] **Step 3: Draft the terms, privacy policy and community guidelines** from the checklist in the private legal research, including the retention schedule, marked at the top as drafts for a lawyer. `accept_terms` stores the version string.

- [ ] **Step 4: Write `launch-list.md`** from the spec's launch list, each line with how to prove it.

- [ ] **Step 5: Once the owner has the development project,** run the deploy workflow, then with `GLASS_ACCOUNTS=1` try real sign-up, reset, Google, a real text, a Windows Hello passkey, profile edit, search and delete. Fix what real email and Google expose.

- [ ] **Step 6: Commit.** Ship releases with `ENABLED` false until `launch-list.md` is complete and the owner says go.
