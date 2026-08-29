# Supabase Maintainer Guide

> **Maintainers only:** The studio backend is already deployed and configured. Team members should use the hosted site and do not need to perform any steps in this document.

Use this guide only when recreating the infrastructure, deploying backend changes, managing approved users, or rotating studio credentials. Steam Radar uses Supabase passwordless authentication and a server-side access whitelist. Provider credentials remain in Function Secrets.

## 1. Recreate or link the Supabase project

Create a free project at [supabase.com](https://supabase.com), then copy its project reference from **Project Settings → General**.

Install and authenticate the Supabase CLI:

```bash
npm install --global supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

## 2. Prepare provider credentials

You need:

- A YouTube Data API v3 key. The server key does not need a website-referrer restriction; restrict it to the YouTube Data API.
- A Twitch application client ID and client secret from the [Twitch Developer Console](https://dev.twitch.tv/console/apps).

Do not commit these values or put them in `config.js`.

## 3. Set Edge Function secrets

Set the provider credentials and the exact browser origins allowed to call the function:

```bash
supabase secrets set YOUTUBE_API_KEY=YOUR_YOUTUBE_KEY
supabase secrets set TWITCH_CLIENT_ID=YOUR_TWITCH_CLIENT_ID
supabase secrets set TWITCH_CLIENT_SECRET=YOUR_TWITCH_CLIENT_SECRET
supabase secrets set ALLOWED_ORIGINS=https://three-coins-studio.github.io,http://127.0.0.1:5000,http://localhost:5000
```

`ALLOWED_ORIGINS` is comma-separated and must contain origins only, without paths or trailing slashes.

## 4. Configure authentication

In **Authentication → URL Configuration**, set the Site URL to:

```text
https://three-coins-studio.github.io/steam-radar/
```

Add the same URL to the redirect allow list. Keep public user creation disabled in **Authentication → Sign In / Providers**. The frontend also sets `shouldCreateUser: false`, so login can never create a user implicitly.

## 5. Deploy the database migrations and function

```bash
supabase db push
supabase functions deploy search --no-verify-jwt
```

The deployed URL is:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/search
```

## 6. Approve a user

Both steps are required for each teammate:

1. In **Authentication → Users**, create or invite the user. This is an administrator-only action.
2. In the SQL editor, add the same normalized email to the private whitelist:

   ```sql
   insert into public.access_whitelist (email)
   values ('teammate@example.com');
   ```

To revoke access immediately, remove the whitelist row. Deleting or banning the Auth user also prevents future sessions.

```sql
delete from public.access_whitelist
where email = 'teammate@example.com';
```

The table has row-level security enabled and grants no browser role permission. The Edge Function reads it only with its service role.

## 7. Configure a replacement backend URL

Set the public function URL in `config.js`:

```js
window.STEAM_RADAR_CONFIG = {
  apiUrl: "https://YOUR_PROJECT_REF.supabase.co/functions/v1/search",
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  publishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
};
```

The URL and publishable key are public client configuration and are safe to publish. Never put a secret or service-role key in this file.

## 8. Test

Run the static site locally:

```bash
python -m http.server 5000
```

Add `http://localhost:5000` to the Auth redirect allow list while testing. Open it, request a link for an approved email, sign in, select **YouTube + Twitch**, and search. A direct request without a valid approved-user bearer token must return HTTP 401 before calling any provider.

The function first resolves the game through Steam Store search and caches its SteamSpy metadata for 24 hours. If a content provider fails while the other succeeds, Steam Radar displays the available results and a provider warning. Supabase caches Twitch searches for two minutes and YouTube-only searches for thirty minutes.

## Secret rotation

Rotate a provider credential with the same `supabase secrets set` command. The new value is available to the function without redeploying it. Never place provider credentials in Postgres tables, frontend JavaScript, logs, or Git history.
