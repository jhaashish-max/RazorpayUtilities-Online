(function () {
    'use strict';
    console.log("[Daily Tracker] Content script loaded successfully!");

    const CONFIG = {
        TICKET_STATUSES: ["Resolved", "Devrev/Tp", "Transfer/Merge", "WOC"],
        QUICK_ADD_STATUSES: ["Resolved", "Devrev/Tp", "Transfer/Merge", "WOC", "Invalid"],
        LEVEL: "L1"
    };

    // Global State
    let currentAgent = null;
    let editMode = false;
    let oldTicketId = null;
    let editDbId = null; // the Supabase primary key
    let allTicketsData = [];
    let allAgentsCache = []; // to populate invalid dropdown

    // Initialize level and config
    async function initializeDailyTracker() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['dailyTrackerLevel'], (result) => {
                if (!result.dailyTrackerLevel) {
                    showLevelPrompt(resolve);
                } else {
                    setLevelConfig(result.dailyTrackerLevel);
                    resolve(true);
                }
            });
        });
    }

    function setLevelConfig(level) {
        CONFIG.LEVEL = level;
        if (level === 'L2') {
            CONFIG.TICKET_STATUSES = ["Devrev", "Tp", "Transfer/Merge", "Resolved/Closed", "WOC"];
            CONFIG.QUICK_ADD_STATUSES = ["Devrev", "Tp", "Transfer/Merge", "Resolved/Closed", "WOC", "Invalid"];
        } else {
            CONFIG.TICKET_STATUSES = ["Resolved", "Devrev/Tp", "Transfer/Merge", "WOC"];
            CONFIG.QUICK_ADD_STATUSES = ["Resolved", "Devrev/Tp", "Transfer/Merge", "WOC"];
        }
    }

    function showLevelPrompt(resolveFn) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(18,52,77,0.8);z-index:999999;display:flex;justify-content:center;align-items:center;backdrop-filter:blur(4px);';

        const modal = document.createElement('div');
        modal.style.cssText = 'background:white;padding:30px;border-radius:12px;width:400px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.3);';

        modal.innerHTML = `
            <h2 style="margin:0 0 15px 0;color:#12344d;font-size:22px;">Welcome to Daily Tracker</h2>
            <p style="color:#475867;margin-bottom:25px;font-size:14px;">Please select your workflow level configuration.</p>
            <div style="display:flex;gap:15px;justify-content:center;">
                <button id="dsm-lvl-l1" style="flex:1;padding:12px;background:#f5f7f9;border:1px solid #cfd7df;border-radius:8px;cursor:pointer;font-weight:600;color:#12344d;transition:0.2s;">L1</button>
                <button id="dsm-lvl-l2" style="flex:1;padding:12px;background:#2c5cc5;border:1px solid #1a4fa3;border-radius:8px;cursor:pointer;font-weight:600;color:#fff;transition:0.2s;">L2</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        document.getElementById('dsm-lvl-l1').onclick = () => { chrome.storage.local.set({ dailyTrackerLevel: 'L1' }); setLevelConfig('L1'); overlay.remove(); resolveFn(true); };
        document.getElementById('dsm-lvl-l2').onclick = () => { chrome.storage.local.set({ dailyTrackerLevel: 'L2' }); setLevelConfig('L2'); overlay.remove(); resolveFn(true); };
    }

    // Helper: Get badge class for status
    function getBadgeClass(status) {
        const s = (status || "").toLowerCase();
        if (s.includes('resolve') || s.includes('close')) return 'dsm-status-badge dsm-status-resolved';
        if (s.includes('jira') || s.includes('devrev') || s === 'tp') return 'dsm-status-badge dsm-status-jira-tp';
        if (s.includes('transfer') || s.includes('merge')) return 'dsm-status-badge dsm-status-transfer-merge';
        if (s.includes('woc') || s.includes('invalid')) return 'dsm-status-badge dsm-status-woc';
        return 'dsm-status-badge';
    }

    // Helper: Show toast notification instead of alert
    function showToast(message, type = 'info') {
        // Remove existing toast
        const existing = document.getElementById('dsm-toast');
        if (existing) existing.remove();

        const colors = {
            success: { bg: '#00a886', border: '#009975' },
            error: { bg: '#e43538', border: '#c62828' },
            info: { bg: '#2c5cc5', border: '#1a4fa3' },
            warning: { bg: '#f5a623', border: '#d4900c' }
        };
        const color = colors[type] || colors.info;

        const toast = document.createElement('div');
        toast.id = 'dsm-toast';
        toast.innerHTML = message;
        toast.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 100000;
            padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 500;
            color: white; background: ${color.bg}; border: 1px solid ${color.border};
            box-shadow: 0 4px 12px rgba(0,0,0,0.2); animation: dsmToastIn 0.3s ease;
        `;
        document.body.appendChild(toast);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'dsmToastOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // --- 1. User Identification (Using your provided snippet) ---
    async function getCurrentAgentName() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['currentUserEmail', 'freshdesk_agents_cache'], (result) => {
                const email = result.currentUserEmail;
                const cache = result.freshdesk_agents_cache;

                // Fallback for development/testing if cache is empty
                if (!email) {
                    // Try to find email from Freshdesk DOM if storage fails
                    const domEmail = document.querySelector('.user-email')?.innerText || "unknown@user.com";
                    const domName = document.querySelector('.user-name')?.innerText || "Unknown Agent";
                    resolve({ name: domName, email: domEmail });
                    return;
                }

                if (!cache || !cache.data || !cache.data.agents) {
                    resolve({ name: "Agent", email: email });
                    return;
                }

                const agent = cache.data.agents.find(a =>
                    (a.contact && a.contact.email && a.contact.email.toLowerCase() === email.toLowerCase()) ||
                    (a.user && a.user.email && a.user.email.toLowerCase() === email.toLowerCase())
                );

                let finalName = "Agent";
                if (agent && agent.contact && agent.contact.name) {
                    finalName = agent.contact.name;
                } else if (agent && agent.user && agent.user.name) {
                    finalName = agent.user.name;
                }

                if (finalName === "Agent" || finalName.toLowerCase().includes("unknown")) {
                    showToast("⚠️ Agent name unverified. Please open a ticket and click the assignee dropdown to refresh.", "warning");
                }

                if (cache && cache.data && cache.data.agents) {
                    allAgentsCache = cache.data.agents
                        .map(a => a.contact?.name || a.user?.name)
                        .filter(n => n && n !== 'System');
                }

                resolve({ name: finalName, email: email });
            });
        });
    }

    // Helper: fetch Activities to auto-populate Invalid Agent
    async function fetchTSPSERaiser(ticketId, currentUser) {
        try {
            let allActivities = [];
            let beforeId = null;

            for (let loop = 0; loop < 50; loop++) {
                const url = new URL(`https://${window.location.hostname}/api/_/tickets/${ticketId}/activities`);
                if (beforeId) url.searchParams.append('before_id', beforeId);

                const res = await fetch(url.toString(), {
                    headers: { 'accept': 'application/json' }
                });

                if (!res.ok) {
                    if (allActivities.length === 0) return null;
                    break;
                }

                const data = await res.json();
                const batch = data.activities || [];
                if (batch.length === 0) break;

                allActivities.push(...batch);
                beforeId = batch[batch.length - 1].id;
            }

            const sorted = allActivities.sort((a, b) => {
                const tA = new Date(a.performed_at).getTime();
                const tB = new Date(b.performed_at).getTime();
                if (tA === tB) return a.id - b.id; // stable sort for identical timestamps
                return tA - tB;
            });

            let humanACERaiserId = null;
            let currentGroup = 'Unknown';
            let lastPSEAssignerId = null;

            let assignedAgents = [];
            let interactingHumans = [];
            let isCurrentlyAssigned = false;
            let groupChangedBySystemAt = null;

            for (const act of sorted) {
                const performerId = act.performer?.user_id || act.performer?.system?.id;
                const isHumanPerformer = act.performer?.type === 'user';
                const time = act.performed_at;

                // Track human interactions as a fallback if explicit assignment history is missing
                const hasValidAction = (act.actions || []).some(a => ['note', 'property_update'].includes(a.type));
                if (isHumanPerformer && performerId && hasValidAction) {
                    if (interactingHumans.length === 0 || interactingHumans[interactingHumans.length - 1].id !== performerId) {
                        interactingHumans.push({ id: performerId, time: time });
                    }
                }

                for (const action of (act.actions || [])) {
                    let newAgentId = null;
                    let newAgentName = null;

                    if (action.type === 'property_update' && action.content) {

                        if (action.content.group_name !== undefined) {
                            currentGroup = action.content.group_name;
                            if (currentGroup.includes('TS-PSE Support Group')) {
                                lastPSEAssignerId = performerId;
                            } else if (currentGroup.includes('ACE')) {
                                if (isHumanPerformer) {
                                    humanACERaiserId = performerId;
                                    groupChangedBySystemAt = null;
                                } else {
                                    humanACERaiserId = null; // Reset if system moves it
                                    groupChangedBySystemAt = time;
                                }
                            }
                        }

                        if (action.content.responder_id !== undefined || action.content.agent_name !== undefined) {
                            if (action.content.responder_id === null || action.content.agent_name === null) {
                                isCurrentlyAssigned = false;
                            } else {
                                newAgentId = action.content.responder_id || newAgentId;
                                newAgentName = action.content.agent_name || newAgentName;
                            }
                        }
                    }

                    if (action.type === 'round_robin' && action.content && action.content.responder_id) {
                        newAgentId = action.content.responder_id;
                    }

                    // Record valid assignments chronologically 
                    if (newAgentId && String(newAgentId) !== 'null') {
                        isCurrentlyAssigned = true;

                        // Prevent consecutive duplicate history entries if the same agent is re-assigned
                        if (assignedAgents.length === 0 || String(assignedAgents[assignedAgents.length - 1].id) !== String(newAgentId)) {
                            assignedAgents.push({ id: newAgentId, name: newAgentName, time: time });
                        }
                    }
                }
            }

            let targetAgentId = null;
            let targetAgentName = null;

            // Load cache to properly resolve IDs to names for filtering
            const cacheData = await new Promise(r => chrome.storage.local.get('freshdesk_agents_cache', r));
            const cache = cacheData.freshdesk_agents_cache;

            const getAgentNameById = (id) => {
                if (!id || !cache || !cache.data || !cache.data.agents) return null;
                const ag = cache.data.agents.find(a => String(a.id) === String(id));
                return ag ? (ag.contact?.name || ag.user?.name) : null;
            };

            // Utility to find the last valid human agent that is NOT the current ticket owner
            const findLastValidAgent = (agentsList, interactingList, limitTime = null) => {
                let currentTicketOwnerId = null;
                if (agentsList.length > 0) {
                    currentTicketOwnerId = agentsList[agentsList.length - 1].id;
                }

                for (let i = agentsList.length - 1; i >= 0; i--) {
                    const id = agentsList[i].id;
                    const time = agentsList[i].time;

                    if (String(id) === String(currentTicketOwnerId)) continue;

                    // Must not have been assigned at or after the group was moved to ACE
                    if (limitTime && new Date(time) >= new Date(limitTime)) continue;

                    return { id, name: agentsList[i].name || getAgentNameById(id) };
                }

                // Fallback to interacting humans
                for (let i = interactingList.length - 1; i >= 0; i--) {
                    const id = interactingList[i].id;
                    const time = interactingList[i].time;

                    if (String(id) === String(currentTicketOwnerId)) continue;
                    if (limitTime && new Date(time) >= new Date(limitTime)) continue;

                    return { id, name: getAgentNameById(id) };
                }
                return null;
            };

            if (currentGroup.includes('TS-PSE Support Group')) {
                targetAgentId = lastPSEAssignerId;
            } else if (currentGroup.includes('ACE')) {
                if (humanACERaiserId) {
                    targetAgentId = humanACERaiserId;
                } else {
                    // System moved it. Find the previous agent != current agent, strictly before ACE change.
                    const prev = findLastValidAgent(assignedAgents, interactingHumans, groupChangedBySystemAt);
                    if (prev) {
                        targetAgentId = prev.id;
                        targetAgentName = prev.name;
                    }
                }
            } else {
                // Default fallback for any other group
                const prev = findLastValidAgent(assignedAgents, interactingHumans);
                if (prev) {
                    targetAgentId = prev.id;
                    targetAgentName = prev.name;
                }
            }

            if (targetAgentId && !targetAgentName) {
                targetAgentName = getAgentNameById(targetAgentId);
            }

            console.log("[Daily Tracker] fetchTSPSERaiser Logic:", { currentGroup, targetAgentId, targetAgentName, currentUser });
            return targetAgentName;
        } catch (e) {
            console.error("Error fetching activities", e);
            return null;
        }
    }

    // --- 2. Injection Logic ---
    function injectTrackerButton() {
        // Debug helper
        const log = (msg) => console.log(`[Daily Tracker]: ${msg}`);

        // Strategy 1: Known Data IDs
        let newButtonContainer = document.querySelector('[data-test-id="header-create-new"]');

        // Strategy 2: Look for 'New' text in buttons/anchors/divs near the top
        if (!newButtonContainer) {
            const candidates = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"], span'));
            newButtonContainer = candidates.find(el => {
                const text = el.innerText || "";
                // Case insensitive check for "New" or "+ New"
                if (!text.match(/new/i)) return false;

                const rect = el.getBoundingClientRect();
                // Visible, top 150px, not too wide (to avoid capturing full rows)
                return rect.top < 150 && rect.height > 0 && rect.width > 0 && rect.width < 200;
            });
        }

        // Strategy 3: Look for adjacent elements like "Layout: " or "Export" to insert BEFORE them
        if (!newButtonContainer) {
            const anchors = Array.from(document.querySelectorAll('*'));
            const anchor = anchors.find(el => {
                const text = el.innerText || "";
                return (text.includes("Layout:") || text.includes("Export")) && el.getBoundingClientRect().top < 150;
            });
            if (anchor) newButtonContainer = anchor; // We will mistakenly call it newButtonContainer but we just need a reference
        }

        // Strategy 3: Ember View specific (Fallback)
        if (!newButtonContainer) {
            // Sometimes it's wrapped in a specific ember-view
            const searchInput = document.querySelector('input[data-test-id="search-box-input"]');
            if (searchInput) {
                // The "New" button is usually to the left or right of search, in the same toolbar
                // We can try to append towards the end of that toolbar container
                // This is risky, so we just log if found
                log("Could not find 'New' button directly, but found Search box. UI might have changed.");
            }
        }

        if (!newButtonContainer) {
            return;
        }

        // Prevent double injection
        if (document.getElementById('dsm-tracker-btn')) return;

        log("Found insertion point. Injecting Tracker button...");

        // --- Tracker Button with Quick Add Dropdown Arrow ---
        const trackerWrapper = document.createElement('div');
        trackerWrapper.id = 'dsm-tracker-wrapper';
        trackerWrapper.style.cssText = 'position: relative; display: inline-flex; margin-right: 8px;';

        const trackerBtn = document.createElement('button');
        trackerBtn.id = 'dsm-tracker-btn';
        trackerBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="margin-right:6px;"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>Tracker`;
        trackerBtn.onclick = openTrackerModal;

        // Check if on a valid ticket page for quick add
        const isOnTicketPage = () => {
            const url = window.location.href;
            return url.match(/razorpay.*\.freshdesk\.com\/a\/tickets\/\d+/) && getTicketIdFromUrl();
        };

        // Only show quick add arrow if on ticket page
        const quickAddArrow = document.createElement('button');
        quickAddArrow.id = 'dsm-quick-add-arrow';
        quickAddArrow.innerHTML = '▾';
        quickAddArrow.title = 'Quick Add to Tracker';

        // Style arrow - show/hide based on ticket page
        const onTicketPage = isOnTicketPage();
        if (onTicketPage) {
            trackerWrapper.classList.add('has-arrow');
        } else {
            quickAddArrow.style.display = 'none';
        }

        const quickAddDropdown = document.createElement('div');
        quickAddDropdown.id = 'dsm-quick-add-dropdown';
        quickAddDropdown.style.cssText = `
            display: none; position: absolute; top: 100%; right: 0; z-index: 10000;
            background: white; border: 1px solid #cfd7df; border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); min-width: 130px; margin-top: 4px;
        `;

        const statuses = CONFIG.LEVEL === 'L1'
            ? CONFIG.QUICK_ADD_STATUSES.filter(s => s !== 'Invalid')
            : CONFIG.QUICK_ADD_STATUSES;

        statuses.forEach((status, index) => {
            const option = document.createElement('div');
            option.className = 'dsm-quick-option';
            option.innerHTML = status;
            option.style.cssText = `
                padding: 8px 12px; cursor: pointer; font-size: 12px; color: #12344d;
                ${index < statuses.length - 1 ? 'border-bottom: 1px solid #ebeff3;' : ''}
                transition: background 0.15s;
            `;
            option.onmouseenter = () => option.style.background = '#f5f7f9';
            option.onmouseleave = () => option.style.background = 'white';
            option.onclick = async (e) => {
                e.stopPropagation();
                quickAddDropdown.style.display = 'none';
                await quickAddTicket(status);
            };
            quickAddDropdown.appendChild(option);
        });

        quickAddArrow.onclick = (e) => {
            e.stopPropagation();
            // Validate again before showing dropdown
            if (!isOnTicketPage()) {
                return;
            }
            const isVisible = quickAddDropdown.style.display === 'block';
            quickAddDropdown.style.display = isVisible ? 'none' : 'block';
        };

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            quickAddDropdown.style.display = 'none';
        });

        trackerWrapper.appendChild(trackerBtn);
        trackerWrapper.appendChild(quickAddArrow);
        trackerWrapper.appendChild(quickAddDropdown);

        // Insert BEFORE the "New" button container
        const parent = newButtonContainer.parentElement;
        parent.insertBefore(trackerWrapper, newButtonContainer);
        log("Injection successful.");
    }

    // --- Quick Add Helper Function ---
    async function quickAddTicket(status) {
        // Validate URL first
        const url = window.location.href;
        if (!url.match(/razorpay.*\.freshdesk\.com\/a\/tickets\/\d+/)) {
            return; // Silently fail if not on valid page
        }

        const ticketId = getTicketIdFromUrl();
        if (!ticketId) {
            return; // Silently fail if no ticket ID
        }

        if (status === 'Invalid') {
            openTrackerModal({ prefillTicket: ticketId, isInvalid: true });
            return;
        }

        const agent = await getCurrentAgentName();
        if (!agent) {
            showToast("Could not get your agent info. Please try again.", "error");
            return;
        }

        const today = new Date().toISOString().split('T')[0];

        // Show loading toast
        showToast("⏳ Adding ticket...", "info");

        try {
            const payload = {
                action: "add_ticket",
                ticket_id: ticketId,
                status: status,
                comment: "",
                agent_name: agent.name,
                agent_email: agent.email,
                date: today,
                level: CONFIG.LEVEL,
                is_invalid: false
            };

            const result = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { type: "DAILY_TRACKER_API", payload: payload },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else if (response && response.success) {
                            resolve(response.data);
                        } else {
                            reject(new Error(response?.error || "Unknown error"));
                        }
                    }
                );
            });

            showToast(`✓ Ticket ${ticketId} added as ${status}!`, "success");

        } catch (e) {
            console.error("Quick Add Error:", e);
            showToast("Failed to add ticket: " + e.message, "error");
        }
    }

    // --- Helper: Get Ticket ID from URL ---
    function getTicketIdFromUrl() {
        const match = window.location.href.match(/\/tickets\/(\d+)/);
        return match ? match[1] : null;
    }

    // --- Custom Select Wrapper Initialization ---
    function makeCustomSelects() {
        const selects = document.querySelectorAll('.dsm-select');
        selects.forEach(select => {
            if (select.nextElementSibling && select.nextElementSibling.classList.contains('dsm-custom-select-container')) {
                select.nextElementSibling.remove();
            }
            select.style.display = 'none';

            const container = document.createElement('div');
            container.className = 'dsm-custom-select-container';
            container.style.cssText = `position: relative; width: 100%; margin-bottom: ${select.style.marginBottom || '20px'}; z-index: 10;`;

            const selectedDiv = document.createElement('div');
            selectedDiv.className = 'dsm-custom-select-trigger dsm-input';
            selectedDiv.style.cssText = 'cursor: pointer; display: flex; justify-content: space-between; align-items: center; margin-bottom: 0; user-select: none; padding-right: 12px;';
            selectedDiv.innerHTML = `<span>${select.options[select.selectedIndex]?.text || 'Select...'}</span><span style="font-size:10px; color:#9ca3af; margin-left: 10px;">▼</span>`;

            const optionsDiv = document.createElement('div');
            optionsDiv.className = 'dsm-custom-select-options';
            optionsDiv.style.cssText = 'display: none; position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); z-index: 999999; max-height: 250px; overflow-y: auto; margin-top: 5px; padding: 5px;';

            let searchInput = null;
            if (select.options.length > 5) {
                const searchWrapper = document.createElement('div');
                searchWrapper.style.cssText = 'padding: 4px 6px; position: sticky; top: -5px; background: white; z-index: 2; border-bottom: 1px solid #f1f5f9; margin-bottom: 5px;';
                searchInput = document.createElement('input');
                searchInput.type = 'text';
                searchInput.placeholder = 'Search...';
                searchInput.style.cssText = 'width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; outline: none; box-sizing: border-box; font-family: inherit; margin: 0;';
                searchWrapper.appendChild(searchInput);
                optionsDiv.appendChild(searchWrapper);

                searchInput.addEventListener('click', (e) => e.stopPropagation());
            }

            const optionsListDiv = document.createElement('div');
            optionsDiv.appendChild(optionsListDiv);

            const allOptionEls = [];

            Array.from(select.options).forEach(opt => {
                const optionEl = document.createElement('div');
                optionEl.style.cssText = 'padding: 10px 14px; cursor: pointer; border-radius: 6px; font-size: 13px; color: #1e293b; transition: all 0.2s;';
                optionEl.innerText = opt.text;
                if (opt.value === select.value) {
                    optionEl.style.background = '#eff6ff';
                    optionEl.style.color = '#2563eb';
                    optionEl.style.fontWeight = '600';
                }
                optionEl.onmouseenter = () => { if (opt.value !== select.value) optionEl.style.background = '#f8fafc'; };
                optionEl.onmouseleave = () => { if (opt.value !== select.value) optionEl.style.background = 'transparent'; };
                optionEl.onclick = (e) => {
                    e.stopPropagation();
                    select.value = opt.value;
                    selectedDiv.querySelector('span').innerText = opt.text;
                    optionsDiv.style.display = 'none';
                    container.style.zIndex = '10';
                    select.dispatchEvent(new Event('change'));
                };
                optionsListDiv.appendChild(optionEl);
                allOptionEls.push({ el: optionEl, text: opt.text.toLowerCase() });
            });

            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase();
                    allOptionEls.forEach(item => {
                        item.el.style.display = item.text.includes(term) ? 'block' : 'none';
                    });
                });
            }

            selectedDiv.onclick = (e) => {
                e.stopPropagation();
                const wasOpen = optionsDiv.style.display === 'block';
                document.querySelectorAll('.dsm-custom-select-options').forEach(el => el.style.display = 'none');
                document.querySelectorAll('.dsm-custom-select-container').forEach(el => el.style.zIndex = '10');
                document.querySelectorAll('.dsm-custom-select-trigger').forEach(el => {
                    el.style.borderColor = '#cbd5e1';
                    el.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.02) inset';
                });

                optionsDiv.style.display = wasOpen ? 'none' : 'block';
                if (!wasOpen) {
                    container.style.zIndex = '99999';
                    selectedDiv.style.borderColor = '#3b82f6';
                    selectedDiv.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.15)';
                    if (searchInput) {
                        searchInput.value = '';
                        allOptionEls.forEach(item => item.el.style.display = 'block');
                        setTimeout(() => searchInput.focus(), 50);
                    }
                }
            };

            // Add native change listener to resync UI natively if select changes via code
            select.addEventListener('change', () => {
                selectedDiv.querySelector('span').innerText = select.options[select.selectedIndex]?.text || 'Select...';
                // Trigger a full redraw of the options to update active borders if needed
                makeCustomSelects();
            }, { once: true });

            container.appendChild(selectedDiv);
            container.appendChild(optionsDiv);
            select.parentNode.insertBefore(container, select.nextSibling);
        });
    }

    // --- 3. UI Builder (The Beautiful Modal) ---
    async function openTrackerModal(options = {}) {
        const agent = await getCurrentAgentName();
        currentAgent = agent; // Set global
        const today = new Date().toISOString().split('T')[0];

        const agentsList = [...new Set(allAgentsCache)].sort();

        // Remove existing if any
        const existing = document.querySelector('.dsm-modal-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'dsm-modal-overlay';

        overlay.innerHTML = `
        <div class="dsm-modal" style="max-height: 90vh;">
            <div class="dsm-left-panel" style="overflow-y:auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; flex-shrink: 0;">
                    <h2 class="dsm-h2" style="margin:0;">📝 Log Ticket</h2>
                    <select id="dsm-level-toggle" style="padding:4px 8px; font-size:11px; border-radius:4px; border:1px solid #cbd5e1; background:#fff; cursor:pointer; color:#64748b; font-weight:600; outline:none;">
                        <option value="L1" ${CONFIG.LEVEL === 'L1' ? 'selected' : ''}>L1 Mode</option>
                        <option value="L2" ${CONFIG.LEVEL === 'L2' ? 'selected' : ''}>L2 Mode</option>
                    </select>
                </div>
                
                <label class="dsm-label">Ticket ID</label>
                <input type="text" id="dsm-ticket-id" class="dsm-input" placeholder="e.g. 17469650" autofocus value="${options.prefillTicket || ''}">
                
                <label class="dsm-label">Status</label>
                <select id="dsm-status" class="dsm-select">
                    ${CONFIG.TICKET_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
                
                <label class="dsm-label">Comment <span style="color:#92a2b1; font-weight:normal;">(optional)</span></label>
                <textarea id="dsm-comment" class="dsm-input" placeholder="Add a note..." rows="2" style="resize:none; min-height:50px;"></textarea>
                
                <!-- Added flex-shrink: 0 to guarantee Flexbox doesn't squish and clip this container -->
                <div class="dsm-invalid-section" style="display:${CONFIG.LEVEL === 'L2' ? 'block' : 'none'}; margin-top:-5px; margin-bottom:15px; background:#fef8e7; border:1px solid #fae29f; padding:12px; border-radius:8px; flex-shrink: 0;">
                    <div class="dsm-checkbox-row" style="margin-bottom:0;">
                        <input type="checkbox" id="dsm-is-invalid" ${options.isInvalid ? 'checked' : ''} style="accent-color:#d4900c;">
                        <label for="dsm-is-invalid" style="color:#b8860b; font-weight:600;">Mark as Invalid</label>
                    </div>
                    
                    <div id="dsm-invalid-fields" style="display:${options.isInvalid ? 'block' : 'none'}; margin-top:12px; border-top:1px dashed #fae29f; padding-top:12px;">
                        <label class="dsm-label" style="color:#9a7009;">Invalid Description <span style="color:#d72d30;">*</span></label>
                        <textarea id="dsm-invalid-desc" class="dsm-input" placeholder="Why is this invalid?" rows="2" style="resize:none; min-height:40px; border-color:#fae29f;"></textarea>
                        
                        <label class="dsm-label" style="color:#9a7009;">Agent Name (Who made it invalid?) <span style="color:#d72d30;">*</span></label>
                        <div style="position:relative;">
                            <select id="dsm-invalid-agent" class="dsm-select" style="border-color:#fae29f; margin-bottom:0;">
                                <option value="">Select Agent...</option>
                            </select>
                            <span id="dsm-invalid-agent-loader" style="display:none; position:absolute; right:35px; top:10px; font-size:12px;">(Fetching...)</span>
                        </div>
                    </div>
                </div>

                <div class="dsm-checkbox-row" style="flex-shrink: 0;">
                    <input type="checkbox" id="dsm-include-transfer" checked>
                    <label for="dsm-include-transfer">Include Transfer/Merge in count</label>
                </div>

                <div style="flex:1"></div>
                
                <div id="dsm-date-warning" style="display:none; color: #d72d30; font-size: 12px; margin-bottom: 10px; flex-shrink: 0;">
                    ⚠ You are viewing a past date. Logging is disabled.
                </div>
                
                <div id="dsm-queued-msg" style="display:none; color: #2c5cc5; font-size: 12px; margin-bottom: 10px; text-align:center; flex-shrink: 0;">
                    ✓ Ticket queued! Saving...
                </div>

                <div style="display:flex; align-items:center; flex-shrink: 0;">
                    <button id="dsm-submit" class="dsm-submit-btn">Add Entry</button>
                    <button id="dsm-cancel-edit" style="display:none; background:none; border:none; color:#647a8e; cursor:pointer; margin-left:10px; font-size:13px; text-decoration:underline;">Cancel</button>
                </div>
                <p style="margin-top:10px; font-size:11px; color:#92a2b1; text-align:center; flex-shrink: 0;">
                    Logged in as: <b>${agent.name}</b>
                </p>
            </div>

            <div class="dsm-right-panel">
                <div class="dsm-header-row">
                    <h2 class="dsm-h2" style="margin:0">Team Activity</h2>
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <input type="date" id="dsm-date-picker" class="dsm-input" style="margin:0; width:auto; padding: 5px 10px;" value="${today}">
                        <span class="dsm-close" id="dsm-close-btn">&times;</span>
                    </div>
                </div>

                <div class="dsm-stats-grid">
                    <div class="dsm-stat-card">
                        <span class="dsm-stat-num" id="dsm-stat-my">0</span>
                        <span class="dsm-stat-label">My Count</span>
                    </div>
                    <div class="dsm-stat-card">
                        <span class="dsm-stat-num" id="dsm-stat-team">0</span>
                        <span class="dsm-stat-label">Team Total</span>
                    </div>
                    <div class="dsm-stat-card" style="border-color: #ffd700;">
                        <span class="dsm-stat-num" style="color: #b8860b" id="dsm-stat-top">--</span>
                        <span class="dsm-stat-label">Top Agent</span>
                    </div>
                </div>
                
                <!-- Tab Navigation -->
                <div class="dsm-tabs">
                    <button class="dsm-tab" data-tab="leaderboard">Leaderboard</button>
                    <button class="dsm-tab active" data-tab="tickets">All Tickets</button>
                    <button class="dsm-tab" data-tab="summary">Summary</button>
                    ${CONFIG.LEVEL === 'L2' ? `<button class="dsm-tab" data-tab="invalid-summary">Invalid Summary</button>` : ''}
                </div>
                
                <!-- Tab Content -->
                <div class="dsm-tab-content" id="dsm-tab-leaderboard" style="display:none;">
                    <div class="dsm-table-wrapper">
                        <table class="dsm-table">
                            <thead>
                                <tr>
                                    <th>Rank</th>
                                    <th>Agent Name</th>
                                    <th>Count</th>
                                </tr>
                            </thead>
                            <tbody id="dsm-leaderboard-body">
                                <tr><td colspan="3" style="text-align:center; padding: 20px;">Loading data...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <div class="dsm-tab-content" id="dsm-tab-tickets" style="display:flex;">
                    <div class="dsm-filter-row">
                        <label class="dsm-filter-label">Filter by Agent:</label>
                        <select id="dsm-agent-filter" class="dsm-select dsm-filter-select">
                            <option value="">All Agents</option>
                        </select>
                    </div>
                    <div class="dsm-table-wrapper">
                        <table class="dsm-table">
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Ticket ID</th>
                                    <th>Status</th>
                                    <th>Agent</th>
                                    <th>Comment</th>
                                    <th>Invalid By</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="dsm-tickets-body">
                                <tr><td colspan="7" style="text-align:center; padding: 20px;">Loading tickets...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <div class="dsm-tab-content" id="dsm-tab-summary" style="display:none;">
                    <div class="dsm-table-wrapper">
                        <table class="dsm-table dsm-summary-table">
                            <thead id="dsm-summary-head">
                                <tr><th>Agent</th></tr>
                            </thead>
                            <tbody id="dsm-summary-body">
                                <tr><td colspan="1" style="text-align:center; padding: 20px;">Loading summary...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <div class="dsm-tab-content" id="dsm-tab-invalid-summary" style="display:none;">
                    <div class="dsm-table-wrapper">
                        <table class="dsm-table">
                            <thead>
                                <tr>
                                    <th>Rank</th>
                                    <th>Routing Agent Name</th>
                                    <th>Invalid Count</th>
                                </tr>
                            </thead>
                            <tbody id="dsm-invalid-summary-body">
                                <tr><td colspan="3" style="text-align:center; padding: 20px;">Loading summary...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `;

        document.body.appendChild(overlay);

        // --- Event Listeners ---

        document.getElementById('dsm-level-toggle').onchange = (e) => {
            const newLevel = e.target.value;
            chrome.storage.local.set({ dailyTrackerLevel: newLevel });
            setLevelConfig(newLevel);
            const wrapper = document.getElementById('dsm-tracker-wrapper');
            if (wrapper) wrapper.remove();
            openTrackerModal(options);
        };

        // Populate Agent List in a non-blocking way
        setTimeout(() => {
            const agentSelect = document.getElementById('dsm-invalid-agent');
            if (agentSelect && agentsList.length > 0) {
                const fragment = document.createDocumentFragment();
                agentsList.forEach(a => {
                    const opt = document.createElement('option');
                    opt.value = opt.textContent = a;
                    fragment.appendChild(opt);
                });
                agentSelect.appendChild(fragment);
                // Initialize custom select for this one if needed
                makeCustomSelects();
            }
        }, 100);

        const invalidBox = document.getElementById('dsm-is-invalid');
        const invalidFields = document.getElementById('dsm-invalid-fields');
        const invalidAgentLoader = document.getElementById('dsm-invalid-agent-loader');
        const invalidAgentSelect = document.getElementById('dsm-invalid-agent');

        invalidBox.onchange = async () => {
            const isChecked = invalidBox.checked;
            invalidFields.style.display = isChecked ? 'block' : 'none';

            if (isChecked && document.getElementById('dsm-ticket-id').value) {
                const tid = document.getElementById('dsm-ticket-id').value;
                invalidAgentLoader.style.display = 'inline';

                const agentNameFound = await fetchTSPSERaiser(tid, agent.name);
                invalidAgentLoader.style.display = 'none';

                if (agentNameFound) {
                    let exists = Array.from(invalidAgentSelect.options).some(o => o.value === agentNameFound);
                    if (!exists) {
                        const opt = document.createElement('option');
                        opt.value = opt.innerHTML = agentNameFound;
                        invalidAgentSelect.appendChild(opt);
                    }
                    invalidAgentSelect.value = agentNameFound;
                    makeCustomSelects(); // Sync dropdown
                }
            } else if (isChecked && !document.getElementById('dsm-ticket-id').value) {
                invalidAgentSelect.value = "";
                makeCustomSelects(); // Reset if user checks without ID
            }
        };

        // Listen to ticket ID input to fetch automatically if marked invalid
        document.getElementById('dsm-ticket-id').addEventListener('blur', () => {
            if (invalidBox.checked) {
                invalidBox.onchange();
            }
        });

        if (options.isInvalid && options.prefillTicket && CONFIG.LEVEL === 'L2') {
            invalidBox.onchange();
        }

        // Close
        document.getElementById('dsm-close-btn').onclick = () => overlay.remove();
        overlay.onclick = (e) => {
            if (e.target === overlay) overlay.remove();
            // Close any open custom selects
            document.querySelectorAll('.dsm-custom-select-options').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.dsm-custom-select-container').forEach(el => el.style.zIndex = '10');
            document.querySelectorAll('.dsm-custom-select-trigger').forEach(el => {
                el.style.borderColor = '#cbd5e1';
                el.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.02) inset';
            });
        };

        // Date Picker Change
        const datePicker = document.getElementById('dsm-date-picker');
        datePicker.onchange = () => {
            loadAllData(datePicker.value, agent.email);
            toggleInputState(datePicker.value);
        };

        // Tab Switching
        document.querySelectorAll('.dsm-tab').forEach(tab => {
            tab.onclick = () => {
                document.querySelectorAll('.dsm-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.dsm-tab-content').forEach(c => c.style.display = 'none');
                tab.classList.add('active');
                document.getElementById('dsm-tab-' + tab.dataset.tab).style.display = 'flex';
            };
        });

        // Agent Filter in All Tickets
        document.getElementById('dsm-agent-filter').onchange = function () {
            filterTicketsByAgent(this.value);
        };

        // Include Transfer/Merge toggle - reload stats when changed
        document.getElementById('dsm-include-transfer').onchange = () => {
            loadAllData(datePicker.value, agent.email);
        };

        // Submit Ticket
        const submitBtn = document.getElementById('dsm-submit');
        const cancelBtn = document.getElementById('dsm-cancel-edit');

        // Cancel Edit
        cancelBtn.onclick = () => {
            editMode = false;
            oldTicketId = null;
            editDbId = null;
            document.getElementById('dsm-ticket-id').value = "";
            document.getElementById('dsm-status').selectedIndex = 0;
            document.getElementById('dsm-comment').value = "";
            document.getElementById('dsm-is-invalid').checked = false;
            document.getElementById('dsm-invalid-desc').value = "";
            document.getElementById('dsm-invalid-agent').value = "";
            document.getElementById('dsm-invalid-fields').style.display = 'none';
            submitBtn.innerHTML = "Add Entry";
            cancelBtn.style.display = "none";
            document.querySelector('.dsm-h2').innerText = "📝 Log Ticket";
            makeCustomSelects(); // Sync reset state
        };

        submitBtn.onclick = async () => {
            const ticketId = document.getElementById('dsm-ticket-id').value;
            const status = document.getElementById('dsm-status').value;
            const comment = document.getElementById('dsm-comment').value;
            const isInvalid = document.getElementById('dsm-is-invalid').checked;
            const invalidDesc = document.getElementById('dsm-invalid-desc').value;
            const invalidAgent = document.getElementById('dsm-invalid-agent').value;

            if (!ticketId) { showToast("Please enter a Ticket ID", "warning"); return; }
            if (isInvalid && (!invalidDesc || !invalidAgent)) {
                showToast("Description and Agent Name are required for Invalid tickets", "warning");
                return;
            }

            submitBtn.innerHTML = editMode ? "Updating..." : "Saving...";
            submitBtn.disabled = true;

            const payload = {
                action: editMode ? "update_ticket" : "add_ticket",
                ticket_id: ticketId,
                status: status,
                comment: comment,
                is_invalid: isInvalid,
                invalid_description: isInvalid ? invalidDesc : null,
                invalid_agent: isInvalid ? invalidAgent : null,
                level: CONFIG.LEVEL,
                agent_name: agent.name,
                agent_email: agent.email,
                user_email: agent.email,     // For permission checks
                old_ticket_id: oldTicketId,  // For update
                new_ticket_id: ticketId,     // For update
                db_id: editDbId,             // For precise update matches
                date: datePicker.value || today
            };

            try {
                // Show queued feedback immediately
                const queuedMsg = document.getElementById('dsm-queued-msg');
                queuedMsg.innerHTML = editMode ? "⟳ Updating..." : "✓ Ticket queued! Saving...";
                queuedMsg.style.display = 'block';

                // Send to background script to bypass CORS
                const result = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage(
                        { type: "DAILY_TRACKER_API", payload: payload },
                        (response) => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                            } else if (response && response.success) {
                                resolve(response.data);
                            } else {
                                reject(new Error(response?.error || "Unknown error"));
                            }
                        }
                    );
                });

                document.getElementById('dsm-ticket-id').value = ""; // Clear input
                queuedMsg.innerHTML = editMode ? '✓ Updated successfully!' : '✓ Saved successfully!';

                // Reset Edit Mode
                if (editMode) cancelBtn.click();

                setTimeout(() => { queuedMsg.style.display = 'none'; }, 2000);
                loadAllData(datePicker.value, agent.email); // Refresh all tabs
            } catch (e) {
                console.error('[Daily Tracker] Error:', e);
                const queuedMsg = document.getElementById('dsm-queued-msg');
                queuedMsg.style.display = 'none';
                showToast("Error saving: " + e.message, "error");
            } finally {
                if (!editMode) submitBtn.innerHTML = "Add Entry";
                submitBtn.disabled = false;
                document.getElementById('dsm-ticket-id').focus();
            }
        };

        // Event Delegation for Table Actions
        document.getElementById('dsm-tickets-body').onclick = (e) => {
            const target = e.target;
            const btn = target.closest('button');
            if (!btn) return;

            const action = btn.dataset.action;
            const id = btn.dataset.id;

            if (action === "edit") {
                const dbId = btn.dataset.dbid;
                const ticket = allTicketsData.find(t => String(t.id) === String(dbId));
                if (ticket) {
                    editMode = true;
                    oldTicketId = ticket.ticket_id;
                    editDbId = ticket.id;

                    document.getElementById('dsm-ticket-id').value = ticket.ticket_id;
                    document.getElementById('dsm-status').value = ticket.status;
                    document.getElementById('dsm-comment').value = ticket.comment || "";

                    const invalidBox = document.getElementById('dsm-is-invalid');
                    invalidBox.checked = ticket.is_invalid || false;
                    document.getElementById('dsm-invalid-fields').style.display = ticket.is_invalid ? 'block' : 'none';
                    document.getElementById('dsm-invalid-desc').value = ticket.invalid_description || "";

                    if (ticket.invalid_agent && !Array.from(document.getElementById('dsm-invalid-agent').options).some(o => o.value === ticket.invalid_agent)) {
                        const opt = document.createElement('option');
                        opt.value = opt.innerHTML = ticket.invalid_agent;
                        document.getElementById('dsm-invalid-agent').appendChild(opt);
                    }
                    document.getElementById('dsm-invalid-agent').value = ticket.invalid_agent || "";

                    submitBtn.innerHTML = "Update Ticket";
                    cancelBtn.style.display = "block";
                    document.querySelector('.dsm-h2').innerText = "✏️ Edit Ticket";

                    document.getElementById('dsm-ticket-id').focus();
                    makeCustomSelects(); // Sync logic to edit mode values
                }
            } else if (action === "delete") {
                const dbId = btn.dataset.dbid;
                const ticket = allTicketsData.find(t => String(t.id) === String(dbId));
                if (confirm(`Are you sure you want to delete ticket ${id}?`)) {
                    // Call delete API
                    const payload = {
                        action: "delete_ticket",
                        ticket_id: id,
                        db_id: dbId,
                        date: datePicker.value || today,
                        user_email: agent.email
                    };

                    chrome.runtime.sendMessage(
                        { type: "DAILY_TRACKER_API", payload: payload },
                        (response) => {
                            if (response && response.success) {
                                loadAllData(datePicker.value, agent.email);
                            } else {
                                showToast("Failed to delete: " + (response?.error || "Unknown error"), "error");
                            }
                        }
                    );
                }
            }
        };

        // Initial Load
        loadAllData(today, agent.email);
        makeCustomSelects(); // Build initial custom dropdowns
    }

    // Load all tab data
    async function loadAllData(date, userEmail) {
        loadData(date, userEmail);
        loadTickets(date);
    }

    // --- 4. Helper Functions ---

    function toggleInputState(selectedDate) {
        const today = new Date().toISOString().split('T')[0];
        const isPast = selectedDate !== today;

        const btn = document.getElementById('dsm-submit');
        const warning = document.getElementById('dsm-date-warning');
        const inputs = document.querySelectorAll('.dsm-left-panel input, .dsm-left-panel select');

        if (isPast) {
            btn.disabled = true;
            warning.style.display = 'block';
            inputs.forEach(el => el.disabled = true);
        } else {
            btn.disabled = false;
            warning.style.display = 'none';
            inputs.forEach(el => el.disabled = false);
        }
    }

    async function loadData(date, userEmail) {
        const tbody = document.getElementById('dsm-leaderboard-body');
        const myStat = document.getElementById('dsm-stat-my');
        const teamStat = document.getElementById('dsm-stat-team');
        const topStat = document.getElementById('dsm-stat-top');
        const includeTransfer = document.getElementById('dsm-include-transfer')?.checked !== false;

        // Add spinner opacity
        tbody.style.opacity = "0.5";

        try {
            // Send to background script to bypass CORS
            const data = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { type: "DAILY_TRACKER_API", payload: { action: "get_stats", date: date, user_email: userEmail, include_docs: includeTransfer, level: CONFIG.LEVEL } },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else if (response && response.success) {
                            resolve(response.data);
                        } else {
                            reject(new Error(response?.error || "Unknown error"));
                        }
                    }
                );
            });

            // Update Stats
            myStat.innerText = data.my_count || 0;
            teamStat.innerText = data.total_today || 0;

            const topName = data.leaderboard.length > 0 ? data.leaderboard[0].name : "--";
            topStat.innerText = topName;

            // Flexibly scale font size for long names
            if (topName.length > 18) {
                topStat.style.fontSize = "16px";
                topStat.style.lineHeight = "1.2";
                topStat.style.marginTop = "8px";
            } else if (topName.length > 12) {
                topStat.style.fontSize = "22px";
                topStat.style.lineHeight = "1.2";
                topStat.style.marginTop = "4px";
            } else {
                topStat.style.fontSize = "";
                topStat.style.lineHeight = "";
                topStat.style.marginTop = "";
            }

            // Update Leaderboard Table
            tbody.innerHTML = "";
            const currentUserName = document.querySelector('.dsm-left-panel b')?.innerText;
            data.leaderboard.forEach((agent, index) => {
                const isMe = agent.name === currentUserName;

                const tr = document.createElement('tr');
                if (isMe) tr.className = "dsm-row-highlight";

                tr.innerHTML = `
                    <td>#${index + 1}</td>
                <td>${agent.name} ${isMe ? '(You)' : ''}</td>
                <td style="font-weight:bold">${agent.count}</td>
                `;
                tbody.appendChild(tr);
            });

            // Update Invalid Leaderboard Table
            const invalidBody = document.getElementById('dsm-invalid-summary-body');
            if (invalidBody) {
                invalidBody.innerHTML = "";
                if (data.invalid_summary && data.invalid_summary.length > 0) {
                    data.invalid_summary.forEach((agent, index) => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                        <td>#${index + 1}</td>
                        <td>${agent.name}</td>
                        <td style="font-weight:bold; color:#d72d30">${agent.count}</td>
                `;
                        invalidBody.appendChild(tr);
                    });
                } else {
                    invalidBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 20px; color:#92a2b1;">No invalid tickets recorded.</td></tr>';
                }
            }

            // Update Summary Table
            renderSummaryTable(data.summary, data.leaderboard);

        } catch (e) {
            console.error(e);
            tbody.innerHTML = `<tr><td colspan="3" style="color:red; text-align:center">Error loading data.</td></tr>`;
        } finally {
            tbody.style.opacity = "1";
        }
    }

    // Load all tickets for a date
    async function loadTickets(date) {
        const tbody = document.getElementById('dsm-tickets-body');
        const agentFilter = document.getElementById('dsm-agent-filter');
        tbody.style.opacity = "0.5";

        try {
            const data = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { type: "DAILY_TRACKER_API", payload: { action: "get_tickets", date: date, user_email: currentAgent ? currentAgent.email : null, level: CONFIG.LEVEL } },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else if (response && response.success) {
                            resolve(response.data);
                        } else {
                            reject(new Error(response?.error || "Unknown error"));
                        }
                    }
                );
            });

            allTicketsData = data.tickets || [];

            // Sort by time descending (newest first)
            allTicketsData.sort((a, b) => (b.time || "").localeCompare(a.time || ""));

            // Populate agent dropdown
            const agents = [...new Set(allTicketsData.map(t => t.agent))].sort();
            agentFilter.innerHTML = '<option value="">All Agents</option>' +
                agents.map(a => `<option value="${a}"${a === currentAgent?.name ? ' selected' : ''}>${a}</option>`).join('');

            // Use custom select updater if it's rendered
            if (typeof makeCustomSelects === 'function') makeCustomSelects();

            // Default filter to current user
            if (currentAgent && agents.includes(currentAgent.name)) {
                filterTicketsByAgent(currentAgent.name);
            } else {
                renderTickets(allTicketsData);
            }
        } catch (e) {
            console.error("FAILED TO LOAD TICKETS:", e);
            console.error("Full error details:", JSON.stringify(e, Object.getOwnPropertyNames(e)));
            tbody.innerHTML = `<tr><td colspan="6" style="color:red; text-align:center">Error loading tickets.<br><small>${e.message}</small></td></tr>`;
        } finally {
            tbody.style.opacity = "1";
        }
    }

    function renderTickets(tickets) {
        const tbody = document.getElementById('dsm-tickets-body');
        tbody.innerHTML = "";

        if (tickets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#92a2b1;">No tickets found.</td></tr>`;
            return;
        }

        tickets.forEach(ticket => {
            const tr = document.createElement('tr');

            // Check ownership (Email match preferred, fallback to Name)
            const isOwner = currentAgent && (
                (ticket.email && ticket.email === currentAgent.email) ||
                (ticket.agent === currentAgent.name)
            );

            let actionButtons = "";
            if (isOwner) {
                actionButtons = `
                    <button class="dsm-action-btn" data-action="edit" data-id="${ticket.ticket_id}" data-dbid="${ticket.id}" title="Edit" style="background:none; border:none; cursor:pointer; margin-right:5px;">✏️</button>
                    <button class="dsm-action-btn" data-action="delete" data-id="${ticket.ticket_id}" data-dbid="${ticket.id}" title="Delete" style="background:none; border:none; cursor:pointer;">🗑️</button>
                `;
            }

            tr.innerHTML = `
                    <td>${ticket.time || '--:--'}</td>
                <td><a href="https://razorpay.freshdesk.com/a/tickets/${ticket.ticket_id}" target="_blank" style="color:#2c5cc5; text-decoration:none;">${ticket.ticket_id}</a></td>
                <td><span class="${getBadgeClass(ticket.status)}">${ticket.status}</span></td>
                <td>${ticket.agent}</td>
                <td class="dsm-comment-cell" title="${ticket.comment || ''}">${ticket.comment || '<span style="color:#92a2b1;">-</span>'}</td>
                <td style="color:#d72d30; font-weight:500;">${ticket.is_invalid ? (ticket.invalid_agent || 'Unknown') : '<span style="color:#92a2b1; font-weight:normal">-</span>'}</td>
                <td>${actionButtons}</td>
                `;
            tbody.appendChild(tr);
        });
    }

    function filterTicketsByAgent(agentName) {
        if (!agentName) {
            renderTickets(allTicketsData);
        } else {
            const filtered = allTicketsData.filter(t => t.agent === agentName);
            renderTickets(filtered);
        }
    }

    // Render Summary Table (Agent × Status breakdown)
    function renderSummaryTable(summary, leaderboard) {
        const thead = document.getElementById('dsm-summary-head');
        const tbody = document.getElementById('dsm-summary-body');

        if (!summary || !leaderboard || leaderboard.length === 0) {
            tbody.innerHTML = '<tr><td colspan="1" style="text-align:center; padding:20px; color:#92a2b1;">No summary data available.</td></tr>';
            return;
        }

        // Get all unique statuses
        const allStatuses = new Set();
        Object.values(summary).forEach(statusMap => {
            Object.keys(statusMap).forEach(s => allStatuses.add(s));
        });
        const statuses = Array.from(allStatuses);

        // Build header
        thead.innerHTML = `<tr><th>Agent</th>${statuses.map(s => `<th>${s}</th>`).join('')} <th style="font-weight:700;">Total</th></tr>`;

        // Build rows (sorted by total, use leaderboard order)
        tbody.innerHTML = "";
        leaderboard.forEach(agent => {
            const statusCounts = summary[agent.name] || {};
            const tr = document.createElement('tr');
            const currentUserName = document.querySelector('.dsm-left-panel b')?.innerText;
            if (agent.name === currentUserName) tr.className = "dsm-row-highlight";

            tr.innerHTML = `
                    <td>${agent.name}</td>
                        ${statuses.map(s => `<td style="text-align:center;">${statusCounts[s] || 0}</td>`).join('')}
                <td style="font-weight:700; text-align:center;">${agent.count}</td>
                `;
            tbody.appendChild(tr);
        });
    }

    // --- 5. Start Observer & Polling ---

    async function startValidation() {
        console.log("[Daily Tracker] Starting validation...");

        const isInit = await initializeDailyTracker();
        if (!isInit) return; // Wait until modal selection

        injectTrackerButton();
        // Also try polling for a bit
        let checks = 0;
        const interval = setInterval(() => {
            injectTrackerButton();
            if (document.getElementById('dsm-tracker-btn')) {
                clearInterval(interval);
                console.log("[Daily Tracker] Button successfully injected.");
            } else if (checks > 10) { // After 10 seconds, force fallback
                clearInterval(interval);
                console.log("[Daily Tracker] Could not find anchor. Injecting floating fallback.");
                injectFloatingFallback();
            }
            checks++;
        }, 1000);
    }

    function injectFloatingFallback() {
        if (document.getElementById('dsm-tracker-btn')) return;

        const trackerBtn = document.createElement('button');
        trackerBtn.id = 'dsm-tracker-btn';
        trackerBtn.innerHTML = `< span >📊</span > Tracker`;
        trackerBtn.onclick = openTrackerModal;

        // Fixed positioning
        Object.assign(trackerBtn.style, {
            position: 'fixed',
            bottom: '80px',
            right: '20px',
            zIndex: '999999',
            padding: '10px 20px',
            background: '#2c5cc5',
            color: '#fff',
            border: 'none',
            borderRadius: '30px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            cursor: 'pointer',
            fontWeight: '600'
        });

        document.body.appendChild(trackerBtn);
    }

    // We use MutationObserver because Freshdesk is an SPA
    const observer = new MutationObserver(() => {
        // Only try normal injection via observer, don't force fallback repeatedly
        if (!document.getElementById('dsm-tracker-btn')) {
            injectTrackerButton();
        }
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
        startValidation();
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
            startValidation();
        });
    }

    // --- GLOBAL URL Observer for Quick Add visibility (runs independently) ---
    // This is outside injectTrackerButton to ensure only ONE interval runs
    let globalLastUrl = '';
    const globalUpdateQuickAddVisibility = () => {
        // Query elements fresh each time
        const arrow = document.getElementById('dsm-quick-add-arrow');
        const wrapper = document.getElementById('dsm-tracker-wrapper');

        const currentUrl = window.location.href;

        // Log URL changes
        if (currentUrl !== globalLastUrl) {
            globalLastUrl = currentUrl;
            console.log("[Daily Tracker] Global observer - URL:", currentUrl);
        }

        // If elements don't exist, skip this cycle
        if (!arrow || !wrapper) {
            return;
        }

        // Check if on ticket page
        const isTicketPage = currentUrl.match(/razorpay.*\.freshdesk\.com\/a\/tickets\/\d+/);

        // Update visibility
        if (isTicketPage) {
            arrow.style.display = 'inline-flex';
            wrapper.classList.add('has-arrow');
        } else {
            arrow.style.display = 'none';
            wrapper.classList.remove('has-arrow');
        }
    };

    // Run global observer every 300ms
    setInterval(globalUpdateQuickAddVisibility, 300);
    window.addEventListener('popstate', globalUpdateQuickAddVisibility);

})(); // End of IIFE