# Brisk Browser Extension — Privacy Policy

_Last updated: November 11, 2026_

The Brisk browser extension ("the extension") sends downloads from your browser to the Brisk desktop download manager ("the Brisk app") installed on your own computer. This policy explains what data the extension handles and where it goes.

## Summary

- The extension does **not** send your data to the developer or to any third party.
- All data the extension handles is sent only to the Brisk app running on your own computer, at `http://127.0.0.1`.
- The extension does not sell, share, or use your data for advertising, analytics, or tracking.

## Data the extension handles

To hand a download over to the Brisk app, the extension handles the following data:

| Data | Why it is needed |
|---|---|
| Download URLs, file names and file sizes | To tell the Brisk app what to download. |
| URLs of videos and media streams detected on the current page, read from network request and response headers | To show a download button for videos on the page and send the selected video to the Brisk app. |
| The address of the page the download came from (the Referer header) | Some websites refuse downloads unless the request includes the page it came from. |
| Cookies for the URL being downloaded | So downloads that need you to be logged in (for example private files or videos) work in the Brisk app as they do in the browser. Only cookies for that specific URL are read. |
| Links you choose from the right-click menu | To send those links to the Brisk app. |

This data is sent only to the Brisk app on your own computer, over the local loopback address `127.0.0.1`. It never leaves your device through the extension. The extension keeps detected media information in memory only for the current tab, and discards it when you leave the page or close the tab. The extension does not store your cookies or browsing history.

## Settings

The extension saves its settings with the browser's `storage.sync` API: the Brisk app's port number, whether download capture is enabled, and whether the video download button is shown. If browser sync is turned on, your browser vendor (for example Google) syncs these settings across your devices under its own privacy policy. The settings contain no personal information.

## Network requests to other servers

- **Video name resolver rules:** the extension downloads a public rules file from `raw.githubusercontent.com`. The rules help it name video downloads. This request contains no user data. GitHub can see your IP address, as with any web request.
- **The website you are on:** to inspect a detected video stream, the extension may request that stream from the website hosting it, using your existing session. This is the same request your browser makes to play the video.

## Data sharing

The extension does not collect, transmit, sell, or share any user data with the developer or any third party. The data is not used for any purpose other than downloading the files and videos you choose with the Brisk app.

## Changes

If this policy changes, the updated version will be published at this address with a new "Last updated" date.

## Contact

Questions about this policy can be raised at https://github.com/BrisklyDev/brisk-browser-extension/issues.
