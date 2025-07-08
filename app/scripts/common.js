import * as browser from "webextension-polyfill";

export const defaultSettings = {
    port: 3020,
    captureEnabled: true,
    briskResponseWaitEnabled: true,
};

const extensionVersion = browser.runtime.getManifest().version;

export async function getBriskBaseUrl() {
    return "http://127.0.0.1:" + await getBriskPort();
}

export async function checkBriskRunning() {
    return await fetch(
        await getBriskBaseUrl(),
        {method: 'POST'}
    );
}

export async function fetchM3u8DataViaBrisk(url, referer, tabId) {
    let suggestedName = await browser.tabs.sendMessage(tabId, {
        type: "get-suggested-video-name"
    },);
    if (suggestedName) {
        suggestedName = suggestedName + '.ts';
    }
    let response = await fetch(
        await getBriskBaseUrl() + '/fetch-m3u8',
        {
            method: 'POST',
            body: JSON.stringify({
                'url': url,
                'referer': referer,
                'extensionVersion': extensionVersion,
                'suggestedName': suggestedName,
            }),
        }
    );
    let json = await response.json();
    if (!json['captured']) {
        return;
    }
    delete json.captured;
    const key = `briskTab${tabId}`;
    let result = await browser.storage.session.get(key);
    let value = result[key] ?? {};
    let savedM3u8 = value['m3u8-cache'] || [];
    savedM3u8.push(json);
    value['m3u8-cache'] = savedM3u8;
    result[key] = value;
    await browser.storage.session.set({[key]: value});
    await browser.tabs.sendMessage(tabId, {
        type: "inject-download-video-button",
        tabId: tabId,
    },);
}

export function isLocalhostUrl(url) {
    try {
        const hostname = new URL(url).hostname;
        return (
            hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            hostname === "::1"
        );
    } catch (e) {
        return false;
    }
}

export async function sendRequestToBrisk(body) {
    body.extensionVersion = extensionVersion;
    return await fetch(
        await getBriskBaseUrl(),
        {method: 'POST', body: JSON.stringify(body)}
    );
}


export async function getSettingsFromStorage() {
    return await browser.storage.sync.get(
        ['briskPort', 'briskResponseWaitEnabled', 'briskCaptureEnabled']
    );
}

export async function getBriskPort() {
    let result = await browser.storage.sync.get(['briskPort']);
    return result.briskPort ?? defaultSettings.port;
}

export async function isResponseWaitEnabled() {
    let result = await browser.storage.sync.get(['briskResponseWaitEnabled']);
    return result.briskResponseWaitEnabled ?? defaultSettings.briskResponseWaitEnabled;
}

export async function isCaptureEnabled() {
    let result = await browser.storage.sync.get(['briskCaptureEnabled']);
    return result.briskCaptureEnabled ?? defaultSettings.captureEnabled;
}

export function extractResolution(text) {
    const match = text.match(/(?:\b|\D)(\d{3,4})p?\b/i);
    return match ? match[1] + (text.includes(match[1] + 'p') ? 'p' : '') : null;
}


export async function getSessionStoredValue(tabId, type) {
    const key = `briskTab${tabId}`;
    let result = await browser.storage.session.get(key);
    let value = result[key] ?? {};
    return value[type] || [];
}