import * as browser from 'webextension-polyfill';
import {testResolver} from "./m3u8-name-resolver";

const hostname = window.location.hostname.replace(/^www\./, '');



async function injectDownloadButtonForVideo(video) {
    if (!video || !video.src || video.dataset.downloadButtonInjected) return;
    video.dataset.downloadButtonInjected = "true";

    const button = document.createElement("button");
    button.style.position = "absolute";
    button.style.top = "10px";
    button.style.left = "10px";
    button.style.zIndex = "9999";
    button.style.padding = "6px 10px";
    button.style.background = "rgba(0,0,0,0.7)";
    button.style.color = "white";
    button.style.border = "none";
    button.style.cursor = "pointer";
    button.style.fontSize = "14px";
    button.style.display = "inline-flex";
    button.style.alignItems = "center";
    button.style.gap = "6px";
    button.style.borderRadius = "6px";
    button.style.opacity = "0.85";
    button.style.userSelect = "none";

    // Fetch SVG content
    const response = await fetch(browser.runtime.getURL("images/brisk-logo.svg"));
    const svgText = await response.text();

    // Parse SVG string to DOM
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgText, "image/svg+xml");
    const svg = svgDoc.querySelector("svg");

    // Change fill color to #2E6BC5
    svg.querySelectorAll("path").forEach(path => {
        path.setAttribute("fill", "#2E6BC5");
    });

    svg.style.width = "16px";
    svg.style.height = "16px";
    svg.style.display = "block";
    svg.removeAttribute("width");
    svg.removeAttribute("height");

    button.appendChild(svg);

    // Add text
    const textNode = document.createTextNode("Download Video");
    button.appendChild(textNode);

    // Create cancel '×' icon
    const cancel = document.createElement("span");
    cancel.textContent = "×";
    cancel.style.marginLeft = "10px";
    cancel.style.marginBottom = "2px";
    cancel.style.fontWeight = "bold";
    cancel.style.cursor = "pointer";
    cancel.style.fontSize = "18px";
    cancel.style.lineHeight = "1";
    cancel.style.color = "white";
    cancel.style.display = "flex";
    cancel.style.alignItems = "center";
    cancel.style.justifyContent = "center";
    cancel.style.height = "100%";

    // Cancel click removes button only
    cancel.onclick = (e) => {
        e.stopPropagation();
        // Also remove the dropdown if open
        if (dropdown) dropdown.remove();
        button.remove();
    };

    button.appendChild(cancel);

    // Create dropdown container (hidden initially)
    const dropdown = document.createElement("div");
    dropdown.style.position = "absolute";
    dropdown.style.top = "100%";  // directly below button
    dropdown.style.left = "0";
    dropdown.style.background = "rgba(0,0,0,0.8)";
    dropdown.style.color = "white";
    dropdown.style.borderRadius = "6px";
    dropdown.style.marginTop = "6px";
    dropdown.style.minWidth = "160px";
    dropdown.style.boxShadow = "0 4px 10px rgba(0,0,0,0.4)";
    dropdown.style.display = "none"; // hide by default
    dropdown.style.flexDirection = "column";
    dropdown.style.zIndex = "10000";
    dropdown.style.userSelect = "none";
    dropdown.style.padding = "8px 0";




    browser.storage.session.get(`briskTab${tabId}`).then(result => {
        let value = result[keyyy] ?? {};
        let savedM3u8 = value['m3u8-cache'] || [];
        log("FETCHED THE CACHED M3U8");
        log(savedM3u8);
    });




    // Dummy items data
    const dummyVideos = [
        {name: "Video 1080p", resolution: "1920x1080", url: video.src},
        {name: "Video 720p", resolution: "1280x720", url: video.src},
        {name: "Video 480p", resolution: "854x480", url: video.src},
    ];

    dummyVideos.forEach(({name, resolution, url}) => {
        const item = document.createElement("div");
        item.textContent = `${name} (${resolution})`;
        item.style.padding = "8px 16px";
        item.style.cursor = "pointer";
        item.style.whiteSpace = "nowrap";
        item.style.fontSize = "13px";
        item.style.transition = "background-color 0.2s";
        item.style.textAlign = "left";   // <--- Add this line

        item.onmouseenter = () => {
            item.style.backgroundColor = "rgba(255,255,255,0.15)";
        };
        item.onmouseleave = () => {
            item.style.backgroundColor = "transparent";
        };
        item.onclick = (e) => {
            e.stopPropagation();
            const a = document.createElement("a");
            a.href = url;
            a.download = "";
            document.body.appendChild(a);
            a.click();
            a.remove();
            dropdown.style.display = "none";
        };

        dropdown.appendChild(item);
    });

    button.appendChild(dropdown);

    // Hover effect for button
    button.addEventListener("mouseenter", () => {
        button.style.opacity = "1";
    });
    button.addEventListener("mouseleave", () => {
        if (dropdown.style.display !== "block") {
            button.style.opacity = "0.85";
        }
    });

    // Toggle dropdown on button click (except cancel)
    button.onclick = (e) => {
        if (e.target === cancel) return; // ignore cancel click
        e.stopPropagation();
        if (dropdown.style.display === "block") {
            dropdown.style.display = "none";
            button.style.opacity = "0.85";
        } else {
            dropdown.style.display = "block";
            button.style.opacity = "1";
        }
    };

    // Close dropdown if clicking outside
    document.addEventListener("click", (e) => {
        if (!button.contains(e.target)) {
            dropdown.style.display = "none";
            button.style.opacity = "0.85";
        }
    });

    // Ensure container is positioned
    const parent = video.parentElement;
    if (getComputedStyle(parent).position === "static") {
        parent.style.position = "relative";
    }

    parent.appendChild(button);
}

