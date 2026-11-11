import * as browser from 'webextension-polyfill';
import {BRISK_DOWNLOAD_URL, defaultSettings, fileNameFromUrl, getSettingsFromStorage, sanitizeFileName} from "./common";
import {itemsForStream} from "./lib/stream-items";

const WAIT_ENABLED_TEXT = "Brisk confirms it can download a file before the browser download is cancelled.";
const WAIT_DISABLED_TEXT = "Browser downloads are cancelled right away, even if Brisk fails to get the file info.";


function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
}

let toastTimer;
function toast(message) {
    const toastElement = document.getElementById('toast');
    toastElement.textContent = message;
    toastElement.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastElement.classList.remove('show'), 2200);
}

async function getActiveTab() {
    const tabs = await browser.tabs.query({active: true, currentWindow: true});
    return tabs[0];
}

// ---------------------------------------------------------------- status

async function refreshStatus() {
    const statusElement = document.getElementById('brisk-status');
    const banner = document.getElementById('not-running-banner');
    let status;
    try {
        status = await browser.runtime.sendMessage({type: 'brisk:status'});
    } catch (e) {
        status = {running: false};
    }
    statusElement.dataset.state = status.running ? 'online' : 'offline';
    statusElement.textContent = status.running ? 'Connected' : 'Not connected';
    statusElement.title = status.running ? 'Connected to Brisk' : 'Brisk is not running or could not be reached';
    banner.hidden = !!status.running;
    return status.running;
}

// ---------------------------------------------------------------- videos

async function getBaseName(tab) {
    try {
        const name = await browser.tabs.sendMessage(tab.id, {type: 'brisk:get-page-video-name'}, {frameId: 0});
        if (name) return name;
    } catch (e) {
        // Content script not available on this page (e.g. browser pages)
    }
    return sanitizeFileName(tab.title || '');
}

function streamTitle(stream, base, isOnlyStream) {
    const fromUrl = fileNameFromUrl(stream.url);
    // With several videos the page title is the same for all of them, the file name tells them apart
    return (isOnlyStream ? base || fromUrl : fromUrl || base) || 'Video';
}

function streamMeta(stream, items) {
    let host = '';
    try {
        host = new URL(stream.url).hostname.replace(/^www\./, '');
    } catch (e) {
        // ignore
    }
    if (stream.kind === 'direct') {
        return [items[0]?.detail, host].filter(Boolean).join(' · ');
    }
    if (stream.isMaster && stream.variants?.length) {
        const count = stream.variants.length;
        return [`HLS · ${count} ${count === 1 ? 'quality' : 'qualities'}`, host].join(' · ');
    }
    return [items[0]?.detail || 'HLS', host].filter(Boolean).join(' · ');
}

async function sendToBrisk(tab, item, chip) {
    if (chip.dataset.state === 'sending') return;
    chip.dataset.state = 'sending';
    let result;
    try {
        result = await browser.runtime.sendMessage({
            type: 'brisk:download',
            tabId: tab.id,
            item: {kind: item.kind, url: item.url, referer: item.referer, name: item.name},
        });
    } catch (e) {
        result = {ok: false, reason: 'error'};
    }
    if (result?.ok) {
        chip.dataset.state = 'done';
        toast('Download started');
        return;
    }
    chip.dataset.state = 'error';
    if (result?.reason === 'not-running') {
        toast("Brisk isn't running");
        refreshStatus();
    } else if (result?.reason === 'rejected') {
        toast("Brisk couldn't get the file info");
    } else {
        toast('Something went wrong');
    }
    setTimeout(() => {
        if (chip.dataset.state === 'error') delete chip.dataset.state;
    }, 3000);
}

