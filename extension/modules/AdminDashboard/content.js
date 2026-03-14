// content.js - Infinite Canvas Extension

let canvas, world;
let cardCount = 0;

// Pan & Zoom State
let panX = 0, panY = 0;
let scale = 1;
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
let isPanning = false;
let startPanX, startPanY;

// Selection State
let selectedCard = null;
let cardZCounter = 100; // Z-index counter

// Resize State
let isResizing = false;
let resizeCard = null;
let resizeStartX, resizeStartY, resizeInitialW, resizeInitialH;

// Configuration
const DEFAULT_CONFIG = {
    overrides: [{ find: '/entity/receiver/', replace: '/entity/qr_code/' }, { find: '/entity/subscription/', replace: '/entity/subscriptions.subscription/' }],
    cardWidth: 900,
    cardHeight: 800
};
let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

// DOM State
let originalParent = null;
let originalNextSibling = null;
let currentContentElement = null;
let isCanvasActive = false;

// Initialize
if (window.location.href.includes('entity')) {
    setTimeout(conditionalInit, 1500);
}
setTimeout(() => {
    loadConfig();
    injectControls();
    // Attach interceptors on page load so overrides work even with canvas off
    attachInterceptors(document.body);
    setupLinkObserver(document.body);
}, 1500);

function conditionalInit() {
    const hasGoButton = Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Go');
    if (hasGoButton) return;

    // Respect stored canvas state preference
    const storedState = localStorage.getItem('rp_canvas_enabled');
    // Only auto-enable if user hasn't explicitly turned it off (null = first time, 'true' = on)
    if (storedState === 'false') return; // User explicitly turned it off, respect that

    // Don't save state during auto-init, only during user toggle
    setCanvasState(true, false);
}

function loadConfig() {
    try {
        const stored = localStorage.getItem('rp_canvas_config');
        if (stored) {
            const parsed = JSON.parse(stored);
            config = { ...DEFAULT_CONFIG, ...parsed };
            if (Array.isArray(parsed)) config = { ...DEFAULT_CONFIG, overrides: parsed };
        }
    } catch (e) { }
}

function saveConfig() {
    localStorage.setItem('rp_canvas_config', JSON.stringify(config));
}

function injectControls() {
    if (document.getElementById('rp-canvas-controls')) return;

    const container = document.createElement('div');
    container.id = 'rp-canvas-controls';
    container.innerHTML = `
        <div id="rp-zoom-control" class="rp-control-btn rp-zoom-slider">
            <span>🔍</span>
            <input type="range" id="rp-zoom-slider" min="10" max="300" value="100">
            <span id="rp-zoom-value">100%</span>
        </div>
        <div id="rp-canvas-toggle" class="rp-control-btn"><span>🖼️</span> Canvas View</div>
        <div id="rp-canvas-settings" class="rp-control-btn"><span>⚙️</span></div>
    `;
    document.body.appendChild(container);

    // User clicks toggle = save state for future pages
    document.getElementById('rp-canvas-toggle').addEventListener('click', () => toggleCanvas(!isCanvasActive));
    document.getElementById('rp-canvas-settings').addEventListener('click', openSettingsModal);

    const zoomSlider = document.getElementById('rp-zoom-slider');
    const zoomValue = document.getElementById('rp-zoom-value');
    zoomSlider.addEventListener('input', (e) => {
        scale = e.target.value / 100;
        zoomValue.textContent = `${e.target.value}%`;
        applyTransform();
    });

    if (isCanvasActive) document.getElementById('rp-canvas-toggle').classList.add('active');
}

// User toggle - saves state for future pages
function toggleCanvas(enable) {
    setCanvasState(enable, true);
}

// Internal function to set state with optional save
function setCanvasState(enable, savePreference = false) {
    const btn = document.getElementById('rp-canvas-toggle');

    // Only save preference when user explicitly toggles (not during auto-init)
    if (savePreference) {
        localStorage.setItem('rp_canvas_enabled', enable.toString());
    }

    if (enable) {
        enableCanvas();
        document.documentElement.classList.add('rp-canvas-mode');
        document.body.classList.add('rp-canvas-mode');
        if (btn) btn.classList.add('active');
    } else {
        disableCanvas();
        document.documentElement.classList.remove('rp-canvas-mode');
        document.body.classList.remove('rp-canvas-mode');
        if (btn) btn.classList.remove('active');
    }
}

