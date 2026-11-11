# Video button fixes: X, labels, TikTok, and Instagram

This document records the changes made to the Brisk browser extension and the
Brisk desktop app to fix the in-page "Download" video button on X (Twitter)
and TikTok, plus some wording changes. It covers each problem, its cause, the fix,
the files touched, and what was and wasn't verified.

Two repositories were changed:

- `brisk-browser-extension` (this repo)
- `brisk` (the desktop app): only `lib/browser_extension/browser_extension_server.dart`

---

## Background: how the video button works

- `app/scripts/content-script.js` creates a `VideoOverlay`
  (`app/scripts/lib/video-overlay.js`) on every page except blocked hosts
  (YouTube, see `BLOCKED_VIDEO_HOSTS` in `app/scripts/common.js`).
- The overlay hit-tests the point under the mouse
  (`document.elementsFromPoint`) to find an eligible `<video>` (at least
  200×110 px, visible) and shows the button in its top-left corner. The UI
  lives in a closed shadow root, shown in the top layer as a popover.
- Opening the menu calls `collectVideoOptions()`
  (`app/scripts/lib/video-sources.js`), which combines:
  - The video's own `src` / `<source>` URLs, if they are real HTTP URLs.
  - Streams the background script detected on the network
    (`brisk:get-streams`): HLS playlists (`.m3u8`) and direct video files.
  - Site-specific sources: X (via the syndication API) and now TikTok (via
    page data).
- Clicking an item sends `brisk:download` to the background script, which
  sends a request to the Brisk app on `http://127.0.0.1:<port>`. A direct file
  is sent as `type: 'single'` along with cookies, Referer, a suggested name
  and, since this work, the User-Agent.

---

## 1. X: button didn't show for the video on screen

### Symptom

On x.com the download button didn't appear on the video being watched.

### Investigation

On x.com/home in Chrome:

- The X `<video>` passes every eligibility check: visible, opacity 1,
  `pointer-events: auto`, large enough.
- `elementsFromPoint` at the video's centre returns the `<video>` at index 3
  (below three overlay `<div>`s), so hit-testing finds it.
- After hovering, the `<brisk-video-overlay>` host existed and was
  `:popover-open`.

### Cause

The overlay only ran its hit-test on `pointermove`. On X you scroll the feed
with the mouse wheel, so videos slide under a cursor that doesn't move, and no
`pointermove` fires. The same happens when a feed video starts autoplaying
under a still cursor. In both cases the button never appeared until the mouse
moved.

### Fix (`app/scripts/lib/video-overlay.js`)

- Moved the throttled check (at most once per 80 ms) out of `onPointerMove`
  into a new `schedulePointerCheck()`.
- Added a `scroll` listener on `window` (capture, passive), added in
  `enable()` and removed in `disable()`. It re-runs the check while the
  pointer is inside the window. Capture also catches scrolling inside nested
  scroll containers.
- `onMediaActivity` (`loadstart`, `play`, `playing`) also re-runs the check,
  so a video that appears or starts under the cursor gets the button.

### Status

The user confirmed the button works on X in Chrome. In Firefox it didn't. I
couldn't automate Firefox in this environment. No Firefox-specific cause was
found in the code: X's CSP allows inline styles and doesn't enforce Trusted
Types. Suggested checks for Firefox:

1. Reload the add-on from `about:debugging` after
   `npx webextension-toolbox build firefox`.
2. Make sure the add-on's "Access your data for all websites" permission is
   on. Firefox MV3 doesn't always grant `<all_urls>` automatically, and the
   content script doesn't run without it.
3. Check whether the button shows on other sites, for example
   `test/video-test.html`.
4. Run `document.querySelector('brisk-video-overlay')` after hovering on x.com
   and look for console errors from `content-script.js`.

This is still open until those results come back.

---

## 2. Wording changes

| Where | Before | After |
|---|---|---|
| Popup header status (`app/scripts/popup.js`) | `Port 3020` / `Not running` | `Connected` / `Not connected` |
| Popup status tooltip | `Brisk is listening on port …` | `Connected to Brisk` / `Brisk is not running or could not be reached` |
| Popup toast after a download | `Sent to Brisk` | `Download started` |
| Video menu header (`video-overlay.js`) | `Send to Brisk` (+ `Not running` tag) | Removed. The menu opens straight onto the options |
| Video menu item after a click | `Sent` | `Started` |

Notes:

- The "Not running" tag lived in the removed header. The "Brisk isn't
  running… get Brisk" notice at the bottom of the menu still shows.
- `renderHeader()` and the `.header`, `.header-title` and `.status` CSS rules
  in `app/scripts/lib/video-overlay-styles.js` were deleted, since nothing
  uses them anymore.
