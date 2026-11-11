import * as browser from 'webextension-polyfill';
import {fileNameFromUrl, formatBitrate, isHttpUrl, qualityLabel, sanitizeFileName} from "../common";
import {details, isHlsUrl, itemsForStream} from "./stream-items";
import {generateVideoName} from "../m3u8-name-resolver";
import {findTweetIds, isXHost, matchTweetMedia} from "./x-page";
import {isTikTokHost, tiktokItems} from "./tiktok-page";
import {instagramItems, isInstagramHost} from "./instagram-page";

const pageHost = location.hostname.replace(/^www\./, '');
const isTopFrame = window.top === window;

/** How close (ms) a network stream must be to a video's load/play to be considered its source */
const ASSOCIATION_WINDOW_BEFORE = 4000;
const ASSOCIATION_WINDOW_AFTER = 30000;
const MAX_OTHER_ITEMS = 12;

async function getBaseName() {
    if (isTopFrame) {
        return await generateVideoName(pageHost);
    }
    try {
        const name = await browser.runtime.sendMessage({type: 'brisk:video-name'});
        if (name) return name;
    } catch (e) {
        // ignore, fall back to this frame's title
    }
    return sanitizeFileName(document.title);
}

export async function getPageVideoName() {
    return await generateVideoName(pageHost);
}

function directSourcesOf(video) {
    const urls = [];
    const push = (url) => {
        if (isHttpUrl(url) && !urls.includes(url)) urls.push(url);
    };
    push(video.currentSrc);
    if (video.getAttribute('src')) push(video.src);
    video.querySelectorAll('source[src]').forEach(source => push(source.src));
    return urls;
}

async function xItems(video) {
    const tweetIds = findTweetIds(video);
    if (tweetIds.length === 0) return null;
    let mediaList = [];
    try {
        mediaList = await browser.runtime.sendMessage({type: 'brisk:x-media', tweetIds});
    } catch (e) {
        return null;
    }
    const media = matchTweetMedia(video, mediaList);
    if (!media) return null;
    const base = sanitizeFileName([media.screenName, media.tweetId].filter(Boolean).join('_'));
    return media.variants.map(variant => {
        const label = media.type === 'animated_gif'
            ? 'GIF'
            : (qualityLabel(variant.width, variant.height) || formatBitrate(variant.bitrate) || 'Video');
        return {
            key: variant.url,
            kind: 'direct',
            label,
            detail: details('MP4', variant.width && variant.height ? `${variant.width}×${variant.height}` : null, formatBitrate(variant.bitrate)),
            url: variant.url,
            referer: 'https://x.com/',
            name: `${base}_${label}.mp4`,
        };
    });
}

/**
 * Picks the progressive MP4 (e.g. TikTok) a Media Source video plays: the file first
 * requested closest to the moment the video started loading its source. Players
 * preload upcoming videos, so only one file is matched.
 */
function matchProgressiveStream(streams, loadedAt, mseVideoCount) {
    if (streams.length === 0) return null;
    if (loadedAt != null) {
        let best = null;
        let bestDistance = Infinity;
        for (const stream of streams) {
            const seenAt = stream.firstDetectedAt ?? stream.detectedAt;
            if (seenAt < loadedAt - ASSOCIATION_WINDOW_BEFORE || seenAt > loadedAt + ASSOCIATION_WINDOW_AFTER) continue;
            const distance = Math.abs(seenAt - loadedAt);
            if (distance < bestDistance) {
                best = stream;
                bestDistance = distance;
            }
        }
        if (best) return best;
    }
    if (mseVideoCount <= 1) {
        return streams.reduce((a, b) => (b.detectedAt > a.detectedAt ? b : a));
    }
    return null;
}

/**
 * Collects the download options for a video element.
 * @param video the hovered <video>
 * @param context {lastActivity: number|null, loadStartedAt: number|null, mseVideoCount: number}
 * @returns {Promise<{sections: Array<{title: string, items: Array}>}>}
 */
export async function collectVideoOptions(video, context) {
    const [base, network, x, tiktok, instagram] = await Promise.all([
        getBaseName().catch(() => sanitizeFileName(document.title)),
        browser.runtime.sendMessage({type: 'brisk:get-streams', scope: 'frame'}).catch(() => ({streams: []})),
        isXHost(location.hostname) ? xItems(video).catch(() => null) : Promise.resolve(null),
        isTikTokHost(location.hostname) ? tiktokItems(video).catch(() => null) : Promise.resolve(null),
        isInstagramHost(location.hostname) ? instagramItems(video).catch(() => null) : Promise.resolve(null),
    ]);

    const thisVideo = [];
    const others = [];
    const seen = new Set();
    const add = (list, items) => {
        for (const item of items) {
            if (seen.has(item.key)) continue;
            seen.add(item.key);
            list.push(item);
        }
    };

    if (x && x.length) {
        add(thisVideo, x);
    }
    if (tiktok && tiktok.length) {
        add(thisVideo, tiktok);
    }
    if (instagram && instagram.length) {
        add(thisVideo, instagram);
    }

    for (const url of directSourcesOf(video)) {
        if (isHlsUrl(url)) {
            const stream = network.streams?.find(s => s.url === url);
            add(thisVideo, stream ? itemsForStream(stream, base) : itemsForStream({kind: 'hls', url, referer: location.href}, base));
        } else {
            const stream = network.streams?.find(s => s.url === url);
            add(thisVideo, itemsForStream(stream || {kind: 'direct', url, referer: location.href}, base));
        }
    }

    // On X, network HLS streams are skipped once the MP4 files are known: their audio is in a separate playlist
    // On TikTok, the files captured from the network are preloads of other posts once the post's own files are known
    const streams = (x && x.length ? [] : (network.streams || []))
        .filter(stream => !(tiktok && tiktok.length && stream.progressive))
        .slice()
        .sort((a, b) => b.detectedAt - a.detectedAt);
    // Streams loaded through Media Source Extensions (blob: sources) can only be
    // matched to their <video> by timing: the playlist is requested when playback starts.
    const {lastActivity, loadStartedAt, mseVideoCount} = context;
    const isMseVideo = (video.currentSrc || '').startsWith('blob:');
    const hasOwnSource = thisVideo.length > 0;
    const progressiveMatch = !hasOwnSource && isMseVideo
        ? matchProgressiveStream(streams.filter(s => s.progressive), loadStartedAt ?? lastActivity, mseVideoCount)
        : null;
    for (const stream of streams) {
        const belongsToVideo = stream === progressiveMatch || (!hasOwnSource && isMseVideo && stream.kind === 'hls' && (
            mseVideoCount <= 1 ||
            (lastActivity != null &&
                stream.detectedAt >= lastActivity - ASSOCIATION_WINDOW_BEFORE &&
                stream.detectedAt <= lastActivity + ASSOCIATION_WINDOW_AFTER)
        ));
        const items = itemsForStream(stream, base);
        if (!belongsToVideo) {
            // "Original quality" says nothing when listing several files: show the file name instead
            items.forEach(item => {
                if (item.kind === 'direct') item.label = fileNameFromUrl(item.url) || item.label;
            });
        }
        add(belongsToVideo ? thisVideo : others, items);
    }

    const sections = [];
    if (thisVideo.length) sections.push({title: 'This video', items: thisVideo});
    if (others.length) {
        sections.push({
            title: thisVideo.length ? 'Other videos on this page' : 'Detected on this page',
            items: others.slice(0, MAX_OTHER_ITEMS),
        });
    }
    return {sections};
}
