import * as browser from "webextension-polyfill";
import {log} from "./content-script";
import {getSessionStoredValue, sendRequestToBrisk} from "./common";

export function injectIframeDownloadButton(message) {
    document.querySelectorAll("video")
        .forEach(video => createDownloadVideoButton(video, message));
}

async function createDownloadVideoButton(video, message) {
    const button = document.createElement("button");
    setInitialButtonStyle(button);
    button.appendChild(await createBriskLogoSvg());
    button.appendChild(document.createTextNode("Download Video"));
    const dropdown = createDropdown();
    const cancel = createCancelIcon(dropdown, button);
    button.appendChild(cancel);
    // createDropdownElements(message).forEach(({name, url}) => createDropdowmItem(name, url, dropdown));
    createDropdownElements(message).forEach(info => createDropdowmItem(info, message.tabId, dropdown));
    addButtonHoverEffect(button, dropdown);
    setButtonOnclick(button, cancel, dropdown);
    setOutsideClickDropdownHide(button, dropdown);
    const parent = video.parentElement;
    if (getComputedStyle(parent).position === "static") {
        parent.style.position = "relative";
    }
    button.appendChild(dropdown);
    parent.appendChild(button);
    return button;
}


async function createBriskLogoSvg() {
    const response = await fetch(browser.runtime.getURL("images/brisk-logo.svg"));
    const svgText = await response.text();
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgText, "image/svg+xml");
    const svg = svgDoc.querySelector("svg");
    svg.querySelectorAll("path").forEach(path => {
        path.setAttribute("fill", "#2E6BC5");
    });
    svg.style.width = "16px";
    svg.style.height = "16px";
    svg.style.display = "block";
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    return svg;
}

function createDropdownElements(message) {
    const subElements = [];
    for (let stream of message.data) {
        const streamInfo = {referer: stream.referer};
        if (stream.isMasterPlaylist) {
            for (let streamInf of stream.streamInfs) {
                streamInfo['name'] = streamInf.fileName;
                streamInfo['url'] = streamInf.url;
                subElements.push(streamInfo);
            }
            continue;
        }
        streamInfo['name'] = stream.fileName;
        streamInfo['url'] = stream.url;
        subElements.push(streamInfo);
    }
    return subElements;
}

function addButtonHoverEffect(button, dropdown) {
    button.addEventListener("mouseenter", () => {
        button.style.opacity = "1";
    });
    button.addEventListener("mouseleave", () => {
        if (dropdown.style.display !== "block") {
            button.style.opacity = "0.85";
        }
    });
}

function createDropdowmItem(info, tabId, dropdown) {
    const item = document.createElement("div");
    item.textContent = info.name;
    item.dataset.url = info.url;
    item.dataset.referer = info.referer;
    item.style.padding = "8px 16px";
    item.style.cursor = "pointer";
    item.style.whiteSpace = "nowrap";
    item.style.fontSize = "13px";
    item.style.transition = "background-color 0.2s";
    item.style.textAlign = "left";
    item.onmouseenter = () => {
        item.style.backgroundColor = "rgba(255,255,255,0.15)";
    };
    item.onmouseleave = () => {
        item.style.backgroundColor = "transparent";
    };
    item.onclick = (e) => {
        // e.stopPropagation();
        browser.runtime.sendMessage({type: 'get-vtt', tabId: tabId})
            .then(vttData => {
                log("Received direct VTT data:");  // Debug log
                log(vttData);
                dropdown.style.display = "none";
            })
            .catch(log);
        // browser.runtime.sendMessage({ type: 'get-session-data', key: 'briskTab123' })
        //     .then((data) => {
        //         log(`Session data from background:${data}`);
        //     });
    };

    dropdown.appendChild(item);
}

function setInitialButtonStyle(button) {
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
}

function setButtonOnclick(button, cancel, dropdown) {
    button.onclick = (e) => {
        if (e.target === cancel) return;
        e.stopPropagation();
        if (dropdown.style.display === "block") {
            dropdown.style.display = "none";
            button.style.opacity = "0.85";
        } else {
            dropdown.style.display = "block";
            button.style.opacity = "1";
        }
    };
}

function setOutsideClickDropdownHide(button, dropdown) {
    document.addEventListener("click", (e) => {
        if (!button.contains(e.target)) {
            dropdown.style.display = "none";
            button.style.opacity = "0.85";
        }
    });
}


function createCancelIcon(dropdown, button) {
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
    cancel.onclick = (e) => {
        e.stopPropagation();
        if (dropdown) dropdown.remove();
        button.remove();
    };
    return cancel;
}

function createDropdown() {
    const dropdown = document.createElement("div");
    dropdown.style.position = "absolute";
    dropdown.style.top = "100%";
    dropdown.style.left = "0";
    dropdown.style.background = "rgba(0,0,0,0.8)";
    dropdown.style.color = "white";
    dropdown.style.borderRadius = "6px";
    dropdown.style.marginTop = "6px";
    dropdown.style.minWidth = "160px";
    dropdown.style.boxShadow = "0 4px 10px rgba(0,0,0,0.4)";
    dropdown.style.display = "none";
    dropdown.style.flexDirection = "column";
    dropdown.style.zIndex = "10000";
    dropdown.style.userSelect = "none";
    dropdown.style.padding = "8px 0";
    return dropdown;
}

