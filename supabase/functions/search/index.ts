import { createClient } from "npm:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

type SearchRequest = {
  game_name?: string;
  steam_url?: string;
  platforms?: string[];
  max_results?: number;
  date_filter?: string;
  language?: string;
};

type SteamGame = {
  appid: number;
  name: string;
  store_url: string;
  thumbnail: string;
  steamspy: JsonRecord;
};

type SearchResult = {
  platform: "youtube" | "twitch";
  content_type: string;
  is_live: boolean;
  video_id: string;
  title: string;
  thumbnail: string;
  channel_name: string;
  channel_id: string;
  channel_url: string;
  video_url: string;
  published_at: string;
  description: string;
  email: string | null;
  country: string;
  language: string;
  view_count: number;
  viewer_count: number;
  like_count: number;
  comment_count: number;
  like_ratio: number;
  duration_seconds: number;
  subscriber_count: string;
  is_short: boolean;
};

const TWITCH_API = "https://api.twitch.tv/helix";
const TWITCH_AUTH = "https://id.twitch.tv/oauth2/token";
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const VALID_PLATFORMS = new Set(["youtube", "twitch"]);
const VALID_DATES = new Set(["all", "week", "month", "year"]);

let twitchToken = "";
let twitchTokenExpiresAt = 0;

function allowedOrigins(): string[] {
  return (Deno.env.get("ALLOWED_ORIGINS") || "http://127.0.0.1:5000,http://localhost:5000")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin")?.replace(/\/$/, "") || "";
  const allowed = allowedOrigins();
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeGameName(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function gameMatchScore(query: string, candidate: string): number {
  const normalizedQuery = normalizeGameName(query);
  const normalizedCandidate = normalizeGameName(candidate);
  if (normalizedCandidate === normalizedQuery) return 10_000;
  const queryTokens = new Set(normalizedQuery.split(" ").filter(Boolean));
  const candidateTokens = normalizedCandidate.split(" ").filter(Boolean);
  const shared = candidateTokens.filter((token) => queryTokens.has(token)).length;
  const missing = [...queryTokens].filter((token) => !candidateTokens.includes(token)).length;
  const extra = candidateTokens.filter((token) => !queryTokens.has(token)).length;
  const prefix = normalizedCandidate.startsWith(normalizedQuery) ? 200 : 0;
  const addonPenalty = /\b(dlc|soundtrack|demo|server|test|editor|artbook)\b/.test(normalizedCandidate) ? 150 : 0;
  return shared * 100 - missing * 80 - extra * 12 + prefix - addonPenalty;
}

async function resolveSteamGame(gameQuery: string): Promise<SteamGame> {
  const query = gameQuery.trim().replace(/\s+/g, " ");
  if (query.length < 2) throw new Error("Enter at least two characters of the game name.");
  if (query.length > 120) throw new Error("Game names must be 120 characters or fewer.");

  const resolutionKey = await cacheKey({ cacheVersion: 2, kind: "steam-game", query: normalizeGameName(query) });
  const cached = await readCache(resolutionKey);
  if (cached?.steam_game) return cached.steam_game as SteamGame;

  const searchUrl = new URL("https://store.steampowered.com/api/storesearch/");
  searchUrl.searchParams.set("term", query);
  searchUrl.searchParams.set("l", "english");
  searchUrl.searchParams.set("cc", "US");
  const searchResponse = await fetchJson(searchUrl, { signal: AbortSignal.timeout(8000) });
  const candidates = ((searchResponse.items as JsonRecord[]) || [])
    .filter((item) => item.type === "app" && Number(item.id) > 0)
    .sort((left, right) => gameMatchScore(query, String(right.name || "")) - gameMatchScore(query, String(left.name || "")));
  const match = candidates[0];
  if (!match) throw new Error(`No Steam game matched “${query}”. Try its full store name.`);

  const appid = Number(match.id);
  let steamspy: JsonRecord = {};
  try {
    const steamSpyUrl = new URL("https://steamspy.com/api.php");
    steamSpyUrl.searchParams.set("request", "appdetails");
    steamSpyUrl.searchParams.set("appid", String(appid));
    steamspy = await fetchJson(steamSpyUrl, { signal: AbortSignal.timeout(8000) });
  } catch {
    // SteamSpy can lag behind newly released games; the Steam match remains usable.
  }

  const game: SteamGame = {
    appid,
    // SteamSpy can retain historical names after a game is renamed; Steam's current store title wins.
    name: String(match.name || steamspy.name || query).trim(),
    store_url: `https://store.steampowered.com/app/${appid}/`,
    thumbnail: String(match.tiny_image || ""),
    steamspy,
  };
  await writeCache(resolutionKey, { steam_game: game }, 86400);
  return game;
}

function extractEmail(text: string): string | null {
  return text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)?.[0] || null;
}

function chunks<T>(items: T[], size = 50): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function isoDurationSeconds(duration: string): number {
  const match = duration.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  return Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 +
    Number(match[3] || 0) * 60 + Number(match[4] || 0);
}

function twitchDurationSeconds(duration: string): number {
  const match = duration.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function publishedAfter(dateFilter: string): string {
  const days = ({ week: 7, month: 30, year: 365 } as Record<string, number>)[dateFilter];
  return days ? new Date(Date.now() - days * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z") : "";
}

function isAfterDate(value: string, dateFilter: string): boolean {
  const after = publishedAfter(dateFilter);
  return !after || new Date(value).getTime() >= new Date(after).getTime();
}

async function fetchJson(url: URL | string, init?: RequestInit): Promise<JsonRecord> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) {
    const message = String((body.error as JsonRecord | undefined)?.message || body.message || `Request failed (${response.status}).`);
    throw new Error(message);
  }
  return body;
}

async function youtubeRequest(resource: string, params: Record<string, string | number>): Promise<JsonRecord> {
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!apiKey) throw new Error("YouTube is not configured on the server.");
  const url = new URL(`${YOUTUBE_API}/${resource}`);
  for (const [key, value] of Object.entries({ ...params, key: apiKey })) {
    if (value !== "") url.searchParams.set(key, String(value));
  }
  return await fetchJson(url);
}

