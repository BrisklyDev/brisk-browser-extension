import * as browser from 'webextension-polyfill';
import {
    checkBriskRunning,
    defaultSettings, fetchM3u8DataViaBrisk,
    isCaptureEnabled, isLocalhostUrl,
    isResponseWaitEnabled,
    sendRequestToBrisk
} from "./common";

let downloadHrefs;
createContextMenuItem();
const isFirefox = navigator.userAgent.includes("Firefox");
const extraInfoSpec = ["requestHeaders"];
if (!isFirefox) {
    extraInfoSpec.push("extraHeaders");
}

const sessionSaveBuffer = {};
const seenUrls = [];

/// TODO change to master url
browser.runtime.onInstalled.addListener(async () => {
    /// TODO TO BE REMOVED
    await browser.storage.sync.remove("briskM3u8NameResolver");
    let response = await fetch("https://raw.githubusercontent.com/BrisklyDev/brisk-extension-dynamic-plugins/refs/heads/developer/m3u8-name-resolver.json");
    await browser.storage.sync.set({
        briskPort: defaultSettings.port,
        briskResponseWaitEnabled: defaultSettings.briskResponseWaitEnabled,
        briskCaptureEnabled: defaultSettings.captureEnabled,
        briskM3u8NameResolver: await response.json(),
    });
});

browser.downloads.onCreated.addListener(sendBriskDownloadAdditionRequest);

browser.runtime.onMessage.addListener((message) => downloadHrefs = message);

browser.webRequest.onBeforeSendHeaders.addListener(async (details) => {
    const refererHeader = details.requestHeaders.find((h) => h.name.toLowerCase() === 'referer');
    const cookieHeader = details.requestHeaders.find((h) => h.name.toLowerCase() === 'cookie');
    //
    // if (refererHeader) {
    //     console.log('Referer:', refererHeader?.value);
    // }
    // if (cookieHeader) {
    //     console.log('Cookie:', cookieHeader?.value);
    // }
    //
    handleVideoStreams(details);
}, {urls: ['<all_urls>']}, ['requestHeaders']);

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
        console.log("THE M3U8 REFERER");
        console.log(referer);
        await saveUrlDataToSession('m3u8', tabId, url, referer);
        await browser.tabs.sendMessage(tabId, {
            type: "m3u8-detected", url: url, referer: referer,
        },);
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
        await browser.tabs.sendMessage(tabId, {
            type: "m3u8-detected", url: url, referer: referer,
        },);
    } else if (url.endsWith('.vtt')) {
        console.log(`vtt url found ${url}`);
        console.log(`vtt referer ${referer}`);
        await saveUrlDataToSession('vtt', tabId, url, referer);
    } else if (url.endsWith(".mp4") || url.endsWith(".webm")) {
        browser.tabs.sendMessage(tabId, {type: "video-detected",});
        await saveUrlDataToSession('video', tabId, url, referer);
        await browser.tabs.sendMessage(tabId, {
            type: "video-detected", url: url, referer: referer,
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
        console.log("Duplicate found, not adding:", {url, referer});
        return;
    }

    const obj = {url, referer};

    if (type === 'm3u8') {
    }

    value[type].push(obj);
    console.log("Added to buffer", value);
    scheduleSessionSave(key);
}

// Listen for requests from popup to get m3u8 URLs for the current tab
browser.runtime.onMessage.addListener(async (message) => {
    if (message.type === 'log') {
        console.log(message.payload);
    }
})

browser.runtime.onMessage.addListener((message, sender) => {
    if (message.type === 'get-vtt') {
        return Promise.resolve("Asdkasodkasodapsd");
    }
});

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
            console.log("Getting m3u8====================================");
            sendResponse({m3u8Urls: urls});
        } else if (message.type === 'get-vtt-list') {
            console.log("Vtt inside background.js");
            console.log(value['vtt']);
            sendResponse({vttUrls: 'asdaposdkaspodkasd'});
        }
    });
    return true;
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