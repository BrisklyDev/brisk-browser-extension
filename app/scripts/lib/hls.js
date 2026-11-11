/**
 * Minimal HLS (m3u8) playlist parser. Only reads what the extension needs to
 * present stream options: variants, alternative renditions, duration, live/DRM flags.
 */

const ATTRIBUTE_REGEX = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;

export function parseAttributes(input) {
    const attributes = {};
    let match;
    ATTRIBUTE_REGEX.lastIndex = 0;
    while ((match = ATTRIBUTE_REGEX.exec(input)) !== null) {
        let value = match[2];
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        attributes[match[1]] = value;
    }
    return attributes;
}

function resolveUrl(uri, baseUrl) {
    try {
        return new URL(uri, baseUrl).href;
    } catch (e) {
        return null;
    }
}

function parseResolution(resolution) {
    const match = /^(\d+)x(\d+)$/i.exec(resolution || '');
    return match ? {width: Number(match[1]), height: Number(match[2])} : {width: null, height: null};
}

function isDrmKey(attributes) {
    const method = (attributes.METHOD || '').toUpperCase();
    if (!method || method === 'NONE' || method === 'AES-128') return false;
    const keyFormat = (attributes.KEYFORMAT || 'identity').toLowerCase();
    // SAMPLE-AES with identity key format can still be decrypted, anything else is DRM
    return method !== 'SAMPLE-AES' || keyFormat !== 'identity';
}

/**
 * @returns {null | {
 *   isMaster: boolean,
 *   variants: Array<{url, bandwidth, width, height, codecs, frameRate, audioGroup}>,
 *   audio: Array<{url, groupId, name, language}>,
 *   subtitles: Array<{url, groupId, name, language}>,
 *   duration: number, segmentCount: number, isLive: boolean, isDrm: boolean, isEncrypted: boolean
 * }}
 */
export function parseM3u8(text, baseUrl) {
    if (typeof text !== 'string' || !text.trimStart().startsWith('#EXTM3U')) {
        return null;
    }
    const result = {
        isMaster: false,
        variants: [],
        audio: [],
        subtitles: [],
        duration: 0,
        segmentCount: 0,
        isLive: true,
        isDrm: false,
        isEncrypted: false,
    };
    let pendingStreamInf = null;
    const seenVariantUrls = new Set();

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            result.isMaster = true;
            pendingStreamInf = parseAttributes(line.substring('#EXT-X-STREAM-INF:'.length));
            continue;
        }
        if (line.startsWith('#EXT-X-MEDIA:')) {
            result.isMaster = true;
            const attributes = parseAttributes(line.substring('#EXT-X-MEDIA:'.length));
            if (!attributes.URI) continue;
            const rendition = {
                url: resolveUrl(attributes.URI, baseUrl),
                groupId: attributes['GROUP-ID'] || null,
                name: attributes.NAME || null,
                language: attributes.LANGUAGE || null,
            };
            if (!rendition.url) continue;
            if (attributes.TYPE === 'AUDIO') result.audio.push(rendition);
            if (attributes.TYPE === 'SUBTITLES') result.subtitles.push(rendition);
            continue;
        }
        if (line.startsWith('#EXT-X-SESSION-KEY:') || line.startsWith('#EXT-X-KEY:')) {
            const attributes = parseAttributes(line.substring(line.indexOf(':') + 1));
            const method = (attributes.METHOD || '').toUpperCase();
            if (method && method !== 'NONE') result.isEncrypted = true;
            if (isDrmKey(attributes)) result.isDrm = true;
            continue;
        }
        if (line.startsWith('#EXTINF:')) {
            result.duration += parseFloat(line.substring('#EXTINF:'.length)) || 0;
            result.segmentCount++;
            continue;
        }
        if (line === '#EXT-X-ENDLIST' || line.startsWith('#EXT-X-PLAYLIST-TYPE:VOD')) {
            result.isLive = false;
            continue;
        }
        if (line.startsWith('#')) {
            continue;
        }
        if (pendingStreamInf) {
            const url = resolveUrl(line, baseUrl);
            if (url && !seenVariantUrls.has(url)) {
                seenVariantUrls.add(url);
                const {width, height} = parseResolution(pendingStreamInf.RESOLUTION);
                result.variants.push({
                    url,
                    bandwidth: Number(pendingStreamInf['AVERAGE-BANDWIDTH'] || pendingStreamInf.BANDWIDTH) || 0,
                    width,
                    height,
                    codecs: pendingStreamInf.CODECS || null,
                    frameRate: Number(pendingStreamInf['FRAME-RATE']) || null,
                    audioGroup: pendingStreamInf.AUDIO || null,
                });
            }
            pendingStreamInf = null;
        }
    }

    if (result.isMaster) {
        result.isLive = false;
        result.variants.sort((a, b) =>
            (Math.min(b.width || 0, b.height || 0) - Math.min(a.width || 0, a.height || 0)) ||
            (b.bandwidth - a.bandwidth)
        );
    }
    return result;
}

/** All playlist URLs a master playlist points to (variants + renditions). */
export function childPlaylistUrls(parsed) {
    if (!parsed || !parsed.isMaster) return [];
    return [
        ...parsed.variants.map(v => v.url),
        ...parsed.audio.map(a => a.url),
        ...parsed.subtitles.map(s => s.url),
    ];
}
