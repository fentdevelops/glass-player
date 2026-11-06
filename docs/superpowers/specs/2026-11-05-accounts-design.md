# Glassy accounts: sign-in, usernames and profiles

Status: approved by the owner on 5 November 2026. Nothing here is built yet.

## Intent

Glassy is a local player. Accounts are the first step online: a person gets a unique username and a profile with a picture, a bio and the playlists they choose to share. Syncing playlists, favorites and settings between devices comes straight after. A community comes later. Accounts have to feel as smooth as the rest of the app and must not repeat the mistakes that got other AI-built apps breached.

## Goals

- Sign in with Google, Sign in with Apple, or email and password, on Windows, Mac and iPhone, all on one shared backend.
- Password reset, and six-digit email codes wherever an email has to prove something.
- A unique username and a profile: picture, bio, shared playlists.
- Find a person by username and open their profile.
- The things stores and law require once accounts and public profiles exist: delete account, report, block, terms and privacy policy.

## Not in this design

- Syncing playlists, favorites and settings, and playlists appearing on profiles. Both need the song identity work, so they get their own design next. The profile page leaves room for playlists.
- Following, feeds, comments, messages, uploads, streaming, listening activity.
- Passkeys and SMS codes.

## Must never happen

- Anything local breaks, slows down or nags because someone is signed out or offline. Sign-in is optional, everywhere.
- A person's email becomes visible to anyone else.
- A sign-in token reaches the renderer, a log or the repo.
- A secret key ships in an app, lands in the repo, or gets pasted into a chat.
- Sign-in happens inside an embedded browser window.
- We write our own password checking or encryption.

## Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **Supabase** (hosted auth, Postgres, storage, Edge Functions) | Row-level security is easy to get wrong, so it needs tests. Handles all the sign-in methods, password hashing and codes. Cheap at small sizes. Earlier research priced it far below the alternatives at scale. | **Chosen.** The owner already offered to set it up |
| Firebase Auth and Firestore | Good sign-in, but much higher cost at scale in the research, and a harder path to the SQL the later playlist and community work needs | Rejected |
| Our own server and auth | Full control, and every breach risk becomes ours | Rejected: sign-in code is the last thing to hand-write |

## Decisions

### The owner's

- Google, Apple, and email and password with reset. This overrides the earlier research advice of no passwords at launch.
- Profiles show picture, bio and shared playlists.
- Usernames are unique, have no minimum length, 18 characters at most, allow periods and underscores, and allow no spaces or other special characters.
- **Accounts are 13 and up.** Teen profiles are hidden from search.
- **Windows goes first**, with Google and email. Apple sign-in, the iPhone app and accounts on Mac follow once the owner has Apple Developer membership. Mac waits because an ad hoc signed app would ask for Keychain permission after each update. The public launch list below applies to the Windows launch; the Apple token test and iPhone screens belong to the later one.

### Proposed, and not yet confirmed by the owner

Each of these is the builder's default unless the owner changes it.

- **Capitals:** usernames are lowercase. Typed capitals become lowercase, so `Fent` and `fent` are one name, and `I` and `l` can't be used to fake someone.
- **Alphabet:** a to z, 0 to 9, `.` and `_`. Accented and non-Latin letters are refused, which also blocks lookalike names.
- **At least one letter or number:** `f` and `7` are fine, `.` and `_` are not. Database check: `username ~ '^[a-z0-9._]{1,18}$' AND username ~ '[a-z0-9]'`.
- **Reserved names:** a table of names nobody can take, such as `admin`, `support`, `glassy`, plus the owner's own name, which they claim first.
- **Changing a username:** once every 30 days. The old name is held for 30 days before anyone else can take it, so nobody can step into a name right after someone leaves it.
- **Filtering:** a blocklist of slurs for usernames and bios. Apple requires filtering once people can post content.
- **Bio:** plain text, 160 characters at most, shown as text only. Links aren't clickable.
- **Who can see profiles:** signed-in people only, so strangers can't scrape them. Search by username prefix, rate limited, in the Search tab under a People group while signed in.
- **Ages:** a date of birth is asked once, on a neutral screen that doesn't hint at the required age. Only the date someone turns 18 is kept, never the full date of birth, and clients can't write it. Under 13: no account, the just-created sign-in is deleted, and that device can't simply try again with another date. If anything later shows someone is under 13, the account is deleted.
- **Teens (13 to 17):** left out of People search and suggestions, with no switch to change that until they turn 18, when it lifts by itself. Someone with their exact username or link can still open their profile, and report and block still work.
- **Passwords:** at least 15 characters, no required symbols, and a check against leaked passwords (needs Supabase Pro). NIST asks for 15 when a password is the only factor. Supabase's hashing limit means a 72 character maximum.
- **Bundle ID:** the iPhone app's ID still needs choosing, and it can't change after launch. Recommended: `com.fentdevelops.glassy`. The desktop ID stays `com.glass.player` so updates keep working.

