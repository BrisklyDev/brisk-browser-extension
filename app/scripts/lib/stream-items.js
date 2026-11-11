import {
    fileNameFromUrl,
    formatBitrate,
    formatBytes,
    formatDuration,
    getExtension,
    qualityLabel,
    sanitizeFileName,
} from "../common";

/**
 * Turns streams detected by the background script into downloadable items
 * (one per quality). Shared by the in-page button and the popup.
 */

export function buildName(base, label, url, defaultExtension) {
    const extension = defaultExtension || getExtension(url) || 'mp4';
    const fallback = (fileNameFromUrl(url) || 'video').replace(/\.[a-z0-9]{2,5}$/i, '');
    const name = sanitizeFileName([base || fallback, label].filter(Boolean).join(' - '));
    return `${name || 'video'}.${extension}`;
}

export function isHlsUrl(url) {
    try {
        return new URL(url).pathname.toLowerCase().endsWith('.m3u8');
    } catch (e) {
        return false;
    }
}

export function details(...parts) {
    return parts.filter(Boolean).join(' · ');
}

export function itemsForStream(stream, base) {
    if (stream.kind === 'direct') {
        const extension = getExtension(stream.url) || (stream.contentType || '').split('/')[1]?.split(';')[0] || 'mp4';
        return [{
            key: stream.url,
            kind: 'direct',
            label: 'Original quality',
            detail: details(extension.toUpperCase(), formatBytes(stream.size)),
            url: stream.url,
            referer: stream.referer,
            name: buildName(base, null, stream.url, extension),
            detectedAt: stream.detectedAt,
            firstDetectedAt: stream.firstDetectedAt ?? stream.detectedAt,
            progressive: !!stream.progressive,
        }];
    }
    if (stream.isMaster && stream.variants?.length) {
        return stream.variants.map(variant => {
            const label = qualityLabel(variant.width, variant.height) || formatBitrate(variant.bandwidth) || 'Stream';
            return {
                key: variant.url,
                kind: 'hls',
                label,
                detail: details('HLS', variant.width && variant.height ? `${variant.width}×${variant.height}` : null, formatBitrate(variant.bandwidth)),
                url: variant.url,
                referer: stream.referer,
                name: buildName(base, label, variant.url, 'ts'),
                detectedAt: stream.detectedAt,
            };
        });
    }
    return [{
        key: stream.url,
        kind: 'hls',
        label: stream.isLive ? 'Live stream' : 'Stream',
        detail: details('HLS', stream.isLive ? 'Live' : formatDuration(stream.duration)),
        url: stream.url,
        referer: stream.referer,
        name: buildName(base, null, stream.url, 'ts'),
        detectedAt: stream.detectedAt,
    }];
}