- The port setting itself (input + Save) is still in the popup's settings.

---

## 3. TikTok: "No downloadable video found"

### Cause

Inspecting a TikTok video page in Chrome showed:

- The `<video>` `src` is `blob:https://www.tiktok.com/…`, a Media Source
  Extensions (MSE) buffer, not a downloadable URL.
- The real file is a complete MP4 (audio included). TikTok's player
  downloads it in byte ranges with `fetch()` from URLs like
  `https://v16-webapp-prime.tiktok.com/video/tos/<region>/<bucket>/<id>?…&mime_type=video_mp4&…&signature=…&tk=tt_chain_token…`.

The background script (`handleResponse` in `app/scripts/background.js`) only
records direct video files for request types in `DIRECT_VIDEO_REQUEST_TYPES`
(`media`, `main_frame`, `sub_frame`, `object`). It ignores `fetch`/XHR video
responses on purpose, because on most sites those are MSE segments
(video-only or audio-only chunks) that are useless alone. So TikTok's only
real file was arriving through exactly the path the extension ignores.

### Fix (`app/scripts/background.js`)

- New `isProgressiveFetchVideo(details, url, pathname)`. It returns true only
  when:
  - The requesting page (`initiator` / `documentUrl`) is on `tiktok.com`.
  - The path contains `/video/tos/`.
  - The `mime_type` query parameter is `video_mp4`.
- In `handleResponse`, such responses from non-media request types are
  recorded with `addDirectVideo(…, progressive = true)`. They still have to
  pass the 256 KB minimum size check (`MIN_DIRECT_VIDEO_SIZE`, using
  `Content-Range` / `Content-Length`).
- Streams now store `firstDetectedAt` (when the URL was first seen) and
  `progressive`. `itemsForStream` (`app/scripts/lib/stream-items.js`) passes
  both through.

Every other site behaves as before.

### First matching attempt (still used as a fallback)

TikTok preloads the next and previous posts, so several MP4s are captured
within seconds of each other, and the URLs contain no post id.
`matchProgressiveStream()` in `app/scripts/lib/video-sources.js` picks the
progressive stream whose `firstDetectedAt` is closest to when the hovered
video fired `loadstart`. The overlay now records this time per video in
`loadStarts` and passes it as `context.loadStartedAt`. The match must fall
between 4 s before and 30 s after `loadstart`. With only one MSE video, the
newest stream is picked. The other captured files are listed under "Detected
on this page".

This was often wrong, which led to section 5.

---

## 4. TikTok: download failed with HTTP 403, and the file name was blank

### Cause 1: Brisk dropped the Referer

The extension sends `refererHeader` with every single-file request. In the
Brisk app, `_handleSingleDownloadRequest`
(`lib/browser_extension/browser_extension_server.dart`) only sent
`Cookie`. `downloadItem.referer` is only used for the "open the page this
came from" link in the UI, not as an HTTP header. TikTok's CDN rejects
requests without `Referer: https://www.tiktok.com/`.

### Cause 2: Brisk's own User-Agent

