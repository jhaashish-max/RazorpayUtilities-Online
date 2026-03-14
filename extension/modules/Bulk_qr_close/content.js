// =========================================================================
// --- CONFIGURATION ---
// =========================================================================
const CHUNK_SIZE = 400;       // IDs per batch
const DELAY_BETWEEN_CHUNKS = 2500; // Time between batches
const DELAY_UI_UPDATE = 1000;      // Time for UI to react

// =========================================================================
// --- UI & STYLING ---
// =========================================================================

function injectStyles() {
    const styleId = 'rp-bulk-styles';
    if (document.getElementById(styleId)) return;

    const css = `
        /* Main Trigger Button */
        #rp-main-trigger {
            position: fixed;
            top: 85px;
            right: 30px;
            z-index: 9999;
            background-color: #2563EB; /* Royal Blue */
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-weight: 600;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        #rp-main-trigger:hover {
            background-color: #1D4ED8;
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(37, 99, 235, 0.4);
        }

        /* Modal Overlay */
        #rp-modal-overlay {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease;
        }
        #rp-modal-overlay.active {
            opacity: 1;
            pointer-events: all;
        }

        /* Modal Box */
        .rp-modal-box {
            background: white;
            width: 500px;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            position: relative;
            transform: scale(0.95);
            transition: transform 0.2s ease;
        }
        #rp-modal-overlay.active .rp-modal-box {
            transform: scale(1);
        }

        /* Modal Content */
        .rp-modal-header {
            font-size: 20px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 16px;
            border-bottom: 1px solid #E5E7EB;
            padding-bottom: 12px;
        }
        .rp-instruction-list {
            list-style: none;
            padding: 0;
            margin: 0 0 24px 0;
        }
        .rp-instruction-list li {
            margin-bottom: 12px;
            color: #374151;
            font-size: 14px;
            display: flex;
            align-items: flex-start;
            line-height: 1.5;
        }
        .rp-icon {
            margin-right: 10px;
            color: #2563EB;
            font-weight: bold;
        }
        .rp-code-bg {
            background: #F3F4F6;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
            color: #C026D3;
        }

        /* Buttons in Modal */
        .rp-btn-group {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        }
        .rp-btn-upload {
            background-color: #2563EB;
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            border: none;
            font-weight: 600;
            cursor: pointer;
        }
        .rp-btn-upload:hover { background-color: #1D4ED8; }
        
        .rp-btn-cancel {
            background-color: white;
            color: #374151;
            padding: 10px 20px;
            border-radius: 6px;
            border: 1px solid #D1D5DB;
            font-weight: 600;
            cursor: pointer;
        }
        .rp-btn-cancel:hover { background-color: #F9FAFB; }

        /* Status Toast */
        #rp-status-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: #1F2937;
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 10px 15px rgba(0,0,0,0.2);
            z-index: 10001;
            display: none;
            font-family: sans-serif;
            font-size: 14px;
            max-width: 400px;
            border-left: 6px solid #3B82F6;
        }
    `;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
}

