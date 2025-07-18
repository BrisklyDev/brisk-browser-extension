import * as browser from "webextension-polyfill";

export async function refreshResolvers() {
    const response = await fetch(
        'https://raw.githubusercontent.com/BrisklyDev/brisk-extension-dynamic-plugins/refs/heads/main/m3u8-name-resolver.json'
    );
    if (response.status !== 200) {
        return;
    }
    const json = await response.json();
    await browser.storage.sync.set({
        briskM3u8NameResolver: json,
    });
}

export async function generateVideoName(host, fileExtension) {
    let res = await browser.storage.sync.get(['briskM3u8NameResolver']);
    let resolver = res.briskM3u8NameResolver;
    let resolvers = resolver['resolvers'];
    for (let resolver of resolvers) {
        if (resolveHostname([resolver['hostname']]) === host) {
            return resolveVideoName(resolver);
        }
    }
    return normalizeFileName(document.title);
}

function resolveHostname(hostName) {
    const regexStr = "\\[atob\\((.+)\\)\\]";
    const regex = new RegExp(regexStr);
    const match = hostName.toString().match(regex);
    if (match) {
        return atob(match[1]);
    }
    return hostName[0];
}

function resolveVideoName(resolver) {
    let parts = resolver['parts'];
    let partsResult = {};
    for (let part of parts) {
        let name = part['name'];
        let selectorResult = resolveSelector(part, partsResult);
        let property = resolveProperty(part, selectorResult);
        let transform = resolveTransform(part, property ?? selectorResult);
        partsResult[name] = transform ?? property;
        if (transform == null) {
            partsResult[name] = null;
        }
    }

    let acceptedFormat;
    for (const {validation, format} of resolver.outputs) {
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
    return acceptedFormat.toString().replace(/\{([^}]+)\}/g, (_, key) => {
        return partsResult[key] ?? "";
    });
}


function resolveTransform(rule, input) {
    let transformList = rule['transform'];
    let result = input;
    loop:
        for (let transform of transformList) {
            let type = transform['type'];
            switch (type) {
                case 'trim':
                    result = result.trim();
                    break;
                case 'replace':
                    result = resolveReplace(transform, result);
                    break;
                case 'replaceAll':
                    result = result.replaceAll(transform['searchValue'], transform['replacer'].toString);
                    break;
                case 'match':
                    let regexResult = resolveRegex(transform, result);
                    if (!regexResult && transform['required']) {
                        result = null;
                        break loop;
                    }
                    result = regexResult;
                    break;
                case 'padStart':
                    result = result.padStart(parseInt(transform['number'].toString()), transform['fillString'])
                    break;
                case 'padEnd':
                    result = result.padEnd(parseInt(transform['number'].toString()), transform['fillString'])
                    break;
            }
        }
    return result;
}

function resolveReplace(transform, result) {
    const regex = transform['regex'];
    if (regex) {
        const regExp = new RegExp(regex, 'g');
        return result.replace(regExp, transform['replacer']);
    }
    return result.replaceAll(transform['searchStr'], transform['replacer']);
}

function log(log) {
    browser.runtime.sendMessage({
        type: 'log', payload: log,
    });
}


function resolveSelector(rule, parts) {
    let selector = rule['selector'];
    if (selector === "@{document.title}") {
        return document.title.toString();
    }
    let isRef = selector.match(/@\{([^}]+)\}/);
    if (isRef) {
        return parts[isRef[1]];
    }
    return isRef ? parts[isRef[1]] : document.querySelector(selector);
}

function resolveRegex(transform, input) {
    const regex = new RegExp(transform['regex'], transform['flags']);
    const match = input.match(regex);
    if (match) {
        return input.match(regex)?.[transform['matchIndex']];
    }
    return null;
}

function resolveProperty(part, input) {
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
            break;
    }
}

function normalizeFileName(name) {
    return name
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^\.+/, '')
        .trim();
}