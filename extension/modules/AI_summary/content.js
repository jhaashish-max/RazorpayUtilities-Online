// --- Configurations ---
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";
const DEFAULT_PROMPT = `Analyze the following helpdesk ticket conversation. 
Output ONLY the following format (2-3 lines max):
Issue: [Brief summary of the issue]
Resolution: [Brief summary of the resolution or current status]

Ticket Context:
{{context}}`;

// --- Main Logic ---

// 1. Storage Helper Functions
async function getApiKey() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['geminiApiKey'], (result) => {
            resolve(result.geminiApiKey);
        });
    });
}

async function saveApiKey(key) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ 'geminiApiKey': key }, () => {
            resolve();
        });
    });
}

async function getStoredPrompt() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['geminiPrompt'], (result) => {
            resolve(result.geminiPrompt || DEFAULT_PROMPT);
        });
    });
}

async function saveStoredPrompt(newPrompt) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ 'geminiPrompt': newPrompt }, () => {
            resolve();
        });
    });
}


// 2. Helper: Wait function (simulating Puppeteer's waitForTimeout)
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 3. Helper: Expand All Conversations (The "Click + Button" Logic)
async function expandAllConversations(statusCallback) {
    const loadMoreSelector = 'button[data-test-button="load-more"]';

    // Safety break to prevent infinite loops if something goes wrong
    let maxAttempts = 20;
    let attempts = 0;

    while (attempts < maxAttempts) {
        // Find the button
        const loadMoreBtn = document.querySelector(loadMoreSelector);

        // If button doesn't exist or is disabled, we assume we are done
        if (!loadMoreBtn || loadMoreBtn.disabled) {
            console.log("No more conversations to load.");
            break;
        }

        // Notify user via button text
        if (statusCallback) statusCallback(`Loading history (${attempts + 1})...`);

        console.log("Clicking 'Load more'...");
        loadMoreBtn.click();

        // Wait a moment for the 'pending' class to potentially appear and the API call to start
        await wait(1000);

        // Wait until the button stops loading (removes .pending class) OR disappears
        let loadingChecks = 0;
        while (loadingChecks < 30) { // Timeout after ~15 seconds
            const loadingBtn = document.querySelector(`${loadMoreSelector}.pending`);
            if (!loadingBtn) {
                // Loading finished
                break;
            }
            await wait(500);
            loadingChecks++;
        }

        attempts++;
        // Small delay before next check to be safe
        await wait(1000);
    }
}

// 4. Scraper Logic
function scrapeTicketContext() {
    console.log("Scraping ticket data...");
    let fullContext = "";

    // Extract Description
    const firstDescriptionNode = document.querySelector('div[data-album*="ticket_"]');
    if (firstDescriptionNode) {
        const textContent = firstDescriptionNode.querySelector('.text-content-wrapper')?.innerText || "";
        fullContext += `[ORIGINAL REQUEST]:\n${textContent}\n\n`;
    }

    // Extract Conversations (Notes/Replies)
    const conversationNodes = document.querySelectorAll('div[data-test-id="conversation-wrapper"]');
    conversationNodes.forEach(convoNode => {
        const author = convoNode.querySelector('.user')?.innerText.trim() || "Agent/System";
        // Check if it's a private note or public reply for better AI context
        const isPrivate = convoNode.classList.contains('ticket-details__privatenote') ? "(Private Note)" : "(Public Reply)";

        const content = convoNode.querySelector('div[data-test-conversation="conversation-text"]')?.innerText || "";

        if (content.trim().length > 0) {
            fullContext += `[${isPrivate} from ${author}]:\n${content}\n\n`;
        }
    });

    return fullContext;
}

// 5. Gemini API Interaction
async function generateSummary(context) {
    let apiKey = await getApiKey();

    if (!apiKey) {
        apiKey = await showApiKeyModal();
        if (!apiKey) return null;
    }

    const currentPrompt = await getStoredPrompt();
    const finalizedPrompt = currentPrompt.replace('{{context}}', context);

    const payload = {
        contents: [{
            parts: [{
                text: finalizedPrompt
            }]
        }]
    };

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.error) {
            console.error("Gemini Error:", data.error);
            // If invalid key, prompt again
            if (data.error.code === 400 || data.error.message.includes('API key')) {
                const newKey = await showApiKeyModal(true, data.error.message);
                if (newKey) {
                    return generateSummary(context);
                }
            }
            return `Error: ${data.error.message}`;
        }

        if (data.candidates && data.candidates.length > 0) {
            return data.candidates[0].content.parts[0].text;
        } else {
            return "Error: No response generated by AI.";
        }

    } catch (error) {
        console.error("Network Error:", error);
        return "Error: Network issue connecting to AI.";
    }
}

