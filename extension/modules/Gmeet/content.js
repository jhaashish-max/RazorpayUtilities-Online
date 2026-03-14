{
    // --- State ---
    const DEFAULT_EMAIL = "ayush.saxena@razorpay.com";
    let currentUserEmail = DEFAULT_EMAIL;
    let viewingUserEmail = DEFAULT_EMAIL;
    let cachedData = {};

    // --- Initialization ---
    chrome.storage.local.get(['currentUserEmail'], (result) => {
        if (result.currentUserEmail) {
            currentUserEmail = result.currentUserEmail;
            viewingUserEmail = currentUserEmail;
        }
    });

    // ===== TEST BUTTON (COMMENTED OUT) =====
    // const testBtn = document.createElement('button');
    // testBtn.id = 'rzp-test-notification-btn';
    // testBtn.innerHTML = '🧪 Test Notification';
    // testBtn.style.cssText = `
    //     position: fixed !important;
    //     bottom: 80px !important;
    //     right: 20px !important;
    //     z-index: 999999 !important;
    //     background: #ff6b6b !important;
    //     color: white !important;
    //     border: none !important;
    //     padding: 12px 20px !important;
    //     border-radius: 8px !important;
    //     font-size: 14px !important;
    //     font-weight: bold !important;
    //     cursor: pointer !important;
    //     box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
    // `;
    // testBtn.onclick = function() {
    //     console.log("🧪 Test button clicked!");
    //     const testMeeting = {
    //         title: "TEST Meeting - Click Test",
    //         organizer: "test.user@razorpay.com",
    //         startTime: new Date().toISOString(),
    //         gmeetLink: "https://meet.google.com/test-link"
    //     };
    //     showFlash(testMeeting, "soon");
    // };
    // document.body.appendChild(testBtn);
    // console.log("🧪 TEST BUTTON added to bottom-right corner - click it to test notification!");




    // Button Injection Observer
    const observer = new MutationObserver(() => {
        let container = document.querySelector('.page-actions__right') || document.querySelector('[data-test-id="header-create-new"]')?.parentElement || document.querySelector('.ticket-page-toolbar');

        if (!container) {
            const candidates = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"], span'));
            // Look for "Tracker" or "New" button
            const newBtn = candidates.find(el => {
                const text = el.innerText || "";
                if (!text.match(/new/i) && !text.match(/tracker/i)) return false;
                const rect = el.getBoundingClientRect();
                return rect.top < 150 && rect.height > 0 && rect.width > 0 && rect.width < 200;
            });
            if (newBtn) container = newBtn.parentElement;
        }

        const existingButton = document.getElementById('rzp-meeting-toggle-btn');
        if (container && !existingButton) injectMeetingButton(container);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function injectMeetingButton(container) {
        const btnContainer = document.createElement('div');
        btnContainer.className = 'pull-right';
        btnContainer.style.marginRight = '10px';
        const button = document.createElement('button');
        button.id = 'rzp-meeting-toggle-btn';
        button.className = 'btn btn--transparent btn--date-select scale-none p0 min-width-45 transparent-border rzp-nav-btn';
        button.innerHTML = `<span class="rzp-icon">📅</span><span style="color: #2c5cc5; font-weight: 600;">Meetings</span>`;
        button.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleDashboard(); };
        container.insertBefore(btnContainer, container.firstChild);
        btnContainer.appendChild(button);
    }

    // --- Dashboard Logic ---
    function toggleDashboard() {
        const existing = document.getElementById('rzp-dashboard-overlay');
        existing ? closeDashboard() : openDashboard();
    }

    async function openDashboard() {
        let backdrop = document.getElementById('rzp-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'rzp-backdrop';
            backdrop.className = 'rzp-backdrop';
            backdrop.onclick = closeDashboard;
            document.body.appendChild(backdrop);
        }
        setTimeout(() => backdrop.classList.add('visible'), 10);

        const overlay = document.createElement('div');
        overlay.id = 'rzp-dashboard-overlay';
        overlay.innerHTML = `
        <div class="rzp-header">
            <h2>My Schedule</h2>
            <div class="rzp-search-wrapper">
                <input type="text" id="rzp-search-input" placeholder="Search colleague..." autocomplete="off">
                <span id="rzp-close-search" class="rzp-search-icon-close">✕</span>
                <div id="rzp-search-results" class="rzp-dropdown"></div>
            </div>
        </div>
        <div id="rzp-reset-view" style="display:none;">
            <span>Viewing: <strong id="rzp-viewing-name">Someone</strong></span>
            <button id="rzp-back-btn">BACK TO ME</button>
        </div>
        <div class="rzp-body" id="rzp-content-area">
            <!-- Initial content will be injected via JS -->
        </div>
    `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('open'));

        // Bind Events
        document.getElementById('rzp-close-search').onclick = closeDashboard;
        document.getElementById('rzp-search-input').addEventListener('input', (e) => handleSearch(e.target.value));
        document.getElementById('rzp-back-btn').onclick = () => {
            viewingUserEmail = currentUserEmail;
            updateHeaderState();
            renderRows(cachedData[viewingUserEmail] || []);
        };

        // Load Data: Cache First, then Network
        await loadData();
    }

    function closeDashboard() {
        const overlay = document.getElementById('rzp-dashboard-overlay');
        const backdrop = document.getElementById('rzp-backdrop');
        if (overlay) {
            overlay.classList.remove('open');
            setTimeout(() => overlay.remove(), 300);
        }
        if (backdrop) {
            backdrop.classList.remove('visible');
            setTimeout(() => backdrop.remove(), 300);
        }
        if (currentUserEmail) viewingUserEmail = currentUserEmail;
    }

    // --- Fetching & Loading ---
    async function loadData() {
        const contentArea = document.getElementById('rzp-content-area');

        // 1. Try Local Storage (Instant)
        const localResult = await chrome.storage.local.get(['cachedMeetings']);
        if (localResult.cachedMeetings) {
            cachedData = localResult.cachedMeetings;
            updateHeaderState();
            renderRows(cachedData[viewingUserEmail] || []);
        } else {
            if (contentArea) contentArea.innerHTML = `<div class="rzp-loader">Loading schedule...</div>`;
        }

        // 2. Fetch Fresh Data (Background)
        try {
            const response = await chrome.runtime.sendMessage({ action: "fetchMeetingsImmediate" });
            if (response && response.success) {
                cachedData = response.data;
                // Only re-render if we are still looking at the same view
                updateHeaderState();
                renderRows(cachedData[viewingUserEmail] || []);
            }
        } catch (error) {
            console.error("Background Fetch Error:", error);
            // If we have no data at all, show error
            if (!cachedData[viewingUserEmail] && contentArea) {
                contentArea.innerHTML = `<div class="rzp-error">Failed to sync. Please try again.</div>`;
            }
        }
    }

    // --- Rendering ---
    function renderRows(meetings) {
        const contentArea = document.getElementById('rzp-content-area');
        if (!contentArea) return;

        if (!meetings || meetings.length === 0) {
            contentArea.innerHTML = `
            <div class="rzp-empty">
                <div style="font-size: 48px; margin-bottom: 10px;">📅</div>
                <div>No meetings found</div>
            </div>`;
            return;
        }

        meetings.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

        let html = '';
        const getMeta = (isoDate) => {
            const d = new Date(isoDate);
            return {
                month: d.toLocaleDateString('en-US', { month: 'short' }),
                day: d.getDate(),
                weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
                time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
        };

        meetings.forEach(m => {
            const start = getMeta(m.startTime);
            const end = getMeta(m.endTime);
            const now = new Date();
            const isLive = now >= new Date(m.startTime) && now <= new Date(m.endTime);
            const isPast = now > new Date(m.endTime);

            let rowClass = 'rzp-ticket-row';
            if (isLive) rowClass += ' active-meeting';
            if (isPast) rowClass += ' past-meeting';

            let linkAction = (m.gmeetLink && m.gmeetLink.length > 5)
                ? `<a href="${m.gmeetLink}" target="_blank" class="rzp-btn rzp-btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg> Join</a>`
                : `<a href="https://calendar.google.com" target="_blank" class="rzp-btn rzp-btn-secondary">Calendar</a>`;

            const liveText = isLive ? `<span class="live-dot"></span> LIVE` : '';
            const avatar = formatNameFromEmail(m.organizer).charAt(0).toUpperCase();

            html += `
            <div class="${rowClass}">
                <div class="rzp-date-block">
                    <span class="rzp-d-day">${start.weekday}</span>
                    <span class="rzp-d-num">${start.day}</span>
                    <span class="rzp-d-month">${start.month}</span>
                </div>
                <div class="rzp-info-block">
                    <div class="rzp-time-badge">
                        ${start.time} - ${end.time}
                        ${liveText}
                    </div>
                    <div class="rzp-title" title="${m.title}">${m.title}</div>
                    <div class="rzp-organizer">
                        <span class="rzp-avatar">${avatar}</span>
                        ${formatNameFromEmail(m.organizer)}
                    </div>
                </div>
                <div class="rzp-action-block">${linkAction}</div>
            </div>
        `;
        });
        contentArea.innerHTML = html;
    }

    // --- Search ---
    function handleSearch(query) {
        const dropdown = document.getElementById('rzp-search-results');
        dropdown.innerHTML = '';
        if (!query || query.length < 2) { dropdown.style.display = 'none'; return; }

        const availableEmails = Object.keys(cachedData);
        const matches = availableEmails.filter(email => email.toLowerCase().includes(query.toLowerCase()));

        if (matches.length > 0) {
            dropdown.style.display = 'block';
            matches.forEach(email => {
                const div = document.createElement('div');
                div.className = 'rzp-search-item';
                div.innerHTML = `<b>${formatNameFromEmail(email)}</b><small>${email}</small>`;
                div.onclick = () => {
                    viewingUserEmail = email;
                    document.getElementById('rzp-search-input').value = '';
                    dropdown.style.display = 'none';
                    updateHeaderState();
                    renderRows(cachedData[email] || []);
                };
                dropdown.appendChild(div);
            });
        } else { dropdown.style.display = 'none'; }
    }

    function formatNameFromEmail(email) {
        if (!email) return "Unknown";
        return email.split('@')[0].split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    function updateHeaderState() {
        const resetBlock = document.getElementById('rzp-reset-view');
        const nameSpan = document.getElementById('rzp-viewing-name');
        if (viewingUserEmail !== currentUserEmail) {
            resetBlock.style.display = 'flex';
            nameSpan.innerText = formatNameFromEmail(viewingUserEmail);
        } else {
            resetBlock.style.display = 'none';
        }
    }

    // --- Notification Trigger ---
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === "triggerNotification") {
            showFlash(request.meeting, request.type);
        }
    });

    function showFlash(meeting, type) {
        // Ensure no duplicate/overlap
        const existing = document.getElementById('rzp-flash-card');
        if (existing) {
            existing.remove();
        }

        const div = document.createElement('div');
        div.id = 'rzp-flash-card';
        div.className = 'rzp-flash-card rzp-slide-in-right';  // CSS class + animation

        const url = (meeting.gmeetLink && meeting.gmeetLink.length > 5) ? meeting.gmeetLink : "https://calendar.google.com";
        const btnText = (meeting.gmeetLink && meeting.gmeetLink.length > 5) ? "Join" : "Calendar";
        const clockText = type === "now" ? "NOW" : "5m";

        div.innerHTML = `
        <div class="rzp-flash-left">
            <div class="rzp-flash-clock">${clockText}</div>
            ${type === 'soon' ? '<span>TO GO</span>' : ''}
        </div>
        <div class="rzp-flash-mid">
            <h4 title="${meeting.title}">${meeting.title}</h4>
            <p>${formatNameFromEmail(meeting.organizer)}</p>
        </div>
        <div class="rzp-flash-right">
            <a href="${url}" target="_blank" class="rzp-flash-join">${btnText}</a>
            <div id="rzp-flash-close" class="rzp-flash-dismiss">✕</div>
        </div>
    `;

        document.body.appendChild(div);

        // Close Handlers
        div.querySelector('#rzp-flash-close').onclick = () => {
            div.classList.add('rzp-slide-out-right');
            setTimeout(() => div.remove(), 500);
        };

        // Auto Dismiss
        setTimeout(() => {
            if (div.parentElement) {
                div.classList.add('rzp-slide-out-right');
                setTimeout(() => div.remove(), 500);
            }
        }, 30000);
    }

    // ===== TEST FUNCTION - Call from console =====
    window.testNotification = function (type = "soon") {
        console.log("🧪 Testing notification with type:", type);
        const testMeeting = {
            title: "Test Meeting - Manual Trigger",
            organizer: "test.user@razorpay.com",
            startTime: new Date().toISOString(),
            gmeetLink: "https://meet.google.com/test-link"
        };
        showFlash(testMeeting, type);
        console.log("✅ Test notification triggered!");
    };
    console.log("🧪 Notification test function available: window.testNotification('soon') or window.testNotification('now')");
}