# YouTube Data API Key Setup for Steam Radar

This guide explains how a team administrator can create, secure, test, and maintain the YouTube Data API keys used by Steam Radar.

## Deployment modes

| Mode | Address | Request location | Recommended credential |
| --- | --- | --- | --- |
| Team website | `https://three-coins-studio.github.io/steam-radar/` | Team member's browser | Website-restricted browser key |
| Local Flask app | `http://127.0.0.1:5000` | Local Python server | Separate server key |

Use two keys. A website restriction protects the GitHub Pages key, but can reject requests from the local Flask server because a Python server request does not carry the website referrer.

## Prerequisites

- A Google account with permission to manage a Google Cloud project.
- Permission to enable APIs and create credentials in that project.
- A studio-managed account or Google Cloud organization is recommended for team ownership.

## 1. Create or select a Google Cloud project

1. Open the [Google Cloud project selector](https://console.cloud.google.com/projectselector2/home/dashboard).
2. Sign in with the account that will own this integration.
3. Select an existing team project or click **New Project**.
4. Use a clear name such as `Steam Radar`.
5. If prompted, select the Three Coins Studio organization or correct team folder.
6. Select the project in the console's top bar.

The enabled API, credentials, restrictions, and quota all belong to the currently selected project.

## 2. Enable YouTube Data API v3

1. Open the [YouTube Data API v3 library page](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
2. Confirm that the correct project is selected.
3. Click **Enable**.
4. Wait for the API management page to open.

If the button says **Manage**, the API is already enabled in that project.

## 3. Create the GitHub Pages browser key

1. Open [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials).
2. Confirm the correct project is selected.
3. Click **Create credentials**, then **API key**.
4. Copy the generated value temporarily and choose **Edit API key**.
5. Name it `Steam Radar - GitHub Pages`.

Do not put the key in issues, screenshots, chat, or unrelated source files.

### Restrict it to the Steam Radar website

Under **Application restrictions**:

1. Select **Websites** (also called HTTP referrers).
2. Add:

   ```text
   https://three-coins-studio.github.io/steam-radar/*
   ```

3. If the root page is rejected during testing, also add:

   ```text
   https://three-coins-studio.github.io/steam-radar/
   ```

Do not add `*` by itself, because that would allow any website to use the key.

### Restrict it to the YouTube API

Under **API restrictions**:

1. Select **Restrict key**.
2. Select only **YouTube Data API v3**.
3. Click **Save**.

Google recommends using both application and API restrictions. Changes can take several minutes to propagate.

## 4. Use and test the team website

1. Open [Steam Radar](https://three-coins-studio.github.io/steam-radar/).
2. Paste the restricted key into **YouTube Data API key for this browser session**.
3. Paste a public Steam store URL.
4. Start with **50 videos** and click **Search**.
5. Confirm that creator results appear.

The key is stored only in the current tab's `sessionStorage`. It is not committed to GitHub or sent to a Steam Radar server. The user may need to enter it again after closing the tab or clearing site data.

GitHub Pages is a static host. Any key used by its JavaScript can be inspected in the public source code and browser network requests. A browser API key must therefore be treated as a public identifier and protected with the website and API restrictions above.

## 5. Create a separate key for local Flask use

Repeat the creation steps and name the second key `Steam Radar - Local Flask`.

Use these restrictions:

- **API restrictions:** only **YouTube Data API v3**.
- **Application restrictions:** use an **IP addresses** restriction if the machine has a stable public outbound IP. If its IP changes regularly, an application restriction may be impractical for local development; monitor the key carefully.

Do not apply the GitHub Pages website restriction to the Flask key. Flask calls Google from Python, not from the browser, so an HTTP-referrer restriction can cause a `403` response.

Copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

Add the local key:

```env
SEARCHAPI_KEY=your_local_flask_key_here
```

Install and run:

```powershell
python -m pip install -r requirements.txt
python -m flask --app app run --host 127.0.0.1 --port 5000
```

Then open `http://127.0.0.1:5000`. The repository ignores `.env`; never force-add it to Git.

## Quota and team usage

Quota is shared by all keys and users in the same Google Cloud project. Larger searches and more team members consume it faster.

Google's current YouTube Data API overview lists a default project allocation of 100 `search.list` calls, 100 `videos.insert` calls, and 10,000 units per day across other endpoints. Defaults can change. Steam Radar reads public data and does not upload videos.

A YouTube search response contains at most 50 results, so a request for 500 videos can require up to ten paginated search calls, followed by read requests for video and channel details. Begin with 50 results when testing.

Review usage on the [YouTube Data API quotas page](https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas). If more quota is needed, follow Google's [quota and compliance process](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits).

## Troubleshooting

### `API key not valid` or `keyInvalid`

- Copy the key again from **APIs & Services > Credentials**.
- Remove accidental leading or trailing spaces.
- Confirm the key was not deleted, disabled, or rotated.
- Confirm the credentials page is showing the intended project.

### `accessNotConfigured`

- Enable **YouTube Data API v3** in the project that owns the key.
- Wait several minutes, then try again.

### `quotaExceeded` or `dailyLimitExceeded`

- Review the project's quota page.
- Request fewer videos.
- Wait for the quota period to reset or use Google's quota process.
- Additional keys in the same project do not create additional project quota.

### “Requests from this referer are blocked”

- Confirm the browser key uses a **Websites** restriction.
- Confirm `https://three-coins-studio.github.io/steam-radar/*` is present.
- Add the exact root URL listed above if necessary.
- Wait several minutes after changing restrictions.
- Do not use the browser key for local Flask requests.

### Local Flask returns `403`

- Confirm `.env` contains the separate local key.
- Remove any website/referrer restriction from that local key.
- If using an IP restriction, verify the current public outbound IP.
- Restart Flask after changing `.env`.

### The website reports “Failed to fetch”

- Confirm the Pages site loaded over HTTPS and the device is online.
- Check whether a VPN, firewall, browser extension, or managed network blocks `youtube.googleapis.com`.
- Inspect the failed request in browser developer tools for Google's specific error response.

## Rotate or revoke a key

Rotate a key on the team's security schedule, when an administrator leaves, or immediately after suspected exposure.

1. Open [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials).
2. Open the affected key.
3. Select **Rotate key**, or create a replacement with the same restrictions.
4. Test the replacement.
5. Update the application or local `.env`.
6. Delete the previous key after the replacement works.

Removing a leaked key from a later Git commit is not sufficient because it remains in history. Revoke or rotate the key first, then clean repository history separately if required.

## Administrator checklist

- [ ] The Cloud project is team-owned.
- [ ] YouTube Data API v3 is enabled.
- [ ] The browser key allows only the Steam Radar Pages URL.
- [ ] The browser key can call only YouTube Data API v3.
- [ ] Local Flask uses a separate key.
- [ ] Quota usage is reviewed periodically.
- [ ] The team has a key-rotation owner and schedule.

## Official references

- [YouTube Data API overview](https://developers.google.com/youtube/v3/getting-started)
- [Google Cloud API key management](https://docs.cloud.google.com/docs/authentication/api-keys)
- [Google Cloud API key restrictions](https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys)
- [YouTube API quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)
