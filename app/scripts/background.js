import * as browser from 'webextension-polyfill';
import {
    checkBriskRunning,
    defaultSettings,
    getBriskPort,
    isBlockedVideoUrl,
    isCaptureEnabled,
    isFirefox,
    isHttpUrl,
    isLocalhostUrl,
    isResponseWaitEnabled,
    isBriskRunning,
    sendRequestToBrisk,
} from "./common";
import {refreshResolvers} from "./m3u8-name-resolver";
import {childPlaylistUrls, parseM3u8} from "./lib/hls";
import {getMediaForTweets} from "./lib/x-media";

const STATE_KEY = 'briskVideoState';
const SELECTION_KEY = 'briskSelectionLinks';
const MAX_STREAMS_PER_TAB = 40;
const MAX_CHILD_URLS_PER_TAB = 600;
const MIN_DIRECT_VIDEO_SIZE = 256 * 1024;
const DIRECT_VIDEO_REQUEST_TYPES = new Set(['media', 'main_frame', 'sub_frame', 'object']);
const DIRECT_VIDEO_EXTENSIONS = /\.(mp4|m4v|webm|mov|mkv|ogv)$/i;

/**
 * TikTok plays complete MP4 files (audio included) through Media Source Extensions,
 * fetching them in byte ranges with fetch(). Unlike regular MSE segments, these
 * responses are whole, downloadable files.
 */
function isProgressiveFetchVideo(details, url, pathname) {
    const page = details.initiator || details.documentUrl || '';
    let pageHost;
    try {
        pageHost = new URL(page).hostname;
    } catch (e) {
        return false;
    }
    if (!/(^|\.)tiktok\.com$/i.test(pageHost)) return false;
    return pathname.includes('/video/tos/') && url.searchParams.get('mime_type') === 'video_mp4';
}

refreshResolvers();
createContextMenuItems();

// ---------------------------------------------------------------------------
// Install / settings
// ---------------------------------------------------------------------------

browser.runtime.onInstalled.addListener(async () => {
    const storedSettings = await browser.storage.sync.get([
        'briskPort',
        'briskResponseWaitEnabled',
        'briskCaptureEnabled',
        'briskVideoButtonEnabled',
    ]);
    const missingSettings = {};
    if (storedSettings.briskPort == null) missingSettings.briskPort = defaultSettings.port;
    if (storedSettings.briskResponseWaitEnabled == null) missingSettings.briskResponseWaitEnabled = defaultSettings.briskResponseWaitEnabled;
    if (storedSettings.briskCaptureEnabled == null) missingSettings.briskCaptureEnabled = defaultSettings.captureEnabled;
    if (storedSettings.briskVideoButtonEnabled == null) missingSettings.briskVideoButtonEnabled = defaultSettings.videoButtonEnabled;
    if (Object.keys(missingSettings).length > 0) await browser.storage.sync.set(missingSettings);
    // Older versions tried to keep the name resolvers in storage.sync, which exceeds its quota
    await browser.storage.sync.remove('briskM3u8NameResolver').catch(pass);
    await refreshResolvers(true);
});

// ---------------------------------------------------------------------------
// Per-tab video state. Kept in memory and mirrored to storage.session because
// the background service worker can be stopped at any time.
// ---------------------------------------------------------------------------

let state = null;
let stateLoading = null;
let persistTimer = null;
const pendingParses = new Map();

async function getState() {
    if (state) return state;
    if (!stateLoading) {
        stateLoading = browser.storage.session.get(STATE_KEY)
            .then(result => result[STATE_KEY])
            .catch(() => null)
            .then(stored => {
                state = stored && stored.tabs ? stored : {tabs: {}};
                return state;
            });
    }
    return stateLoading;
}

function persistState() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        browser.storage.session.set({[STATE_KEY]: state}).catch(pass);
    }, 300);
}

async function getTabState(tabId, create = true) {
    const s = await getState();
    if (!s.tabs[tabId] && create) {
        s.tabs[tabId] = {streams: [], subtitles: [], childUrls: []};
    }
    return s.tabs[tabId] || null;
}

