export const OVERLAY_STYLES = `
:host { all: initial; }

* { box-sizing: border-box; }

.wrap {
    --bg: #202124;
    --bg-hover: #2c2d31;
    --line: #3a3b40;
    --text: #e8e9eb;
    --muted: #9b9ea5;
    --accent: #4a86d8;
    --warn: #e3b34f;
    --ok: #6cbf84;
    --error: #e57368;
    position: absolute;
    left: 0;
    top: 0;
    font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: var(--text);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 120ms, visibility 0s linear 120ms;
}

.wrap.visible {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition: opacity 120ms;
}

.bar { display: flex; align-items: stretch; }

button {
    font: inherit;
    color: inherit;
    margin: 0;
    border: 0;
    background: none;
    cursor: pointer;
}

button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.pill, .dismiss {
    background: var(--bg);
    border: 1px solid var(--line);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}

.pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px 0 9px;
    border-radius: 4px 0 0 4px;
    white-space: nowrap;
}

.pill:hover, .wrap.open .pill { background: var(--bg-hover); }

.logo { display: inline-flex; color: var(--accent); }
.logo svg { width: 10px; height: 12px; display: block; }

.dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 28px;
    margin-left: -1px;
    border-radius: 0 4px 4px 0;
    color: var(--muted);
}

.dismiss:hover { background: var(--bg-hover); color: var(--text); }
.dismiss svg { width: 12px; height: 12px; }

.menu {
    position: absolute;
    top: 32px;
    left: 0;
    width: 290px;
    max-height: 360px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--line);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}

.menu[hidden] { display: none; }
.menu.above { top: auto; bottom: 32px; }
.menu.align-right { left: auto; right: 0; }


.body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 0;
    scrollbar-width: thin;
}

.section-title {
    padding: 8px 10px 3px;
    font-size: 11.5px;
    color: var(--muted);
}

.item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 6px 10px;
    text-align: left;
}

.item:hover { background: var(--bg-hover); }
.item[data-state="sending"] { cursor: progress; }

.item-text {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
}

.item-label {
    flex: none;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.item-detail {
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.item-action {
    display: inline-flex;
    align-items: center;
    flex: none;
    color: var(--muted);
    font-size: 12px;
}

.item-action svg { width: 15px; height: 15px; }
.item:hover .item-action { color: var(--accent); }
.item[data-state="done"] .item-action { color: var(--ok); }
.item[data-state="not-running"] .item-action,
.item[data-state="rejected"] .item-action,
.item[data-state="error"] .item-action { color: var(--error); }

.spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid var(--line);
    border-top-color: var(--muted);
    animation: spin 700ms linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.loading, .empty {
    padding: 14px 10px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
}

.empty-title { color: var(--text); font-size: 13px; margin-bottom: 2px; }

.notice {
    padding: 8px 10px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
    flex: none;
}

.notice strong { color: var(--warn); font-weight: 600; }
.notice a { color: var(--accent); }

@media (prefers-reduced-motion: reduce) {
    .wrap, .spinner { transition: none; animation: none; }
}
`;
