# Supabase Maintainer Guide

> **Maintainers only:** The studio backend is already configured. Team members only need the hosted site and the shared team password.

Steam Radar uses a shared password gate backed by a private bcrypt hash in Postgres. The plaintext password and provider credentials must never be committed to this repository.

## 1. Link the Supabase project

Create a project if needed, install the CLI, and link the repository:

```bash
npm install --global supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

## 2. Configure provider credentials

Create a YouTube Data API v3 key and a Twitch application client ID and secret. Store them, along with the allowed browser origins, as Function Secrets:

```bash
supabase secrets set YOUTUBE_API_KEY=YOUR_YOUTUBE_KEY
supabase secrets set TWITCH_CLIENT_ID=YOUR_TWITCH_CLIENT_ID
supabase secrets set TWITCH_CLIENT_SECRET=YOUR_TWITCH_CLIENT_SECRET
supabase secrets set ALLOWED_ORIGINS=https://three-coins-studio.github.io,http://127.0.0.1:5000,http://localhost:5000
```

`ALLOWED_ORIGINS` is comma-separated and must contain origins only, without paths or trailing slashes.

## 3. Apply the database migration

```bash
supabase db push
```

## 4. Set the team password

Choose a unique, randomly generated password of at least 16 characters. In the Supabase SQL editor, replace the placeholder below and run the statement:

```sql
insert into public.team_access (id, password_hash, updated_at)
values (
  1,
  extensions.crypt('REPLACE_WITH_A_LONG_RANDOM_PASSWORD', extensions.gen_salt('bf', 12)),
  now()
)
on conflict (id) do update
set password_hash = excluded.password_hash,
    updated_at = excluded.updated_at;
```

Only the bcrypt hash is stored. The team enters the original password in the site. It is sent over HTTPS for server-side verification and retained only in that browser tab's `sessionStorage`.

To rotate access, run the same statement with a new password and share it securely with the team. Existing tabs will be rejected on their next API request.

## 5. Deploy the function

Deploy only after the password row exists, so the hosted tool is never left without a valid access password:

```bash
supabase functions deploy search --no-verify-jwt
```

The function URL is `https://YOUR_PROJECT_REF.supabase.co/functions/v1/search`.

## 6. Configure the browser

Set the public function URL and publishable key in `config.js`:

```js
window.STEAM_RADAR_CONFIG = {
  apiUrl: "https://YOUR_PROJECT_REF.supabase.co/functions/v1/search",
  publishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
};
```

These values are public client configuration. Never put the team password, a secret key, or a service-role key in this file.

## 7. Test

Run the static site locally:

```bash
python -m http.server 5000
```

Open `http://localhost:5000`, confirm that an incorrect password is rejected, then unlock with the team password and run a YouTube + Twitch search. A request without the `X-Access-Password` header must return HTTP 401 before any provider is called.

The function resolves games through Steam Store search and caches SteamSpy metadata for 24 hours. If one content provider fails, Steam Radar displays results from the other with a warning. Twitch searches are cached for two minutes and YouTube-only searches for thirty minutes.

## Provider-secret rotation

Rotate provider credentials with `supabase secrets set`. New values are available to the function without redeploying it. Never place provider credentials in Postgres, frontend JavaScript, logs, or Git history.