async function resetTab(tabId) {
    const s = await getState();
    if (!s.tabs[tabId]) return;
    delete s.tabs[tabId];
    persistState();
    updateBadge(tabId, 0);
}

async function removeFrameStreams(tabId, frameId) {
    const tab = await getTabState(tabId, false);
    if (!tab) return;
    const before = tab.streams.length;
    tab.streams = tab.streams.filter(stream => stream.frameId !== frameId);
    tab.subtitles = tab.subtitles.filter(subtitle => subtitle.frameId !== frameId);
    if (tab.streams.length !== before) {
        persistState();
        notifyTab(tabId, tab);
    }
}

function visibleStreams(tab) {
    return tab.streams.filter(stream => !stream.hidden);
}

function updateBadge(tabId, count) {
    const text = count > 0 ? String(count) : '';
    browser.action.setBadgeText({tabId, text}).catch(pass);
    if (count > 0) {
        browser.action.setBadgeBackgroundColor({tabId, color: '#2E6BC5'}).catch(pass);
        browser.action.setBadgeTextColor?.({tabId, color: '#FFFFFF'})?.catch?.(pass);
    }
}

function notifyTab(tabId, tab) {
    updateBadge(tabId, visibleStreams(tab).length);
    browser.tabs.sendMessage(tabId, {type: 'brisk:streams-changed'}).catch(pass);
}

browser.tabs.onRemoved.addListener(tabId => resetTab(tabId));

browser.webRequest.onBeforeRequest.addListener((details) => {
    if (details.tabId < 0) return;
    if (details.type === 'main_frame') {
        resetTab(details.tabId);
    } else if (details.type === 'sub_frame') {
        removeFrameStreams(details.tabId, details.frameId);
    }
}, {urls: ['<all_urls>'], types: ['main_frame', 'sub_frame']});

// ---------------------------------------------------------------------------
// Stream detection
// ---------------------------------------------------------------------------

/** Referer header of in-flight requests, keyed by request id */
const requestReferers = new Map();

browser.webRequest.onSendHeaders.addListener((details) => {
    if (details.tabId < 0) return;
    const referer = details.requestHeaders?.find(h => h.name.toLowerCase() === 'referer');
    if (!referer) return;
    requestReferers.set(details.requestId, referer.value);
    if (requestReferers.size > 1000) {
        requestReferers.delete(requestReferers.keys().next().value);
    }
}, {
    urls: ['<all_urls>'],
    types: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'object', 'other'],
}, isFirefox ? ['requestHeaders'] : ['requestHeaders', 'extraHeaders']);

const forgetRequest = (details) => requestReferers.delete(details.requestId);
browser.webRequest.onCompleted.addListener(forgetRequest, {urls: ['<all_urls>']});
browser.webRequest.onErrorOccurred.addListener(forgetRequest, {urls: ['<all_urls>']});

browser.webRequest.onHeadersReceived.addListener((details) => {
    handleResponse(details).catch(e => console.warn('[Brisk] Failed to process response', e));
}, {
    urls: ['<all_urls>'],
    types: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'object', 'other'],
}, ['responseHeaders']);

function getHeader(headers, name) {
    const header = headers?.find(h => h.name.toLowerCase() === name);
    return header ? header.value : null;
}

function totalSize(headers) {
    const contentRange = getHeader(headers, 'content-range');
    const total = contentRange && /\/(\d+)$/.exec(contentRange);
    if (total) return Number(total[1]);
    const length = Number(getHeader(headers, 'content-length'));
    return length > 0 ? length : null;
}

function requestReferer(details) {
    return requestReferers.get(details.requestId)
        || details.documentUrl
        || (details.initiator && details.initiator !== 'null' ? details.initiator + '/' : null)
        || null;
}