function enableCanvas() {
    if (isCanvasActive) return;

    if (!document.getElementById('rp-infinite-canvas')) setupCanvasStructure();
    document.getElementById('rp-infinite-canvas').style.display = 'block';

    if (!currentContentElement) {
        const main = document.querySelector('div.app-container main');
        if (!main) return;
        currentContentElement = main.querySelector('.entity-page') || main.querySelector('.box') || main;
    }

    if (currentContentElement) {
        originalParent = currentContentElement.parentNode;
        originalNextSibling = currentContentElement.nextSibling;

        let rootCard = document.getElementById('card-root');
        if (!rootCard) {
            rootCard = createCardElement('card-root', 'Current Page');
            rootCard.style.left = '50px';
            rootCard.style.top = '50px';
            world.appendChild(rootCard);
            attachInterceptors(rootCard);
            setupLinkObserver(rootCard);
        }
        rootCard.querySelector('.rp-card-body').appendChild(currentContentElement);
        selectCard(rootCard);
        // Inject styles to hide buttons in current page too
        injectCurrentPageStyles();
    }
    isCanvasActive = true;

    // Block browser back/forward swipe gestures when canvas is active
    window.addEventListener('wheel', blockBrowserGestures, { passive: false });
}

function disableCanvas() {
    if (!isCanvasActive) return;
    const canvasEl = document.getElementById('rp-infinite-canvas');
    if (canvasEl) canvasEl.style.display = 'none';
    if (currentContentElement && originalParent) {
        originalParent.insertBefore(currentContentElement, originalNextSibling);
    }
    isCanvasActive = false;

    // Remove gesture blocker
    window.removeEventListener('wheel', blockBrowserGestures);
}

// Block horizontal swipe gestures that trigger browser back/forward
function blockBrowserGestures(e) {
    // Only block when canvas is active
    if (!isCanvasActive) return;

    // Check for horizontal dominance
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Aggressive blocking: if any significant X movement, prevent default to stop swipe nav
        // We only allow if target is clearly scrollable and not at edge?
        // Actually, for this specific request, blocking ALL horizontal browser gestures is safer
        // unless explicitly handled by our canvas pan.
        // But our canvas pan handles it via its own listener which calls preventDefault.
        // This global listener catches events that bubble up from cards.

        // If it's a small jitter, ignore. If it's a swipe, block.
        if (Math.abs(e.deltaX) > 2) {
            e.preventDefault();
        }
    }
}

function setupCanvasStructure() {
    canvas = document.createElement('div');
    canvas.id = 'rp-infinite-canvas';
    world = document.createElement('div');
    world.id = 'rp-canvas-world';
    canvas.appendChild(world);
    document.body.appendChild(canvas);
    setupCanvasInteractions();
}

// ---------------------------------------------------------
// Card Creation
// ---------------------------------------------------------

function createCardElement(id, title) {
    const card = document.createElement('div');
    card.classList.add('rp-entity-card');
    card.id = id;
    card.style.width = `${config.cardWidth}px`;
    card.style.height = `${config.cardHeight}px`;
    card.style.zIndex = cardZCounter++;

    card.innerHTML = `
        <div class="rp-card-header">
            <span>${title}</span>
            ${id !== 'card-root' ? '<span class="rp-close-btn">✕</span>' : ''}
        </div>
        <div class="rp-card-body"></div>
        <div class="rp-resize-handle"></div>
    `;

    setupCardInteractions(card);
    return card;
}

