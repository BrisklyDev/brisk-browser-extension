import * as browser from "webextension-polyfill";

export const defaultSettings = {
    port: 3020,
    captureEnabled: true,
    videoButtonEnabled: true,
    briskResponseWaitEnabled: true,
};

export const BRISK_DOWNLOAD_URL = "https://github.com/BrisklyDev/brisk/releases/latest";

const extensionVersion = browser.runtime.getManifest().version;
export const isFirefox = navigator.userAgent.includes("Firefox");

/**
 * Hosts where the video download button and stream detection are disabled.
 * Downloading YouTube videos is not allowed by the Chrome Web Store policies.
 */
const BLOCKED_VIDEO_HOSTS = [
    "youtube.com",
    "youtube-nocookie.com",
    "youtu.be",
    "googlevideo.com",
    "ytimg.com",
];

export function isBlockedVideoHost(hostname) {
    if (!hostname) return false;
    const host = hostname.toLowerCase();
    return BLOCKED_VIDEO_HOSTS.some(blocked => host === blocked || host.endsWith("." + blocked));
}

export function isBlockedVideoUrl(url) {
    try {
        return isBlockedVideoHost(new URL(url).hostname);
    } catch (e) {
        return false;
    }
}

export async function getBriskBaseUrl() {
    return "http://127.0.0.1:" + await getBriskPort();
}

/**
 * Pings Brisk. Resolves with the response or rejects if Brisk is not reachable.
 */
export async function checkBriskRunning(timeoutMs = 2000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(await getBriskBaseUrl(), {method: 'POST', signal: controller.signal});
    } finally {
        clearTimeout(timer);
    }
}

export async function isBriskRunning(timeoutMs = 2000) {
    try {
        await checkBriskRunning(timeoutMs);
        return true;
    } catch (e) {
        return false;
    }
}

export function isLocalhostUrl(url) {
    try {
        const hostname = new URL(url).hostname;
        return (
            hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            hostname === "[::1]" ||
            hostname === "::1"
        );
    } catch (e) {
        return false;
    }
}

export function isHttpUrl(url) {
    return typeof url === "string" && /^https?:\/\//i.test(url);
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
        ['briskPort', 'briskResponseWaitEnabled', 'briskCaptureEnabled', 'briskVideoButtonEnabled']
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

export async function isVideoButtonEnabled() {
    let result = await browser.storage.sync.get(['briskVideoButtonEnabled']);
    return result.briskVideoButtonEnabled ?? defaultSettings.videoButtonEnabled;
}

export function getExtension(url) {
    try {
        const match = new URL(url).pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
        return match ? match[1].toLowerCase() : null;
    } catch (e) {
        return null;
    }
}

export function fileNameFromUrl(url) {
    try {
        const path = new URL(url).pathname;
        return decodeURIComponent(path.substring(path.lastIndexOf('/') + 1)) || null;
    } catch (e) {
        return null;
    }
}

export function sanitizeFileName(name) {
    if (!name) return "";
    return name
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^\.+/, '')
        .trim()
        .slice(0, 180)
        .trim();
}

export function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return null;
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let value = bytes;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatBitrate(bitsPerSecond) {
    if (!bitsPerSecond) return null;
    if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
    return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

export function formatDuration(seconds) {
    if (!seconds || !isFinite(seconds)) return null;
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** "1920x1080" -> "1080p", portrait "720x1280" -> "720p" */
export function qualityLabel(width, height) {
    if (!width || !height) return null;
    return `${Math.min(width, height)}p`;
}