function createUI() {
    injectStyles();

    // Prevent duplicate creation
    if (document.getElementById('rp-main-trigger')) return;

    // Clean up any stale elements (if button is missing but these remain)
    const staleModal = document.getElementById('rp-modal-overlay');
    if (staleModal) staleModal.remove();

    const staleToast = document.getElementById('rp-status-toast');
    if (staleToast) staleToast.remove();

    // 1. Create Main Button (always created, visibility controlled by CSS)
    const btn = document.createElement('button');
    btn.id = 'rp-main-trigger';
    btn.innerHTML = `<span>📂</span> Bulk QR Closure Tool`;
    document.body.appendChild(btn);

    // 2. Create Modal Structure
    const modalHtml = `
        <div id="rp-modal-overlay">
            <div class="rp-modal-box">
                <div class="rp-modal-header">Bulk QR Closure Instructions</div>
                
                <ul class="rp-instruction-list">
                    <li>
                        <span class="rp-icon">1.</span>
                        <span>Supported Files: <strong>Excel (.xlsx)</strong> or <strong>CSV</strong>.</span>
                    </li>
                    <li>
                        <span class="rp-icon">2.</span>
                        <span><strong>Column A</strong> must contain the QR IDs.</span>
                    </li>
                    <li>
                        <span class="rp-icon">3.</span>
                        <span><strong>Row 1</strong> is treated as a Header and will be skipped.</span>
                    </li>
                    <li>
                        <span class="rp-icon">4.</span>
                        <span>Note: Prefixes like <span class="rp-code-bg">qr_</span> are automatically removed.</span>
                    </li>
                </ul>

                <div class="rp-btn-group">
                    <button class="rp-btn-cancel" id="rp-modal-close">Cancel</button>
                    <button class="rp-btn-upload" id="rp-modal-upload">Select File & Start</button>
                </div>
            </div>
        </div>
    `;
    const modalDiv = document.createElement('div');
    modalDiv.innerHTML = modalHtml;
    document.body.appendChild(modalDiv);

    // 3. Create Hidden Input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv, .xlsx, .xls';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // 4. Create Status Toast
    const statusDiv = document.createElement('div');
    statusDiv.id = 'rp-status-toast';
    document.body.appendChild(statusDiv);

    // --- EVENT LISTENERS ---

    // Open Modal
    btn.onclick = () => {
        document.getElementById('rp-modal-overlay').classList.add('active');
    };

    // Close Modal
    document.getElementById('rp-modal-close').onclick = () => {
        document.getElementById('rp-modal-overlay').classList.remove('active');
    };

    // Click "Select File" inside modal
    document.getElementById('rp-modal-upload').onclick = () => {
        fileInput.click();
    };

    // File Selected
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            // Hide modal
            document.getElementById('rp-modal-overlay').classList.remove('active');
            // Process
            processFile(file);
        }
        fileInput.value = '';
    };
}

function updateStatus(message, type = 'info') {
    const el = document.getElementById('rp-status-toast');
    if (!el) return;

    el.style.display = 'block';
    el.textContent = message;

    if (type === 'error') {
        el.style.borderLeftColor = '#EF4444'; // Red
    } else if (type === 'success') {
        el.style.borderLeftColor = '#10B981'; // Green
    } else {
        el.style.borderLeftColor = '#3B82F6'; // Blue
    }
}

// =========================================================================
// --- LOGIC ---
// =========================================================================

