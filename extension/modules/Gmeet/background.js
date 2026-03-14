const API_URL = "https://freshdesk-p1-timer-default-rtdb.asia-southeast1.firebasedatabase.app/meets.json?auth=qstP0N1XO3JdegEDlxNEHJdzdmiCWQq6lVMemUFz";
const UPDATED_AT_URL = "https://freshdesk-p1-timer-default-rtdb.asia-southeast1.firebasedatabase.app/meets/updatedAt.json?auth=qstP0N1XO3JdegEDlxNEHJdzdmiCWQq6lVMemUFz";

// Track notified meetings to prevent spamming in the same window
let notifiedMeetings = new Set();

// 1. Listen for frontend requests (when opening dashboard)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchMeetingsImmediate") {
        fetchDataHelper(false).then(data => {
            // Dashboard open: use cache first (instant load), updatedAt check will determine if fresh fetch needed
            sendResponse({ success: true, data: data });
        }).catch(err => {
            sendResponse({ success: false, error: err.toString() });
        });
        return true; // Keep channel open
    }
});

// 2. Helper to fetch and cache data
async function fetchDataHelper(force = false) {
    try {
        // 1. Check if data has changed on server
        const updateResponse = await fetch(UPDATED_AT_URL);
        const serverUpdatedAt = await updateResponse.json();

        const localData = await chrome.storage.local.get(['lastUpdatedAt', 'cachedMeetings']);
        const localUpdatedAt = localData.lastUpdatedAt;

        // If server time matches local time, and we have cached data, return cache
        // Unless 'force' is true (though usually we trust the timestamp)
        if (!force && serverUpdatedAt === localUpdatedAt && localData.cachedMeetings) {
            console.log("✅ Data unchanged, returning cache");
            return localData.cachedMeetings;
        }

        // 2. Data changed or no cache, fetch full data
        console.log("🔄 Data changed or no cache, fetching fresh...");
        const response = await fetch(API_URL);
        const json = await response.json();

        // Firebase structure: { data: { "email_com": [...] } }
        const rawData = json.data || {};
        const transformedData = {};

        // Transform keys: replace underscores with dots to match standard email format
        // e.g. "user_name@razorpay_com" -> "user.name@razorpay.com"
        for (const [key, value] of Object.entries(rawData)) {
            const newKey = key.replace(/_/g, '.');
            transformedData[newKey] = value;
        }

        // 3. Update Cache & Timestamp
        await chrome.storage.local.set({
            'cachedMeetings': transformedData,
            'lastUpdatedAt': serverUpdatedAt
        });

        return transformedData;

    } catch (error) {
        console.error("API Fetch Error:", error);
        // Fallback to cache if network fails
        const local = await chrome.storage.local.get(['cachedMeetings']);
        if (local.cachedMeetings) return local.cachedMeetings;
        throw error;
    }
}

// 3. Poll every 1 Minute
chrome.alarms.create("fetchMeetings", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "fetchMeetings") {
        console.log("Alarm triggered: fetchMeetings");
        fetchDataHelper().then(meetings => {
            chrome.storage.local.get(['currentUserEmail'], (result) => {
                const email = result.currentUserEmail;
                console.log("Fetched meetings. Current User Email:", email);
                checkTimeAndNotify(meetings, email);
            });
        });
    }
});

// 4. Check time and notify
function checkTimeAndNotify(meetings, currentUserEmail) {
    const now = new Date();
    console.log("Checking time and notify at:", now.toISOString());

    let meetingsToCheck = [];

    // 1. Try specific user email
    if (currentUserEmail && meetings[currentUserEmail]) {
        console.log(`Checking meetings for user: ${currentUserEmail}`);
        meetingsToCheck = meetings[currentUserEmail];
    }
    // 2. Fallback: If no email set, check ALL meetings (God Mode Safety)
    else {
        console.log("No current user email found or no meetings for user. Checking ALL meetings.");
        meetingsToCheck = Object.values(meetings).flat();
    }

    console.log(`Total meetings to check: ${meetingsToCheck.length}`);

    meetingsToCheck.forEach(meeting => {
        // SUPPORT BOTH FORMATS
        const startStr = meeting.startTime || meeting.start_time;
        if (!startStr) return;

        const meetingTime = new Date(startStr);
        const diffMs = meetingTime - now;
        const minutesDiff = diffMs / (1000 * 60);

        const mId = meeting.id || (meeting.title + startStr);
        const key5min = `${mId}_5min`;
        const keyNow = `${mId}_now`;

        // console.log(`Meeting: ${meeting.title}, Starts: ${startStr}, Diff: ${minutesDiff.toFixed(2)} mins`);

        // STAGE 1: 5-Minute Warning (Window: 3 to 7 minutes)
        if (minutesDiff > 3 && minutesDiff <= 7) {
            if (!notifiedMeetings.has(key5min)) {
                console.log(`Triggering 5min warning for: ${meeting.title}`);
                triggerFlash(meeting, "soon");
                notifiedMeetings.add(key5min);
                setTimeout(() => notifiedMeetings.delete(key5min), 10 * 60 * 1000);
            } else {
                // console.log(`Already notified (5min) for: ${meeting.title}`);
            }
        }

        // STAGE 2: Starting Now / Urgent (Window: -1 to 3 minutes)
        else if (minutesDiff >= -1 && minutesDiff <= 3) {
            if (!notifiedMeetings.has(keyNow)) {
                console.log(`Triggering NOW warning for: ${meeting.title}`);
                triggerFlash(meeting, "now");
                notifiedMeetings.add(keyNow);
                setTimeout(() => notifiedMeetings.delete(keyNow), 10 * 60 * 1000);
            } else {
                // console.log(`Already notified (NOW) for: ${meeting.title}`);
            }
        }
    });
}

function triggerFlash(meeting, type) {
    console.log(`Sending message to tabs: ${type} for ${meeting.title}`);
    // Send to ALL tabs that match Freshdesk
    chrome.tabs.query({ url: "*://*.freshdesk.com/*" }, function (tabs) {
        if (!tabs || tabs.length === 0) {
            console.log("No Freshdesk tabs found to notify.");
            return;
        }
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
                action: "triggerNotification",
                meeting: meeting,
                type: type
            }).then(() => {
                console.log(`Notification sent to tab ${tab.id}`);
            }).catch((err) => {
                console.log(`Failed to send to tab ${tab.id}:`, err);
            });
        });
    });
}