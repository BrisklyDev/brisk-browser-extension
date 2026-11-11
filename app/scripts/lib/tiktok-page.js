/**
 * Content-script side of TikTok support: asks the main-world script
 * (tiktok-main.js) for the post a <video> shows, so the download options
 * belong to that exact video instead of one TikTok preloaded.
 */
import {formatBitrate, formatBytes, isHttpUrl, qualityLabel, sanitizeFileName} from "../common";
import {details} from "./stream-items";
import {requestFromMainWorld} from "./main-world";

const REQUEST_EVENT = 'brisk:tiktok-item-request';
const RESPONSE_EVENT = 'brisk:tiktok-item-response';

export function isTikTokHost(hostname) {
    return /(^|\.)tiktok\.com$/i.test(hostname);
}

function codecName(codec) {
    if (!codec) return null;
    if (/265|hevc|hvc/i.test(codec)) return 'H.265';
    if (/264|avc/i.test(codec)) return 'H.264';
    return codec.toUpperCase();
}

/** Download items for the TikTok post shown by the video, best quality first. Null if unknown. */
export async function tiktokItems(video) {
    const item = await requestFromMainWorld(video, REQUEST_EVENT, RESPONSE_EVENT);
    if (!item || !Array.isArray(item.variants)) return null;
    const base = sanitizeFileName([item.author, item.id].filter(Boolean).join('_')) || 'tiktok';
    const variants = item.variants
        .filter(variant => isHttpUrl(variant?.url))
        .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
    const result = [];
    for (const variant of variants) {
        const quality = qualityLabel(variant.width, variant.height) || formatBitrate(variant.bitrate) || 'Video';
        const codec = codecName(variant.codec);
        // Several entries can share a quality: keep them apart by codec and bitrate
        const label = codec ? `${quality} ${codec}` : quality;
        result.push({
            key: variant.url,
            kind: 'direct',
            label,
            detail: details('MP4', variant.width && variant.height ? `${variant.width}×${variant.height}` : null,
                formatBitrate(variant.bitrate), formatBytes(variant.size)),
            url: variant.url,
            referer: 'https://www.tiktok.com/',
            name: sanitizeFileName(`${base}_${label}`) + '.mp4',
        });
    }
    return result.length ? result : null;
}