function setupCardInteractions(card) {
    const header = card.querySelector('.rp-card-header');
    const resizeHandle = card.querySelector('.rp-resize-handle');
    const closeBtn = card.querySelector('.rp-close-btn');

    let isDragging = false;
    let dragStartX, dragStartY, dragInitialLeft, dragInitialTop;

    // Drag by Header
    header.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('rp-close-btn')) return;
        selectCard(card);
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragInitialLeft = parseInt(card.style.left || 0);
        dragInitialTop = parseInt(card.style.top || 0);
        e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const dx = (e.clientX - dragStartX) / scale;
        const dy = (e.clientY - dragStartY) / scale;
        card.style.left = `${dragInitialLeft + dx}px`;
        card.style.top = `${dragInitialTop + dy}px`;
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    // Resize by Handle
    resizeHandle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        selectCard(card);
        isResizing = true;
        resizeCard = card;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeInitialW = card.offsetWidth;
        resizeInitialH = card.offsetHeight;
    });

    // Close Button
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            card.remove();
            if (selectedCard === card) selectedCard = null;
        });
    }

    // Click on card body to select (but not start panning)
    card.querySelector('.rp-card-body').addEventListener('mousedown', (e) => {
        selectCard(card);
        e.stopPropagation();
    });
}

// ---------------------------------------------------------
// Selection - USE Z-INDEX INSTEAD OF DOM REORDER
// ---------------------------------------------------------

function selectCard(card) {
    if (selectedCard === card) return;

    // Deselect previous
    if (selectedCard) {
        selectedCard.classList.remove('selected');
        // Disable pointer events on iframe content
        const iframeWrap = selectedCard.querySelector('.rp-iframe-wrapper');
        if (iframeWrap) iframeWrap.classList.add('blocked');
    }

    selectedCard = card;

    if (selectedCard) {
        selectedCard.classList.add('selected');
        // Bring to front via z-index (NO DOM reorder - prevents iframe reload)
        cardZCounter++;
        selectedCard.style.zIndex = cardZCounter;
        // Enable pointer events on new selected card's iframe
        const iframeWrap = selectedCard.querySelector('.rp-iframe-wrapper');
        if (iframeWrap) iframeWrap.classList.remove('blocked');
    }
}

function deselectCard() {
    if (selectedCard) {
        selectedCard.classList.remove('selected');
        const iframeWrap = selectedCard.querySelector('.rp-iframe-wrapper');
        if (iframeWrap) iframeWrap.classList.add('blocked');
        selectedCard = null;
    }
}

// ---------------------------------------------------------
// Canvas Interactions
// ---------------------------------------------------------

function setupCanvasInteractions() {
    canvas.addEventListener('mousedown', (e) => {
        if (e.target.closest('.rp-entity-card')) return;
        deselectCard();
        isPanning = true;
        startPanX = e.clientX;
        startPanY = e.clientY;
        canvas.dataset.initialPanX = panX;
        canvas.dataset.initialPanY = panY;
        canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (isPanning) {
            e.preventDefault();
            panX = parseFloat(canvas.dataset.initialPanX) + (e.clientX - startPanX);
            panY = parseFloat(canvas.dataset.initialPanY) + (e.clientY - startPanY);
            applyTransform();
        }
        if (isResizing && resizeCard) {
            e.preventDefault();
            const dw = (e.clientX - resizeStartX) / scale;
            const dh = (e.clientY - resizeStartY) / scale;
            const newW = Math.max(300, resizeInitialW + dw);
            const newH = Math.max(200, resizeInitialH + dh);
            resizeCard.style.width = `${newW}px`;
            resizeCard.style.height = `${newH}px`;
            // Show dimension tooltip
            showDimensionTooltip(resizeCard, Math.round(newW), Math.round(newH));
        }
    });

    window.addEventListener('mouseup', () => {
        isPanning = false;
        canvas.style.cursor = '';
        if (isResizing) {
            hideDimensionTooltip();
        }
        isResizing = false;
        resizeCard = null;
    });

    // Scroll/Zoom
    canvas.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            scale = Math.min(Math.max(scale + (-e.deltaY * 0.01), MIN_SCALE), MAX_SCALE);
            applyTransform();
            updateZoomSlider();
            return;
        }

        const card = e.target.closest('.rp-entity-card');

        // If hovering over the SELECTED card, let it scroll naturally
        if (card && card === selectedCard) {
            return; // Natural scroll inside selected card
        }

        // Otherwise (unselected card or empty canvas), pan the canvas
        e.preventDefault();
        panX -= e.deltaX;
        panY -= e.deltaY;
        applyTransform();
    }, { passive: false });
}

