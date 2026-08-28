# Steam Radar

Steam Radar helps game-marketing teams discover YouTube and Twitch creators covering a Steam game. Paste a Steam store URL to search videos, VODs, and live streams; compare public performance signals; select creators with publicly listed contact emails; and export outreach data.

## Features

- Search up to 500 results per platform from a Steam game URL
- Discover YouTube videos, Twitch VODs, and Twitch live streams
- Filter by upload period, language, video length, engagement, views, comments, country, and title keywords
- Review video and channel statistics
- Select creator emails directly from result cards
- Deduplicate selected email addresses
- Export all visible results or only selected creator emails to CSV

## Recommended hosted setup

The team build uses GitHub Pages for the interface and a free Supabase Edge Function for provider requests. API credentials are stored as server-side Function Secrets, so team members do not enter keys or log in.

Follow [Supabase Backend Setup](SUPABASE_SETUP.md) to create the project, configure YouTube and Twitch credentials, deploy the cache migration and search function, and connect `config.js`.

## Legacy local Flask setup

1. Install Python 3.10 or newer.
2. Install dependencies:

   ```bash
   python -m pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and add a YouTube Data API v3 key:

   ```env
   SEARCHAPI_KEY=your_youtube_data_api_key
   ```

   Follow the [complete API key setup guide](API_KEY_SETUP.md) to create the key and apply the correct restrictions.

4. Run the app:

   ```bash
   python -m flask --app app run --host 127.0.0.1 --port 5000
   ```

5. Open `http://127.0.0.1:5000`.

The Flask fallback supports YouTube only. Twitch and combined searches use the Supabase backend.

## GitHub Pages

The public team build is published at:

`https://three-coins-studio.github.io/steam-radar/`

GitHub Pages calls the configured Supabase Edge Function. Provider credentials never reach the browser. The public function URL is configured in `config.js`; see [Supabase Backend Setup](SUPABASE_SETUP.md).

The local Flask workflow continues to read `SEARCHAPI_KEY` from `.env` as a YouTube-only fallback. See [YouTube Data API Key Setup](API_KEY_SETUP.md) for local key creation and quota guidance.

## Data and outreach

Contact emails are detected only when creators publish them in public channel metadata. Review exported contacts and follow applicable privacy, anti-spam, and platform requirements before outreach.
