import * as browser from 'webextension-polyfill';
import {BRISK_DOWNLOAD_URL} from "../common";
import {collectVideoOptions} from "./video-sources";
import {OVERLAY_STYLES} from "./video-overlay-styles";

const MIN_VIDEO_WIDTH = 200;
const MIN_VIDEO_HEIGHT = 110;
const HIDE_DELAY_MS = 900;
const BUTTON_INSET = 12;
const MENU_WIDTH = 304;
const POINTER_CHECK_INTERVAL_MS = 80;
const SHADOW_SCAN_INTERVAL_MS = 400;

const LOGO_PATH = "M35.48.09c.95,0,1.62.63,1.36,1.27l-7.32,17.31c-.25.62.42,1.26,1.36,1.26l16.35.09c.94.01,1.62.63,1.36,1.27l-10.9,25.85h14.78c.93,0,1.38.78.73,1.22l-25.73,17.19c-.4.26-1.03.26-1.42,0L.32,48.37c-.68-.44-.21-1.22.71-1.22h15.6s.04-.08.05-.13l7.3-17.31c.25-.62-.42-1.26-1.36-1.26l-16.35-.09c-.94,0-1.61-.63-1.36-1.26L16.05.71C16.23.28,16.8,0,17.43,0l18.05.09Z";

const ICONS = {
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

const STOPPED_EVENTS = ['click', 'dblclick', 'auxclick', 'contextmenu', 'pointerdown', 'pointerup', 'mousedown', 'mouseup',
    'touchstart', 'touchend', 'keydown', 'keyup', 'keypress', 'wheel', 'focusin', 'focusout'];

function svgIcon(name) {
    const template = document.createElement('template');
    // Static, extension-defined markup only
    template.innerHTML = ICONS[name];
    return template.content.firstElementChild;
}

function logoIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 53.5 65.75');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', LOGO_PATH);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
}

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
}

function isEligible(video) {
    if (!video || !video.isConnected) return false;
    const rect = video.getBoundingClientRect();
    if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) return false;
    const style = getComputedStyle(video);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
}