async function handleResponse(details) {
    const {tabId, url, statusCode, type} = details;
    if (tabId < 0 || !isHttpUrl(url) || isLocalhostUrl(url)) return;
    if (statusCode && statusCode >= 400) return;
    if (isBlockedVideoUrl(url) || isBlockedVideoUrl(details.initiator || details.documentUrl || '')) return;

    let parsedUrl;
    let pathname;
    try {
        parsedUrl = new URL(url);
        pathname = parsedUrl.pathname.toLowerCase();
    } catch (e) {
        return;
    }
    const contentType = (getHeader(details.responseHeaders, 'content-type') || '').toLowerCase();
    if (contentType.startsWith('text/html')) return;

    if (contentType.includes('mpegurl') || pathname.endsWith('.m3u8')) {
        await addHlsStream(details, requestReferer(details));
        return;
    }
    if (contentType.startsWith('text/vtt') || pathname.endsWith('.vtt')) {
        await addSubtitle(details, requestReferer(details));
        return;
    }
    const looksLikeVideo = contentType.startsWith('video/') || DIRECT_VIDEO_EXTENSIONS.test(pathname);
    const isSegment = contentType.includes('mp2t') || contentType.includes('iso.segment') || pathname.endsWith('.m4s') || pathname.endsWith('.ts');
    if (!DIRECT_VIDEO_REQUEST_TYPES.has(type) && isProgressiveFetchVideo(details, parsedUrl, pathname)) {
        const size = totalSize(details.responseHeaders);
        if (size != null && size < MIN_DIRECT_VIDEO_SIZE) return;
        await addDirectVideo(details, requestReferer(details), contentType || 'video/mp4', size, true);
        return;
    }
    // Fetch/XHR video responses are almost always MSE segments, only elements loading a file are considered
    if (looksLikeVideo && !isSegment && DIRECT_VIDEO_REQUEST_TYPES.has(type)) {
        const size = totalSize(details.responseHeaders);
        if (size != null && size < MIN_DIRECT_VIDEO_SIZE) return;
        await addDirectVideo(details, requestReferer(details), contentType, size);
    }
}

function newStreamId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function addStream(tab, stream) {
    tab.streams.push(stream);
    if (tab.streams.length > MAX_STREAMS_PER_TAB) {
        tab.streams.splice(0, tab.streams.length - MAX_STREAMS_PER_TAB);
    }
}

async function addDirectVideo(details, referer, contentType, size, progressive = false) {
    const tab = await getTabState(details.tabId);
    const existing = tab.streams.find(stream => stream.url === details.url);
    if (existing) {
        existing.detectedAt = Date.now();
        persistState();
        return;
    }
    addStream(tab, {
        id: newStreamId(),
        kind: 'direct',
        url: details.url,
        referer,
        frameId: details.frameId,
        detectedAt: Date.now(),
        firstDetectedAt: Date.now(),
        progressive,
        contentType: contentType || null,
        size: size || null,
    });
    persistState();
    notifyTab(details.tabId, tab);
}

async function addSubtitle(details, referer) {
    const tab = await getTabState(details.tabId);
    if (tab.subtitles.some(subtitle => subtitle.url === details.url)) return;
    tab.subtitles.push({url: details.url, referer, frameId: details.frameId});
    if (tab.subtitles.length > 50) tab.subtitles.shift();
    persistState();
}

async function addHlsStream(details, referer) {
    const {tabId, url, frameId} = details;
    const tab = await getTabState(tabId);
    if (tab.childUrls.includes(url)) return;
    if (tab.streams.some(stream => stream.url === url)) return;

    const stream = {
        id: newStreamId(),
        kind: 'hls',
        url,
        referer,
        frameId,
        detectedAt: Date.now(),
        status: 'pending',
    };
    addStream(tab, stream);
    persistState();

    const parse = analyzeHlsStream(tabId, stream).finally(() => pendingParses.delete(stream.id));
    pendingParses.set(stream.id, parse);
    await parse;
}