async function searchYouTube(
  gameName: string,
  maxResults: number,
  dateFilter: string,
  language: string,
): Promise<SearchResult[]> {
  const videoItems: JsonRecord[] = [];
  let pageToken = "";
  for (let page = 0; page < Math.ceil(maxResults / 50); page++) {
    const response = await youtubeRequest("search", {
      q: `${gameName} gameplay`,
      part: "id,snippet",
      type: "video",
      maxResults: Math.min(50, maxResults - videoItems.length),
      safeSearch: "none",
      relevanceLanguage: language !== "any" ? language : "",
      publishedAfter: publishedAfter(dateFilter),
      pageToken,
    });
    videoItems.push(...((response.items as JsonRecord[]) || []));
    pageToken = String(response.nextPageToken || "");
    if (!pageToken || videoItems.length >= maxResults) break;
  }

  const uniqueItems: JsonRecord[] = [];
  const seen = new Set<string>();
  for (const item of videoItems) {
    const id = String((item.id as JsonRecord)?.videoId || "");
    if (id && !seen.has(id)) {
      seen.add(id);
      uniqueItems.push(item);
    }
  }

  const channelInfo = new Map<string, JsonRecord>();
  const channelIds = [...new Set(uniqueItems.map((item) => String((item.snippet as JsonRecord)?.channelId || "")).filter(Boolean))];
  for (const ids of chunks(channelIds)) {
    const response = await youtubeRequest("channels", {
      part: "snippet,brandingSettings,statistics",
      id: ids.join(","),
      maxResults: 50,
    });
    for (const channel of (response.items as JsonRecord[]) || []) {
      const snippet = (channel.snippet as JsonRecord) || {};
      const branding = ((channel.brandingSettings as JsonRecord)?.channel as JsonRecord) || {};
      const stats = (channel.statistics as JsonRecord) || {};
      channelInfo.set(String(channel.id), {
        email: extractEmail(`${snippet.description || ""} ${branding.keywords || ""}`),
        country: String(snippet.country || ""),
        subscriber_count: String(stats.subscriberCount || "N/A"),
      });
    }
  }

  const statsInfo = new Map<string, JsonRecord>();
  for (const ids of chunks(uniqueItems.map((item) => String((item.id as JsonRecord).videoId)))) {
    const response = await youtubeRequest("videos", {
      part: "statistics,contentDetails",
      id: ids.join(","),
    });
    for (const video of (response.items as JsonRecord[]) || []) {
      const content = (video.contentDetails as JsonRecord) || {};
      statsInfo.set(String(video.id), {
        ...((video.statistics as JsonRecord) || {}),
        duration_seconds: isoDurationSeconds(String(content.duration || "")),
      });
    }
  }

  return uniqueItems.slice(0, maxResults).map((item) => {
    const videoId = String((item.id as JsonRecord).videoId);
    const snippet = (item.snippet as JsonRecord) || {};
    const channelId = String(snippet.channelId || "");
    const channel = channelInfo.get(channelId) || {};
    const stats = statsInfo.get(videoId) || {};
    const thumbnails = (snippet.thumbnails as JsonRecord) || {};
    const thumbnail = ["maxres", "high", "medium", "default"]
      .map((key) => String((thumbnails[key] as JsonRecord | undefined)?.url || ""))
      .find(Boolean) || "";
    const views = Number(stats.viewCount || 0);
    const likes = Number(stats.likeCount || 0);
    const duration = Number(stats.duration_seconds || 0);
    return {
      platform: "youtube",
      content_type: duration > 0 && duration <= 60 ? "short" : "video",
      is_live: false,
      video_id: `youtube-${videoId}`,
      title: String(snippet.title || ""),
      thumbnail,
      channel_name: String(snippet.channelTitle || ""),
      channel_id: channelId,
      channel_url: `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`,
      video_url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      published_at: String(snippet.publishedAt || ""),
      description: String(snippet.description || ""),
      email: (channel.email as string | null) || null,
      country: String(channel.country || ""),
      language,
      view_count: views,
      viewer_count: 0,
      like_count: likes,
      comment_count: Number(stats.commentCount || 0),
      like_ratio: views ? Math.round((likes / views * 100) * 100) / 100 : 0,
      duration_seconds: duration,
      subscriber_count: String(channel.subscriber_count || "N/A"),
      is_short: duration > 0 && duration <= 60,
    };
  });
}

