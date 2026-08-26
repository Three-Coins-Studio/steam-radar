import os
import re
import time
import math
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from googleapiclient.discovery import build
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)

# ── Your YouTube Data API v3 key ────────────────────────────────────────────
YOUTUBE_API_KEY = os.getenv("SEARCHAPI_KEY")
# ────────────────────────────────────────────────────────────────────────────

youtube = build("youtube", "v3", developerKey=YOUTUBE_API_KEY)
PAGE_SIZE = 50


def extract_game_name_from_steam(steam_url: str) -> str:
    match = re.search(r"/app/\d+/([^/?#]+)", steam_url)
    if match:
        return match.group(1).replace("_", " ").strip()
    match = re.search(r"/app/(\d+)", steam_url)
    if match:
        return match.group(1)
    raise ValueError("Could not extract game name. Use a valid store.steampowered.com/app/... URL.")


def extract_email(text: str) -> Optional[str]:
    if not text:
        return None
    match = re.search(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", text)
    return match.group(0) if match else None


def iso8601_duration_to_seconds(duration: str) -> int:
    """Convert ISO 8601 duration (PT4M13S) to total seconds."""
    if not duration:
        return 0
    match = re.match(
        r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration
    )
    if not match:
        return 0
    days, hours, minutes, seconds = (int(x or 0) for x in match.groups())
    return days * 86400 + hours * 3600 + minutes * 60 + seconds


def published_after_for_filter(date_filter: str) -> Optional[str]:
    now = datetime.now(timezone.utc)
    deltas = {"week": 7, "month": 30, "year": 365}
    if date_filter in deltas:
        return (now - timedelta(days=deltas[date_filter])).strftime("%Y-%m-%dT%H:%M:%SZ")
    return None


def chunk(lst: list, size: int) -> List[list]:
    return [lst[i:i + size] for i in range(0, len(lst), size)]


def search_youtube_videos(
    game_name: str,
    max_results: int = 100,
    date_filter: str = "all",
    language: str = "en",
) -> List[Dict]:
    published_after = published_after_for_filter(date_filter)
    pages_needed = math.ceil(max_results / PAGE_SIZE)

    # 1. Paginated search
    video_items: List[Dict] = []
    next_page_token: Optional[str] = None

    for page_num in range(pages_needed):
        remaining = max_results - len(video_items)
        params: Dict = dict(
            q=f"{game_name} gameplay",
            part="id,snippet",
            type="video",
            maxResults=min(PAGE_SIZE, remaining),
            safeSearch="none",
        )
        if language and language != "any":
            params["relevanceLanguage"] = language
        if published_after:
            params["publishedAfter"] = published_after
        if next_page_token:
            params["pageToken"] = next_page_token

        resp = youtube.search().list(**params).execute()
        video_items.extend(resp.get("items", []))
        next_page_token = resp.get("nextPageToken")
        if not next_page_token or len(video_items) >= max_results:
            break
        if page_num < pages_needed - 1:
            time.sleep(0.1)

    if not video_items:
        return []

    # Deduplicate
    seen: set = set()
    unique: List[Dict] = []
    for item in video_items:
        vid = item["id"]["videoId"]
        if vid not in seen:
            seen.add(vid)
            unique.append(item)
    video_items = unique[:max_results]

    # 2. Channel details
    all_channel_ids = list({item["snippet"]["channelId"] for item in video_items})
    channel_info: Dict[str, Dict] = {}
    for batch in chunk(all_channel_ids, 50):
        ch_resp = youtube.channels().list(
            part="snippet,brandingSettings,statistics",
            id=",".join(batch),
            maxResults=50,
        ).execute()
        for ch in ch_resp.get("items", []):
            ch_id = ch["id"]
            snippet = ch.get("snippet", {})
            branding = ch.get("brandingSettings", {}).get("channel", {})
            stats = ch.get("statistics", {})
            combined = snippet.get("description", "") + " " + branding.get("keywords", "")
            channel_info[ch_id] = {
                "email":        extract_email(combined),
                "country":      snippet.get("country", ""),
                "subscriber_count": stats.get("subscriberCount", "N/A"),
                "channel_video_count": stats.get("videoCount", "N/A"),
            }

    # 3. Video statistics + contentDetails (for duration)
    all_video_ids = [item["id"]["videoId"] for item in video_items]
    stats_map: Dict[str, Dict] = {}
    for batch in chunk(all_video_ids, 50):
        v_resp = youtube.videos().list(
            part="statistics,contentDetails",
            id=",".join(batch),
        ).execute()
        for v in v_resp.get("items", []):
            raw_duration = v.get("contentDetails", {}).get("duration", "")
            stats_map[v["id"]] = {
                **v.get("statistics", {}),
                "duration_seconds": iso8601_duration_to_seconds(raw_duration),
                "duration_raw": raw_duration,
            }

    # 4. Assemble
    results: List[Dict] = []
    for item in video_items:
        video_id = item["id"]["videoId"]
        snippet = item["snippet"]
        ch_id = snippet["channelId"]
        ch_extra = channel_info.get(ch_id, {})
        stats = stats_map.get(video_id, {})

        thumbs = snippet.get("thumbnails", {})
        thumbnail = (
            thumbs.get("maxres", {}).get("url")
            or thumbs.get("high", {}).get("url")
            or thumbs.get("medium", {}).get("url")
            or thumbs.get("default", {}).get("url")
            or ""
        )

        view_count = int(stats.get("viewCount", 0) or 0)
        like_count = int(stats.get("likeCount", 0) or 0)
        comment_count = int(stats.get("commentCount", 0) or 0)
        duration_sec = stats.get("duration_seconds", 0)

        # Like ratio as a percentage (likes / views * 100)
        like_ratio = round((like_count / view_count * 100), 2) if view_count > 0 else 0

        results.append({
            "video_id":           video_id,
            "title":              snippet.get("title", ""),
            "thumbnail":          thumbnail,
            "channel_name":       snippet.get("channelTitle", ""),
            "channel_id":         ch_id,
            "channel_url":        f"https://www.youtube.com/channel/{ch_id}",
            "video_url":          f"https://www.youtube.com/watch?v={video_id}",
            "published_at":       snippet.get("publishedAt", ""),
            "description":        snippet.get("description", ""),
            "email":              ch_extra.get("email"),
            "country":            ch_extra.get("country", ""),
            "view_count":         view_count,
            "like_count":         like_count,
            "comment_count":      comment_count,
            "like_ratio":         like_ratio,
            "duration_seconds":   duration_sec,
            "subscriber_count":   ch_extra.get("subscriber_count", "N/A"),
            "is_short":           duration_sec > 0 and duration_sec <= 60,
        })

    return results


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/api/scrape", methods=["POST"])
def scrape():
    data = request.get_json(force=True)
    steam_url = (data.get("steam_url") or "").strip()

    if not steam_url:
        return jsonify({"error": "No Steam URL provided."}), 400
    if "steampowered.com" not in steam_url:
        return jsonify({"error": "Please provide a valid Steam store URL."}), 400

    try:
        game_name = extract_game_name_from_steam(steam_url)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        max_results = max(1, min(int(data.get("max_results", 100)), 500))
    except (TypeError, ValueError):
        max_results = 100

    date_filter = (data.get("date_filter") or "all").strip().lower()
    if date_filter not in ("all", "week", "month", "year"):
        date_filter = "all"

    language = (data.get("language") or "en").strip().lower()

    try:
        videos = search_youtube_videos(game_name, max_results, date_filter, language)
    except Exception as e:
        return jsonify({"error": f"YouTube API error: {str(e)}"}), 500

    return jsonify({
        "game_name":   game_name,
        "total":       len(videos),
        "date_filter": date_filter,
        "videos":      videos,
    })


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