async function analyzeHlsStream(tabId, stream) {
    let parsed = null;
    try {
        const response = await fetch(stream.url, {credentials: 'include'});
        if (response.ok) {
            parsed = parseM3u8(await response.text(), response.url || stream.url);
        }
    } catch (e) {
        // The CDN might require headers the extension can't send. Brisk can still try.
    }
    const tab = await getTabState(tabId, false);
    if (!tab) return;
    const current = tab.streams.find(s => s.id === stream.id);
    if (!current) return;

    if (!parsed) {
        current.status = 'unknown';
    } else if (parsed.isMaster) {
        current.status = 'ready';
        current.isMaster = true;
        current.isDrm = parsed.isDrm;
        current.variants = parsed.variants.map(v => ({
            url: v.url,
            bandwidth: v.bandwidth,
            width: v.width,
            height: v.height,
            hasSeparateAudio: !!v.audioGroup && parsed.audio.some(a => a.groupId === v.audioGroup),
        }));
        current.subtitleCount = parsed.subtitles.length;
        const children = childPlaylistUrls(parsed);
        tab.childUrls.push(...children);
        if (tab.childUrls.length > MAX_CHILD_URLS_PER_TAB) {
            tab.childUrls.splice(0, tab.childUrls.length - MAX_CHILD_URLS_PER_TAB);
        }
        const childSet = new Set(children);
        tab.streams = tab.streams.filter(s => !childSet.has(s.url));
    } else {
        if (tab.childUrls.includes(current.url)) {
            tab.streams = tab.streams.filter(s => s.id !== current.id);
        } else {
            current.status = 'ready';
            current.isMaster = false;
            current.isDrm = parsed.isDrm;
            current.isLive = parsed.isLive;
            current.duration = parsed.isLive ? null : Math.round(parsed.duration);
        }
    }
    // DRM protected streams can't be downloaded, so they are not offered at all
    tab.streams.forEach(s => s.hidden = !!s.isDrm);
    persistState();
    notifyTab(tabId, tab);
}

async function getStreams(message, sender) {
    const tabId = message.tabId ?? sender.tab?.id;
    if (tabId == null) return {streams: [], subtitles: []};
    const tab = await getTabState(tabId, false);
    if (!tab) return {streams: [], subtitles: []};

    const inScope = (item) => message.scope !== 'frame' || item.frameId === sender.frameId;
    const waiting = tab.streams.filter(inScope).map(s => pendingParses.get(s.id)).filter(Boolean);
    if (waiting.length > 0) {
        await Promise.race([Promise.allSettled(waiting), new Promise(r => setTimeout(r, 4000))]);
    }
    const fresh = await getTabState(tabId, false);
    if (!fresh) return {streams: [], subtitles: []};
    return {
        streams: visibleStreams(fresh).filter(inScope),
        subtitles: fresh.subtitles.filter(inScope).map(({url, referer}) => ({url, referer})),
    };
}

// ---------------------------------------------------------------------------
// Sending videos to Brisk
// ---------------------------------------------------------------------------

async function cookieHeaderFor(url) {
    try {
        const cookies = await browser.cookies.getAll({url});
        if (!cookies.length) return null;
        return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    } catch (e) {
        return null;
    }
}

async function getPageUrl(sender, tabId) {
    if (sender.tab?.id === tabId && sender.tab.url) return sender.tab.url;
    try {
        return (await browser.tabs.get(tabId)).url;
    } catch (e) {
        return null;
    }
}

async function downloadVideo(message, sender) {
    const item = message.item;
    const tabId = message.tabId ?? sender.tab?.id;
    if (!item || !isHttpUrl(item.url)) {
        return {ok: false, reason: 'error'};
    }
    const pageUrl = await getPageUrl(sender, tabId);
    let body;
    if (item.kind === 'hls') {
        const tab = tabId != null ? await getTabState(tabId, false) : null;
        body = {
            type: 'm3u8',
            m3u8Url: item.url,
            vttUrls: (tab?.subtitles || []).map(({url, referer}) => ({url, referer: referer || ''})),
            referer: pageUrl,
            refererHeader: item.referer || pageUrl,
            suggestedName: item.name || null,
            tabId,
        };
    } else {
        body = {
            type: 'single',
            data: {
                url: item.url,
                referer: item.referer || pageUrl,
                refererHeader: item.referer || pageUrl,
                suggestedName: item.name || null,
                userAgent: navigator.userAgent,
            },
        };
        const cookie = await cookieHeaderFor(item.url);
        if (cookie) body.data.cookie = cookie;
    }

    let response;
    try {
        response = await sendRequestToBrisk(body);
    } catch (e) {
        return {ok: false, reason: 'not-running'};
    }
    if (!response.ok) {
        return {ok: false, reason: 'error'};
    }
    try {
        const json = await response.json();
        if (json && json.captured === false) {
            return {ok: false, reason: 'rejected'};
        }
    } catch (e) {
        // Brisk accepted the request but didn't send a JSON body
    }
    return {ok: true};
}