function findAndInjectVideos() {
    const videos = document.querySelectorAll("video");
    videos.forEach(injectDownloadButtonForVideo);
}


const videoNameResolvers = {
    'aniwatchtv.to': resolve_aniWatchVideoName,
    'hianime.to': resolve_aniWatchVideoName,
    'aniplaynow.live': resolve_aniPlayVideoName,
    'openani.me': resolve_openAnime,
    [atob('aGFuaW1lLnR2')]: resolve_aGFuaW1lLnR2,
    [atob('aGVudGFpaGF2ZW4ueHh4')]: resolve_aGVudGFpaGF2ZW4ueHh4,
};

function resolve_aGVudGFpaGF2ZW4ueHh4() {
    const heading = document.querySelector('#chapter-heading');
    if (!heading) {
        return null;
    }
    const rawText = heading.textContent.trim();
    const parts = rawText.split('-').map(part => part.trim());
    if (parts.length === 2) {
        const titlePart = parts[0].replace(/\s+/g, '.');
        const episodePart = parts[1].replace(/\s+/g, '.');
        return `${titlePart}.${episodePart}`;
    }
    const cleaned = rawText
        .replace(/\s+/g, '.')
        .replace(/[^\w.-]/g, '');
    if (!cleaned) {
        return null;
    }
    return cleaned;
}

function resolve_openAnime() {
    let title = document.title
        .replaceAll("|", "")
        .replaceAll("OpenAnime", "")
        .trim();

    return title.endsWith('.') ? title.slice(0, -1) : title;
}

function resolve_aGFuaW1lLnR2() {
    const titleElement = document.querySelector('.tv-title');
    if (titleElement) {
        return titleElement.textContent.trim();
    }
}

function resolve_aniPlayVideoName() {
    const titleElement = document.querySelector('a[href*="/anime/info/"] span');
    const animeName = titleElement?.textContent.trim();
    const episodeElement = document.querySelector('span.font-medium.text-sm.md\\:text-white');
    const episodeNumber = episodeElement ? episodeElement.textContent.trim() : null;
    const epNum = episodeNumber ? episodeNumber.match(/\d+/)?.[0] : null;
    if (epNum == null) return animeName;
    const epNumPadded = epNum.toString().padStart(2, '0');
    return `${animeName}.${epNumPadded}`;
}

function resolve_aniWatchVideoName() {
    const animeName = document.querySelector('h2.film-name a')?.textContent?.trim() || null;
    const notice = document.querySelector('.server-notice strong b');
    if (!notice || !animeName) return null;
    const text = notice.textContent.trim(); // e.g. "Episode 2"
    const match = text.match(/\d+/);
    let epNum = match ? parseInt(match[0], 10) : null;
    if (epNum === null) return animeName;
    const epNumPadded = epNum.toString().padStart(2, '0');
    return `${animeName}.${epNumPadded}`;
}

export function log(log) {
    browser.runtime.sendMessage({
        type: 'log',
        payload: log,
    });
}

async function getSuggestedVideoName() {
    // testResolver(hostname, document);
    log(`Resolving video name for host ${hostname}....`);
    const resolver = videoNameResolvers[hostname];
    if (!resolver) return null;
    return resolver().replace(/[\\\/:*?"<>|=]/g, '.').replace(/\s+/g, '.');
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // if (message.type === 'm3u8-detected') {
    //     findAndInjectVideos();
    // }
    /// To prevent handling iframes (only handle the actual window)
    if (window.top !== window) {
        return;
    }
    if (message.type === 'get-suggested-video-name') {
        (async () => {
            const suggestedName = await getSuggestedVideoName();
            console.log(`THIS IS SUGGESTED NAME ${suggestedName}`);
            sendResponse(suggestedName);
        })();
        return true;
    }
    if (message.type === 'm3u8-detected') {
        log("M3U8 DETECTED yooo1");
        findAndInjectVideos();
    }

    // if (message.type === 'inject-download-video-button') {
    //     findAndInjectVideos();
    // }
});

function debounce(fn, delay) {
    let timer = null;
    return function () {
        let context = this, args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () {
            fn.apply(context, args);
        }, delay);
    };
}

document.addEventListener("selectionchange", debounce(function (event) {
    try {
        let extractedHrefs = getHrefOfAllSelectedLinks();
        sendHrefsToBackground(extractedHrefs);
    } catch (e) {
        console.log(e);
    }
}, 250));


function sendHrefsToBackground(hrefs) {
    browser.runtime.sendMessage(hrefs);
}

const getHrefOfAllSelectedLinks = () => getSelectedNodes()
    .filter(node => node.tagName === "A")
    .map(node => node.href);


function getSelectedNodes() {
    const selection = document.getSelection();
    const fragment = document.createDocumentFragment();
    const nodeList = [];

    for (let i = 0; i < selection.rangeCount; i++) {
        fragment.append(selection.getRangeAt(i).cloneContents());
    }

    const walker = document.createTreeWalker(fragment);
    let currentNode = walker.currentNode;
    while (currentNode) {
        nodeList.push(currentNode);
        currentNode = walker.nextNode();
    }

    return nodeList;
}