async function processFile(file) {
    updateStatus("Reading file...", 'info');

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            // Remove header row
            if (json.length > 0) json.shift();

            let validIds = [];
            json.forEach(row => {
                if (row[0]) {
                    let rawId = String(row[0]).trim();
                    let cleanId = rawId.replace(/^qr_/i, ''); // Remove prefix
                    if (cleanId && cleanId.length > 3) validIds.push(cleanId);
                }
            });

            if (validIds.length === 0) {
                updateStatus("Error: No valid IDs found in Column A.", 'error');
                return;
            }

            await runAutomationLoop(validIds);

        } catch (err) {
            console.error(err);
            updateStatus(`Error parsing file: ${err.message}`, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

async function runAutomationLoop(allIds) {
    const total = allIds.length;
    const processedReport = [];

    const chunks = [];
    for (let i = 0; i < total; i += CHUNK_SIZE) {
        chunks.push(allIds.slice(i, i + CHUNK_SIZE));
    }

    updateStatus(`Starting: ${total} IDs in ${chunks.length} batches.`);

    // 1. Locate and Open Modal ONCE
    try {
        const menuItems = Array.from(document.querySelectorAll('div.td'));
        const link = menuItems.find(el => el.textContent.trim() === 'Bulk QR Closure');

        if (!link) throw new Error("Could not find 'Bulk QR Closure' link.");

        link.scrollIntoView({ behavior: 'smooth', block: 'center' });
        link.click();
        await delay(DELAY_UI_UPDATE);
    } catch (e) {
        updateStatus(`Error: Make sure you are on the Actions page.\n${e.message}`, 'error');
        return;
    }

    // 2. Loop
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const currentBatch = i + 1;

        updateStatus(`Processing Batch ${currentBatch}/${chunks.length} (${chunk.length} IDs)...`);

        try {
            const textarea = await waitForElement('textarea[name="qr_ids"]', 5000);

            // Paste IDs
            textarea.value = chunk.join(',');
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));

            // Submit
            const submitBtn = document.querySelector('div.btn');
            if (!submitBtn) throw new Error("Submit button missing");
            submitBtn.click();

            // Wait for Success
            await waitForElement('div[data-tip="click to copy"]', 90000); // 90s timeout

            chunk.forEach(id => {
                processedReport.push({ "QR ID": id, "Status": "qrcode cancelled successfully" });
            });

            // Close Modal
            const closeBtn = document.querySelector('.Modal-close');
            if (closeBtn) closeBtn.click();
            await delay(1000);

            // Re-open for next batch (unless last)
            if (i < chunks.length - 1) {
                const menuItems = Array.from(document.querySelectorAll('div.td'));
                const link = menuItems.find(el => el.textContent.trim() === 'Bulk QR Closure');
                if (link) link.click();
                await delay(DELAY_BETWEEN_CHUNKS);
            }

        } catch (err) {
            console.error(err);
            updateStatus(`Batch ${currentBatch} Failed: ${err.message}. Retrying...`, 'error');

            chunk.forEach(id => {
                processedReport.push({ "QR ID": id, "Status": "Failed / Error" });
            });

            // Recovery
            const closeBtn = document.querySelector('.Modal-close');
            if (closeBtn) closeBtn.click();
            await delay(DELAY_BETWEEN_CHUNKS);

            const menuItems = Array.from(document.querySelectorAll('div.td'));
            const link = menuItems.find(el => el.textContent.trim() === 'Bulk QR Closure');
            if (link) link.click();
        }
    }

    updateStatus("Completed! Downloading Report...", 'success');
    downloadReport(processedReport);
}

function downloadReport(data) {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Closure Report");
    XLSX.writeFile(workbook, "Razorpay_Bulk_QR_Closure_Report.xlsx");
}

const delay = ms => new Promise(res => setTimeout(res, ms));

const waitForElement = (selector, timeout = 10000) => {
    return new Promise((resolve, reject) => {
        if (document.querySelector(selector)) return resolve(document.querySelector(selector));
        const observer = new MutationObserver(() => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve(document.querySelector(selector));
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for ${selector}`));
        }, timeout);
    });
};

// =========================================================================
// --- ROBUST VISIBILITY & PERSISTENCE LOOP ---
// =========================================================================

function ensureAndToggleButton() {
    // 0. Ensure Styles exist (SPA might clear head/body)
    injectStyles();

    let btn = document.getElementById('rp-main-trigger');

    // 1. Re-create if missing (SPA might have wiped DOM)
    if (!btn) {
        createUI();
        btn = document.getElementById('rp-main-trigger');
        if (btn) console.log('🔧 Re-created missing button');
    }

    if (!btn) return; // Should exist now

    // 2. Toggle Visibility based on URL
    // Use includes() to handle trailing slashes or query params
    const currentPath = window.location.pathname;
    const isActionsPage = currentPath.includes('/admin/actions');

    // Only log state changes to avoid console spam
    const targetDisplay = isActionsPage ? 'flex' : 'none';
    if (btn.style.display !== targetDisplay) {
        console.log(`🔄 Toggling Button: ${isActionsPage ? 'SHOW' : 'HIDE'} (Path: ${currentPath})`);
        btn.style.display = targetDisplay;
    }
}

// Start the loop immediately
// Run frequently (250ms) to catch SPA navigation quickly
setInterval(ensureAndToggleButton, 250);

// Also run once on load
setTimeout(ensureAndToggleButton, 500);
