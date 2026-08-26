# Steam Radar

Steam Radar helps game-marketing teams discover YouTube creators covering a Steam game. Paste a Steam store URL to search relevant videos, compare public performance signals, filter results, select creators with publicly listed contact emails, and export a deduplicated outreach CSV.

## Features

- Search up to 500 YouTube videos from a Steam game URL
- Filter by upload period, language, video length, engagement, views, comments, country, and title keywords
- Review video and channel statistics
- Select creator emails directly from result cards
- Deduplicate selected email addresses
- Export all visible results or only selected creator emails to CSV

## Setup

1. Install Python 3.10 or newer.
2. Install dependencies:

   ```bash
   python -m pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and add a YouTube Data API v3 key:

   ```env
   SEARCHAPI_KEY=your_youtube_data_api_key
   ```

4. Run the app:

   ```bash
   python -m flask --app app run --host 127.0.0.1 --port 5000
   ```

5. Open `http://127.0.0.1:5000`.

## GitHub Pages

The public team build is published at:

`https://three-coins-studio.github.io/steam-radar/`

GitHub Pages cannot run Flask, so the deployed build performs YouTube API requests directly from the browser. Each team member enters a YouTube Data API key when opening the site. The key is stored only in that browser tab's session storage and is not committed to this repository.

For safer use, restrict the key in Google Cloud Console:

- Application restriction: **Websites**
- Allowed referrer: `https://three-coins-studio.github.io/steam-radar/*`
- API restriction: **YouTube Data API v3**

The local Flask workflow continues to read `SEARCHAPI_KEY` from `.env`.

## Data and outreach

Contact emails are detected only when creators publish them in public channel metadata. Review exported contacts and follow applicable privacy, anti-spam, and platform requirements before outreach.
