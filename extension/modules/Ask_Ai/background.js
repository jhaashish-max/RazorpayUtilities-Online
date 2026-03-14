// AskAi Module - Background Script

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "askAiQuery") {
        handleAskAiQuery(request.query)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(err => sendResponse({ success: false, error: err.message }));

        return true; // Keep channel open for async response
    }
});

async function handleAskAiQuery(text) {
    const API_URL = "https://n8n-conc.razorpay.com/webhook/askai";

    console.log("[AskAi] Sending query:", text);

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
                // Note: 'Cookie' header cannot be set in fetch.
                // If cookies are needed, they should be handled by the browser 
                // via 'credentials: "include"' if the domain is different,
                // but since it's a Chrome Extension bg script, standard fetch 
                // respects browser cookies for the domain usually.
            },
            body: JSON.stringify({ text: text })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const json = await response.json();
        console.log("[AskAi] Response:", json);
        return json;

    } catch (error) {
        console.error("[AskAi] Failed:", error);
        throw error;
    }
}
