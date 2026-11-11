/**
 * Runs in the page's main world on TikTok (content scripts can't see React's
 * properties on DOM nodes). Answers requests from the content script for the
 * post shown by a <video>: TikTok keeps the post data, including the URL of
 * every quality, in the props of the player's React components.
 */

const REQUEST_EVENT = 'brisk:tiktok-item-request';
const RESPONSE_EVENT = 'brisk:tiktok-item-response';
const PROBE_ATTRIBUTE = 'data-brisk-probe';
const MAX_FIBER_DEPTH = 40;

function fiberOf(element) {
    for (const key in element) {
        if (key.startsWith('__reactFiber$')) return element[key];
    }
    return null;
}

function isItem(value, wantedId) {
    return value && typeof value === 'object' && value.video && typeof value.video === 'object' &&
        value.id != null && (wantedId == null || String(value.id) === wantedId);
}

function findItem(video) {
    // The player wrapper's id ends with the post id: xgwrapper-<index>-<id>
    const wrapper = video.closest('[id^="xgwrapper-"]');
    const wantedId = wrapper ? (/-(\d{8,25})$/.exec(wrapper.id) || [])[1] ?? null : null;
    let element = wrapper || video.parentElement;
    while (element && !fiberOf(element)) element = element.parentElement;
    let fiber = element ? fiberOf(element) : null;
    for (let depth = 0; fiber && depth < MAX_FIBER_DEPTH; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (props && typeof props === 'object') {
            for (const key of Object.keys(props)) {
                if (isItem(props[key], wantedId)) return props[key];
            }
        }
    }
    return null;
}

function firstUrl(list) {
    return Array.isArray(list) ? list.find(url => typeof url === 'string' && /^https?:\/\//.test(url)) || null : null;
}

function summarize(item) {
    const video = item.video;
    const variants = [];
    for (const info of Array.isArray(video.bitrateInfo) ? video.bitrateInfo : []) {
        const url = firstUrl(info?.PlayAddr?.UrlList);
        if (!url) continue;
        variants.push({
            url,
            width: Number(info.PlayAddr.Width) || null,
            height: Number(info.PlayAddr.Height) || null,
            bitrate: Number(info.Bitrate) || null,
            codec: typeof info.CodecType === 'string' ? info.CodecType : null,
            size: Number(info.PlayAddr.DataSize) || null,
        });
    }
    if (variants.length === 0 && typeof video.playAddr === 'string' && /^https?:\/\//.test(video.playAddr)) {
        variants.push({
            url: video.playAddr,
            width: Number(video.width) || null,
            height: Number(video.height) || null,
            bitrate: Number(video.bitrate) || null,
            codec: typeof video.codecType === 'string' ? video.codecType : null,
            size: null,
        });
    }
    const author = typeof item.author === 'string' ? item.author : item.author?.uniqueId;
    return {
        id: String(item.id),
        author: typeof author === 'string' ? author : null,
        variants,
    };
}

document.addEventListener(REQUEST_EVENT, (event) => {
    const token = typeof event.detail === 'string' ? event.detail : null;
    if (!token) return;
    let result = null;
    try {
        const video = document.querySelector(`video[${PROBE_ATTRIBUTE}="${CSS.escape(token)}"]`);
        const item = video ? findItem(video) : null;
        if (item) result = summarize(item);
    } catch (e) {
        result = null;
    }
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {detail: JSON.stringify({token, item: result})}));
});