async function getBriskStatus() {
    return {running: await isBriskRunning(1500), port: await getBriskPort()};
}

async function getVideoName(sender, tabId) {
    const id = tabId ?? sender.tab?.id;
    if (id == null) return null;
    try {
        return await browser.tabs.sendMessage(id, {type: 'brisk:get-page-video-name'}, {frameId: 0});
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

let selectionLinks = [];

browser.runtime.onMessage.addListener((message, sender) => {
    switch (message?.type) {
        case 'brisk:get-streams':
            return getStreams(message, sender);
        case 'brisk:download':
            return downloadVideo(message, sender);
        case 'brisk:status':
            return getBriskStatus();
        case 'brisk:x-media':
            return getMediaForTweets(message.tweetIds);
        case 'brisk:video-name':
            return getVideoName(sender, message.tabId);
        case 'brisk:selection-links':
            selectionLinks = Array.isArray(message.links) ? message.links.filter(isHttpUrl) : [];
            browser.storage.session.set({[SELECTION_KEY]: selectionLinks}).catch(pass);
            return;
        default:
            return;
    }
});

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "brisk-download-selection") {
        let links = selectionLinks;
        if (!links.length) {
            const stored = await browser.storage.session.get(SELECTION_KEY).catch(() => ({}));
            links = stored[SELECTION_KEY] || [];
        }
        const body = {
            "type": "multi",
            "data": {"referer": tab?.url, "downloadHrefs": links},
        };
        try {
            await sendRequestToBrisk(body);
        } catch (e) {
            console.error("Failed to send request to Brisk!");
        }
    }
    if (info.menuItemId === "brisk-download") {
        const body = {
            "type": "single",
            "data": {"referer": tab?.url, "url": info.linkUrl},
        };
        const cookie = await cookieHeaderFor(info.linkUrl);
        if (cookie) body.data.cookie = cookie;
        try {
            await sendRequestToBrisk(body);
        } catch (e) {
            console.error("Failed to send request to Brisk!");
        }
    }
});

function createContextMenuItems() {
    browser.contextMenus.removeAll().then(() => {
        browser.contextMenus.create({
            id: "brisk-download-selection", title: "Download selected links with Brisk", contexts: ["selection"]
        });
        browser.contextMenus.create({
            id: "brisk-download", title: "Download link with Brisk", contexts: ["link"]
        });
    }).catch(console.log);
}

// ---------------------------------------------------------------------------
// Browser download capture
// ---------------------------------------------------------------------------

browser.downloads.onCreated.addListener(sendBriskDownloadAdditionRequest);

async function sendBriskDownloadAdditionRequest(downloadItem) {
    // blob: and data: downloads are generated by the page and can't be fetched by Brisk
    if (!isHttpUrl(downloadItem.url) || isLocalhostUrl(downloadItem.url)) {
        return;
    }
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
    const cookie = await cookieHeaderFor(downloadItem.url);
    if (cookie) {
        body['data']['cookie'] = cookie;
    }
    let response;
    try {
        response = await sendRequestToBrisk(body);
    } catch (e) {
        return;
    }
    if (await isResponseWaitEnabled()) {
        let json;
        try {
            json = await response.json();
        } catch (e) {
            return;
        }
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

function pass() {
    return null;
}
