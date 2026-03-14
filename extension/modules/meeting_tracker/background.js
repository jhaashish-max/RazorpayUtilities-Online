{
    // BLOCK SCOPE: Meeting Tracker
    // Use chrome.storage.session to persist state across Service Worker restarts

    // 3. Handle Meeting Session
    chrome.runtime.onConnect.addListener((port) => {
        if (port.name === "meeting-session") {
            const tabId = port.sender.tab.id.toString();
            const alarmName = `meeting_close_${tabId}`;
            
            // CLEAR any pending close alarm for this tab (Reconnection logic)
            chrome.alarms.clear(alarmName);

            // Check if we are resuming an existing session
            chrome.storage.session.get(tabId, (data) => {
                const existingSession = data[tabId];
                
                if (existingSession) {
                    // Resuming... update badge just in case
                    chrome.action.setBadgeText({ tabId: parseInt(tabId), text: "REC" });
                    chrome.action.setBadgeBackgroundColor({ tabId: parseInt(tabId), color: "#e74c3c" });
                    // Remove any "pending close" marker if we had one (optional, handled by alarm clear)
                } else {
                    // New Session
                    const startTime = Date.now();
                    chrome.storage.session.set({
                        [tabId]: { startTime: startTime, ticketId: null }
                    });
                     // Show "REC" Badge
                    chrome.action.setBadgeText({ tabId: parseInt(tabId), text: "REC" });
                    chrome.action.setBadgeBackgroundColor({ tabId: parseInt(tabId), color: "#e74c3c" });
                }
            });

            // Update Ticket ID if sent
            port.onMessage.addListener((msg) => {
                if (msg.type === "INIT_SESSION") {
                    chrome.storage.session.get(tabId, (data) => {
                        if (data[tabId]) {
                            const updatedSession = { ...data[tabId], ticketId: msg.ticketId || null };
                            chrome.storage.session.set({ [tabId]: updatedSession });
                        }
                    });
                }
            });

            // 4. Meeting Connection Dropped (Likely SW idle or Tab closed)
            port.onDisconnect.addListener(() => {
                // Do NOT save immediately. Set an alarm to check if this was a real close.
                // We give a grazce period (e.g. 6-10 seconds) for the content script to reconnect.
                // If it reconnects, the onConnect above clears this alarm.
                chrome.alarms.create(alarmName, { delayInMinutes: 0.1 }); 
            });
        }
    });

    // 5. Alarm Triggered: Finalize the Session if not reconnected
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name.startsWith("meeting_close_")) {
            const tabId = alarm.name.replace("meeting_close_", "");
            
            chrome.storage.session.get(tabId, (data) => {
                const session = data[tabId];
                if (session) {
                    const endTime = Date.now();
                    // Just to be safe, if endTime is somehow super close to startTime (weird flicker), we might skip? 
                    // But usually safe to save.
                    saveLog(session.startTime, endTime, session.ticketId);

                    // Clean up
                    chrome.storage.session.remove(tabId);
                    // Clear Badge checks if tab still exists (optional, but good practice to avoid errors)
                    chrome.tabs.get(parseInt(tabId)).then(() => {
                        chrome.action.setBadgeText({ tabId: parseInt(tabId), text: "" });
                    }).catch(() => {}); // Tab likely closed
                }
            });
        }
    });

    function saveLog(start, end, ticketId) {
        const logEntry = { start, end, ticketId };
        chrome.storage.local.get({ history: [] }, (data) => {
            const updatedHistory = [logEntry, ...data.history];
            chrome.storage.local.set({ history: updatedHistory });
        });
    }

    // Capture User Email from Network Requests
    chrome.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
            const emailHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'x-fw-auth-user-email');
            if (emailHeader) {
                chrome.storage.local.set({ currentUserEmail: emailHeader.value });
            }
        },
        { urls: ["*://*.freshdesk.com/*"] },
        ["requestHeaders"]
    );
}