### What "OTP" and "encryption" mean here

**Six-digit email codes** are used at sign-up, for password reset, and before changing a password or email. Links are never used, because a link can't finish a secure sign-in that started on another device. Email templates show the code only.

**Not included: a code on every new device.** Supabase's second factors are an authenticator app or a phone, not email ([Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa)), so this would mean writing our own sign-in gate, the riskiest code in the project.

**Later: an authenticator app code** as an optional second step. It gets its own small design, because the hard part is getting back in after losing the phone, and Supabase's docs disagree on recovery codes. Nothing in this design enforces a second factor.

**Encryption:**
- All traffic uses encrypted connections.
- Supabase stores password hashes, never passwords, and encrypts its disks.
- Sign-in tokens are locked by the device: Electron `safeStorage` on Windows and Mac, the Keychain on iPhone.
- Apple refresh tokens sit in a private table that no client can read.
- No end-to-end encryption: profiles are public to signed-in people and need to be readable by the server. No extra column encryption.

## How it works

### Data (Supabase Postgres)

All schema changes are migration files in `supabase/migrations/`. Every table has row-level security on, explicit grants per role, and separate policies per operation.

| Table | Holds | Access |
|---|---|---|
| `profiles` | `id` (the auth user, cascade delete), `username` (unique, checked as above), `username_changed_at`, `bio`, `avatar_path`, `hidden`, `turns_18_on`, timestamps. **No email or date of birth.** | Signed-in people read rows that aren't hidden and aren't blocked either way. Owners update only `bio` and `avatar_path`, through column grants. `username`, `hidden` and `turns_18_on` are never written directly |
| `reserved_usernames` | Names nobody can take, including held old names with an expiry | No client access |
| `blocks` | Who blocked whom | Owners read and write their own rows |
| `reports` | Reporter, reported profile, reason, time | Insert only |
| `private.apple_tokens` | Apple refresh tokens | Edge Functions only |

Functions, as security-definer with `search_path = ''`, in a private schema behind thin public wrappers:
- `set_username(name)` is the only way to create or change a username. It enforces the rules and the 30 days, and the unique index settles any race.
- `username_available(name)` for the live check while typing, rate limited.
- `search_profiles(prefix)`, rate limited, leaves out anyone under 18.
- `set_age(date_of_birth)`, once only: refuses under 13 and stores just `turns_18_on`.

A signed-in account has no profile until it picks a username.

| Also | Holds | Access |
|---|---|---|
| `consents` | Which version of the terms and privacy policy someone accepted, and when | Owners read their own rows. Written once at acceptance |
| `moderation_actions` | What was removed or hidden, why, and when, plus the notice sent to the person | No client access |

### Pictures

Bucket `avatars`, public read, with writes limited to `{user id}/` by policy. JPEG only, 512 KB at most. Apps crop with the existing Adjust cover tool and re-encode to 512 by 512, which also strips location data. The renderer's Content-Security-Policy gains the storage host for images only.

### Windows and Mac