function renderStream(tab, stream, base, isOnlyStream) {
    const items = itemsForStream(stream, base);
    const li = el('li', items.length === 1 ? 'video single' : 'video');
    const name = el('div', 'video-name', streamTitle(stream, base, isOnlyStream));
    name.title = stream.url;

    const qualities = el('div', 'qualities');
    for (const item of items) {
        const chip = el('button', 'quality');
        chip.type = 'button';
        chip.title = `Download ${item.name}`;
        chip.textContent = item.kind === 'direct' && items.length === 1 ? 'Download' : item.label;
        chip.addEventListener('click', () => sendToBrisk(tab, item, chip));
        qualities.appendChild(chip);
    }
    li.append(name, el('div', 'video-meta', streamMeta(stream, items)), qualities);
    return li;
}

async function renderVideos() {
    const list = document.getElementById('video-list');
    const empty = document.getElementById('video-empty');
    const count = document.getElementById('video-count');
    const tab = await getActiveTab();
    if (!tab) return;

    let data = {streams: []};
    try {
        data = await browser.runtime.sendMessage({type: 'brisk:get-streams', tabId: tab.id, scope: 'tab'});
    } catch (e) {
        // ignore
    }
    const streams = (data?.streams || []).slice().sort((a, b) => b.detectedAt - a.detectedAt);
    const base = streams.length ? await getBaseName(tab) : '';
    list.replaceChildren(...streams.map(stream => renderStream(tab, stream, base, streams.length === 1)));
    empty.hidden = streams.length > 0;
    count.hidden = streams.length === 0;
    count.textContent = String(streams.length);
}

// ---------------------------------------------------------------- settings

function initSettings() {
    const portInput = document.getElementById('port');
    const portHint = document.getElementById('port-hint');
    const saveButton = document.getElementById('save-port');
    const captureToggle = document.getElementById('enable-capture');
    const videoButtonToggle = document.getElementById('show-video-download-button');
    const waitToggle = document.getElementById('enable-wait-brisk-response');
    const waitDescription = document.getElementById('wait-description');

    const updateWaitDescription = () => {
        waitDescription.textContent = waitToggle.checked ? WAIT_ENABLED_TEXT : WAIT_DISABLED_TEXT;
    };

    getSettingsFromStorage().catch(() => ({})).then((data) => {
        portInput.value = data.briskPort ?? defaultSettings.port;
        captureToggle.checked = data.briskCaptureEnabled ?? defaultSettings.captureEnabled;
        videoButtonToggle.checked = data.briskVideoButtonEnabled ?? defaultSettings.videoButtonEnabled;
        waitToggle.checked = data.briskResponseWaitEnabled ?? defaultSettings.briskResponseWaitEnabled;
        updateWaitDescription();
    });

    // Toggles are saved immediately
    const saveToggle = (key, input) => input.addEventListener('change', async () => {
        await browser.storage.sync.set({[key]: input.checked});
        toast('Settings saved');
    });
    saveToggle('briskCaptureEnabled', captureToggle);
    saveToggle('briskVideoButtonEnabled', videoButtonToggle);
    saveToggle('briskResponseWaitEnabled', waitToggle);
    waitToggle.addEventListener('change', updateWaitDescription);

    const savePort = async () => {
        const port = Number(portInput.value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            portInput.setAttribute('aria-invalid', 'true');
            portHint.textContent = 'Enter a port between 1 and 65535.';
            portHint.classList.add('error');
            return;
        }
        portInput.removeAttribute('aria-invalid');
        portHint.textContent = "Must match the port set in Brisk's extension settings.";
        portHint.classList.remove('error');
        await browser.storage.sync.set({briskPort: port});
        toast('Port saved');
        refreshStatus();
    };
    saveButton.addEventListener('click', savePort);
    portInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') savePort();
    });
}

// ---------------------------------------------------------------- tabs

function initTabs() {
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const tab = button.dataset.tab;
            document.querySelectorAll('.tab-button').forEach(other => {
                const active = other === button;
                other.classList.toggle('active', active);
                other.setAttribute('aria-selected', String(active));
            });
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.toggle('active', content.id === tab);
            });
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('version').textContent = `v${browser.runtime.getManifest().version}`;
    document.getElementById('get-brisk-link').href = BRISK_DOWNLOAD_URL;
    initTabs();
    initSettings();
    refreshStatus();
    renderVideos();
});
