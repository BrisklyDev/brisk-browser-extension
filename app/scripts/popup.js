import * as browser from 'webextension-polyfill';
import {
    sendRequestToBrisk,
    extractResolution,
    defaultSettings,
    getSettingsFromStorage, getSessionStoredValue
} from "./common";

const tooltipEnabledText = "If disabled, downloads are immediately cancelled even if Brisk fails to get the file info.<br>(Downloads are not cancelled if Brisk is not running in the background)";
const tooltipDisabledText = "If enabled, the extension waits for a response from Brisk that determines this file can be downloaded before cancelling the browser download.<br>";

async function createM3u8List(tabId, m3u8Urls, listContainer) {
    let suggestedName = await browser.tabs.sendMessage(tabId, {type: 'get-suggested-video-name'});
    m3u8Urls.forEach((obj) => {
        const listItem = document.createElement('li');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = resolveSuggestedName(obj, suggestedName, true);
        const downloadButton = document.createElement('button');
        downloadButton.textContent = 'Download';
        downloadButton.classList.add('download-btn');
        registerVideoStreamDownloadClickListener(downloadButton, obj);
        listItem.appendChild(nameSpan);
        listItem.appendChild(downloadButton);
        listContainer.appendChild(listItem);
    });
}


function resolveSuggestedName(obj, suggestedName, handleMaster) {
    let fileNameFromUrl = obj.url.substring(obj.url.lastIndexOf('/') + 1)
    if (fileNameFromUrl.includes('.m3u8?')) {
        fileNameFromUrl = fileNameFromUrl.substring(0, fileNameFromUrl.indexOf('.m3u8?') + 5)
    }
    if (fileNameFromUrl.includes('.mp4?')) {
        fileNameFromUrl = fileNameFromUrl.substring(0, fileNameFromUrl.indexOf('.mp4?') + 4)
    }
    if (suggestedName == null || suggestedName === '') {
        return fileNameFromUrl;
    }
    let resolution = extractResolution(fileNameFromUrl);
    if (suggestedName.endsWith(".mp4")) {
        return resolution ? `${suggestedName}.${resolution}.mp4` : `${suggestedName}.mp4`;
    } else if (handleMaster && fileNameFromUrl.includes("master")) {
        return `${suggestedName}.all.resolutions.ts`;
    } else {
        return `${suggestedName}.ts`;
    }
}

function registerVideoStreamDownloadClickListener(downloadButton, obj) {
    downloadButton.addEventListener('click', async () => {
        let tabId = await getCurrentTabId();
        const tab = await browser.tabs.get(tabId);
        let suggestedName = await browser.tabs.sendMessage(tabId, {type: 'get-suggested-video-name', 'tabId': tabId});
        suggestedName = resolveSuggestedName(obj, suggestedName, false);
        if (obj.url.endsWith(".mp4") || obj.url.endsWith(".webm")) {
            let body = {
                'type': 'single', 'data': {
                    'url': obj.url, 'referer': tab.url, 'suggestedName': suggestedName, 'refererHeader': obj.referer,
                }
            };
            await sendRequestToBrisk(body);
        } else {
            let vttUrls = await getSessionStoredValue(tabId, 'vtt');
            await sendRequestToBrisk({
                'type': 'm3u8',
                'm3u8Url': obj.url,
                'vttUrls': vttUrls,
                'referer': tab.url,
                'suggestedName': suggestedName,
                'refererHeader': obj.referer,
            });
        }
    });
}

async function getCurrentTabId() {
    let tabs = await browser.tabs.query({active: true, currentWindow: true});
    return tabs[0].id;
}

function handleDynamicTooltipMessage(responseWaitEnabledCheckbox, tooltip) {
    function updateTooltip() {
        tooltip.innerHTML = responseWaitEnabledCheckbox.checked ? tooltipEnabledText : tooltipDisabledText;
    }

    updateTooltip();
    responseWaitEnabledCheckbox.addEventListener('change', updateTooltip);
}

document.addEventListener('DOMContentLoaded', () => {
    const tooltip = document.getElementById('wait-tooltip');
    const portInput = document.getElementById('port');
    const saveButton = document.getElementById('save-port');
    const enableCaptureCheckbox = document.getElementById('enable-capture');
    const responseWaitEnabledCheckbox = document.getElementById('enable-wait-brisk-response');

    getSettingsFromStorage().then((data) => {
        portInput.value = data.briskPort ?? defaultSettings.port;
        enableCaptureCheckbox.checked = data.briskCaptureEnabled ?? defaultSettings.captureEnabled;
        responseWaitEnabledCheckbox.checked = data.briskResponseWaitEnabled ?? defaultSettings.briskResponseWaitEnabled;
    }).catch((a) => {
        portInput.value = defaultSettings.port;
        enableCaptureCheckbox.checked = defaultSettings.captureEnabled;
        responseWaitEnabledCheckbox.checked = defaultSettings.briskResponseWaitEnabled;
    });

    handleDynamicTooltipMessage(responseWaitEnabledCheckbox, tooltip);
    saveButton.addEventListener('click', async () => {
        const port = Number(portInput.value);
        if (port <= 1 || port >= 65535) {
            alert('Please enter a valid port number (1-65535).');
            return;
        }
        await browser.storage.sync.set({
            briskPort: port,
            briskCaptureEnabled: enableCaptureCheckbox.checked,
            briskResponseWaitEnabled: responseWaitEnabledCheckbox.checked,
        });
        alert("Settings saves successfully");
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const listContainer = document.getElementById('m3u8-list');
    browser.tabs.query({active: true, currentWindow: true}).then((tabs) => {
        const tabId = tabs[0].id;
            const key = `briskTab${tabId}`;
            browser.storage.session.get(key).then(result => {
                let value = result[key] ?? {};
                let urls = value['m3u8'] || [];
                let videos = value['video'] || [];
                if (videos) {
                    urls.push(...videos);
                }
                createM3u8List(tabId, urls, listContainer);
            });
    });
});

document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
        const tab = button.dataset.tab;
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tab);
        });
    });
});