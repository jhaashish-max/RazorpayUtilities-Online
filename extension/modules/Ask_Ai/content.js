// AskAi Module - Content Script

(function () {
    // Prevent duplicate injection
    if (document.getElementById('ask-ai-host')) return;

    // Create Host for Shadow DOM
    const host = document.createElement('div');
    host.id = 'ask-ai-host';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    // Inject Styles directly into Shadow DOM
    const link = document.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', chrome.runtime.getURL('modules/Ask_Ai/styles.css'));
    shadow.appendChild(link);

    // --- HTML Structure ---
    const container = document.createElement('div');
    container.innerHTML = `
        <!-- Chat Window -->
        <div class="ask-ai-window" id="chat-window">
            <div class="ask-ai-header">
                <div class="ask-ai-logo">Ai</div>
                <div class="ask-ai-title">
                    <h3>Razorpay Assistant</h3>
                    <p>Powered by N8N & AI</p>
                </div>
                <button class="ask-ai-expand-btn" id="expand-btn" title="Toggle Fullscreen">
                    <svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"></path></svg>
                </button>
            </div>
            
            <div class="ask-ai-messages" id="messages-area">
                <div class="ask-ai-message msg-ai">
                    <div style="padding: 15px;">Hello! 👋<br>I'm your AI assistant. Ask me anything about payments, errors, or workflows.</div>
                </div>
            </div>

            <div class="ask-ai-input-area">
                <textarea class="ask-ai-input" id="user-input" placeholder="Type your question..." rows="1"></textarea>
                <button class="ask-ai-send-btn" id="send-btn" disabled>
                    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>
                </button>
            </div>
        </div>

        <!-- Floating Action Button -->
        <div class="ask-ai-fab" id="fab">
            <svg viewBox="0 0 24 24">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"></path>
            </svg>
        </div>
    `;
    shadow.appendChild(container);

    // --- Logic ---
    const fab = shadow.getElementById('fab');
    const windowEl = shadow.getElementById('chat-window');
    const input = shadow.getElementById('user-input');
    const sendBtn = shadow.getElementById('send-btn');
    const messagesArea = shadow.getElementById('messages-area');
    const expandBtn = shadow.getElementById('expand-btn');

    // Toggle Window
    fab.addEventListener('click', () => {
        const isVisible = windowEl.classList.contains('visible');
        if (isVisible) {
            windowEl.classList.remove('visible');
            fab.classList.remove('open');
        } else {
            windowEl.classList.add('visible');
            fab.classList.add('open');
            setTimeout(() => input.focus(), 300);
            scrollToBottom();
        }
    });

    // Expand Toggle
    expandBtn.addEventListener('click', () => {
        windowEl.classList.toggle('expanded');
        setTimeout(scrollToBottom, 300);
    });

    // Input Handling
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 100) + 'px';
        sendBtn.disabled = !input.value.trim();
    });

    input.addEventListener('keydown', (e) => {
        // Prevent Freshdesk shortcuts
        e.stopPropagation();

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Also stop keypress/keyup just in case
    input.addEventListener('keypress', (e) => e.stopPropagation());
    input.addEventListener('keyup', (e) => e.stopPropagation());

    sendBtn.addEventListener('click', sendMessage);

    async function sendMessage() {
        const text = input.value.trim();
        if (!text) return;

        // Add User Message
        appendMessage(text, 'user');
        input.value = '';
        input.style.height = 'auto';
        sendBtn.disabled = true;

        // Show Loading
        const loaderId = appendLoader();

        try {
            // Call Background API
            const response = await chrome.runtime.sendMessage({
                action: "askAiQuery",
                query: text
            });

            removeLoader(loaderId);

            if (response && response.success && response.data) {
                // Parse AI Response - Handle multiple response formats
                let parts = null;

                // Format 1: data.content.parts (old N8N format)
                if (response.data.content?.parts) {
                    parts = response.data.content.parts;
                }
                // Format 2: data.candidates[0].content.parts (Gemini direct format)
                else if (response.data.candidates?.[0]?.content?.parts) {
                    parts = response.data.candidates[0].content.parts;
                }

                if (parts && parts.length > 0) {
                    let rawText = parts[0].text;
                    // Extract HTML from markdown code blocks (```html...```)
                    const htmlMatch = rawText.match(/```html\s*([\s\S]*?)\s*```/);
                    let cleanHtml = htmlMatch ? htmlMatch[1] : rawText;

                    // Render HTML
                    appendHtmlResponse(cleanHtml);
                } else {
                    appendMessage("Received empty response.", 'ai');
                }
            } else {
                appendMessage("Error: " + (response.error || "Unknown error"), 'ai');
            }

        } catch (e) {
            removeLoader(loaderId);
            appendMessage("Network Error: " + e.message, 'ai');
        }
    }

    function appendMessage(text, sender) {
        const div = document.createElement('div');
        div.className = `ask-ai-message msg-${sender}`;
        div.innerText = text; // User messages are text
        if (sender === 'ai') {
            // Basic text AI response fallback
            div.innerHTML = text.replace(/\n/g, '<br>');
        }
        messagesArea.appendChild(div);
        scrollToBottom();
    }

    function appendHtmlResponse(htmlContent) {
        // Unescape escaped quotes if present (from API responses)
        let cleanHtml = htmlContent
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n')
            .replace(/\\\\/g, '\\');

        const div = document.createElement('div');
        div.className = 'ask-ai-message msg-ai ai-html-response';

        // Create a container for the HTML content
        const contentDiv = document.createElement('div');
        contentDiv.className = 'ai-response-content';
        contentDiv.innerHTML = cleanHtml;

        div.appendChild(contentDiv);
        messagesArea.appendChild(div);

        // Multiple scroll attempts to ensure it works
        scrollToBottom();
        setTimeout(scrollToBottom, 100);
        setTimeout(scrollToBottom, 300);
    }

    function appendLoader() {
        const id = 'loader-' + Date.now();
        const div = document.createElement('div');
        div.id = id;
        div.className = 'typing-indicator';
        div.innerHTML = `
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
        `;
        messagesArea.appendChild(div);
        scrollToBottom();
        return id;
    }

    function removeLoader(id) {
        const el = shadow.getElementById(id);
        if (el) el.remove();
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            messagesArea.scrollTop = messagesArea.scrollHeight;
        });
    }

})();