function containsPoint(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Shows a "Download" button over the video under the mouse pointer.
 * The UI lives in a closed shadow root inside a single host element attached to
 * <html> (in the top layer when popovers are supported), so it is not affected by
 * the page's CSS, stacking contexts, overflow clipping or framework re-renders.
 */
export class VideoOverlay {
    constructor() {
        this.enabled = false;
        this.videos = document.getElementsByTagName('video');
        this.shadowVideos = new Set();
        this.activity = new WeakMap();
        this.loadStarts = new WeakMap();
        this.dismissed = new WeakSet();
        this.itemStates = new Map();
        this.activeVideo = null;
        this.visible = false;
        this.menuOpen = false;
        this.pointer = {x: -1, y: -1, inside: false};
        this.overUi = false;
        this.hideTimer = null;
        this.frame = null;
        this.moveScheduled = false;
        this.renderToken = 0;
        this.briskRunning = null;

        this.onPointerMove = this.onPointerMove.bind(this);
        this.onScroll = this.onScroll.bind(this);
        this.onPointerLeaveWindow = this.onPointerLeaveWindow.bind(this);
        this.onMediaActivity = this.onMediaActivity.bind(this);
        this.onOutsidePointerDown = this.onOutsidePointerDown.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onFullscreenChange = this.onFullscreenChange.bind(this);
        this.onMessage = this.onMessage.bind(this);
        this.tick = this.tick.bind(this);
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        window.addEventListener('pointermove', this.onPointerMove, {capture: true, passive: true});
        // Scrolling (e.g. an X/Twitter feed) moves videos under a still pointer without any pointermove
        window.addEventListener('scroll', this.onScroll, {capture: true, passive: true});
        // Not a capture listener on document: that would fire whenever the pointer leaves any element
        document.documentElement.addEventListener('mouseleave', this.onPointerLeaveWindow, {passive: true});
        window.addEventListener('blur', this.onPointerLeaveWindow, {passive: true});
        window.addEventListener('pointerdown', this.onOutsidePointerDown, {capture: true, passive: true});
        window.addEventListener('keydown', this.onKeyDown, {capture: true});
        document.addEventListener('fullscreenchange', this.onFullscreenChange, {passive: true});
        for (const type of ['loadstart', 'play', 'playing']) {
            document.addEventListener(type, this.onMediaActivity, {capture: true, passive: true});
        }
        browser.runtime.onMessage.addListener(this.onMessage);
    }

    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        window.removeEventListener('pointermove', this.onPointerMove, {capture: true});
        window.removeEventListener('scroll', this.onScroll, {capture: true});
        document.documentElement.removeEventListener('mouseleave', this.onPointerLeaveWindow);
        window.removeEventListener('blur', this.onPointerLeaveWindow);
        window.removeEventListener('pointerdown', this.onOutsidePointerDown, {capture: true});
        window.removeEventListener('keydown', this.onKeyDown, {capture: true});
        document.removeEventListener('fullscreenchange', this.onFullscreenChange);
        for (const type of ['loadstart', 'play', 'playing']) {
            document.removeEventListener(type, this.onMediaActivity, {capture: true});
        }
        browser.runtime.onMessage.removeListener(this.onMessage);
        this.hide(true);
        this.host?.remove();
        this.host = null;
    }

    // ----------------------------------------------------------------- DOM

    ensureHost() {
        if (this.host) {
            if (!this.host.isConnected) this.attachHost();
            return;
        }
        const host = document.createElement('brisk-video-overlay');
        const hostStyles = {
            all: 'initial',
            position: 'fixed',
            inset: '0 auto auto 0',
            width: '0',
            height: '0',
            margin: '0',
            padding: '0',
            border: '0',
            background: 'transparent',
            overflow: 'visible',
            'z-index': '2147483647',
            'pointer-events': 'none',
            display: 'block',
        };
        for (const [property, value] of Object.entries(hostStyles)) {
            host.style.setProperty(property, value, 'important');
        }
        this.usePopover = typeof host.showPopover === 'function';
        if (this.usePopover) host.setAttribute('popover', 'manual');

        const root = host.attachShadow({mode: 'closed'});
        const style = document.createElement('style');
        style.textContent = OVERLAY_STYLES;
        root.appendChild(style);

        const wrap = el('div', 'wrap');
        const bar = el('div', 'bar');
        const pill = el('button', 'pill');
        pill.type = 'button';
        pill.setAttribute('aria-haspopup', 'menu');
        pill.setAttribute('aria-expanded', 'false');
        pill.title = 'Download this video with Brisk';
        const logo = el('span', 'logo');
        logo.appendChild(logoIcon());
        pill.append(logo, el('span', 'pill-label', 'Download'));
        const dismiss = el('button', 'dismiss');
        dismiss.type = 'button';
        dismiss.title = 'Hide for this video';
        dismiss.setAttribute('aria-label', 'Hide the download button for this video');
        dismiss.appendChild(svgIcon('close'));
        bar.append(pill, dismiss);

        const menu = el('div', 'menu');
        menu.setAttribute('role', 'menu');
        menu.hidden = true;
        wrap.append(bar, menu);
        root.appendChild(wrap);

        pill.addEventListener('click', () => this.menuOpen ? this.closeMenu() : this.openMenu());
        dismiss.addEventListener('click', () => {
            if (this.activeVideo) this.dismissed.add(this.activeVideo);
            this.hide(true);
        });
        wrap.addEventListener('pointerenter', () => {
            this.overUi = true;
            this.cancelHide();
        });
        wrap.addEventListener('pointerleave', () => {
            this.overUi = false;
        });
        for (const type of STOPPED_EVENTS) {
            host.addEventListener(type, e => e.stopPropagation());
        }

        this.host = host;
        this.ui = {root, wrap, bar, pill, dismiss, menu};
        this.attachHost();
    }

    attachHost() {
        const fullscreenElement = document.fullscreenElement;
        const parent = !this.usePopover && fullscreenElement && fullscreenElement.tagName !== 'VIDEO'
            ? fullscreenElement
            : document.documentElement;
        parent.appendChild(this.host);
        this.raise();
    }

    /** Moves the overlay to the top of the top layer (above dialogs and fullscreen elements). */
    raise() {
        if (!this.usePopover || !this.host?.isConnected) return;
        try {
            if (this.host.matches(':popover-open')) this.host.hidePopover();
            this.host.showPopover();
        } catch (e) {
            this.usePopover = false;
        }
    }

    // -------------------------------------------------------------- events

    onMessage(message) {
        if (message?.type === 'brisk:streams-changed' && this.menuOpen) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = setTimeout(() => this.renderMenu(false), 400);
        }
    }

    onMediaActivity(event) {
        if (event.target instanceof HTMLVideoElement) {
            this.activity.set(event.target, Date.now());
            if (event.type === 'loadstart') this.loadStarts.set(event.target, Date.now());
            // A video that appears or starts playing under a still pointer should get the button too
            if (this.pointer.inside) this.schedulePointerCheck();
        }
    }

    onPointerMove(event) {
        this.pointer.x = event.clientX;
        this.pointer.y = event.clientY;
        this.pointer.inside = true;
        this.schedulePointerCheck();
    }

    onScroll() {
        if (this.pointer.inside) this.schedulePointerCheck();
    }

    schedulePointerCheck() {
        if (this.moveScheduled) return;
        this.moveScheduled = true;
        // Hit-testing on every mouse move is wasteful on heavy pages: check at most every 80ms
        setTimeout(() => {
            this.moveScheduled = false;
            this.handlePointer();
        }, POINTER_CHECK_INTERVAL_MS);
    }

    onPointerLeaveWindow() {
        this.pointer.inside = false;
        if (!this.menuOpen) this.scheduleHide();
    }

    onOutsidePointerDown(event) {
        if (!this.menuOpen || !this.host) return;
        if (!event.composedPath().includes(this.host)) this.closeMenu();
    }

    onKeyDown(event) {
        if (event.key === 'Escape' && this.menuOpen) {
            this.closeMenu();
            this.ui.pill.focus();
        }
    }

    onFullscreenChange() {
        if (!this.host) return;
        if (this.usePopover) {
            this.raise();
        } else {
            this.attachHost();
        }
    }

    handlePointer() {
        if (!this.enabled) return;
        if (this.overUi || this.menuOpen) return;
        const video = this.videoAt(this.pointer.x, this.pointer.y);
        if (video && !this.dismissed.has(video)) {
            if (video !== this.activeVideo || !this.visible) this.show(video);
            this.cancelHide();
        } else if (this.visible) {
            this.scheduleHide();
        }
    }

    /** Finds the top-most eligible <video> under the given point. */
    videoAt(x, y) {
        if (x < 0 || y < 0) return null;
        // Pages without any <video> in the light DOM only get an occasional scan for shadow DOM players
        if (this.videos.length === 0 && this.shadowVideos.size === 0) {
            const now = Date.now();
            if (now - (this.lastShadowScan || 0) < SHADOW_SCAN_INTERVAL_MS) return null;
            this.lastShadowScan = now;
        }
        const stack = document.elementsFromPoint(x, y);
        const depth = new Map();
        for (let i = 0; i < stack.length && i < 60; i++) {
            const element = stack[i];
            if (element === this.host) continue;
            depth.set(element, i);
            if (element instanceof HTMLVideoElement) {
                if (isEligible(element)) return element;
                continue;
            }
            if (element.shadowRoot) {
                for (const inner of element.shadowRoot.elementsFromPoint(x, y)) {
                    if (inner instanceof HTMLVideoElement && isEligible(inner)) {
                        this.shadowVideos.add(inner);
                        return inner;
                    }
                }
            }
        }
        // Videos with pointer-events: none are not part of the hit-test stack:
        // pick the one whose closest ancestor is highest in the stack.
        let best = null;
        let bestDepth = Infinity;
        const consider = (video) => {
            if (!video.isConnected || !containsPoint(video.getBoundingClientRect(), x, y) || !isEligible(video)) return;
            let node = video.parentElement;
            while (node && !depth.has(node)) node = node.parentElement;
            const d = node ? depth.get(node) : Infinity;
            if (d < bestDepth || best === null) {
                best = video;
                bestDepth = d;
            }
        };
        for (const video of this.videos) consider(video);
        for (const video of this.shadowVideos) {
            if (!video.isConnected) this.shadowVideos.delete(video);
            else consider(video);
        }
        return best;
    }

    // ------------------------------------------------------------ visibility

    show(video) {
        this.ensureHost();
        if (this.activeVideo !== video) {
            this.closeMenu();
        }
        this.activeVideo = video;
        this.visible = true;
        this.ui.wrap.classList.add('visible');
        this.position();
        if (!this.frame) this.frame = requestAnimationFrame(this.tick);
    }

    hide(immediate = false) {
        this.cancelHide();
        this.closeMenu();
        this.visible = false;
        this.ui?.wrap.classList.remove('visible');
        if (immediate) this.activeVideo = null;
        if (this.frame) {
            cancelAnimationFrame(this.frame);
            this.frame = null;
        }
    }

    scheduleHide() {
        if (this.hideTimer || !this.visible) return;
        this.hideTimer = setTimeout(() => {
            this.hideTimer = null;
            if (this.overUi || this.menuOpen) return;
            const rect = this.activeVideo?.getBoundingClientRect();
            if (this.pointer.inside && rect && containsPoint(rect, this.pointer.x, this.pointer.y)) return;
            this.hide();
        }, HIDE_DELAY_MS);
    }

    cancelHide() {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
    }

    tick() {
        this.frame = null;
        if (!this.visible || !this.enabled) return;
        if (!this.activeVideo || !this.activeVideo.isConnected) {
            this.hide(true);
            return;
        }
        if (!this.position()) {
            this.hide();
            return;
        }
        this.frame = requestAnimationFrame(this.tick);
    }

    /** Places the button in the video's top-left corner. Returns false if the video is off-screen. */
    position() {
        const rect = this.activeVideo.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
        const visibleTop = Math.max(rect.top, 0);
        const visibleBottom = Math.min(rect.bottom, viewportHeight);
        const visibleLeft = Math.max(rect.left, 0);
        const visibleRight = Math.min(rect.right, viewportWidth);
        if (visibleBottom - visibleTop < 48 || visibleRight - visibleLeft < 120) {
            return false;
        }
        const left = Math.round(visibleLeft + BUTTON_INSET);
        const top = Math.round(visibleTop + BUTTON_INSET);
        const wrap = this.ui.wrap;
        if (wrap._left !== left || wrap._top !== top) {
            wrap.style.transform = `translate(${left}px, ${top}px)`;
            wrap._left = left;
            wrap._top = top;
        }
        if (this.menuOpen) {
            const menu = this.ui.menu;
            const menuHeight = menu.offsetHeight || 200;
            const spaceBelow = viewportHeight - (top + 40);
            menu.classList.toggle('above', spaceBelow < Math.min(menuHeight, 240) && top > spaceBelow);
            menu.classList.toggle('align-right', left + MENU_WIDTH > viewportWidth - 8);
            menu.style.maxHeight = `${Math.max(160, Math.min(380, menu.classList.contains('above') ? top - 16 : spaceBelow - 12))}px`;
        }
        return true;
    }

    // ----------------------------------------------------------------- menu

    openMenu() {
        if (!this.activeVideo) return;
        this.menuOpen = true;
        this.ui.menu.hidden = false;
        this.ui.wrap.classList.add('open');
        this.ui.pill.setAttribute('aria-expanded', 'true');
        this.raise();
        this.renderMenu(true);
        this.position();
    }

    closeMenu() {
        if (!this.menuOpen) return;
        this.menuOpen = false;
        this.renderToken++;
        this.ui.menu.hidden = true;
        this.ui.wrap.classList.remove('open');
        this.ui.pill.setAttribute('aria-expanded', 'false');
    }

    async renderMenu(showLoading) {
        const token = ++this.renderToken;
        const video = this.activeVideo;
        const menu = this.ui.menu;
        if (showLoading) {
            menu.replaceChildren(this.renderLoading());
        }
        const context = {
            lastActivity: this.activity.get(video) ?? null,
            loadStartedAt: this.loadStarts.get(video) ?? null,
            mseVideoCount: [...this.videos, ...this.shadowVideos]
                .filter(v => isEligible(v) && (v.currentSrc || '').startsWith('blob:')).length,
        };
        const [options, status] = await Promise.all([
            collectVideoOptions(video, context).catch(() => ({sections: []})),
            browser.runtime.sendMessage({type: 'brisk:status'}).catch(() => ({running: false})),
        ]);
        if (token !== this.renderToken || !this.menuOpen) return;
        this.briskRunning = !!status?.running;

        const children = [];
        if (options.sections.length === 0) {
            children.push(this.renderEmpty());
        } else {
            const body = el('div', 'body');
            for (const section of options.sections) {
                body.appendChild(el('div', 'section-title', section.title));
                for (const item of section.items) body.appendChild(this.renderItem(item));
            }
            children.push(body);
        }
        if (!this.briskRunning) children.push(this.renderNotRunning());
        menu.replaceChildren(...children);
        this.position();
    }

    renderLoading() {
        return el('div', 'loading', 'Looking for video sources…');
    }

    renderEmpty() {
        const empty = el('div', 'empty');
        empty.appendChild(el('div', 'empty-title', 'No downloadable video found yet'));
        empty.appendChild(el('div', 'empty-text', 'Start playing the video, then open this menu again. Protected (DRM) videos can\'t be downloaded.'));
        return empty;
    }

    renderNotRunning() {
        const notice = el('div', 'notice');
        const text = el('div', 'notice-text');
        text.append(el('strong', null, 'Brisk isn\'t running. '), document.createTextNode('Start the Brisk app to download, or '));
        const link = el('a', null, 'get Brisk');
        link.href = BRISK_DOWNLOAD_URL;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        text.append(link, document.createTextNode('.'));
        notice.appendChild(text);
        return notice;
    }

    renderItem(item) {
        const row = el('button', 'item');
        row.type = 'button';
        row.setAttribute('role', 'menuitem');
        row.title = item.name;
        const text = el('span', 'item-text');
        text.append(el('span', 'item-label', item.label), el('span', 'item-detail', item.detail || ''));
        const action = el('span', 'item-action');
        row.append(text, action);
        this.applyItemState(row, action, this.itemStates.get(item.key) || 'idle');
        row.addEventListener('click', () => this.download(item, row, action));
        return row;
    }

    applyItemState(row, action, state) {
        row.dataset.state = state;
        action.replaceChildren();
        switch (state) {
            case 'sending':
                action.appendChild(el('span', 'spinner'));
                break;
            case 'done':
                action.append(el('span', 'action-text', 'Started'));
                break;
            case 'not-running':
                action.append(el('span', 'action-text', 'Not running'));
                break;
            case 'rejected':
            case 'error':
                action.append(el('span', 'action-text', 'Failed'));
                break;
            default:
                action.appendChild(svgIcon('download'));
        }
    }

    async download(item, row, action) {
        if (row.dataset.state === 'sending') return;
        this.itemStates.set(item.key, 'sending');
        this.applyItemState(row, action, 'sending');
        let result;
        try {
            result = await browser.runtime.sendMessage({type: 'brisk:download', item: {
                kind: item.kind, url: item.url, referer: item.referer, name: item.name,
            }});
        } catch (e) {
            result = {ok: false, reason: 'error'};
        }
        const state = result?.ok ? 'done' : (result?.reason || 'error');
        this.itemStates.set(item.key, state === 'done' ? 'done' : 'idle');
        this.applyItemState(row, action, state);
        if (state === 'not-running' && this.briskRunning !== false) {
            this.briskRunning = false;
            this.ui.menu.appendChild(this.renderNotRunning());
        }
        if (state !== 'done') {
            setTimeout(() => {
                if (row.isConnected && row.dataset.state === state) this.applyItemState(row, action, 'idle');
            }, 3500);
        }
    }
}
