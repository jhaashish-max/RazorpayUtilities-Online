// -----------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------
// n8n Webhook URL (replaces the old Google Apps Script proxy)
const WEBHOOK_URL = 'https://n8n-conc.razorpay.com/webhook/837343e8-04f2-4d8b-9b2d-ab420e8c0578';
// -----------------------------------------------------------------

const CACHE_DURATION_MINUTES = 1;

let sheetDataCache = {
    data: null,
    timestamp: 0,
};

/**
 * Transforms the n8n webhook array response into the keyed-object format
 * expected by content.js and dashboard.js:
 *   { "ticketId": { createdAt, promiseOne, openToWocTime, wocReopenTime, ... } }
 */
function transformN8nResponse(rawArray) {
    const result = {};
    for (const item of rawArray) {
        const ticketId = String(item.ticket_id);
        if (!ticketId) continue;

        result[ticketId] = {
            // Core fields used by P1 timer logic
            createdAt: item.created_at_ist || '',
            promiseOne: item.cf_promise_one || '',
            openToWocTime: item.time_open_to_woc || '',
            wocReopenTime: item.time_woc_reopen || '',

            // Additional fields preserved for potential use
            subject: item.subject || '',
            status: item.status || '',
            agent: item.agent || '',
            agentEmail: item.Agent_email || '',
            groupName: item.group_name || '',
            cfEndStateAction: item.cf_end_state_action || '',
            cfP1Update: item.cf_p1_update || '',
            cfPromise1UpdatedTime: item.cf_promise_1_updated_time || '',
            tags: item.tags || '',
            emailSourceUpdate: item.email_source_update || '',
            firstResponseTimeIst: item.first_response_time_ist || '',
            firstResponseP1Hours: item.first_response_p1_hours,
            responseAdherence: item.response_adherence || '',
            responseNotificationLevel: item.Response_notification_level || '',
            statusAtFirstResponse: item.status_at_first_response || '',
            actionedAfterFr: item.actioned_after_fr || '',
            tsPaymentsPushTime: item.ts_payments_push_time || '',
            chatUnresolved: item.chat_unresolved || '',
            firstResponse: item.first_response || '',
        };
    }
    return result;
}

/**
 * Fetches ticket data from the n8n webhook.
 */
async function getSheetData() {
    const now = Date.now();
    const cacheExpiry = sheetDataCache.timestamp + CACHE_DURATION_MINUTES * 60 * 1000;

    if (sheetDataCache.data && now < cacheExpiry) {
        console.log('Returning cached data (local).');
        return sheetDataCache.data;
    }

    console.log('Cache expired or empty, fetching from n8n webhook...');
    try {
        const response = await fetch(WEBHOOK_URL);
        if (!response.ok) {
            throw new Error(`n8n webhook fetch failed with status: ${response.status}`);
        }

        const rawData = await response.json();

        // n8n returns an array of ticket objects — transform to keyed format
        if (!Array.isArray(rawData)) {
            console.error("Unexpected response format from n8n (expected array):", rawData);
            throw new Error('Unexpected response format from n8n');
        }

        const data = transformN8nResponse(rawData);

        // Success: Store in local cache
        sheetDataCache = { data, timestamp: now };
        console.log(`Fetched and cached ${Object.keys(data).length} ticket entries from n8n.`);
        return data;

    } catch (error) {
        console.error('Error in getSheetData:', error);
        return { error: error.message };
    }
}

// --- Event Listeners ---

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSheetData') {
        getSheetData().then(response => {
            sendResponse(response);
        })
        return true; // Indicates asynchronous response
    }
});

// Listen for clicks on the browser action icon (toolbar button)
chrome.action.onClicked.addListener((tab) => {
    console.log('Extension icon clicked. Forcing cache clear and refresh...');

    // Clear the local cache
    sheetDataCache = { data: null, timestamp: 0 };

    // Tell the active tab to refresh its data
    if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "forceRefresh" })
            .catch(err => console.log("Could not send forceRefresh message.", err));
    }
});

// Alarm for periodic cache refresh (pre-warms cache)
chrome.alarms.create('periodicCacheRefresh', { periodInMinutes: CACHE_DURATION_MINUTES });

chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'periodicCacheRefresh') {
        console.log('Background alarm: Refreshing data cache...');
        getSheetData().catch(err => console.log("Periodic cache refresh failed:", err));
    }
});

console.log('Background script loaded (n8n Webhook Mode).');