Brisk sends a fixed Chrome User-Agent (`userAgentHeader` in
`lib/util/http_util.dart` and the download engine's `constants.dart`).
TikTok's video URLs are signed and likely tied to the browser that loaded
them.

### Cause 3: blank file name

Brisk ignored the extension's `suggestedName` for single files. It used the
name from `Content-Disposition` or from the URL, and TikTok video URLs have
no file name in the path.

### Fix

Brisk app (`lib/browser_extension/browser_extension_server.dart`,
`_handleSingleDownloadRequest`):

- Reads `data.refererHeader`, `data.userAgent` and `data.suggestedName`.
- Builds one `headers` map with `Cookie`, `Referer` and `User-Agent` (each
  only when present). It's used for both the file-info request and the
  download itself (`downloadItem.requestHeaders`), including the "update
  URL" path (`awaitingUpdateUrlItem`). The download engine only adds its
  default User-Agent when `User-Agent` is missing, so the browser's value
  wins.
- If `suggestedName` is non-empty and passes `FileUtil.isFileNameInvalid`,
  it replaces the file name from the server or URL. This is done by
  rebuilding the `FileInfo` (its `fileName` is `final`).
- Added `import 'package:brisk/model/file_metadata.dart';` for `FileInfo`.

Extension (`app/scripts/background.js`, `downloadVideo`):

- Single-file requests now include `userAgent: navigator.userAgent`.

### Status

After these changes, downloads worked with a proper `.mp4` name. The Referer
fix alone still left failures, so the User-Agent was most likely the main
403 cause. Both changes landed together, so this wasn't isolated.

---

## 5. TikTok: the menu could pick the next or previous video

### Cause

The timing match in section 3 is a guess. Preloads start around the same
time as the visible video, so the "closest" file was often a neighbouring
post.

### Investigation

On tiktok.com/foryou in Chrome:

- Each player is wrapped in an element whose id ends with the post id:
  `xgwrapper-<index>-<postId>`, for example `xgwrapper-0-7673766573571607840`.
- TikTok is a React app. React stores each component's internal data
  (its "fiber") on DOM nodes under keys like `__reactFiber$…`. Walking up the
  fiber tree from the wrapper (about 19 levels up) finds a component whose
  `item` prop is the full post: `id`, `author`, and `video` with `playAddr`,
  `downloadAddr` and `bitrateInfo[]`.
- Each `bitrateInfo` entry holds one quality: `PlayAddr.UrlList[]`, `Width`,
  `Height`, `Bitrate`, `CodecType` (`h264`, `h265_hvc1`), `DataSize` and
  `GearName`.
- Testing every `<video>` on the feed, each found the `item` whose `id`
  matched its own wrapper id, with URLs for every quality.

### Constraint

Content scripts run in an isolated world. They share the DOM but not JS
properties, so React's `__reactFiber$…` keys are invisible to them. Reading
the data needs a script in the page's own JS context.

### Fix

New `app/scripts/tiktok-main.js` (main-world script, no extension APIs):

- Loaded by a new manifest entry:
  ```json
  {
    "run_at": "document_idle",
    "matches": ["*://*.tiktok.com/*"],
    "js": ["scripts/tiktok-main.js"],
    "world": "MAIN"
  }
  ```
- Listens for `brisk:tiktok-item-request` on `document`. The event detail is
  a random token.
- Finds `video[data-brisk-probe="<token>"]` and reads the post id from the
  closest `[id^="xgwrapper-"]`. It walks up from the nearest element with a
  React fiber (up to 40 levels through `fiber.return`). In each level's
  `memoizedProps`, it looks for an object with `video` and an `id` equal to
  the wrapper's post id. If there is no wrapper id, the first post found is
  used.
- Summarizes the post into `{id, author, variants[]}`. Each variant is
  `{url, width, height, bitrate, codec, size}`, taken from `bitrateInfo`, or
  from `playAddr` if there is no `bitrateInfo`.
- Replies with `brisk:tiktok-item-response`, whose detail is a JSON string
  `{token, item}`. Strings are used so the data crosses safely between the
  page and the content script in Firefox.

New `app/scripts/lib/tiktok-page.js` (content-script side):

- `isTikTokHost(hostname)`.
- `tiktokItems(video)`:
  - Tags the video with a one-time `data-brisk-probe` token and sends the
    request.
  - Waits up to 1 s for the matching response, then removes the attribute.
  - Builds menu items sorted by height, then bitrate. Labels look like
    `1080p H.265` or `576p H.264`. The details line shows the MP4
    resolution, bitrate and size.
  - Sets `referer: https://www.tiktok.com/` and names files
    `<author>_<postId>_<label>.mp4`.
  - Ignores non-HTTP URLs.

`app/scripts/lib/video-sources.js`:

- `collectVideoOptions` calls `tiktokItems(video)` on TikTok and adds the
  results to "This video".
- When those items exist, progressive network streams (the captured
  preloads) are dropped from the list.
- If the lookup returns nothing, the timing match from section 3 is used
  instead.

### Notes and limits

- This depends on TikTok's internal page structure: the `xgwrapper-<n>-<id>`
  ids and the `item` prop. If TikTok changes either, the lookup returns
  `null` and the menu falls back to timing instead of breaking.
- H.265 entries are often the highest resolution, but some players can't
  open them. H.264 plays everywhere.
- `"world": "MAIN"` content scripts need Chrome 111+ or Firefox 128+.
- A page could send fake responses. That only affects which TikTok URL is
  offered on TikTok's own page, and non-HTTP URLs are rejected.

### Verification

- The lookup logic was run by hand on the live For You feed in Chrome. Every
  video matched its own post id and had URLs for all qualities.
- `npx webextension-toolbox build chrome` and `… build firefox` compile.
  `scripts/tiktok-main.js` is emitted and the `world` key is in the built
  manifests.
- Not tested yet: the full extension flow with the new script, the TikTok
  video detail page (`/@user/video/<id>`), and Firefox.

---

## 6. Instagram: no video detected

### Cause

Instagram plays videos through Media Source Extensions (`blob:` src) using
DASH, with separate video-only and audio-only tracks fetched in byte ranges.
There's no `.m3u8` and no complete file on the network, so the background
script had nothing to offer. Even if the segments were captured, Brisk can't
merge DASH audio and video.

### Investigation

On instagram.com/reels/ and the home feed in Chrome:

- Walking up the React fiber tree from each `<video>` (about 12 levels)
  reaches the player component, whose props include `implementations[]`.
- One implementation holds the DASH `manifest` (MPD XML). The other holds
  `data.hdSrc` and `data.sdSrc`: progressive MP4 URLs on Instagram's CDN.
  They are often the same URL.
- Every video on the page had its own unique `hdSrc` (5 videos, 5 URLs), so
  the match is exact per video, with no timing guesswork.
- A range request on `hdSrc` returned `206` with `video/mp4`, and the file's
  header contained both a video (`vide`) and an audio (`soun`) track.
- The post data (author, shortcode) isn't in these props. On the feed, each
  video's `<article>` has a `/p/<code>/` or `/reel/<code>/` link. On the
  reels page there's no such link per video, but the page URL
  (`/reels/<code>/`) follows the video that's playing.

### Fix

- `app/scripts/lib/main-world.js` (new): the token and DOM-event bridge,
  moved out of `tiktok-page.js` so TikTok and Instagram share it
  (`requestFromMainWorld(video, requestEvent, responseEvent)`).
- `app/scripts/instagram-main.js` (new, main world, loaded on
  `*://*.instagram.com/*` with `"world": "MAIN"`): handles
  `brisk:instagram-item-request`. It finds the first fiber with
  `implementations` above the probed `<video>` (up to 30 levels) and returns
  `hdSrc` (as HD) and `sdSrc` (as SD, only if different).
- `app/scripts/lib/instagram-page.js` (new): `isInstagramHost`,
  `instagramItems(video)`. Items use `referer: https://www.instagram.com/`.
  Names are `instagram_<shortcode>.mp4`. The shortcode comes from the
  video's `<article>` link, or from the page URL if the video is playing.
  Otherwise the name uses the start of the CDN file name.
- `app/scripts/lib/video-sources.js`: Instagram items go into "This video".
- `app/manifest.json`: the main-world content script entry for Instagram.

### Limits

- The DASH manifest may contain higher resolutions than the progressive MP4.
  Those are video-only tracks that would need merging with audio, so they
  aren't offered.
- This depends on Instagram's internal player props (`implementations`,
  `hdSrc`, `sdSrc`). If they change, the menu shows nothing found again.