async function getTwitchToken(force = false): Promise<string> {
  if (!force && twitchToken && Date.now() < twitchTokenExpiresAt - 60000) return twitchToken;
  const clientId = Deno.env.get("TWITCH_CLIENT_ID");
  const clientSecret = Deno.env.get("TWITCH_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Twitch is not configured on the server.");
  const url = new URL(TWITCH_AUTH);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("grant_type", "client_credentials");
  const response = await fetchJson(url, { method: "POST" });
  twitchToken = String(response.access_token || "");
  twitchTokenExpiresAt = Date.now() + Number(response.expires_in || 0) * 1000;
  return twitchToken;
}

async function twitchRequest(path: string, params: Record<string, string | number>, retry = true): Promise<JsonRecord> {
  const url = new URL(`${TWITCH_API}/${path}`);
  for (const [key, value] of Object.entries(params)) if (value !== "") url.searchParams.append(key, String(value));
  const token = await getTwitchToken(!retry);
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Client-Id": Deno.env.get("TWITCH_CLIENT_ID") || "",
    },
  });
  if (response.status === 401 && retry) return await twitchRequest(path, params, false);
  const body = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(String(body.message || `Twitch request failed (${response.status}).`));
  return body;
}

function normalizeName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function categoryMatchScore(query: string, candidate: string): number {
  const queryTokens = normalizeName(query).split(" ").filter((token) => token && !/^\d+$/.test(token));
  const candidateTokens = normalizeName(candidate).split(" ").filter((token) => token && !/^\d+$/.test(token));
  const querySet = new Set(queryTokens);
  const candidateSet = new Set(candidateTokens);
  const shared = queryTokens.filter((token) => candidateSet.has(token)).length;
  const missing = queryTokens.filter((token) => !candidateSet.has(token)).length;
  const extra = candidateTokens.filter((token) => !querySet.has(token)).length;
  const prefixBonus = normalizeName(query).startsWith(normalizeName(candidate)) ||
      normalizeName(candidate).startsWith(normalizeName(query))
    ? 3
    : 0;
  return shared * 10 - missing * 4 - extra * 3 + prefixBonus;
}

