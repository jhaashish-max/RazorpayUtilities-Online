// --- UNIFIED BACKGROUND LOADER-- -

try {
    importScripts('modules/meeting_tracker/background.js');
} catch (e) {
    console.error("Failed to load Meeting Tracker background:", e);
}

try {
    importScripts('modules/freshdesk_p1/background.js');
} catch (e) {
    console.error("Failed to load Freshdesk P1 background:", e);
}

try {
    importScripts('modules/Gmeet/background.js');
} catch (e) {
    console.error("Failed to load Gmeet background:", e);
}

try {
    importScripts('modules/Daily_Tracker/background.js');
} catch (e) {
    console.error("Failed to load Daily Tracker background:", e);
}

try {
    importScripts('modules/Ask_Ai/background.js');
} catch (e) {
    console.error("Failed to load Ask_Ai background:", e);
}
