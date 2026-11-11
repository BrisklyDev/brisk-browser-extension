/**
 * Asks a main-world script (e.g. tiktok-main.js, instagram-main.js) about a
 * <video>. Content scripts can't see the page's JS properties (such as React
 * props on DOM nodes), so the main-world script reads them and answers through
 * DOM events. The video is found by a one-time attribute token.
 */

const PROBE_ATTRIBUTE = 'data-brisk-probe';
const TIMEOUT_MS = 1000;

export function requestFromMainWorld(video, requestEvent, responseEvent) {
    const token = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
        const finish = (item) => {
            document.removeEventListener(responseEvent, onResponse);
            clearTimeout(timer);
            if (video.getAttribute(PROBE_ATTRIBUTE) === token) video.removeAttribute(PROBE_ATTRIBUTE);
            resolve(item);
        };
        const onResponse = (event) => {
            let data;
            try {
                data = JSON.parse(event.detail);
            } catch (e) {
                return;
            }
            if (data?.token === token) finish(data.item || null);
        };
        const timer = setTimeout(() => finish(null), TIMEOUT_MS);
        document.addEventListener(responseEvent, onResponse);
        video.setAttribute(PROBE_ATTRIBUTE, token);
        document.dispatchEvent(new CustomEvent(requestEvent, {detail: token}));
    });
}
