/**
 * Runs in the page's main world on Instagram (content scripts can't see React's
 * properties on DOM nodes). Answers requests from the content script for the
 * files of a <video>: Instagram's player component receives a list of
 * "implementations", one of which holds the progressive MP4 files (hdSrc and
 * sdSrc, with audio). The other holds a DASH manifest, which Brisk can't merge.
 */

const REQUEST_EVENT = 'brisk:instagram-item-request';
const RESPONSE_EVENT = 'brisk:instagram-item-response';
const PROBE_ATTRIBUTE = 'data-brisk-probe';
const MAX_FIBER_DEPTH = 30;

function fiberOf(element) {
    for (const key in element) {
        if (key.startsWith('__reactFiber$')) return element[key];
    }
    return null;
}

function isHttp(url) {
    return typeof url === 'string' && /^https?:\/\//.test(url);
}

function findSources(video) {
    let element = video;
    while (element && !fiberOf(element)) element = element.parentElement;
    let fiber = element ? fiberOf(element) : null;
    for (let depth = 0; fiber && depth < MAX_FIBER_DEPTH; depth++, fiber = fiber.return) {
        const implementations = fiber.memoizedProps?.implementations;
        if (!Array.isArray(implementations)) continue;
        const variants = [];
        for (const implementation of implementations) {
            const data = implementation?.data;
            if (!data || typeof data !== 'object') continue;
            if (isHttp(data.hdSrc)) variants.push({url: data.hdSrc, quality: 'HD'});
            if (isHttp(data.sdSrc) && data.sdSrc !== data.hdSrc) variants.push({url: data.sdSrc, quality: 'SD'});
        }
        // The first player component above the <video> is the one that plays it
        return variants;
    }
    return [];
}

document.addEventListener(REQUEST_EVENT, (event) => {
    const token = typeof event.detail === 'string' ? event.detail : null;
    if (!token) return;
    let result = null;
    try {
        const video = document.querySelector(`video[${PROBE_ATTRIBUTE}="${CSS.escape(token)}"]`);
        const variants = video ? findSources(video) : [];
        if (variants.length) result = {variants};
    } catch (e) {
        result = null;
    }
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {detail: JSON.stringify({token, item: result})}));
});
