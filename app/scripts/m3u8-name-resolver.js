import * as browser from "webextension-polyfill";
import {sanitizeFileName} from "./common";

const RESOLVERS_URL = 'https://raw.githubusercontent.com/BrisklyDev/brisk-extension-dynamic-plugins/refs/heads/main/m3u8-name-resolver.json';
const RESOLVERS_KEY = 'briskM3u8NameResolver';
const RESOLVERS_FETCHED_AT_KEY = 'briskM3u8NameResolverFetchedAt';
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

/**
 * Downloads the latest name resolvers. They are stored in storage.local because the
 * resolver file is larger than the 8KB per-item quota of storage.sync.
 */
export async function refreshResolvers(force = false) {
    try {
        if (!force) {
            const stored = await browser.storage.local.get([RESOLVERS_FETCHED_AT_KEY]);
            const fetchedAt = stored[RESOLVERS_FETCHED_AT_KEY] || 0;
            if (Date.now() - fetchedAt < REFRESH_INTERVAL_MS) return;
        }
        const response = await fetch(RESOLVERS_URL, {cache: 'no-cache'});
        if (response.status !== 200) {
            return;
        }
        const json = await response.json();
        if (!Array.isArray(json?.resolvers)) {
            return;
        }
        await browser.storage.local.set({
            [RESOLVERS_KEY]: json,
            [RESOLVERS_FETCHED_AT_KEY]: Date.now(),
        });
    } catch (e) {
        // Offline or blocked: the page title is used as the video name instead
    }
}

/**
 * Builds a file name (without extension) for videos on the current page.
 * Never throws: falls back to the page title.
 */
export async function generateVideoName(host) {
    try {
        const stored = await browser.storage.local.get([RESOLVERS_KEY]);
        const resolvers = stored[RESOLVERS_KEY]?.resolvers || [];
        for (const resolver of resolvers) {
            if (resolveHostname([resolver['hostname']]) !== host) continue;
            const name = sanitizeFileName(resolveVideoName(resolver));
            if (name) return name;
        }
    } catch (e) {
        // A broken resolver must never prevent the download button from working
    }
    return normalizeFileName(document.title);
}

function resolveHostname(hostName) {
    const regex = /\[atob\((.+)\)\]/;
    const match = hostName.toString().match(regex);
    if (match) {
        return atob(match[1]);
    }
    return hostName[0];
}

function resolveVideoName(resolver) {
    const partsResult = {};
    for (const part of resolver['parts'] || []) {
        const name = part['name'];
        try {
            const selectorResult = resolveSelector(part, partsResult);
            const property = resolveProperty(part, selectorResult);
            const transform = resolveTransform(part, property ?? selectorResult);
            partsResult[name] = transform ?? null;
        } catch (e) {
            partsResult[name] = null;
        }
    }

    let acceptedFormat;
    for (const {validation, format} of resolver.outputs || []) {
        const {type, values} = validation;
        const areAllNotNull = values.every(v => partsResult[v] != null);
        const areAllNull = values.every(v => partsResult[v] == null);
        const isAnyNull = values.some(v => partsResult[v] == null);
        switch (type) {
            case "isAllNotNull":
                if (areAllNotNull) acceptedFormat = format;
                break;
            case "isAllNull":
                if (areAllNull) acceptedFormat = format;
                break;
            case "isAnyNull":
                if (isAnyNull) acceptedFormat = format;
                break;
        }
    }
    if (acceptedFormat == null) {
        return null;
    }
    return acceptedFormat.toString().replace(/\{([^}]+)\}/g, (_, key) => {
        return partsResult[key] ?? "";
    });
}

function resolveTransform(rule, input) {
    if (typeof input !== 'string') {
        return input == null || typeof input === 'object' ? null : String(input);
    }
    let result = input;
    for (const transform of rule['transform'] || []) {
        if (result == null) break;
        switch (transform['type']) {
            case 'trim':
                result = result.trim();
                break;
            case 'replace':
                result = resolveReplace(transform, result);
                break;
            case 'replaceAll':
                result = result.replaceAll(transform['searchValue'], String(transform['replacer'] ?? ''));
                break;
            case 'match': {
                const regexResult = resolveRegex(transform, result);
                if (!regexResult && transform['required']) {
                    return null;
                }
                result = regexResult;
                break;
            }
            case 'padStart':
                result = result.padStart(parseInt(transform['number'].toString()), transform['fillString']);
                break;
            case 'padEnd':
                result = result.padEnd(parseInt(transform['number'].toString()), transform['fillString']);
                break;
        }
    }
    return result;
}

function resolveReplace(transform, result) {
    const regex = transform['regex'];
    if (regex) {
        return result.replace(new RegExp(regex, 'g'), transform['replacer']);
    }
    return result.replaceAll(transform['searchStr'], transform['replacer']);
}

function resolveSelector(rule, parts) {
    const selector = rule['selector'];
    if (selector === "@{document.title}") {
        return document.title.toString();
    }
    const isRef = selector.match(/@\{([^}]+)\}/);
    if (isRef) {
        return parts[isRef[1]];
    }
    return document.querySelector(selector);
}

function resolveRegex(transform, input) {
    const match = input.match(new RegExp(transform['regex'], transform['flags']));
    return match ? match[transform['matchIndex']] ?? null : null;
}

function resolveProperty(part, input) {
    if (input == null || typeof input !== 'object') {
        return undefined;
    }
    switch (part['property']) {
        case 'textContent':
            return input.textContent;
        case 'innerText':
            return input.innerText;
        case 'innerHTML':
            return input.innerHTML;
        case 'outerHTML':
            return input.outerHTML;
        default:
            return undefined;
    }
}

function normalizeFileName(name) {
    return sanitizeFileName(name || '');
}
