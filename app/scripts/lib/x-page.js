/**
 * Content-script helpers for X (Twitter): finds the tweet a <video> belongs to
 * and matches it against media returned by the background script.
 */

export function isXHost(hostname) {
    return /(^|\.)(x|twitter)\.com$/i.test(hostname);
}

const STATUS_REGEX = /\/status(?:es)?\/(\d{5,25})/;

export function findTweetIds(video) {
    const ids = [];
    const add = (href) => {
        const match = href && STATUS_REGEX.exec(href);
        if (match && !ids.includes(match[1])) ids.push(match[1]);
    };
    const article = video.closest('article');
    if (article) {
        // The timestamp link of a tweet points to its status page
        article.querySelectorAll('a[href*="/status/"] time').forEach(time => add(time.closest('a')?.getAttribute('href')));
        article.querySelectorAll('a[href*="/status/"]').forEach(a => add(a.getAttribute('href')));
    }
    // Media viewer pages (/status/<id>/video/1) show the video outside of an article
    if (ids.length === 0) add(location.pathname);
    return ids.slice(0, 8);
}

function stripQuery(url) {
    return (url || '').split('?')[0];
}

/** Key shared by a media's thumbnail and its file names, e.g. the GIF id in tweet_video(_thumb)/<key> */
function gifKey(url) {
    const match = /tweet_video(?:_thumb)?\/([^./?]+)/.exec(url || '');
    return match ? match[1] : null;
}

export function matchTweetMedia(video, mediaList) {
    if (!mediaList || mediaList.length === 0) return null;
    const poster = video.getAttribute('poster') || '';
    const source = video.currentSrc || video.src || '';
    const match = mediaList.find(media =>
        (media.mediaId && (poster.includes(`/${media.mediaId}/`) || source.includes(`/${media.mediaId}/`))) ||
        (media.thumb && stripQuery(poster) === stripQuery(media.thumb)) ||
        (gifKey(media.thumb) && (gifKey(poster) === gifKey(media.thumb) || gifKey(source) === gifKey(media.thumb)))
    );
    if (match) return match;
    return mediaList.length === 1 ? mediaList[0] : null;
}