### Verification

- Lookup logic run by hand in Chrome on /reels/ and the home feed: every
  video resolved to its own MP4. On the feed every video had an article with
  a shortcode.
- Chrome and Firefox builds compile, and `scripts/instagram-main.js` is
  emitted.
- Not tested yet: the full extension flow and Brisk downloading the file.

---

## Files changed

### Extension (`brisk-browser-extension`)

| File | Change |
|---|---|
| `app/scripts/lib/video-overlay.js` | Scroll and media-event re-checks (`schedulePointerCheck`, `onScroll`). `loadStarts` tracking and `context.loadStartedAt`. Header removed. `Sent` became `Started` |
| `app/scripts/lib/video-overlay-styles.js` | Removed unused `.header`, `.header-title` and `.status` rules |
| `app/scripts/popup.js` | `Connected` / `Not connected` status and tooltip. `Download started` toast |
| `app/scripts/background.js` | `isProgressiveFetchVideo`. Progressive capture in `handleResponse`. `firstDetectedAt` / `progressive` on streams. `userAgent` in single-file requests |
| `app/scripts/lib/stream-items.js` | Passes `firstDetectedAt` / `progressive` to items |
| `app/scripts/lib/video-sources.js` | `matchProgressiveStream` fallback. TikTok items. Drops preloads when the post is known |
| `app/scripts/lib/tiktok-page.js` | New: content-script side of the TikTok lookup (uses `main-world.js`) |
| `app/scripts/tiktok-main.js` | New: main-world React props reader |
| `app/manifest.json` | Main-world content scripts for `*://*.tiktok.com/*` and `*://*.instagram.com/*` |
| `app/scripts/lib/main-world.js` | New: shared main-world request bridge |
| `app/scripts/instagram-main.js` | New: main-world reader for Instagram player props |
| `app/scripts/lib/instagram-page.js` | New: Instagram menu items and naming |

### Desktop app (`brisk`)

| File | Change |
|---|---|
| `lib/browser_extension/browser_extension_server.dart` | Single downloads send `Referer` and `User-Agent` and use `suggestedName`. Adds the `file_metadata.dart` import |

## Building

```sh
npx webextension-toolbox build chrome    # -> dist/chrome
npx webextension-toolbox build firefox   # -> dist/firefox
```

`npm run build` alone fails with `missing required argument 'vendor'`, so
pass the browser name. `npx eslint` fails because the project has no ESLint
config. For the app, `dart analyze` on the changed file reports no errors,
only two warnings that were already there (lines ~193 and ~528).
