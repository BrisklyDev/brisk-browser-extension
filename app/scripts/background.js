import * as browser from 'webextension-polyfill';
import {
    checkBriskRunning,
    defaultSettings, isCaptureEnabled, isResponseWaitEnabled, sendRequestToBrisk, setCachedSettings, settingCache
} from "./common";

let m3u8UrlsByTab = {};
let vttUrlsByTab = {};
let videoUrlsByTab = {};
let downloadHrefs;
createContextMenuItem();

const isFirefox = navigator.userAgent.includes("Firefox");
const extraInfoSpec = ["requestHeaders"];
if (!isFirefox) {
    extraInfoSpec.push("extraHeaders");
}

browser.runtime.onInstalled.addListener(async () => {
    await browser.storage.sync.set({
        briskPort: defaultSettings.port,
        briskResponseWaitEnabled: defaultSettings.briskResponseWaitEnabled,
        briskCaptureEnabled: defaultSettings.captureEnabled,
    });
    await setCachedSettings();
});

browser.downloads.onCreated.addListener(sendBriskDownloadAdditionRequest);

browser.runtime.onMessage.addListener((message) => downloadHrefs = message);

browser.webRequest.onBeforeSendHeaders.addListener(async (details) => {
    handleVideoStreams(details);
}, {urls: ['<all_urls>']}, extraInfoSpec);


function handleVideoStreams(details) {
    const {tabId, url, requestHeaders} = details;
    const refererHeader = requestHeaders.find(h => h.name.toLowerCase() === 'referer');
    const referer = refererHeader?.value || null;
    const pathName = new URL(url).pathname;
    if (pathName.endsWith('m3u8')) {
        addUrlToTab(m3u8UrlsByTab, tabId, url, referer);
    }
    // For aniplaynow.live
    if (url.includes("/m3u8-proxy")) {
        const urlObj = new URL(url);
        const rawUrl = urlObj.searchParams.get("url");
        const realM3u8Url = rawUrl || null;
        const headersParam = urlObj.searchParams.get("headers");
        let realReferer = referer;
        if (!headersParam) {
            const headers = JSON.parse(headersParam);
            realReferer = headers.Referer;
        }
        console.log(`realM3u8 ${realM3u8Url}`);
        console.log(`real header ${realReferer}`);
        addUrlToTab(m3u8UrlsByTab, tabId, realM3u8Url, realReferer);
    } else if (url.endsWith('.vtt')) {
        console.log(`vtt referer ${referer}`);
        addUrlToTab(vttUrlsByTab, tabId, url, referer);
    } else if (url.endsWith(".mp4") || url.endsWith(".webm")) {
        addUrlToTab(videoUrlsByTab, tabId, url, referer);
    }
}

function addUrlToTab(urlsByTab, tabId, url, referer) {
    if (!urlsByTab[tabId]) {
        urlsByTab[tabId] = [];
    }
    if (!urlsByTab[tabId].includes(url)) {
        urlsByTab[tabId].push({url: url, referer: referer});
    }
}

// Listen for tab reload events to clear the m3u8 URLs for that tab
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        m3u8UrlsByTab[tabId] = [];
        vttUrlsByTab[tabId] = [];
        videoUrlsByTab[tabId] = [];
    }
});

// Listen for requests from popup to get m3u8 URLs for the current tab
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(message);
    if (message.type === 'get-m3u8-list') {
        let urls = m3u8UrlsByTab[message.tabId] || [];
        if (videoUrlsByTab[message.tabId]) {
            urls.push(...videoUrlsByTab[message.tabId]);
        }
        sendResponse({m3u8Urls: urls});
    }
    if (message.type === 'get-vtt-list') {
        const urls = vttUrlsByTab[message.tabId] || [];
        sendResponse({vttUrls: urls});
    }
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "brisk-download") {
        let body = {
            "type": "multi", "data": {
                "referer": tab.url, downloadHrefs
            },
        };
        try {
            await sendRequestToBrisk(body);
        } catch (e) {
            console.error("Failed to send request to Brisk!");
        }
    }
});


async function sendBriskDownloadAdditionRequest(downloadItem) {
    if (!(await isCaptureEnabled())) {
        return;
    }
    try {
        await checkBriskRunning();
    } catch (e) {
        return;
    }
    let body = {
        "type": "single", "data": {
            'url': downloadItem.url, 'referer': downloadItem.referrer
        }
    };
    let response;
    try {
        response = await sendRequestToBrisk(body);
    } catch (e) {
        return;
    }
    if (await isResponseWaitEnabled()) {
        let json = await response.json();
        if (json["captured"]) {
            await removeBrowserDownload(downloadItem.id);
        }
    } else {
        await removeBrowserDownload(downloadItem.id);
    }
}

async function removeBrowserDownload(id) {
    await browser.downloads.cancel(id).then(pass).catch(console.log);
    await browser.downloads.erase({id}).then(pass).catch(console.log);
    await browser.downloads.removeFile(id).then(pass).catch(pass);
}

function createContextMenuItem() {
    browser.contextMenus.removeAll().then(() => {
        browser.contextMenus.create({
            id: "brisk-download", title: "Download selected links with Brisk", contexts: ["selection"]
        }, () => null);
    }).catch(console.log);
}

const pass = () => null;