function applyTransform() {
    world.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
}

function updateZoomSlider() {
    const slider = document.getElementById('rp-zoom-slider');
    const value = document.getElementById('rp-zoom-value');
    if (slider && value) {
        slider.value = Math.round(scale * 100);
        value.textContent = `${Math.round(scale * 100)}%`;
    }
}

// ---------------------------------------------------------
// Dimension Tooltip
// ---------------------------------------------------------

let dimensionTooltip = null;
let hideTooltipTimer = null;

function showDimensionTooltip(card, w, h) {
    if (!dimensionTooltip) {
        dimensionTooltip = document.createElement('div');
        dimensionTooltip.id = 'rp-dimension-tooltip';
        document.body.appendChild(dimensionTooltip);
    }

    dimensionTooltip.textContent = `${w} × ${h}`;
    dimensionTooltip.style.display = 'block';

    // Position near the card's resize handle
    const cardRect = card.getBoundingClientRect();
    dimensionTooltip.style.left = `${cardRect.right - 80}px`;
    dimensionTooltip.style.top = `${cardRect.bottom - 40}px`;

    // Clear any pending hide timer
    if (hideTooltipTimer) clearTimeout(hideTooltipTimer);
}

function hideDimensionTooltip() {
    if (!dimensionTooltip) return;
    // Delay hiding so user can see final size
    hideTooltipTimer = setTimeout(() => {
        if (dimensionTooltip) dimensionTooltip.style.display = 'none';
    }, 800);
}

// ---------------------------------------------------------
// Card Spawning
// ---------------------------------------------------------

function spawnIframeCard(originalUrl) {
    if (!isCanvasActive) return;
    const url = applyOverrides(originalUrl);
    cardCount++;
    const urlParts = url.split('/');
    const title = `${urlParts[urlParts.length - 3] || 'Entity'}/${urlParts[urlParts.length - 1]}`;

    const card = createCardElement(`card-${cardCount}`, title);

    const lastCard = world.lastElementChild;
    if (lastCard && lastCard.classList.contains('rp-entity-card')) {
        card.style.left = (parseInt(lastCard.style.left || 0) + 60) + 'px';
        card.style.top = (parseInt(lastCard.style.top || 0) + 60) + 'px';
    } else {
        card.style.left = '100px';
        card.style.top = '100px';
    }

    // Iframe wrapper starts BLOCKED until selected
    card.querySelector('.rp-card-body').innerHTML = `
        <div class="rp-iframe-wrapper blocked"><iframe src="${url}" scrolling="yes"></iframe></div>
    `;
    world.appendChild(card);
    selectCard(card); // This will unblock the iframe

    const iframe = card.querySelector('iframe');
    iframe.onload = () => {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            injectStyles(doc);
            setupLinkObserver(doc.body);
            attachInterceptors(doc.body);
            doc.body.style.overflow = 'auto';
            doc.body.style.height = '100%';
        } catch (e) { }
    };
}

// ---------------------------------------------------------
// Link Handling
// ---------------------------------------------------------

function setupLinkObserver(root) {
    if (!root) return;
    new MutationObserver(() => attachInterceptors(root)).observe(root, { childList: true, subtree: true });
}

function attachInterceptors(root) {
    root.querySelectorAll('a[href^="/admin/entity/"], a[href^="/admin/merchants/"]').forEach(link => {
        if (link.dataset.hasInterceptor) return;
        link.dataset.hasInterceptor = "true";
        link.addEventListener('click', (e) => {
            // Allow Cmd/Ctrl+click to work normally
            if (e.metaKey || e.ctrlKey) return;

            // Apply URL overrides
            const overriddenUrl = applyOverrides(link.href);

            if (isCanvasActive) {
                // Canvas mode: open in new card
                e.preventDefault();
                spawnIframeCard(overriddenUrl);
            } else if (overriddenUrl !== link.href) {
                // Canvas off but URL was overridden: navigate to overridden URL
                e.preventDefault();
                window.location.href = overriddenUrl;
            }
            // If canvas off and no override, let normal navigation happen
        });
    });
}

