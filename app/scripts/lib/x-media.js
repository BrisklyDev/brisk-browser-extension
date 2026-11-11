/**
 * Resolves X (Twitter) video media to direct, progressive MP4 files.
 *
 * X streams videos as HLS with separate audio playlists, so downloading the
 * HLS variant alone gives a silent video. The public syndication endpoint
 * (the one used by embedded tweets) lists complete MP4 files with audio.
 * Runs in the background script, where host permissions allow the request.
 */

const SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result";
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function syndicationToken(tweetId) {
    return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function dimensionsFromUrl(url) {
    const match = /\/(\d{2,5})x(\d{2,5})\//.exec(url);
    return match ? {width: Number(match[1]), height: Number(match[2])} : {width: null, height: null};
}

/** ext_tw_video(_thumb)/<id>/ and amplify_video(_thumb)/<id>/ URLs carry the media id */
function mediaIdFromUrl(url) {
    const match = /\/(?:ext_tw_video|amplify_video)(?:_thumb)?\/(\d+)\//.exec(url || '');
    return match ? match[1] : null;
}

function normalizeMedia(tweet) {
    const media = [];
    for (const item of tweet?.mediaDetails || []) {
        if (item.type !== 'video' && item.type !== 'animated_gif') continue;
        const variants = (item.video_info?.variants || [])
            .filter(v => v.content_type === 'video/mp4' && v.url)
            .map(v => ({url: v.url, bitrate: v.bitrate || 0, ...dimensionsFromUrl(v.url)}))
            .sort((a, b) => b.bitrate - a.bitrate);
        if (variants.length === 0) continue;
        media.push({
            mediaId: item.id_str || mediaIdFromUrl(item.media_url_https) || mediaIdFromUrl(variants[0].url),
            tweetId: tweet.id_str,
            screenName: tweet.user?.screen_name || null,
            type: item.type,
            thumb: item.media_url_https || null,
            durationMs: item.video_info?.duration_millis || null,
            aspectRatio: item.video_info?.aspect_ratio || null,
            variants,
        });
    }
    return media;
}

async function fetchTweet(tweetId) {
    const url = `${SYNDICATION_URL}?id=${tweetId}&lang=en&token=${syndicationToken(tweetId)}`;
    const response = await fetch(url, {credentials: 'omit'});
    if (!response.ok) {
        throw new Error(`Syndication request failed with ${response.status}`);
    }
    return await response.json();
}

export async function getTweetMedia(tweetId) {
    if (!/^\d{1,25}$/.test(String(tweetId))) return [];
    const cached = cache.get(tweetId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached.media;
    }
    let media = [];
    try {
        const tweet = await fetchTweet(tweetId);
        media = [...normalizeMedia(tweet), ...normalizeMedia(tweet?.quoted_tweet)];
    } catch (e) {
        // Private, deleted or age restricted tweets are not available through syndication
        media = [];
    }
    cache.set(tweetId, {at: Date.now(), media});
    if (cache.size > 200) {
        cache.delete(cache.keys().next().value);
    }
    return media;
}

export async function getMediaForTweets(tweetIds) {
    const ids = [...new Set((tweetIds || []).map(String))].slice(0, 8);
    const results = await Promise.all(ids.map(getTweetMedia));
    const byMediaId = new Map();
    for (const media of results.flat()) {
        const key = media.mediaId || media.thumb || media.variants[0].url;
        if (!byMediaId.has(key)) byMediaId.set(key, media);
    }
    return [...byMediaId.values()];
}
