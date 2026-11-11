import * as browser from 'webextension-polyfill';
import {isBlockedVideoHost, isVideoButtonEnabled} from "./common";
import {VideoOverlay} from "./lib/video-overlay";
import {getPageVideoName} from "./lib/video-sources";

const isTopFrame = window.top === window;

// ---------------------------------------------------------------------------
// Video download button
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((message) => {
    if (message?.type === 'brisk:get-page-video-name' && isTopFrame) {
        return getPageVideoName().catch(() => null);
    }
});

if (!isBlockedVideoHost(location.hostname)) {
    const overlay = new VideoOverlay();
    const apply = (enabled) => enabled ? overlay.enable() : overlay.disable();
    isVideoButtonEnabled().then(apply).catch(() => apply(true));
    browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && changes.briskVideoButtonEnabled) {
            apply(changes.briskVideoButtonEnabled.newValue !== false);
        }
    });
}

// ---------------------------------------------------------------------------
// "Download selected links with Brisk" context menu support
// ---------------------------------------------------------------------------

function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

document.addEventListener("selectionchange", debounce(function () {
    try {
        const selection = document.getSelection();
        if (!selection || selection.isCollapsed) return;
        const links = getHrefOfAllSelectedLinks();
        browser.runtime.sendMessage({type: 'brisk:selection-links', links}).catch(() => null);
    } catch (e) {
        console.log(e);
    }
}, 250));

const getHrefOfAllSelectedLinks = () => getSelectedNodes()
    .filter(node => node.tagName === "A" && node.href)
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
