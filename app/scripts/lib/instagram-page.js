/**
 * Content-script side of Instagram support: asks the main-world script
 * (instagram-main.js) for the MP4 files of the hovered <video>. Instagram plays
 * videos through Media Source Extensions with separate audio and video tracks,
 * so nothing useful can be picked up from the network.
 */
import {isHttpUrl, sanitizeFileName} from "../common";
import {details} from "./stream-items";
import {requestFromMainWorld} from "./main-world";

const REQUEST_EVENT = 'brisk:instagram-item-request';
const RESPONSE_EVENT = 'brisk:instagram-item-response';
const SHORTCODE_REGEX = /\/(?:p|reels?|tv)\/([A-Za-z0-9_-]{5,})/;

export function isInstagramHost(hostname) {
    return /(^|\.)instagram\.com$/i.test(hostname);
}

/** The post's shortcode, from the post link of a feed post or from the page URL of the playing video */
function shortcodeFor(video) {
    const article = video.closest('article');
    if (article) {
        for (const link of article.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) {
            const match = SHORTCODE_REGEX.exec(link.getAttribute('href') || '');
            if (match) return match[1];
        }
    }
    // On /reels/<code>/ and /p/<code>/ pages the URL follows the video that is playing
    if (!video.paused) {
        const match = SHORTCODE_REGEX.exec(location.pathname);
        if (match && match[1] !== 'audio') return match[1];
    }
    return null;
}

function fileStem(url) {
    try {
        return new URL(url).pathname.split('/').pop().replace(/\.[a-z0-9]+$/i, '').slice(0, 16);
    } catch (e) {
        return null;
    }
}

/** Download items for the hovered Instagram video. Null if unknown. */
export async function instagramItems(video) {
    const item = await requestFromMainWorld(video, REQUEST_EVENT, RESPONSE_EVENT);
    if (!item || !Array.isArray(item.variants)) return null;
    const variants = item.variants.filter(variant => isHttpUrl(variant?.url));
    if (variants.length === 0) return null;
    const base = sanitizeFileName(`instagram_${shortcodeFor(video) || fileStem(variants[0].url) || Date.now()}`);
    return variants.map(variant => ({
        key: variant.url,
        kind: 'direct',
        label: variant.quality === 'SD' ? 'SD' : 'Original quality',
        detail: details('MP4', variant.quality),
        url: variant.url,
        referer: 'https://www.instagram.com/',
        name: variants.length > 1 ? `${base}_${variant.quality}.mp4` : `${base}.mp4`,
    }));
}
