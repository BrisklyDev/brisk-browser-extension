import * as browser from 'webextension-polyfill';
import {
    checkBriskRunning,
    defaultSettings, fetchM3u8DataViaBrisk, getExtension,
    isCaptureEnabled, isFirefox, isLocalhostUrl,
    isResponseWaitEnabled,
    sendRequestToBrisk, sendVttToBrisk
} from "./common";
import {refreshResolvers} from "./m3u8-name-resolver";

refreshResolvers();

let downloadHrefs;
createContextMenuItem();
const sessionSaveBuffer = {};
const seenUrls = [];
let urlCookies = {};

/// TODO change to master url
browser.runtime.onInstalled.addListener(async () => {
    await browser.storage.sync.set({
        briskPort: defaultSettings.port,
        briskResponseWaitEnabled: defaultSettings.briskResponseWaitEnabled,
        briskCaptureEnabled: defaultSettings.captureEnabled,
    });
});

browser.downloads.onCreated.addListener(sendBriskDownloadAdditionRequest);

browser.runtime.onMessage.addListener((message) => downloadHrefs = message);

browser.webRequest.onBeforeSendHeaders.addListener(async (details) => {
    const cookieHeader = details.requestHeaders.find((h) => h.name.toLowerCase() === 'cookie');
    if (cookieHeader) {
        urlCookies[details.url] = cookieHeader.value;
    }
    handleVideoStreams(details);
}, {urls: ['<all_urls>']}, isFirefox ? ['requestHeaders'] : ['requestHeaders', 'extraHeaders']);

async function handleVideoStreams(details) {
    const {tabId, url, requestHeaders} = details;
    const refererHeader = requestHeaders.find(h => h.name.toLowerCase() === 'referer');
    const referer = refererHeader?.value || null;
    const pathName = new URL(url).pathname;
    if (seenUrls.includes(url) || isLocalhostUrl(url)) {
        return;
    }
    if (pathName.endsWith('m3u8')) {
        seenUrls.push(url);
        fetchM3u8DataViaBrisk(url, referer, tabId);
        await saveUrlDataToSession('m3u8', tabId, url, referer);
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
        fetchM3u8DataViaBrisk(url, referer, tabId);
        await saveUrlDataToSession('m3u8', tabId, url, referer);
    } else if (url.endsWith('.vtt')) {
        sendVttToBrisk(url, referer, tabId);
        await saveUrlDataToSession('vtt', tabId, url, referer);
    } else if (url.endsWith(".mp4") || url.endsWith(".webm")) {
        await saveUrlDataToSession('video', tabId, url, referer);
        let suggestedName = await browser.tabs.sendMessage(tabId, {
            type: "get-suggested-video-name",
            fileExtension: getExtension(url),
        },);
        await browser.tabs.sendMessage(tabId, {
            type: "inject-download-video-button",
            tabId: tabId,
            isM3u8: false,
            referer: referer,
            url: url,
            suggestedName: suggestedName,
        },);

    }
}

function scheduleSessionSave(key) {
    if (sessionSaveBuffer[key].timeout) clearTimeout(sessionSaveBuffer[key].timeout);
    sessionSaveBuffer[key].timeout = setTimeout(() => {
        browser.storage.session.set({[key]: sessionSaveBuffer[key].data});
        sessionSaveBuffer[key].timeout = null;
    }, 300);
}

async function saveUrlDataToSession(type, tabId, url, referer) {
    const key = `briskTab${tabId}`;
    if (!sessionSaveBuffer[key]) sessionSaveBuffer[key] = {data: {}, timeout: null};
    let value = sessionSaveBuffer[key].data;

    if (!value[type]) value[type] = [];

    const exists = value[type].some(item => item.url === url && item.referer === referer);
    if (exists) {
        return;
    }

    const obj = {url, referer};

    if (type === 'm3u8') {
    }

    value[type].push(obj);
    scheduleSessionSave(key);
}

// Listen for requests from popup to get m3u8 URLs for the current tab
browser.runtime.onMessage.addListener(async (message) => {
    if (message.type === 'log') {
        console.log(message.payload);
    }
})

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const key = `briskTab${message.tabId}`;
    browser.storage.session.get(key).then((result) => {
        let value = result[key] ?? {};
        if (message.type === 'get-m3u8-list') {
            let urls = value['m3u8'] || [];
            let videos = value['video'] || [];
            if (videos) {
                urls.push(...videos);
            }
            sendResponse({m3u8Urls: urls});
        }
    });
    return true;
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "brisk-download-selection") {
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
    if (info.menuItemId === "brisk-download") {
        let body = {
            "type": "single", "data": {
                "referer": tab.url,
                "url": info.linkUrl,
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
    if (urlCookies[downloadItem.url]) {
        body['data']['cookie'] = urlCookies[downloadItem.url];
    }
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
            id: "brisk-download-selection", title: "Download selected links with Brisk", contexts: ["selection"]
        }, () => null);
    }).catch(console.log);
    browser.contextMenus.create({
        id: "brisk-download", title: "Download link with Brisk", contexts: ["link"]
    }, () => null);
}

const pass = () => null;