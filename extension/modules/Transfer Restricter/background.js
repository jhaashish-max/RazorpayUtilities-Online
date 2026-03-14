// Background service worker for Freshdesk Transfer Restricter

const REMOTE_FORM_URL = "https://jhaashish-max.github.io/Transfer-restriction-form/form_data.json";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fetchFormData') {

        fetch(REMOTE_FORM_URL)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Network response was not ok: ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                sendResponse({ success: true, data: data });
            })
            .catch(error => {
                console.error("Background fetch failed:", error);
                sendResponse({ success: false, error: error.message });
            });

        return true; // Will respond asynchronously
    }
});
