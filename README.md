# Steam Radar

Steam Radar helps game-marketing teams discover YouTube and Twitch creators covering a Steam game. Enter a game name to resolve its canonical Steam title, then search videos, VODs, and live streams; compare public performance signals; select creators with publicly listed contact emails; and export outreach data.

## Features

- Find a game by name through Steam search and SteamSpy metadata
- Search up to 500 results per platform for the resolved Steam game
- Discover YouTube videos, Twitch VODs, and Twitch live streams
- Filter by upload period, language, video length, engagement, views, comments, country, and title keywords
- Review video and channel statistics
- Select creator emails directly from result cards
- Deduplicate selected email addresses
- Export all visible results or only selected creator emails to CSV

## Use the team build

Open [Steam Radar](https://three-coins-studio.github.io/steam-radar/), enter a Steam game name, choose YouTube, Twitch, or both, and select **Search**.

The hosted team build is already configured. It does not require an account, API key, Twitch login, Supabase project, or local installation.

## Architecture

GitHub Pages hosts the interface and calls the studio's deployed Supabase Edge Function. The function resolves the name with Steam Store search, enriches the selected app through SteamSpy, and then queries YouTube and Twitch. Provider credentials remain in server-side Function Secrets and never reach the browser.

## Local development for maintainers

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

The Flask fallback supports YouTube only. Twitch and combined searches use the already-deployed Supabase backend configured in `config.js`.

The local Flask workflow continues to read `SEARCHAPI_KEY` from `.env` as a YouTube-only fallback. See [YouTube Data API Key Setup](API_KEY_SETUP.md) for local key creation and quota guidance.

Infrastructure deployment and credential rotation are maintainer operations. They are documented separately in the [Supabase maintainer guide](SUPABASE_SETUP.md) and are not required to use Steam Radar.

## Data and outreach

Contact emails are detected only when creators publish them in public channel metadata. Review exported contacts and follow applicable privacy, anti-spam, and platform requirements before outreach.
