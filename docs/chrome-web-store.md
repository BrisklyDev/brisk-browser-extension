# Chrome Web Store submission notes

Text to paste into the Chrome Web Store developer dashboard when submitting the extension.
The extension only works together with the Brisk desktop app, so reviewers must be told
how to install it. Otherwise the review fails with "functionality not working".

## Store listing

**Short description** (from `manifest.json`)

> Send downloads and videos from your browser to the Brisk download manager app.

**Detailed description**

> Brisk is the browser companion for the free, open-source Brisk download manager
> (https://github.com/BrisklyDev/brisk). **The Brisk desktop app must be installed and running**
> for downloads to work.
>
> Features:
> - Sends downloads started in the browser to Brisk for faster, resumable downloading
> - "Download link with Brisk" and "Download selected links with Brisk" context menu entries
> - A **Download** button appears when you hover over a video. It lists the available qualities and sends your pick to Brisk.
> - The toolbar popup lists every video detected on the current page
>
> Supported: regular video files (MP4, WebM, …) and HLS streams (m3u8), including videos inside iframes.
> DRM-protected videos can't be downloaded. YouTube is not supported.

## Test instructions (Developer Dashboard → Privacy / Test instructions)

> This extension is a companion for the Brisk desktop download manager and needs it to download anything.
>
> 1. Download and install Brisk for your OS: https://github.com/BrisklyDev/brisk/releases/latest
>    (Windows `.exe` installer, macOS `.dmg`, Linux `.tar.xz`). Start it.
> 2. Click the Brisk toolbar icon. The header should show a green **Connected** badge.
>    (If Brisk isn't running, the popup and the video button say so and link to the download page.)
> 3. Video download:
>    - Open a page with a video, e.g. https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video
>      or an X post with a video such as https://x.com/elonmusk/status/1585341984679469056.
>    - Hover over the video. A **Download** button appears in its top-left corner.
>    - Click it and choose a quality. Brisk opens its "Add download" dialog for that video.
>    - The toolbar popup's **Videos** tab lists the same videos with a download button for each.
> 4. Download capture: click any file download link (e.g. https://proof.ovh.net/files/10Mb.dat).
>    The browser download is cancelled and the file is added to Brisk instead.
> 5. Context menu: right-click a link and choose "Download link with Brisk".

## Permission justifications

| Permission | Why it is needed |
|---|---|
| `downloads` | Detect downloads started in the browser and hand them over to Brisk (the browser copy is cancelled). |
| `webRequest` | Detect video files and HLS (m3u8) playlists that the page loads, so the download button can offer them. Observation only, requests are never blocked or modified. |
| `cookies` | Send the cookies of a download URL to Brisk so it can download files that require the user's session. Only read when a download is sent to Brisk. |
| `contextMenus` | "Download link with Brisk" and "Download selected links with Brisk" menu entries. |
| `storage` | Store the user's settings (Brisk port, toggles) and the list of detected videos per tab. |
| Host permission `<all_urls>` | Videos and downloads can come from any site. Needed to show the video button and to read playlists so qualities can be listed. |

**Remote code:** none. All code is bundled. The extension downloads one JSON data file
(`m3u8-name-resolver.json` from the BrisklyDev GitHub repository) that holds CSS selectors used to name video files. It is data, never executed.

**Data usage:** download and video URLs are only sent to the Brisk app running locally on `127.0.0.1`.
On x.com / twitter.com, when the user opens the video download menu, the extension requests the
tweet's public media info from `cdn.syndication.twimg.com` (the endpoint used by embedded tweets)
to find the MP4 files. To list the qualities of an HLS stream, the extension downloads the playlist
from the same server the page loaded it from. No other servers are contacted, apart from the
resolver file download above.