async function resolveTwitchGame(gameName: string): Promise<JsonRecord> {
  const exact = await twitchRequest("games", { name: gameName });
  const exactGame = ((exact.data as JsonRecord[]) || [])[0];
  if (exactGame) return exactGame;
  const search = await twitchRequest("search/categories", { query: gameName, first: 20 });
  const candidates = (search.data as JsonRecord[]) || [];
  const normalized = normalizeName(gameName);
  const normalizedExact = candidates.find((game) => normalizeName(String(game.name || "")) === normalized);
  if (normalizedExact) return normalizedExact;
  return [...candidates].sort((left, right) =>
    categoryMatchScore(gameName, String(right.name || "")) - categoryMatchScore(gameName, String(left.name || ""))
  )[0] || {};
}

function twitchThumbnail(value: string): string {
  return value.replace(/%?\{width\}/g, "640").replace(/%?\{height\}/g, "360");
}

async function searchTwitch(
  gameName: string,
  maxResults: number,
  dateFilter: string,
  language: string,
): Promise<{ results: SearchResult[]; category: JsonRecord }> {
  const category = await resolveTwitchGame(gameName);
  const gameId = String(category.id || "");
  if (!gameId) throw new Error(`No Twitch category matched “${gameName}”.`);

  const videos: JsonRecord[] = [];
  let cursor = "";
  const period = dateFilter === "week" ? "week" : dateFilter === "month" ? "month" : "all";
  while (videos.length < maxResults) {
    const response = await twitchRequest("videos", {
      game_id: gameId,
      first: Math.min(100, maxResults - videos.length),
      period,
      language: language !== "any" ? language : "",
      after: cursor,
    });
    const page = ((response.data as JsonRecord[]) || []).filter((video) => isAfterDate(String(video.created_at || ""), dateFilter));
    videos.push(...page);
    cursor = String(((response.pagination as JsonRecord) || {}).cursor || "");
    if (!cursor || videos.length >= maxResults) break;
  }

  const liveResponse = await twitchRequest("streams", {
    game_id: gameId,
    first: Math.min(100, maxResults),
    language: language !== "any" ? language : "",
  });
  const streams = (liveResponse.data as JsonRecord[]) || [];
  const userIds = [...new Set([
    ...videos.map((video) => String(video.user_id || "")),
    ...streams.map((stream) => String(stream.user_id || "")),
  ].filter(Boolean))];

  const users = new Map<string, JsonRecord>();
  for (const ids of chunks(userIds, 100)) {
    const params = new URLSearchParams();
    ids.forEach((id) => params.append("id", id));
    const response = await twitchRequest(`users?${params.toString()}`, {});
    for (const user of (response.data as JsonRecord[]) || []) users.set(String(user.id), user);
  }

  const liveResults: SearchResult[] = streams.map((stream) => {
    const userId = String(stream.user_id || "");
    const user = users.get(userId) || {};
    const login = String(user.login || stream.user_login || "");
    const description = String(user.description || "");
    return {
      platform: "twitch",
      content_type: "live",
      is_live: true,
      video_id: `twitch-live-${stream.id}`,
      title: String(stream.title || ""),
      thumbnail: twitchThumbnail(String(stream.thumbnail_url || user.offline_image_url || "")),
      channel_name: String(stream.user_name || user.display_name || login),
      channel_id: userId,
      channel_url: `https://www.twitch.tv/${encodeURIComponent(login)}`,
      video_url: `https://www.twitch.tv/${encodeURIComponent(login)}`,
      published_at: String(stream.started_at || ""),
      description,
      email: extractEmail(description),
      country: "",
      language: String(stream.language || ""),
      view_count: 0,
      viewer_count: Number(stream.viewer_count || 0),
      like_count: 0,
      comment_count: 0,
      like_ratio: 0,
      duration_seconds: Math.max(0, Math.floor((Date.now() - new Date(String(stream.started_at)).getTime()) / 1000)),
      subscriber_count: "N/A",
      is_short: false,
    };
  });

  const vodResults: SearchResult[] = videos.map((video) => {
    const userId = String(video.user_id || "");
    const user = users.get(userId) || {};
    const login = String(user.login || video.user_login || "");
    const description = String(user.description || video.description || "");
    return {
      platform: "twitch",
      content_type: String(video.type || "archive"),
      is_live: false,
      video_id: `twitch-${video.id}`,
      title: String(video.title || ""),
      thumbnail: twitchThumbnail(String(video.thumbnail_url || user.offline_image_url || "")),
      channel_name: String(video.user_name || user.display_name || login),
      channel_id: userId,
      channel_url: `https://www.twitch.tv/${encodeURIComponent(login)}`,
      video_url: String(video.url || `https://www.twitch.tv/videos/${video.id}`),
      published_at: String(video.created_at || video.published_at || ""),
      description,
      email: extractEmail(description),
      country: "",
      language: String(video.language || ""),
      view_count: Number(video.view_count || 0),
      viewer_count: 0,
      like_count: 0,
      comment_count: 0,
      like_ratio: 0,
      duration_seconds: twitchDurationSeconds(String(video.duration || "")),
      subscriber_count: "N/A",
      is_short: false,
    };
  });

  return { results: [...liveResults, ...vodResults].slice(0, maxResults), category };
}

function supabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}") as Record<string, string>;
    key = keys.default || key;
  } catch {
    // Legacy projects expose SUPABASE_SERVICE_ROLE_KEY instead.
  }
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

async function cacheKey(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readCache(key: string): Promise<JsonRecord | null> {
  const admin = supabaseAdmin();
  if (!admin) return null;
  const { data } = await admin.from("search_cache").select("response,expires_at").eq("cache_key", key).maybeSingle();
  if (!data || new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data.response as JsonRecord;
}

async function writeCache(key: string, response: JsonRecord, ttlSeconds: number): Promise<void> {
  const admin = supabaseAdmin();
  if (!admin) return;
  await admin.from("search_cache").upsert({
    cache_key: key,
    response,
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed." }, 405);

  const origin = request.headers.get("origin")?.replace(/\/$/, "") || "";
  if (origin && !allowedOrigins().includes(origin)) return json(request, { error: "Origin not allowed." }, 403);

  try {
    const body = await request.json() as SearchRequest;
    const gameQuery = String(body.game_name || "").trim();
    if (!gameQuery) return json(request, { error: "Enter a Steam game name." }, 400);
    const steamGame = await resolveSteamGame(gameQuery);
    const gameName = steamGame.name;
    const requestedPlatforms = Array.isArray(body.platforms) ? body.platforms : ["youtube", "twitch"];
    const platforms = [...new Set(requestedPlatforms.map(String).filter((item) => VALID_PLATFORMS.has(item)))];
    if (!platforms.length) return json(request, { error: "Choose YouTube, Twitch, or both." }, 400);
    const maxResults = Math.max(1, Math.min(Number(body.max_results) || 100, 500));
    const dateFilter = VALID_DATES.has(String(body.date_filter)) ? String(body.date_filter) : "all";
    const language = String(body.language || "en").toLowerCase();
    const normalizedRequest = { cacheVersion: 4, appid: steamGame.appid, gameName, platforms: [...platforms].sort(), maxResults, dateFilter, language };
    const key = await cacheKey(normalizedRequest);
    const cached = await readCache(key);
    if (cached) return json(request, { ...cached, cached: true });

    const settled = await Promise.allSettled(platforms.map(async (platform) => {
      if (platform === "youtube") return { platform, results: await searchYouTube(gameName, maxResults, dateFilter, language) };
      const twitch = await searchTwitch(gameName, maxResults, dateFilter, language);
      return { platform, results: twitch.results, category: twitch.category };
    }));

    const results: SearchResult[] = [];
    const errors: Record<string, string> = {};
    let twitchCategory: JsonRecord | null = null;
    settled.forEach((entry, index) => {
      const platform = platforms[index];
      if (entry.status === "fulfilled") {
        results.push(...entry.value.results);
        if (entry.value.category) twitchCategory = entry.value.category;
      } else {
        errors[platform] = entry.reason instanceof Error ? entry.reason.message : String(entry.reason);
      }
    });
    if (!results.length && Object.keys(errors).length) {
      return json(request, { error: Object.values(errors).join(" "), provider_errors: errors }, 502);
    }

    const response: JsonRecord = {
      game_name: gameName,
      steam_game: steamGame,
      total: results.length,
      platforms,
      date_filter: dateFilter,
      twitch_category: twitchCategory,
      provider_errors: errors,
      videos: results,
    };
    await writeCache(key, response, platforms.includes("twitch") ? 120 : 1800);
    return json(request, { ...response, cached: false });
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
