// ==========================================
// PART A: WEBRTC TRACKER
// ==========================================
{
    // Scope Block to prevent collision with other content scripts
    const script = document.createElement('script');

    // UPDATED PATH for the unified structure
    script.src = chrome.runtime.getURL('modules/meeting_tracker/injected.js');

    script.onload = function () {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);

    let port = null;
    let activeConnections = 0;

    function connectToBackground() {
        if (port) return; // Already connected

        try {
            port = chrome.runtime.connect({ name: "meeting-session" });

            // Send Initial Ticket ID
            const ticketId = getTicketId();
            port.postMessage({
                type: "INIT_SESSION",
                ticketId: ticketId
            });

            // Listen for unexpected disconnects (SW Idle)
            port.onDisconnect.addListener(() => {
                port = null;
                // If meeting is still active, RECONNECT IMMEDIATELY
                if (activeConnections > 0) {
                    console.log("Meeting Tracker: Service Worker disconnected. Reconnecting...");
                    connectToBackground();
                }
            });
        } catch (e) {
            console.error("Meeting Tracker: Connection failed", e);
        }
    }

    window.addEventListener("message", (event) => {
        if (event.source !== window) return;

        if (event.data.type === "EXT_RTC_CONNECTED") {
            activeConnections++;
            if (activeConnections === 1) {
                // First connection started
                connectToBackground();
            } else if (activeConnections > 1 && !port) {
                // Should be connected, but if not (rare race?), connect
                connectToBackground();
            }
        }

        if (event.data.type === "EXT_RTC_DISCONNECTED") {
            if (activeConnections > 0) activeConnections--;

            if (activeConnections === 0 && port) {
                // Meeting genuinely ended
                port.disconnect();
                port = null;
            }
        }
    });

    function getTicketId() {
        try {
            let ticketEl = document.querySelector('.breadcrumb__item.active[data-test-id="breadcrumb-item"]');
            if (ticketEl) return ticketEl.innerText.trim();
            if (window.top && window.top.document) {
                ticketEl = window.top.document.querySelector('.breadcrumb__item.active[data-test-id="breadcrumb-item"]');
                if (ticketEl) return ticketEl.innerText.trim();
            }
        } catch (e) { }
        return null;
    }

    function getAgentName() {
        try {
            const scrape = (doc) => {
                // Strategy 1: User provided selector (title="Agent")
                let agentEl = doc.querySelector('label[title="Agent"]');
                if (agentEl && agentEl.parentElement) {
                    const val = agentEl.parentElement.querySelector('.filter-field-value');
                    if (val) {
                        // console.log("Meeting Tracker: Found agent via title:", val.textContent.trim());
                        return val.textContent.trim();
                    }
                }
                // Strategy 2: Look for label with text "Agent"
                const labels = Array.from(doc.querySelectorAll('label'));
                const agentLabel = labels.find(l => l.textContent.trim() === 'Agent');
                if (agentLabel && agentLabel.parentElement) {
                    const val = agentLabel.parentElement.querySelector('.filter-field-value');
                    if (val) return val.textContent.trim();
                }

                // Strategy 3: Ember View (data-test-id="Agent")
                const emberAgent = doc.querySelector('div[data-test-id="Agent"]');
                if (emberAgent) {
                    const val = emberAgent.querySelector('.ember-power-select-selected-item');
                    if (val) return val.textContent.trim();
                }

                return null;
            };

            // 1. Try Top Document
            let name = scrape(document);
            if (name) {
                // console.log("Meeting Tracker: Found agent in top frame:", name);
                return name;
            }

            // 2. Try Iframes
            const frames = document.querySelectorAll('iframe');
            for (let i = 0; i < frames.length; i++) {
                try {
                    const doc = frames[i].contentDocument;
                    if (doc) {
                        name = scrape(doc);
                        if (name) {
                            // console.log("Meeting Tracker: Found agent in iframe:", name);
                            return name;
                        }
                    }
                } catch (e) { /* ignore cross-origin */ }
            }

            // console.log("Meeting Tracker: Agent element not found yet.");
        } catch (e) { console.error("Error scraping agent:", e); }
        return "";
    }

    // ==========================================
    // PART B: UI INJECTION
    // ==========================================

    if (window.self === window.top) {
        const FIREBASE_URL = "https://freshdesk-p1-timer-default-rtdb.asia-southeast1.firebasedatabase.app/calls.json";
        const FIREBASE_SECRET = "qstP0N1XO3JdegEDlxNEHJdzdmiCWQq6lVMemUFz";

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initializeUI);
        } else {
            initializeUI();
        }

        function initializeUI() {
            injectStyles();
            injectModal();
            injectLeftIcon();
            checkAndInjectRightWidget();

            const observer = new MutationObserver((mutations) => {
                if (!document.getElementById('call-history-nav-item')) injectLeftIcon();
                checkAndInjectRightWidget();

                // Auto-fill agent if empty
                const agentInput = document.getElementById('widget-agent');
                if (agentInput && !agentInput.value) {
                    const name = getAgentName();
                    if (name) agentInput.value = name;
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });
        }

        function injectStyles() {
            const style = document.createElement('style');
            style.textContent = `
                .nav-item-call-history { margin-top: 10px; display: flex; justify-content: center; cursor: pointer; }
                .call-history-icon { width: 32px; height: 32px; fill: #92a2b1; transition: fill 0.3s; }
                .call-history-icon:hover { fill: #fff; }
                .calls-widget-container { margin-top: 16px; padding: 10px 0; border-top: 1px solid #ebeff3; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; box-sizing: border-box; width: 100%; }
                .calls-widget-header { font-size: 12px; font-weight: 600; color: #183247; margin-bottom: 10px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; }
                .calls-widget-content { background: #f5f7f9; padding: 10px; border-radius: 4px; border: 1px solid #cfd7df; box-sizing: border-box; }
                .call-input-row { margin-bottom: 10px; }
                .call-label { display: block; font-size: 11px; font-weight: 600; color: #475867; margin-bottom: 4px; }
                .call-input { width: 100%; padding: 4px 2px; border: 1px solid #cfd7df; border-radius: 4px; font-size: 11px; background: #fff; box-sizing: border-box; }
                .call-btn { width: 100%; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; border: none; cursor: pointer; margin-top: 8px; }
                .btn-add { background: #2c5cc5; color: #fff; }
                .btn-check { background: #fff; border: 1px solid #cfd7df; color: #183247; margin-top: 5px; }
                .call-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 99999; display: flex; justify-content: center; align-items: center; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
                .call-modal-overlay.active { opacity: 1; pointer-events: auto; }
                .call-modal { background: #fff; width: 550px; max-height: 80vh; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); display: flex; flex-direction: column; overflow: hidden; font-family: sans-serif; }
                .call-modal-header { padding: 15px 20px; border-bottom: 1px solid #ebeff3; background: #f5f7f9; }
                .call-modal-title-row { display: flex; justify-content: space-between; align-items: center; }
                .call-modal-title { font-size: 16px; font-weight: 600; color: #183247; }
                .call-modal-close { cursor: pointer; font-size: 20px; color: #475867; }
                .call-modal-subtitle { font-size: 11px; color: #787878; margin-top: 6px; font-style: italic; display: none; }
                .call-modal-body { padding: 0; overflow-y: auto; flex: 1; max-height: 400px; }
                .modal-list-item { padding: 12px 20px; border-bottom: 1px solid #ebeff3; display: flex; justify-content: space-between; align-items: center; }
                .modal-list-item:hover { background: #fcfcfc; }
                .modal-time-block { font-size: 13px; font-weight: 600; color: #2c5cc5; }
                .modal-note { font-size: 12px; color: #475867; margin-top: 4px; max-width: 300px; word-wrap: break-word;}
                .modal-date { font-size: 11px; color: #92a2b1; }
                .modal-tag { font-size: 10px; background: #ebeff3; padding: 2px 6px; border-radius: 4px; margin-left: 8px; color: #333;}
                .modal-duration { font-size: 10px; background: #e8f5e9; color: #2e7d32; padding: 2px 6px; border-radius: 4px; margin-left: 8px; }
                .modal-clear-btn { font-size: 11px; color: #d32f2f; cursor: pointer; margin-left: 10px; text-decoration: underline; display: none; }
                .modal-clear-btn:hover { color: #b71c1c; }
                .modal-agent { font-size: 11px; color: #475867; margin-top: 2px; font-style: italic; }
                .modal-delete-btn { font-size: 14px; color: #92a2b1; cursor: pointer; margin-left: 10px; transition: color 0.2s; }
                .modal-delete-btn:hover { color: #d32f2f; }
                /* Error Modal Styles */
                .error-modal { background: #fff; width: 450px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); animation: slideDown 0.3s ease-out; }
                .error-modal-header { padding: 20px; border-bottom: 1px solid #ebeff3; background: #fff3e0; display: flex; align-items: center; gap: 12px; }
                .error-modal-icon { width: 48px; height: 48px; background: #ff9800; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
                .error-modal-icon svg { width: 28px; height: 28px; fill: #fff; }
                .error-modal-header-text { flex: 1; }
                .error-modal-header-title { font-size: 18px; font-weight: 600; color: #e65100; margin: 0 0 4px 0; }
                .error-modal-header-subtitle { font-size: 13px; color: #f57c00; margin: 0; }
                .error-modal-body { padding: 20px; }
                .error-modal-message { font-size: 14px; color: #475867; line-height: 1.6; margin: 0 0 16px 0; }
                .error-modal-details { background: #f5f7f9; padding: 12px; border-radius: 6px; border-left: 3px solid #ff9800; }
                .error-modal-detail-row { font-size: 13px; color: #183247; margin: 6px 0; }
                .error-modal-detail-label { font-weight: 600; color: #475867; }
                .error-modal-detail-value { color: #2c5cc5; font-weight: 500; }
                .error-modal-footer { padding: 16px 20px; background: #f5f7f9; display: flex; justify-content: flex-end; gap: 10px; }
                .error-modal-btn { padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; border: none; cursor: pointer; transition: all 0.2s; }
                .error-modal-btn-primary { background: #ff9800; color: #fff; }
                .error-modal-btn-primary:hover { background: #f57c00; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(255,152,0,0.3); }
                @keyframes slideDown { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                /* Custom Dropdown Styles */
                .custom-dropdown-container { position: relative; width: 100%; }
                .custom-dropdown-input { width: 100%; padding: 8px 30px 8px 10px; border: 1px solid #cfd7df; border-radius: 4px; font-size: 13px; background: #fff; box-sizing: border-box; height: 34px; cursor: pointer; transition: border-color 0.2s, box-shadow 0.2s; background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="%23475867"><path d="M7 10l5 5 5-5z"/></svg>'); background-repeat: no-repeat; background-position: right 10px center; }
                .custom-dropdown-input:focus { border-color: #2c5cc5; box-shadow: 0 0 0 2px rgba(44, 92, 197, 0.2); outline: none; }
                .custom-dropdown-list { position: absolute; top: 100%; left: 0; width: 100%; max-height: 180px; overflow-y: auto; background: #fff; border: 1px solid #cfd7df; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000; display: none; margin-top: 4px; }
                .custom-dropdown-item { padding: 8px 12px; font-size: 13px; color: #183247; cursor: pointer; border-bottom: 1px solid #f5f7f9; transition: background 0.1s; }
                .custom-dropdown-item:last-child { border-bottom: none; }
                .custom-dropdown-item:hover { background: #f0f4fa; color: #2c5cc5; }
                .custom-dropdown-item.selected { background: #e8f5e9; font-weight: 600; }
                /* Scrollbar for dropdown */
                .custom-dropdown-list::-webkit-scrollbar { width: 6px; }
                .custom-dropdown-list::-webkit-scrollbar-track { background: #f1f1f1; }
                .custom-dropdown-list::-webkit-scrollbar-thumb { background: #c1c7d0; border-radius: 3px; }
                .custom-dropdown-list::-webkit-scrollbar-thumb:hover { background: #a0a6b0; }
            `;
            document.head.appendChild(style);
        }

        function injectModal() {
            if (document.getElementById('call-tracker-modal')) return;
            const modalHTML = `
                <div class="call-modal-overlay" id="call-tracker-modal">
                    <div class="call-modal">
                        <div class="call-modal-header">
                            <div class="call-modal-title-row">
                                <div style="display:flex; align-items:center;">
                                    <span class="call-modal-title" id="modal-title-text">Call History</span>
                                    <span class="modal-clear-btn" id="modal-clear-btn">Clear All</span>
                                </div>
                                <span class="call-modal-close" id="modal-close-btn">&times;</span>
                            </div>
                            <div class="call-modal-subtitle" id="modal-subtitle-text"></div>
                        </div>
                        <div class="call-modal-body" id="modal-list-body"></div>
                    </div>
                </div>
                <div class="call-modal-overlay" id="error-modal-overlay">
                    <div class="error-modal">
                        <div class="error-modal-header">
                            <div class="error-modal-icon">
                                <svg viewBox="0 0 24 24">
                                    <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
                                </svg>
                            </div>
                            <div class="error-modal-header-text">
                                <h3 class="error-modal-header-title" id="error-modal-title">Time Slot Conflict</h3>
                                <p class="error-modal-header-subtitle" id="error-modal-subtitle">Cannot add duplicate time slot</p>
                            </div>
                        </div>
                        <div class="error-modal-body">
                            <p class="error-modal-message" id="error-modal-message"></p>
                            <div class="error-modal-details" id="error-modal-details"></div>
                        </div>
                        <div class="error-modal-footer">
                            <button class="error-modal-btn error-modal-btn-primary" id="error-modal-ok">Got It</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            document.getElementById('modal-close-btn').addEventListener('click', () => {
                document.getElementById('call-tracker-modal').classList.remove('active');
            });
            document.getElementById('error-modal-ok').addEventListener('click', () => {
                document.getElementById('error-modal-overlay').classList.remove('active');
            });
            // Close on overlay click
            document.getElementById('error-modal-overlay').addEventListener('click', (e) => {
                if (e.target.id === 'error-modal-overlay') {
                    document.getElementById('error-modal-overlay').classList.remove('active');
                }
            });
        }

        function showErrorModal(title, subtitle, message, details = {}) {
            const modal = document.getElementById('error-modal-overlay');
            if (!modal) return;

            document.getElementById('error-modal-title').textContent = title;
            document.getElementById('error-modal-subtitle').textContent = subtitle;
            document.getElementById('error-modal-message').textContent = message;

            const detailsContainer = document.getElementById('error-modal-details');
            detailsContainer.innerHTML = '';

            Object.entries(details).forEach(([key, value]) => {
                const row = document.createElement('div');
                row.className = 'error-modal-detail-row';
                row.innerHTML = `<span class="error-modal-detail-label">${key}:</span> <span class="error-modal-detail-value">${value}</span>`;
                detailsContainer.appendChild(row);
            });

            modal.classList.add('active');
        }

        function injectLeftIcon() {
            const navList = document.querySelector('ul.nav-list') || document.querySelector('.navbar-body ul');
            if (navList && !document.getElementById('call-history-nav-item')) {
                const li = document.createElement('li');
                li.id = 'call-history-nav-item';
                li.className = 'navbar-item nav-item-call-history hint--right';
                li.setAttribute('aria-label', 'Your Call History');
                li.innerHTML = `
                    <div class="nav-link">
                        <span class="nav-icon-wrapper">
                            <svg class="call-history-icon" viewBox="0 0 24 24">
                                <path d="M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3M12,8V13L16.28,15.54L17,14.33L13.5,12.25V8H12Z" />
                            </svg>
                        </span>
                    </div>
                `;
                li.addEventListener('click', openLocalHistoryModal);
                navList.appendChild(li);
            }
        }

        function checkAndInjectRightWidget() {
            // Do not inject on list views (URLs containing /filters, /search, or /dashboard)
            const url = window.location.href.toLowerCase();
            if (url.includes('/filters') || url.includes('/search') || url.includes('/dashboard')) {
                const existingWidget = document.getElementById('calls-widget-container');
                if (existingWidget) existingWidget.remove();
                return;
            }

            // Check if we are on the dashboard/list view (indicated by Export button)
            if (document.querySelector('[data-test-id="ticket-list-export"]')) {
                // If widget exists but we are now on dashboard, remove it
                const existingWidget = document.getElementById('calls-widget-container');
                if (existingWidget) existingWidget.remove();
                return;
            }

            if (document.querySelector('[data-test-id="group-agent"]')) {
                injectRightWidget();
            }
        }

        function injectRightWidget() {
            const agentContainer = document.querySelector('[data-test-id="group-agent"]');
            if (agentContainer && !document.getElementById('calls-widget-container')) {
                const widget = document.createElement('div');
                widget.id = 'calls-widget-container';
                widget.className = 'calls-widget-container';
                widget.innerHTML = `
                    <div class="calls-widget-header" id="calls-widget-toggle">
                        <span>Calls</span>
                        <svg width="10" height="10" viewBox="0 0 24 24" style="fill:#475867"><path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>
                    </div>
                    <div class="calls-widget-content" id="calls-widget-body">
                        <div class="call-input-row"><label class="call-label">Date</label><input type="date" id="widget-date" class="call-input"></div>
                        <div class="call-input-row" style="display: flex; gap: 5px;">
                            <div style="flex: 1; min-width: 0;">
                                <label class="call-label">Start Time</label>
                                <input type="time" id="widget-start-time" class="call-input">
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <label class="call-label">End Time</label>
                                <input type="time" id="widget-end-time" class="call-input">
                            </div>
                        </div>
                        <div class="call-input-row">
                            <label class="call-label">Agent</label>
                            <div style="display:flex; align-items:center;">
                            <div style="display:flex; align-items:center;">
                                <div class="custom-dropdown-container" id="agent-dropdown-container">
                                    <input type="text" id="widget-agent" class="custom-dropdown-input" placeholder="Select Agent" autocomplete="off">
                                    <div id="agent-dropdown-list" class="custom-dropdown-list"></div>
                                </div>
                                <button type="button" id="widget-agent-refresh" style="background:none; border:none; cursor:pointer; margin-left:5px; padding:0;" title="Refresh Agent List">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#475867"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                                </button>
                            </div>
                        </div>
                        <div class="call-input-row" style="justify-content: flex-start; align-items: center;">
                            <input type="checkbox" id="widget-adhoc-toggle" style="margin-right: 5px;">
                            <label for="widget-adhoc-toggle" style="font-size: 12px; color: #475867; margin-right: 5px;">Adhoc?</label>
                            <span title="For adhoc calls toggle this to on" style="cursor: help; font-size: 12px; border: 1px solid #ccc; border-radius: 50%; width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; color: #666;">?</span>
                        </div>
                        <div class="call-input-row"><label class="call-label">Notes (Max 50)</label><input type="text" id="widget-notes" class="call-input" maxlength="50" placeholder="Short description..."></div>
                        <button type="button" id="widget-add-btn" class="call-btn btn-add">Add Call</button>
                        <button type="button" id="widget-check-btn" class="call-btn btn-check">Check Calls for Ticket</button>
                        <div id="widget-msg" style="font-size:11px; color:green; margin-top:5px; display:none; text-align:center;">Saved!</div>
                    </div>
                `;
                agentContainer.parentNode.insertBefore(widget, agentContainer.nextSibling);

                // Prefill Date
                document.getElementById('widget-date').valueAsDate = new Date();

                const now = new Date();
                document.getElementById('widget-start-time').value = now.toTimeString().substring(0, 5);

                const agentInput = document.getElementById('widget-agent');
                const setAgentName = () => {
                    const name = getAgentName();
                    if (name) agentInput.value = name;
                    return !!name;
                };

                // Initial try
                if (!setAgentName()) {
                    // Retry logic if not found immediately
                    setTimeout(() => { if (!agentInput.value) setAgentName(); }, 1000);
                    setTimeout(() => { if (!agentInput.value) setAgentName(); }, 2000);
                    setTimeout(() => { if (!agentInput.value) setAgentName(); }, 3500);
                }

                // Refresh button logic
                document.getElementById('widget-agent-refresh').addEventListener('click', () => {
                    populateAgentDropdown(); // Trigger fetch/populate
                    const found = setAgentName();
                    if (!found) {
                        const btn = document.getElementById('widget-agent-refresh');
                        const originalHtml = btn.innerHTML;
                        btn.innerHTML = '<span style="font-size:10px; color:red;">!</span>';
                        setTimeout(() => btn.innerHTML = originalHtml, 1000);
                    }
                });

                // Initial population
                populateAgentDropdown();

                // Debug button logic
                /*
                document.getElementById('widget-debug-btn').addEventListener('click', () => {
                    let msg = "Debug Info:\n";
                    const labelTitle = document.querySelector('label[title="Agent"]');
                    msg += `Label[title="Agent"]: ${labelTitle ? "Found" : "Not Found"}\n`;

                    const labels = Array.from(document.querySelectorAll('label'));
                    const labelText = labels.find(l => l.textContent.trim() === 'Agent');
                    msg += `Label[text="Agent"]: ${labelText ? "Found" : "Not Found"}\n`;

                    if (labelTitle && labelTitle.parentElement) {
                        const val = labelTitle.parentElement.querySelector('.filter-field-value');
                        msg += `Value (Title): ${val ? val.textContent.trim() : "Not Found"}\n`;
                    }
                    if (labelText && labelText.parentElement) {
                        const val = labelText.parentElement.querySelector('.filter-field-value');
                        msg += `Value (Text): ${val ? val.textContent.trim() : "Not Found"}\n`;
                    }

                    const emberAgent = document.querySelector('div[data-test-id="Agent"]');
                    msg += `Ember Agent Div: ${emberAgent ? "Found" : "Not Found"}\n`;
                    if (emberAgent) {
                        const val = emberAgent.querySelector('.ember-power-select-selected-item');
                        msg += `Value (Ember): ${val ? val.textContent.trim() : "Not Found"}\n`;
                    }

                    msg += `Current Value: ${document.getElementById('widget-agent').value}`;
                    alert(msg);
                });
                */

                // Custom Dropdown Logic
                const dropdownInput = document.getElementById('widget-agent');
                const dropdownList = document.getElementById('agent-dropdown-list');

                // Show list on focus/click
                dropdownInput.addEventListener('focus', () => {
                    dropdownList.style.display = 'block';
                    filterDropdown();
                });
                dropdownInput.addEventListener('click', () => {
                    dropdownList.style.display = 'block';
                    filterDropdown();
                });

                // Filter on input
                dropdownInput.addEventListener('input', filterDropdown);

                function filterDropdown() {
                    const filter = dropdownInput.value.toLowerCase();
                    const items = dropdownList.querySelectorAll('.custom-dropdown-item');
                    let hasVisible = false;
                    items.forEach(item => {
                        const text = item.textContent.toLowerCase();
                        if (text.includes(filter)) {
                            item.style.display = 'block';
                            hasVisible = true;
                        } else {
                            item.style.display = 'none';
                        }
                    });
                    dropdownList.style.display = hasVisible ? 'block' : 'none';
                }

                // Hide on outside click
                document.addEventListener('click', (e) => {
                    if (!document.getElementById('agent-dropdown-container').contains(e.target)) {
                        dropdownList.style.display = 'none';
                        // Validate on blur/close
                        validateSelection();
                    }
                });

                function validateSelection() {
                    const currentVal = dropdownInput.value;
                    const items = Array.from(dropdownList.querySelectorAll('.custom-dropdown-item'));
                    const match = items.find(item => item.textContent === currentVal);
                    if (!match && currentVal !== "") {
                        // Optional: Clear if invalid, or just let save validation handle it
                        // dropdownInput.value = ""; 
                    }
                }

                // Also try on focus if still empty
                dropdownInput.addEventListener('focus', () => {
                    if (!dropdownInput.value) setAgentName();
                });

                // Time Validation Logic
                const startInput = document.getElementById('widget-start-time');
                const endInput = document.getElementById('widget-end-time');

                startInput.addEventListener('change', () => {
                    if (startInput.value) {
                        endInput.min = startInput.value;
                        // If end time is set and is less than start time, clear it
                        if (endInput.value && endInput.value < startInput.value) {
                            endInput.value = "";
                        }
                    }
                });

                document.getElementById('widget-add-btn').addEventListener('click', saveFirebaseCall);
                document.getElementById('widget-check-btn').addEventListener('click', checkFirebaseCalls);
            }
        }

        async function saveFirebaseCall(e) {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const btn = document.getElementById('widget-add-btn');
            const dateVal = document.getElementById('widget-date').value;
            const startTime = document.getElementById('widget-start-time').value;
            const endTime = document.getElementById('widget-end-time').value;
            const notes = document.getElementById('widget-notes').value;
            const agent = document.getElementById('widget-agent').value.trim();
            const isAdhoc = document.getElementById('widget-adhoc-toggle').checked;

            if (!dateVal) { alert("Please select a Date"); return; }
            if (!startTime) { alert("Please enter Start Time"); return; }
            if (!endTime) { alert("Please enter End Time"); return; }
            if (startTime > endTime) { alert("End Time cannot be earlier than Start Time"); return; }
            if (!agent) { alert("Please select an Agent"); return; }

            // Validate Agent against Custom List
            const dropdownList = document.getElementById('agent-dropdown-list');
            if (dropdownList) {
                const items = Array.from(dropdownList.querySelectorAll('.custom-dropdown-item')).map(i => i.textContent);
                if (!items.includes(agent)) {
                    alert("Please select a valid Agent from the list.");
                    return;
                }
            }

            const ticketId = isAdhoc ? "Adhoc" : getTicketId();
            if (!ticketId) { alert("Ticket ID not found"); return; }

            btn.innerText = "Checking..."; btn.disabled = true;

            // Check for duplicate time slots for the same agent and date
            try {
                console.log("[Meeting Tracker] Validating time slot...");
                console.log("[Meeting Tracker] Agent:", agent);
                console.log("[Meeting Tracker] Date:", dateVal);
                console.log("[Meeting Tracker] Time:", startTime, "-", endTime);

                const response = await fetch(`${FIREBASE_URL}?auth=${FIREBASE_SECRET}`);
                const allData = await response.json();

                console.log("[Meeting Tracker] Fetched data:", allData ? Object.keys(allData).length : 0, "entries");

                if (allData) {
                    const newStart = new Date(dateVal + 'T' + startTime + ':00');
                    const newEnd = new Date(dateVal + 'T' + endTime + ':00');
                    const newDateStr = dateVal; // YYYY-MM-DD format

                    console.log("[Meeting Tracker] New slot:", newStart.toISOString(), "to", newEnd.toISOString());

                    let checkedCount = 0;
                    // Check all existing calls for the same agent
                    for (const [key, call] of Object.entries(allData)) {
                        // Skip deleted entries and non-object entries
                        if (!call || typeof call !== 'object' || call.isDeleted) continue;

                        // Only check calls for the same agent
                        if (call.agent !== agent) continue;

                        // Check if the call is on the same date
                        if (call.start) {
                            const existingStart = new Date(call.start);
                            const existingDateStr = call.start.substring(0, 10); // Extract YYYY-MM-DD

                            // Only compare if on the same date
                            if (existingDateStr === newDateStr) {
                                checkedCount++;
                                const existingEnd = call.end ? new Date(call.end) : null;

                                console.log(`[Meeting Tracker] Checking existing slot #${checkedCount}:`, existingStart.toISOString(), "to", existingEnd ? existingEnd.toISOString() : "null");

                                // Check for time overlap
                                // Overlap occurs if:
                                // 1. New start time falls within existing time range
                                // 2. New end time falls within existing time range
                                // 3. New time range completely contains existing time range
                                // 4. Same start/end times (exact match)
                                if (existingEnd) {
                                    const hasOverlap =
                                        (newStart >= existingStart && newStart < existingEnd) ||  // New start overlaps
                                        (newEnd > existingStart && newEnd <= existingEnd) ||      // New end overlaps
                                        (newStart <= existingStart && newEnd >= existingEnd) ||   // New contains existing
                                        (newStart.getTime() === existingStart.getTime() && newEnd.getTime() === existingEnd.getTime()); // Exact match

                                    console.log("[Meeting Tracker] Overlap detected:", hasOverlap);

                                    if (hasOverlap) {
                                        btn.innerText = "Add Call";
                                        btn.disabled = false;

                                        const existingTimeStr = existingStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
                                            " - " + existingEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                                        console.log("[Meeting Tracker] BLOCKING: Duplicate time slot found!");
                                        showErrorModal(
                                            'Time Slot Conflict Detected',
                                            'This agent already has a call scheduled during this time period.',
                                            `Agent "${agent}" already has a call scheduled on ${newDateStr} from ${existingTimeStr}.`,
                                            {
                                                'Agent': agent,
                                                'Date': newDateStr,
                                                'Requested Time': `${startTime} - ${endTime}`,
                                                'Conflict With': existingTimeStr
                                            }
                                        );
                                        return;
                                    }
                                }
                            }
                        }
                    }
                    console.log(`[Meeting Tracker] Validation passed. Checked ${checkedCount} existing slots for same agent/date.`);
                }
            } catch (err) {
                console.error("[Meeting Tracker] Error checking for duplicates:", err);
                btn.innerText = "Add Call";
                btn.disabled = false;
                alert("Failed to validate time slot. Please try again.");
                return;
            }

            btn.innerText = "Saving...";

            const payload = {
                ticketId: ticketId,
                start: dateVal + 'T' + startTime + ':00',
                end: endTime ? (dateVal + 'T' + endTime + ':00') : null,
                notes: notes,
                agent: agent,
                timestamp: Date.now(),
                createdAt: new Date().toISOString()
            };

            try {
                await fetch(`${FIREBASE_URL}?auth=${FIREBASE_SECRET}`, {
                    method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }
                });
                const msg = document.getElementById('widget-msg');
                msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000);
                document.getElementById('widget-notes').value = "";
                document.getElementById('widget-end-time').value = "";
            } catch (e) { console.error(e); alert("Failed to save."); } finally { btn.innerText = "Add Call"; btn.disabled = false; }
        }

        function openLocalHistoryModal(e) {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            document.getElementById('modal-title-text').innerText = "Your Call History";
            const subTitle = document.getElementById('modal-subtitle-text');
            subTitle.innerText = "(may not be 100% accurate and is based on call you take in browser only)";
            subTitle.style.display = 'block';

            const modal = document.getElementById('call-tracker-modal');
            const listBody = document.getElementById('modal-list-body');
            const clearBtn = document.getElementById('modal-clear-btn');

            listBody.innerHTML = '<div style="padding:20px; text-align:center;">Loading...</div>';
            modal.classList.add('active');
            clearBtn.style.display = 'none';

            clearBtn.onclick = (evt) => {
                if (evt) { evt.preventDefault(); evt.stopPropagation(); }
                if (confirm("Are you sure you want to clear your local call history?")) {
                    chrome.storage.local.set({ history: [] }, () => {
                        listBody.innerHTML = '<div style="padding:20px; text-align:center;">No automated recordings found.</div>';
                        clearBtn.style.display = 'none';
                    });
                }
            };

            chrome.storage.local.get({ history: [] }, (data) => {
                const history = data.history || [];
                if (history.length === 0) {
                    listBody.innerHTML = '<div style="padding:20px; text-align:center;">No automated recordings found.</div>';
                    clearBtn.style.display = 'none';
                    return;
                }
                clearBtn.style.display = 'inline-block';
                let html = '';
                history.forEach(log => {
                    const startDate = new Date(log.start);
                    const endDate = new Date(log.end);
                    const dateStr = startDate.toLocaleDateString();
                    const timeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + " - " + endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    function formatDuration(ms) {
                        const seconds = Math.floor((ms / 1000) % 60);
                        const minutes = Math.floor((ms / (1000 * 60)) % 60);
                        const hours = Math.floor((ms / (1000 * 60 * 60)));
                        if (hours > 0) return `${hours}h ${minutes}m`;
                        return `${minutes}m ${seconds}s`;
                    }

                    const durationStr = formatDuration(log.end - log.start);
                    const tid = log.ticketId ? `#${log.ticketId}` : ':';
                    html += `
                        <div class="modal-list-item">
                            <div>
                                <div class="modal-time-block">${timeStr} <span class="modal-tag">${tid}</span> <span class="modal-duration">${durationStr}</span></div>
                                <div class="modal-note">Automated Recording</div>
                            </div>
                            <div class="modal-date">${dateStr}</div>
                        </div>`;
                });
                listBody.innerHTML = html;
            });
        }

        async function checkFirebaseCalls() {
            const isAdhoc = document.getElementById('widget-adhoc-toggle').checked;
            const agentName = document.getElementById('widget-agent').value.trim();

            if (isAdhoc && !agentName) {
                alert("Please enter Agent Name to check Adhoc calls.");
                return;
            }

            const ticketId = isAdhoc ? "Adhoc" : getTicketId();
            if (!ticketId) { alert("Ticket ID not found"); return; }

            const modal = document.getElementById('call-tracker-modal');
            const listBody = document.getElementById('modal-list-body');
            document.getElementById('modal-title-text').innerText = isAdhoc ? `Adhoc Calls (${agentName})` : `Manual Logs for Ticket #${ticketId}`;
            document.getElementById('modal-subtitle-text').style.display = 'none';
            document.getElementById('modal-clear-btn').style.display = 'none'; // Hide clear button for firebase calls

            listBody.innerHTML = '<div style="padding:20px; text-align:center;">Loading...</div>';
            modal.classList.add('active');

            // Fetch ALL data and filter client-side to avoid indexing issues and "test_data" keys
            fetch(`${FIREBASE_URL}?auth=${FIREBASE_SECRET}`)
                .then(r => r.json())
                .then(data => {
                    if (!data) {
                        listBody.innerHTML = '<div style="padding:20px; text-align:center;">No calls found.</div>';
                        return;
                    }

                    let calls = [];
                    Object.entries(data).forEach(([key, c]) => {
                        // Filter out non-object keys like "test_data" and ensure ticketId matches
                        if (typeof c === 'object' && c !== null && c.ticketId && !c.isDeleted) {
                            if (c.ticketId == ticketId) {
                                calls.push({ ...c, id: key });
                            }
                        }
                    });

                    // Filter by agent if Adhoc
                    if (isAdhoc) {
                        calls = calls.filter(c => c.agent === agentName);
                    }

                    if (calls.length === 0) {
                        listBody.innerHTML = '<div style="padding:20px; text-align:center;">No calls found for this ticket/agent.</div>';
                        return;
                    }

                    // Sort by timestamp desc
                    calls.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

                    let html = '';
                    calls.forEach(c => {
                        const start = c.start ? new Date(c.start) : new Date();
                        const timeStr = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const endStr = c.end ? new Date(c.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Ongoing';
                        const note = c.notes || '';
                        const agent = c.agent || 'Unknown';

                        html += `
                            <div class="modal-list-item">
                                <div>
                                    <div class="modal-time-block">${timeStr} - ${endStr}</div>
                                    <div class="modal-note">${note}</div>
                                    <div class="modal-agent">Agent: ${agent}</div>
                                </div>
                                <div style="display:flex; align-items:center;">
                                    <div class="modal-date">${start.toLocaleDateString()}</div>
                                    <span class="modal-delete-btn" data-id="${c.id}" title="Delete Call">&times;</span>
                                </div>
                            </div>`;
                    });
                    listBody.innerHTML = html;

                    // Add Delete Listeners
                    document.querySelectorAll('.modal-delete-btn').forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            const callId = e.target.getAttribute('data-id');
                            if (confirm("Are you sure you want to delete this call?")) {
                                const email = await new Promise(resolve => chrome.storage.local.get(['currentUserEmail'], res => resolve(res.currentUserEmail || 'unknown')));

                                try {
                                    await fetch(`${FIREBASE_URL.replace('.json', '')}/${callId}.json?auth=${FIREBASE_SECRET}`, {
                                        method: 'PATCH',
                                        body: JSON.stringify({
                                            isDeleted: true,
                                            deletedBy: email,
                                            deletedAt: new Date().toISOString()
                                        }),
                                        headers: { 'Content-Type': 'application/json' }
                                    });
                                    checkFirebaseCalls(); // Refresh list
                                } catch (err) {
                                    console.error("Delete failed", err);
                                    alert("Failed to delete call.");
                                }
                            }
                        });
                    });
                })
                .catch(e => {
                    console.error(e);
                    listBody.innerHTML = '<div style="padding:20px; text-align:center; color:red;">Error loading calls.</div>';
                });
        }
    }

    async function fetchAgentsAndGroups() {
        const CACHE_KEY = 'freshdesk_agents_cache';
        const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

        const now = Date.now();
        const data = await new Promise(resolve => chrome.storage.local.get([CACHE_KEY], resolve));
        const cache = data[CACHE_KEY];

        if (cache && (now - cache.timestamp < CACHE_DURATION)) {
            console.log("Meeting Tracker: Using cached agents data");
            return cache.data;
        }

        console.log("Meeting Tracker: Fetching fresh agents data");
        try {
            const response = await fetch('https://razorpay-ind.freshdesk.com/api/_/bootstrap/agents_groups');
            const json = await response.json();
            const newData = { agents: json.data.agents, groups: json.data.groups };

            chrome.storage.local.set({
                [CACHE_KEY]: {
                    data: newData,
                    timestamp: now
                }
            });
            return newData;
        } catch (e) {
            console.error("Meeting Tracker: Failed to fetch agents", e);
            return cache ? cache.data : { agents: [], groups: [] }; // Fallback to stale cache if available
        }
    }

    async function populateAgentDropdown() {
        try {
            const { agents, groups } = await fetchAgentsAndGroups();
            const groupName = getCurrentTicketGroup();
            console.log("Meeting Tracker: Current Group:", groupName);

            let filteredAgents = agents;
            if (groupName) {
                const group = groups.find(g => g.name.trim() === groupName.trim());
                if (group) {
                    filteredAgents = agents.filter(a => a.group_ids && a.group_ids.includes(group.id));
                }
            }

            // Filter out bots
            filteredAgents = filteredAgents.filter(agent =>
                agent.contact && agent.contact.name && !agent.contact.name.toLowerCase().includes('bot')
            );

            const dropdownList = document.getElementById('agent-dropdown-list');
            if (dropdownList) {
                dropdownList.innerHTML = '';
                filteredAgents.forEach(agent => {
                    const div = document.createElement('div');
                    div.className = 'custom-dropdown-item';
                    div.textContent = agent.contact.name;
                    div.addEventListener('click', () => {
                        document.getElementById('widget-agent').value = agent.contact.name;
                        dropdownList.style.display = 'none';
                    });
                    dropdownList.appendChild(div);
                });
                console.log(`Meeting Tracker: Populated dropdown with ${filteredAgents.length} agents.`);
            }
        } catch (e) {
            console.error("Meeting Tracker: Error populating dropdown", e);
        }
    }

    function getCurrentTicketGroup() {
        try {
            // Strategy 1: Look for label with title="Group" inside a disabled field structure
            // <div data-test-id="filter-disabled-field" ...> <label ... title="Group">Group</label> <div class="disabledField"> <span ... class="filter-field-value">VALUE</span> </div> </div>
            const groupLabel = document.querySelector('label[title="Group"]');
            if (groupLabel) {
                // Check siblings/parent for the value
                // Based on user snippet: label is sibling to div.disabledField which contains span.filter-field-value
                const parent = groupLabel.parentElement;
                if (parent) {
                    const valSpan = parent.querySelector('.filter-field-value');
                    if (valSpan) return valSpan.textContent.trim();
                }
            }

            // Strategy 2: Fallback to previous Ember Power Select logic if needed (though user snippet shows disabled field)
            const labels = Array.from(document.querySelectorAll('label, .title'));
            const groupLabelText = labels.find(el => el.textContent.trim() === 'Group');

            if (groupLabelText) {
                let container = groupLabelText.parentElement;
                let valueSpan = container.querySelector('.ember-power-select-selected-item');

                if (!valueSpan) {
                    if (container.nextElementSibling) {
                        valueSpan = container.nextElementSibling.querySelector('.ember-power-select-selected-item');
                    }
                }

                if (valueSpan) return valueSpan.textContent.trim();
            }
        } catch (e) {
            console.error("Meeting Tracker: Error getting group", e);
        }
        return "";
    }
}