- `@supabase/supabase-js` runs **in the main process only**, with PKCE on and a storage adapter using the async `safeStorage` API.
- The renderer talks through validated `account:*` IPC calls and only ever receives the signed-in state and profile data.
- Google and Apple: open a one-time listener on `127.0.0.1` on one of a few fixed ports (listed in Supabase's redirect allow-list), check the URL is exactly the project's authorize endpoint, open it with `shell.openExternal`, exchange the code when the browser returns, close the listener. The browser page says you can go back to Glassy.
- Sign out uses `signOut({ scope: 'local' })`. A separate "Sign out everywhere" exists.

### iPhone

Built by the iPhone session against this same backend, which it doesn't change. Research for its screens uses the Appllama skill and MCP.
- Apple: native sign-in with a nonce (hash to Apple, raw value to Supabase). Save the name on the first sign-in, since Apple sends it once.
- Google: `openAuthSessionAsync` with PKCE, redirect scheme `glassy://`. Never turn on "Skip nonce check".
- Tokens: Keychain, device only, wiped on first launch after a fresh install.
- Only the project URL and publishable key ship in any app bundle. Treat the whole bundle as public.

### Screens (desktop)

An **Account** section at the top of Settings.
- Signed out: Continue with Apple, Continue with Google, and an email form. Never shown as a prompt at launch.
- After first sign-in: pick a username, with a live availability check. Date of birth comes first, then terms and privacy policy, accepted with a checkbox.
- Signed in: picture, username, bio, View profile, Sign out, Sign out everywhere, Delete account.
- Someone else's profile opens as a page in the side panel, built like the artist pages, with Report and Block in its menu.

Everything follows the app's taste rules: liquid glass, everything glides, nothing snaps, plain language, no emojis. A server problem shows as a calm message and never touches playback.

### Email

Supabase's built-in email only sends 2 messages an hour, so a real email sender on a subdomain, with SPF, DKIM and DMARC set, is required before anyone else signs in. Error messages are the same whether or not an email is registered.

**No bot-check widget at launch.** Turnstile only works on real web pages, and the app loads from a local file, so it would mean a hosted page in a hidden window or moving the email form to the browser. It also applies to the whole project once on. Launch relies on Supabase's rate limits, email confirmation and the leaked-password check. If bots show up, add it with a hosted page.

### How changes reach Supabase

- **Tests:** on every push, GitHub Actions starts a throwaway copy of Supabase (real Auth, Storage and Postgres, no secrets needed) and tests every policy as a signed-out client and as a second account. Docker isn't needed on this PC.
- **Development:** a manual workflow applies migrations and deploys Edge Functions, using secrets the owner enters in GitHub's settings. The builder can run it and never sees the secrets.
- **Production:** the same workflow behind a GitHub environment that needs the owner's click. Before asking, the builder gets an independent review of the policy changes and sums them up in plain language.

### Deleting an account

Required by [App Store rule 5.1.1(v)](https://developer.apple.com/app-store/review/guidelines/). An Edge Function, after a fresh code or sign-in and a typed username:
1. revokes the Apple token, if there is one
2. deletes the person's pictures and rows
3. deletes the auth user

The device signs out and wipes its tokens. **Local music, playlists and settings stay.**

**Needs testing:** when an Apple account is created through the desktop's web flow, Supabase may not hand us the Apple refresh token. Check on the development project. If it doesn't, decide how deletion revokes it before Apple sign-in ships on desktop.

### Report and block

Required by [App Store rule 1.2](https://developer.apple.com/app-store/review/guidelines/) along with filtering and a published contact address. Reports go to the `reports` table and the owner handles them from the Supabase dashboard. Blocking hides both people from each other. No admin app yet.

Removing a profile sets `hidden`, deletes the picture file (hiding alone would leave it at its public address), records a `moderation_actions` row and sends the person a notice saying why. Removal requests for non-consensual intimate images get answered within 48 hours.

**Pictures aren't checked before going public** at first: filtering covers usernames and bios, and pictures are handled by report. The lawyer review should confirm this is enough. Checking first would add a quarantine bucket and a moderation service.

## Who does what

**The owner, who types every secret straight into a dashboard and never into a chat or file:**

| Service | What for | Cost | When |
|---|---|---|---|
| Supabase development project | Building and testing | Free, pauses after 7 idle days | First |
| Supabase production project | Real accounts, leaked-password check | About $25 a month | Before launch |
| Domain | Email sender, public terms and privacy pages | About $10 to $15 a year | Before email sign-up works for anyone else |
| Email sender (SMTP) | Codes | Free tier is likely enough at first | With the domain |
| Google Cloud sign-in client | Google button | Free | Any time |
| Apple Developer | Apple button on every platform, and the iPhone app | $99 a year | Apple sign-in waits for this |
| GitHub settings | Secrets for the deploy workflow, the production approval click | Free | With the development project |
| DMCA agent registration | People can post pictures | About $6 | Before launch |
| Lawyer review of terms, privacy policy, report process, picture handling | | Varies | Before public launch |

**Desktop session:** owns the backend, migrations, Edge Functions, desktop app and this document. Gets the development project's URL and publishable key only, and deploys through the workflow above.

**iPhone session:** owns the iPhone screens and native sign-in, and asks the desktop session for any backend change.

## Order of work

1. Migrations, policies and tests for usernames and profiles, including tests as a signed-out client and as a second account.
2. Desktop: email and password with codes, username picker, profile editing.
3. Windows: Google.
4. Search, viewing profiles, report, block, delete account.
5. Windows launch.
6. Once membership exists: Apple sign-in, Mac accounts with Developer ID signing, and the iPhone screens. The iPhone session can start its screens earlier against the development project if the owner tells it to.
7. Next design: sync and shared playlists.

Account features stay switched off in public releases until the launch list below is complete, so releases can keep shipping meanwhile.

## Launch list

Row-level security tested from outside on every table. No secret in any bundle or the repo (gitleaks in CI). Real email sender live. Terms, privacy policy and a retention schedule published, and acceptance logged. Report, block, delete and a "download my data" export working. Two-factor on the owner's Supabase, GitHub, Apple and Google accounts. A backup restored once. Lawyer review done, including whether EU and UK users need anything more. Age signals from the operating system are needed by 1 January 2027 under California's AB 1043, which goes on the next list, and matter more now that teens can sign up.

Windows code signing isn't required for accounts and stays a separate later item.

## Left to the builder

Exact layouts and motion within the taste rules; the blocklist source; rate limit numbers; which fixed ports; the email provider.