// 6. UI: Modals
function showApiKeyModal(isError = false, errorMessage = "") {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fas-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'fas-modal';

        const title = isError ? 'API Error' : 'Enter Gemini API Key';
        const msg = isError ? `<p style="color:red; margin-bottom:10px;">${errorMessage}</p><p>Please update your API Key:</p>` : '<p>Please enter your Google Gemini API Key to continue.</p>';

        modal.innerHTML = `
            <h2>${title}</h2>
            ${msg}
            <input type="password" id="fas-api-key-input" placeholder="Paste API Key here..." />
            <div class="fas-modal-actions">
                <button class="fas-btn fas-btn-secondary" id="fas-cancel-btn">Cancel</button>
                <button class="fas-btn fas-btn-primary" id="fas-save-btn">Save</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const input = modal.querySelector('#fas-api-key-input');
        const saveBtn = modal.querySelector('#fas-save-btn');
        const cancelBtn = modal.querySelector('#fas-cancel-btn');

        input.focus();

        const close = (val) => {
            document.body.removeChild(overlay);
            resolve(val);
        };

        saveBtn.onclick = async () => {
            const key = input.value.trim();
            if (key) {
                await saveApiKey(key);
                close(key);
            }
        };

        cancelBtn.onclick = () => close(null);

        // Allow Enter key to save
        input.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') saveBtn.click();
        });
    });
}

function showPromptEditorModal() {
    return new Promise(async (resolve) => {
        const currentPrompt = await getStoredPrompt();

        const overlay = document.createElement('div');
        overlay.className = 'fas-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'fas-modal';
        modal.style.width = '600px';

        modal.innerHTML = `
            <h2>Customize Prompt</h2>
            <p>Edit the instructions sent to Gemini. Keep <code>{{context}}</code> where the ticket content should act.</p>
            <textarea id="fas-prompt-input" style="height: 200px;">${currentPrompt}</textarea>
            <div class="fas-modal-actions">
                <button class="fas-btn fas-btn-secondary" id="fas-reset-btn">Reset to Default</button>
                <button class="fas-btn fas-btn-secondary" id="fas-cancel-prompt-btn">Cancel</button>
                <button class="fas-btn fas-btn-primary" id="fas-save-prompt-btn">Save</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const input = modal.querySelector('#fas-prompt-input');
        const saveBtn = modal.querySelector('#fas-save-prompt-btn');
        const cancelBtn = modal.querySelector('#fas-cancel-prompt-btn');
        const resetBtn = modal.querySelector('#fas-reset-btn');

        const close = () => {
            document.body.removeChild(overlay);
            resolve();
        };

        saveBtn.onclick = async () => {
            const newPrompt = input.value.trim();
            if (newPrompt) {
                await saveStoredPrompt(newPrompt);
                close();
            }
        };

        resetBtn.onclick = () => {
            input.value = DEFAULT_PROMPT;
        };

        cancelBtn.onclick = close;
    });
}


// 7. UI Injection
function injectButton() {
    const targetButton = document.querySelector('button[data-cmd="resetFont"]');

    if (!targetButton || document.getElementById('freddy-ai-summarizer-btn')) return;

    // Container for our buttons
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; align-items: center; margin-left: 5px;';

    // Main Action Button
    const btn = document.createElement('button');
    btn.id = 'freddy-ai-summarizer-btn';
    btn.type = 'button';
    btn.className = 'fr-command fr-btn';
    btn.title = 'Generate AI Summary';
    btn.style.cssText = 'width: auto; padding: 0 10px; font-weight: bold; color: #2c5cc5; display: flex; align-items: center; justify-content: center;';
    btn.innerHTML = '<span>✨ AI Summary</span>';

    // Settings/Prompt Edit Button (Arrow)
    const settingsBtn = document.createElement('button');
    settingsBtn.id = 'freddy-ai-settings-btn';
    settingsBtn.type = 'button';
    settingsBtn.className = 'fr-command fr-btn';
    settingsBtn.title = 'Edit Prompt';
    settingsBtn.innerHTML = `
       <svg viewBox="0 0 24 24">
           <path d="M7 10l5 5 5-5z"></path>
       </svg>
    `;

    // Append to container
    container.appendChild(btn);
    container.appendChild(settingsBtn);

    // Event Listeners
    settingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showPromptEditorModal();
    });

    btn.addEventListener('click', async (e) => {
        e.preventDefault();

        const originalText = '<span>✨ AI Summary</span>';
        btn.disabled = true;

        try {
            // Step 1: Expand History
            await expandAllConversations((statusText) => {
                btn.innerHTML = `<span>${statusText}</span>`;
            });

            // Step 2: Scrape
            btn.innerHTML = '<span>Analyzing...</span>';
            const context = scrapeTicketContext();

            if (!context) {
                alert("No context found to summarize.");
                return;
            }

            // Step 3: Generate
            const summary = await generateSummary(context);

            // Step 4: Insert
            if (summary) {
                insertIntoEditor(summary);
            }
        } catch (err) {
            console.error(err);
            alert("An error occurred: " + err.message);
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });

    targetButton.parentNode.insertBefore(container, targetButton.nextSibling);
}

// 8. Insert Result into Editor
function insertIntoEditor(text) {
    const editor = document.querySelector('.fr-element.fr-view');

    if (editor) {
        const formattedText = text.replace(/\n/g, '<br>').replace(/(Issue:|Resolution:)/g, '<strong>$1</strong>');

        editor.innerHTML += `<p><br>----------------<br>${formattedText}<br>----------------</p>`;

        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.focus();
    } else {
        alert("Could not find open editor. Please open a Reply or Note first.\n\n" + text);
    }
}

// --- Initialization ---
const observer = new MutationObserver((mutations) => {
    // Check if button is missing and needs reinjection (e.g. after view changes)
    if (!document.getElementById('freddy-ai-summarizer-btn')) {
        injectButton();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

setTimeout(injectButton, 2000);