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