function applyOverrides(url) {
    config.overrides.forEach(rule => { if (url.includes(rule.find)) url = url.replace(rule.find, rule.replace); });
    return url;
}

function injectStyles(doc) {
    const style = doc.createElement('style');
    style.textContent = `
        header, aside.admin-sidebar, footer, .app-container > aside { display: none !important; }
        .app-container, main { margin: 0 !important; padding: 0 !important; width: 100% !important; max-width: none !important; overflow: visible !important; box-shadow: none !important; }
        .container, .container-fluid, .row, .col-12, .col-md-12 { width: 100% !important; max-width: none !important; margin: 0 !important; padding-left: 10px !important; padding-right: 10px !important; }
        body { background: white !important; overflow: auto !important; }
        html, body { overscroll-behavior-x: none !important; } /* Prevent swipe nav in iframe */
        /* Hide all action buttons */
        button, .btn, .label-info, aside.container { display: none !important; }
    `;
    doc.head.appendChild(style);
}

function injectCurrentPageStyles() {
    // Remove existing if already injected
    let existing = document.getElementById('rp-current-page-styles');
    if (existing) return;

    const style = document.createElement('style');
    style.id = 'rp-current-page-styles';
    style.textContent = `
        /* Hide buttons in current page card */
        .rp-entity-card button:not(.rp-close-btn),
        .rp-entity-card .btn,
        .rp-entity-card .label-info,
        .rp-entity-card aside.container {
            display: none !important;
        }
        /* Prevent swipe nav on current page */
        html.rp-canvas-mode, body.rp-canvas-mode {
            overscroll-behavior-x: none !important;
        }
    `;
    document.head.appendChild(style);
}

// ---------------------------------------------------------
// Settings Modal
// ---------------------------------------------------------

function openSettingsModal() {
    let modal = document.getElementById('rp-settings-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'rp-settings-modal';
    modal.innerHTML = `
        <div class="rp-settings-content">
            <h3>Canvas Settings</h3>
            <div class="rp-setting-group">
                <label>Default Card Size</label>
                <div class="rp-size-inputs">
                    <div class="input-wrap"><span>Width</span><input type="number" id="rp-width-input" value="${config.cardWidth}"></div>
                    <div class="input-wrap"><span>Height</span><input type="number" id="rp-height-input" value="${config.cardHeight}"></div>
                </div>
            </div>
            <div class="rp-setting-group">
                <label>Link Overrides</label>
                <div class="rp-rule-list" id="rp-rule-list"></div>
                <div class="rp-add-rule">
                    <input type="text" id="rp-find-input" placeholder="Find">
                    <input type="text" id="rp-replace-input" placeholder="Replace">
                    <button id="rp-add-rule-btn">Add</button>
                </div>
            </div>
            <div class="rp-modal-actions"><button id="rp-save-settings">Save & Close</button></div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#rp-add-rule-btn').addEventListener('click', () => {
        const find = document.getElementById('rp-find-input').value.trim();
        const replace = document.getElementById('rp-replace-input').value.trim();
        if (find && replace) { config.overrides.push({ find, replace }); renderRules(); document.getElementById('rp-find-input').value = ''; document.getElementById('rp-replace-input').value = ''; }
    });
    modal.querySelector('#rp-save-settings').addEventListener('click', () => {
        config.cardWidth = parseInt(document.getElementById('rp-width-input').value) || 900;
        config.cardHeight = parseInt(document.getElementById('rp-height-input').value) || 800;
        saveConfig();
        modal.style.display = 'none';
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    modal.style.display = 'flex';
    renderRules();
}

function renderRules() {
    const list = document.getElementById('rp-rule-list');
    list.innerHTML = config.overrides.map((r, i) => `
        <div class="rp-rule-item">
            <span class="rp-find">${r.find}</span> ➡ <span class="rp-replace">${r.replace}</span>
            <button class="rp-rule-del" data-i="${i}">🗑️</button>
        </div>
    `).join('');
    list.querySelectorAll('.rp-rule-del').forEach(btn => btn.addEventListener('click', (e) => {
        config.overrides.splice(parseInt(e.target.dataset.i), 1);
        saveConfig();
        renderRules();
    }));
}