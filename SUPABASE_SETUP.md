# Supabase Backend Setup

Steam Radar uses a public Supabase Edge Function as its hosted API. Team members do not enter API keys or sign in. You configure the studio credentials once as Supabase Function Secrets.

## 1. Create the Supabase project

Create a free project at [supabase.com](https://supabase.com), then copy its project reference from **Project Settings → General**.

Install and authenticate the Supabase CLI:

```bash
npm install --global supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

## 2. Create the provider credentials

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

## 4. Deploy the database migration and function

```bash
supabase db push
supabase functions deploy search --no-verify-jwt
```

The deployed URL is:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/search
```

## 5. Connect the frontend

Set the public function URL in `config.js`:

```js
window.STEAM_RADAR_CONFIG = {
  apiUrl: "https://YOUR_PROJECT_REF.supabase.co/functions/v1/search",
};
```

This URL is not a secret and is safe to publish on GitHub Pages.

## 6. Test

Run the static site locally:

```bash
python -m http.server 5000
```

Open `http://localhost:5000`, paste a Steam store URL, select **YouTube + Twitch**, and search.

If a provider fails while the other succeeds, Steam Radar displays the available results and a provider warning. Supabase caches Twitch searches for two minutes and YouTube-only searches for thirty minutes.

## Secret rotation

Rotate a provider credential with the same `supabase secrets set` command. The new value is available to the function without redeploying it. Never place provider credentials in Postgres tables, frontend JavaScript, logs, or Git history.
