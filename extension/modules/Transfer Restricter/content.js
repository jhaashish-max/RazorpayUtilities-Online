console.log("Freshdesk Transfer Restricter Extension Loaded v2");

// Configuration
const TARGET_ACTION_TEXTS = [
    "Transfer To A Different Group",
    "Resolution Through Child Ticket"
];
const NOTE_MARKER = "{Transfer Requirements Checked}";
const SIGNATURE_SECRET = "TR-EXT-2024-SECURE"; // Secret key for signature generation

// Simple hash function for signature generation
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36).toUpperCase();
}

// Generate a visible, verifiable signature
function generateSignature() {
    const timestamp = Date.now();
    const dataToSign = `${SIGNATURE_SECRET}-${timestamp}`;
    const hash = simpleHash(dataToSign);
    const signature = `TR-${timestamp.toString(36).toUpperCase()}-${hash}`;
    return signature;
}

// Verify a signature
function verifySignature(signature) {
    if (!signature || !signature.startsWith('TR-')) return false;

    const parts = signature.split('-');
    if (parts.length !== 3) return false;

    const timestampBase36 = parts[1];
    const providedHash = parts[2];

    // Convert timestamp back
    const timestamp = parseInt(timestampBase36, 36);
    if (isNaN(timestamp)) return false;

    // Recalculate hash
    const dataToSign = `${SIGNATURE_SECRET}-${timestamp}`;
    const expectedHash = simpleHash(dataToSign);

    return providedHash === expectedHash;
}

// State
let isModalOpen = false;
let formData = null;
let statusFormData = null;
let cancelCooldown = false; // Prevent re-opening immediately after cancel
let formCompletedForTransfer = false; // Flag: form already completed for current transfer
let lastKnownStatus = null; // Track status for change detection

// Initialize
function init() {
    // Double-check URL to be safe, though manifest handles it
    if (!window.location.href.startsWith("https://razorpay-ind.freshdesk.com/a/tickets/")) {
        console.log("Transfer Restricter: Not a ticket page, skipping.");
        return;
    }

    console.log("Initializing...");

    // Load Form Data with Remote -> Cache -> Bundle fallback
    const CACHE_KEY = "TR_cached_form_data";

    // helper to load from bundle
    const loadFromBundle = () => {
        const url = chrome.runtime.getURL('form_data.json');
        console.log("Fetching form data from bundle:", url);
        fetch(url)
            .then(response => response.json())
            .then(data => {
                formData = data;
                console.log("Form data loaded from bundle.");
            })
            .catch(err => console.error("Failed to load form data from bundle", err));
    };

    // helper to load from cache
    const loadFromCache = () => {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            try {
                formData = JSON.parse(cached);
                console.log("Form data loaded from local storage cache.");
                return true;
            } catch (e) {
                console.error("Failed to parse cached form data", e);
            }
        }
        return false;
    };

    // 1. Try Remote via Background
    console.log("Attempting to fetch form data from remote...");
    chrome.runtime.sendMessage({ action: 'fetchFormData' }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn("Background fetch error (runtime):", chrome.runtime.lastError.message);
            // Fallback
            if (!loadFromCache()) loadFromBundle();
            return;
        }

        if (response && response.success && response.data) {
            console.log("Form data loaded from remote.");
            formData = response.data;
            // Update cache
            localStorage.setItem(CACHE_KEY, JSON.stringify(formData));
        } else {
            console.warn("Background fetch failed or returned no data:", response?.error);
            // Fallback
            if (!loadFromCache()) loadFromBundle();
        }
    });

    // Load Status Form Data
    const statusUrl = chrome.runtime.getURL('status_form_data.json');
    fetch(statusUrl)
        .then(response => response.json())
        .then(data => {
            statusFormData = data;
            console.log("Status form data loaded.");
        })
        .catch(err => console.error("Failed to load status form data", err));

    // Get initial status
    lastKnownStatus = getCurrentStatus();
    console.log("Initial status:", lastKnownStatus);

    // Observer for dropdown and status changes
    const observer = new MutationObserver(() => {
        // Always remove "Send and set as" element
        removeSendAndSetElement();

        detectTransferSelection();
        if (!isModalOpen) {
            detectStatusChange();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    // Initial checks
    removeSendAndSetElement();

    // Check if we already completed this for this session
    if (isTransferCompletedCheck()) {
        formCompletedForTransfer = true;
        console.log("Transfer already completed for this ticket in session.");
    }

    detectTransferSelection();
}

// Remove "Send and set as" dropdown element
function removeSendAndSetElement() {
    const sendAndSetTriggers = document.querySelectorAll('.send-and-set-trigger');
    sendAndSetTriggers.forEach(el => {
        console.log("Removing Send and set as element");
        el.remove();
    });
}

// Helper to get Ticket ID for persistence
function getTicketId() {
    const match = window.location.href.match(/tickets\/(\d+)/);
    return match ? match[1] : null;
}

// Session Persistence for Transfer Completion
function isTransferCompletedCheck() {
    const ticketId = getTicketId();
    if (!ticketId) return false;
    return sessionStorage.getItem(`TR_complete_${ticketId}`) === 'true';
}

function setTransferCompleted() {
    const ticketId = getTicketId();
    if (ticketId) {
        sessionStorage.setItem(`TR_complete_${ticketId}`, 'true');
    }
    formCompletedForTransfer = true;
}

// Get current status from page
function getCurrentStatus() {
    // Find all power-select triggers and look for one containing status-like values
    const allPowerSelects = document.querySelectorAll('.ember-power-select-trigger .ember-power-select-selected-item');

    // Known status values to help identify the status dropdown
    const statusKeywords = ['Open', 'Pending', 'Resolved', 'Closed', 'Waiting', 'Customer', 'Third Party', 'Escalated'];

    for (const select of allPowerSelects) {
        const text = select.textContent.trim();
        // Check if this looks like a status value
        if (statusKeywords.some(keyword => text.includes(keyword))) {
            // Make sure it's not the End State Action dropdown
            const parentTrigger = select.closest('.ember-power-select-trigger');
            const ariaLabel = parentTrigger?.getAttribute('aria-label') || '';
            if (!ariaLabel.includes('End State')) {
                return text;
            }
        }
    }

    return null;
}

// Detect status changes
function detectStatusChange() {
    const currentStatus = getCurrentStatus();

    if (!currentStatus) {
        return; // Can't detect status yet
    }

    if (!lastKnownStatus) {
        lastKnownStatus = currentStatus;
        return;
    }

    // If status changed, show the modal (unless one is already open)
    if (currentStatus !== lastKnownStatus && !isModalOpen) {
        console.log(`[Status] Changed: "${lastKnownStatus}" → "${currentStatus}"`);

        // Show status change modal
        showStatusChangeModal(lastKnownStatus, currentStatus);

        // Note: lastKnownStatus is updated in the modal submit handler
    }
}

function detectTransferSelection() {
    // First: Check if Transfer is currently selected
    const selectedItems = document.querySelectorAll('.ember-power-select-selected-item');
    let transferIsSelected = false;
    let transferElement = null;
    let currentValue = null;

    for (const item of selectedItems) {
        const text = item.textContent.trim();
        // Look for End State Action dropdown specifically
        const parentLabel = item.closest('[aria-label*="End State"]') ||
            item.closest('[data-test-id="trigger-power-select"]');
        if (parentLabel) {
            currentValue = text;
            if (TARGET_ACTION_TEXTS.includes(text)) {
                transferIsSelected = true;
                transferElement = item;
            }
            break;
        }
    }

    // Debug log current state
    console.log(`[DEBUG] Dropdown value: "${currentValue}", transferIsSelected: ${transferIsSelected}, formCompletedForTransfer: ${formCompletedForTransfer}`);

    // If Transfer is NOT selected
    if (!transferIsSelected) {
        if (formCompletedForTransfer) {
            console.log("Transfer deselected - resetting formCompletedForTransfer flag");
            formCompletedForTransfer = false;
        }

        // If modal was open, close it and re-enable update button
        if (isModalOpen) {
            console.log("Transfer deselected - closing modal");
            const overlay = document.getElementById('transfer-modal-overlay');
            if (overlay) overlay.remove();
            isModalOpen = false;
            enableUpdateBtn();
            console.log("Transfer deselected - modal closed, update button enabled (no refresh).");
        }
    }

    // If Transfer IS selected and we should show modal
    if (transferIsSelected && !isModalOpen && !cancelCooldown && !formCompletedForTransfer) {
        console.log("Transfer action detected!");

        // Immediately reset this dropdown to "--"
        forceResetDropdown(transferElement);

        // Show our validation modal (NON-BLOCKING)
        showTransferModal();

        // Disable the Update button to prevent premature submission
        disableUpdateBtn();
    }
}

// Disable the "Update" button on the ticket
function disableUpdateBtn() {
    const btn = document.querySelector('.ticket-details-submit, [data-test-id="ticket-properties-btn"]');
    if (btn) {
        btn.disabled = true;
        btn.title = "Please complete the Transfer form first";
        btn.style.opacity = "0.6";
        btn.style.cursor = "not-allowed";
        console.log("Transfer Restricter: Update button disabled.");
    }
}

// Enable the "Update" button on the ticket
function enableUpdateBtn() {
    const btn = document.querySelector('.ticket-details-submit, [data-test-id="ticket-properties-btn"]');
    if (btn) {
        btn.disabled = false;
        btn.title = "";
        btn.style.opacity = "";
        btn.style.cursor = "";
        console.log("Transfer Restricter: Update button enabled.");
    }
}

async function forceResetDropdown(selectedItemSpan) {
    console.log("Forcing dropdown reset...");

    // Get the trigger element
    const trigger = selectedItemSpan.closest('.ember-power-select-trigger');
    if (!trigger) {
        console.warn("Trigger not found");
        return;
    }

    // 1. Click to open dropdown
    trigger.click();

    // 2. Wait a moment for options to render
    await sleep(300);

    // 3. Find and click the "--" option
    const options = document.querySelectorAll('.ember-power-select-option');
    for (const opt of options) {
        const text = opt.textContent.trim();
        if (text === "--" || text === "") {
            console.log("Clicking reset option:", text);
            opt.click();

            // Reset the completed flag since this is a fresh transfer attempt
            formCompletedForTransfer = false;
            console.log("Reset formCompletedForTransfer flag");
            return;
        }
    }

    // If we couldn't find it, close the dropdown
    trigger.click();
    console.warn("Could not find '--' option");
}

// Function to set dropdown back to "Transfer To A Different Group" on success
async function setDropdownToTransfer() {
    console.log("Setting dropdown to Transfer...");

    // Find any power-select trigger that currently shows "--"
    const selectedItems = document.querySelectorAll('.ember-power-select-selected-item');
    let trigger = null;

    for (const item of selectedItems) {
        if (item.textContent.trim() === '--' || item.textContent.trim() === '') {
            trigger = item.closest('.ember-power-select-trigger');
            break;
        }
    }

    // Also check for placeholders
    if (!trigger) {
        const placeholders = document.querySelectorAll('.custom-placeholder');
        for (const ph of placeholders) {
            if (ph.textContent.trim() === '--') {
                trigger = ph.closest('.ember-power-select-trigger');
                break;
            }
        }
    }

    if (!trigger) {
        console.warn("Could not find dropdown to set to Transfer");
        return false;
    }

    // Open dropdown
    trigger.click();
    await sleep(300);

    // Find and click a target action option
    const options = document.querySelectorAll('.ember-power-select-option');
    for (const opt of options) {
        if (TARGET_ACTION_TEXTS.includes(opt.textContent.trim())) {
            console.log("Clicking Transfer option");

            // Set cooldown so we don't detect this as a new trigger
            cancelCooldown = true;
            opt.click();

            // Clear cooldown after a moment
            setTimeout(() => {
                cancelCooldown = false;
            }, 1000);

            return true;
        }
    }

    // Close if not found
    trigger.click();
    console.warn("Could not find Transfer option");
    return false;
}

// -----------------------------------------------------------------------------
// Dynamic Form Rendering & Handling
// -----------------------------------------------------------------------------

function showTransferModal() {
    if (document.getElementById('transfer-modal-overlay')) return;
    if (!formData) {
        alert("Form data not loaded. Please refresh and try again.");
        return;
    }

    isModalOpen = true;

    const overlay = document.createElement('div');
    overlay.id = 'transfer-modal-overlay';
    overlay.style.cssText = '';
    // CSS class handles positioning now (non-blocking)


    // Build form HTML dynamically
    let fieldsHtml = '';

    // Check if we have the old structure or new structure
    const items = formData.items || [];

    items.forEach(item => {
        fieldsHtml += renderField(item, '', true);
    });

    overlay.innerHTML = `
        <div id="transfer-modal-content">
            <div id="transfer-modal-header">
                <h3>${formData.title}</h3>
            </div>
            <div id="transfer-modal-body">
                <div class="transfer-tree" id="transfer-form-root">
                    ${fieldsHtml}
                </div>
            </div>
            <div id="transfer-modal-footer">
                <span id="modal-status-msg"></span>
                <button id="btn-cancel-transfer" class="transfer-btn transfer-btn-secondary">Cancel</button>
                <button id="btn-submit-transfer" class="transfer-btn transfer-btn-primary" disabled>Submit & Add Note</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Initial Processing
    // Make modal draggable
    const modalContent = document.getElementById('transfer-modal-content');
    const modalHeader = document.getElementById('transfer-modal-header');
    if (overlay && modalHeader) {
        makeDraggable(overlay, modalHeader);
    }

    // Attach listeners
    attachFormListeners(overlay);

    // 2. Scan existing notes if "existing" field is present
    if (document.getElementById('field-existing')) {
        scanExistingNotes();
    }

    document.getElementById('btn-cancel-transfer').addEventListener('click', cancelModal);
    document.getElementById('btn-submit-transfer').addEventListener('click', handleSubmit);

    // Initial validation check
    validateModalForm();
}

function renderField(field, parentPath = '', isRoot = false) {
    // Special case for the "Existing Notes" hardcoded logic (legacy support or explicit ID)
    if (field.id === 'existing') {
        return `
            <div class="form-field-wrapper" data-field-id="${field.id}" id="field-${field.id}">
                <label style="font-weight:500; cursor:pointer; display:block; margin-bottom:10px;">
                    <input type="radio" name="root_choice" value="existing" class="trigger-input" data-is-root="true"> 
                    ${field.label}
                </label>
                <div id="sub-existing" style="display:none; margin-left:20px; padding:10px; background:#f5f5f5; border-radius:4px; margin-top:8px;">
                    <div id="existing-notes-list">Scanning for previous notes...</div>
                    <div id="existing-note-actions" style="display:none; margin-top:10px; padding-top:10px; border-top:1px solid #ddd;">
                        <p style="font-weight:bold; margin-bottom:8px;">Add selected note again?</p>
                        <label style="display:block; margin-bottom:4px;"><input type="radio" name="readd_note" value="yes"> Yes - Duplicate the note</label>
                        <label style="display:block;"><input type="radio" name="readd_note" value="no"> No - Just allow transfer</label>
                    </div>
                </div>
            </div>`;
    }

    let fieldId = field.name || field.id;
    let inputName = fieldId;

    // Force root radios to share the same name group
    if (isRoot && field.type === 'radio') {
        inputName = 'root_choice';
    }

    const isRequired = field.required ? 'required' : '';
    const style = field.important ? 'border:1px solid #ffcccc; background:#fff5f5; padding:10px; border-radius:4px;' : 'margin-bottom:12px;';
    const labelStyle = field.important ? 'color:#d72d30; font-weight:bold;' : 'font-weight:500;';

    let html = `<div class="form-field-wrapper" style="${style}" data-type="${field.type}" data-name="${fieldId}">`;

    if (field.type === 'radio') {
        html += `<label style="${labelStyle} display:block; margin-bottom:8px;">${field.label}${field.required ? ' *' : ''}</label>`;
        if (field.options) {
            field.options.forEach((opt, optIndex) => {
                // Use the actual option value for "existing" to preserve special handling
                const optUniqueVal = opt.value === 'existing' ? 'existing' : `${inputName}_opt_${optIndex}`;

                // Special sub-content for "existing" option
                let subContent = '';
                if (opt.value === 'existing') {
                    subContent = `
                        <div id="sub-existing" class="sub-group" data-parent-name="${inputName}" data-parent-val="existing" style="display:none; margin-left:20px; padding:12px; background:#f8fafc; border-radius:6px; margin-top:8px; border-left:3px solid #2563eb;">
                            <div id="existing-notes-list">Scanning for previous notes...</div>
                            <div id="existing-note-actions" style="display:none; margin-top:10px; padding-top:10px; border-top:1px solid #e2e8f0;">
                                <p style="font-weight:600; margin-bottom:8px; color:#374151;">Add selected note again?</p>
                                <label style="display:block; margin-bottom:6px; cursor:pointer;"><input type="radio" name="readd_note" value="yes"> Yes - Duplicate the note</label>
                                <label style="display:block; cursor:pointer;"><input type="radio" name="readd_note" value="no"> No - Just allow transfer</label>
                            </div>
                        </div>`;
                } else if (opt.subItems && opt.subItems.length > 0) {
                    subContent = `
                        <div class="sub-group" data-parent-name="${inputName}" data-parent-val="${optUniqueVal}" style="display:none; margin-left:20px; margin-top:5px; border-left:2px solid #eee; padding-left:10px;">
                            ${opt.subItems.map(sub => renderField(sub, fieldId)).join('')}
                        </div>`;
                }

                html += `
                    <div style="margin-bottom:6px;">
                        <label style="cursor:pointer;">
                            <input type="radio" name="${inputName}" value="${optUniqueVal}" class="trigger-input" data-has-sub="${!!(opt.subItems && opt.subItems.length > 0) || opt.value === 'existing'}" data-opt-label="${opt.label}">
                            ${opt.label}
                        </label>
                        ${subContent}
                    </div>`;
            });
        }
    } else if (field.type === 'select') {
        html += `<label style="${labelStyle} display:block; margin-bottom:4px;">${field.label}${field.required ? ' *' : ''}</label>`;
        html += `<select name="${fieldId}" class="trigger-input" style="width:100%; padding:6px; border:1px solid #ddd; border-radius:3px;">`;
        html += `<option value="">-- Select --</option>`;
        if (field.options) {
            field.options.forEach((opt, optIndex) => {
                // Use unique identifier for each option
                const optUniqueVal = `${fieldId}_opt_${optIndex}`;
                html += `<option value="${optUniqueVal}" data-opt-label="${opt.label}">${opt.label}</option>`;
            });
        }
        html += `</select>`;

        // Render all possible sub-items containers with unique identifiers
        if (field.options) {
            field.options.forEach((opt, optIndex) => {
                const optUniqueVal = `${fieldId}_opt_${optIndex}`;
                if (opt.subItems && opt.subItems.length > 0) {
                    html += `
                        <div class="sub-group" data-parent-name="${fieldId}" data-parent-val="${optUniqueVal}" style="display:none; margin-left:10px; margin-top:10px;">
                            ${opt.subItems.map(sub => renderField(sub, fieldId)).join('')}
                        </div>`;
                }
            });
        }


    } else if (field.type === 'checkbox') {
        html += `
            <label style="${labelStyle} cursor:pointer;">
                <input type="checkbox" name="${fieldId}" value="true" class="trigger-input" data-has-sub="${!!(field.subItems && field.subItems.length > 0)}">
                ${field.label}${field.required ? ' *' : ''}
            </label>`;

        // Render sub-items that appear when checkbox is checked
        if (field.subItems && field.subItems.length > 0) {
            html += `
                <div class="sub-group checkbox-sub" data-parent-name="${fieldId}" data-parent-val="true" style="display:none; margin-left:20px; margin-top:8px; border-left:2px solid #4CAF50; padding-left:10px;">
                    ${field.subItems.map(sub => renderField(sub, fieldId)).join('')}
                </div>`;
        }


    } else if (field.type === 'text') {
        html += `<label style="${labelStyle} display:block; margin-bottom:4px;">${field.label}${field.required ? ' *' : ''}</label>`;
        html += `<input type="text" name="${fieldId}" placeholder="${field.label}" 
                  class="form-input" 
                  ${field.validation ? `data-regex="${field.validation}"` : ''} 
                  style="width:100%; padding:6px; border:1px solid #ddd; border-radius:3px;">`;

    } else if (field.type === 'textarea') {
        html += `<label style="${labelStyle} display:block; margin-bottom:4px;">${field.label}${field.required ? ' *' : ''}</label>`;
        html += `<textarea name="${fieldId}" placeholder="${field.label}" 
                  class="form-input" 
                  style="width:100%; padding:6px; border:1px solid #ddd; border-radius:3px; min-height:60px;"></textarea>`;
    } else if (field.type === 'section') {
        html += `<h4 style="margin:15px 0 10px 0; border-bottom:1px solid #eee; padding-bottom:5px;">${field.label}</h4>`;
    }

    html += `</div>`;
    return html;
}

// Make an element draggable
function makeDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();
        // get the mouse cursor position at startup:
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        // call a function whenever the cursor moves:
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        // calculate the new cursor position:
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        // set the element's new position:
        // Use offsetTop/Left since we are using fixed positioning on the overlay
        // Note: For 'right' positioned elements, we might need to adjust logic or switch to standard top/left

        // If the element was positioned with 'right', we need to check if we can just manipulate top/left
        // Ideally we switch to top/left positioning once drag starts

        // Simple Top/Left manipulation
        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";

        // Clear 'right' if it exists to prevent conflict
        element.style.right = 'auto';
    }

    function closeDragElement() {
        // stop moving when mouse button is released:
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

function attachFormListeners(overlay) {

    // 1. Inputs triggering visibility changes (Radio, Select)
    overlay.querySelectorAll('.trigger-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const name = e.target.name;
            const val = e.target.value;
            const type = e.target.type; // radio, select-one, checkbox

            // Helper to reset a container
            const resetContainer = (container) => {
                // hide container
                container.style.display = 'none';

                // clear all inputs
                container.querySelectorAll('input, select, textarea').forEach(el => {
                    if (el.type === 'checkbox' || el.type === 'radio') {
                        el.checked = false;
                    } else {
                        el.value = '';
                    }
                });

                // recursively hide all nested sub-groups
                container.querySelectorAll('.sub-group').forEach(sub => {
                    sub.style.display = 'none';
                });
            };

            // Hide all sub-groups for this field name
            // If it's a radio/select, we hide siblings' sub-groups
            if (type === 'radio') {
                // Find all sub-groups controlled by this radio group
                const allSubGroups = overlay.querySelectorAll(`.sub-group[data-parent-name="${name}"]`);
                allSubGroups.forEach(g => {
                    // Only reset if it's NOT the one we are about to show
                    // (Though strict logic says if val matches, show it. If not, reset it.)
                    if (g.dataset.parentVal !== val) {
                        resetContainer(g);
                    }
                });

                // Show the relevant one
                const targetGroup = overlay.querySelectorAll(`.sub-group[data-parent-name="${name}"][data-parent-val="${val}"]`);
                targetGroup.forEach(g => g.style.display = 'block');

                // Special case: Existing Logic
                if (val === 'existing') {
                    const exDiv = document.getElementById('sub-existing');
                    if (exDiv) {
                        exDiv.style.display = 'block';
                        scanExistingNotes();
                    }
                    // Hide other root sub-trees
                    overlay.querySelectorAll('.form-field-wrapper > .sub-group').forEach(g => {
                        if (!g.closest('#sub-existing')) resetContainer(g);
                    });
                } else if (document.getElementById('sub-existing')) {
                    document.getElementById('sub-existing').style.display = 'none';
                }
            }

            else if (type === 'select-one') { // Dropdown
                const allSubGroups = overlay.querySelectorAll(`.sub-group[data-parent-name="${name}"]`);
                allSubGroups.forEach(g => {
                    if (g.dataset.parentVal !== val) {
                        resetContainer(g);
                    }
                });

                const targetGroup = overlay.querySelectorAll(`.sub-group[data-parent-name="${name}"][data-parent-val="${val}"]`);
                targetGroup.forEach(g => g.style.display = 'block');
            }

            else if (type === 'checkbox') {
                // Show/hide sub-items based on checkbox state
                const isChecked = e.target.checked;
                const subGroup = overlay.querySelector(`.sub-group[data-parent-name="${name}"][data-parent-val="true"]`);
                if (subGroup) {
                    if (isChecked) {
                        subGroup.style.display = 'block';
                    } else {
                        resetContainer(subGroup);
                    }
                }
            }

            validateModalForm();
        });
    });

    // 2. Text inputs Validation listeners
    overlay.querySelectorAll('.form-input').forEach(input => {
        input.addEventListener('input', validateModalForm);
    });

    // 3. Existing notes special listeners
    overlay.addEventListener('change', (e) => {
        if (e.target.name === 'readd_note' || e.target.name === 'selected_existing_note') {
            validateModalForm();
        }
    });
}

function cancelModal() {
    console.log("Cancel clicked - reloading page");
    location.reload();
}

function removeModal() {
    console.log("Removing modal...");
    isModalOpen = false;

    // Try multiple methods to ensure removal
    const el = document.getElementById('transfer-modal-overlay');
    if (el) {
        el.style.display = 'none'; // Hide immediately
        el.remove(); // Remove from DOM
        console.log("Modal removed successfully");
    } else {
        console.warn("Modal element not found for removal");
    }

    // Double-check and force remove any lingering overlays
    document.querySelectorAll('#transfer-modal-overlay').forEach(overlay => {
        overlay.remove();
    });
}

function scanExistingNotes() {
    const listContainer = document.getElementById('existing-notes-list');
    listContainer.innerHTML = '<p style="color:#666;">Scanning ticket conversations...</p>';

    // Use the correct Freshdesk selectors (from Puppeteer script)
    // Notes have type "added a private note" in conversation-status
    const conversationWrappers = document.querySelectorAll('div[data-test-id="conversation-wrapper"]');
    const matches = [];

    conversationWrappers.forEach((wrapper, idx) => {
        // Check if it's a note
        const statusEl = wrapper.querySelector('span[data-test-id="conversation-status"]');
        const isNote = statusEl && statusEl.textContent.includes('note');

        // Get content
        const contentEl = wrapper.querySelector('div[data-test-conversation="conversation-text"]');
        const content = contentEl ? contentEl.textContent.trim() : '';

        // Check for our marker
        const hasMarker = content.includes(NOTE_MARKER) || content.includes("Transfer Requirements Checked");

        if (hasMarker) {
            const timeEl = wrapper.querySelector('span[data-test-id="time-info"]');
            const timeText = timeEl ? (timeEl.getAttribute('aria-label') || timeEl.textContent.trim()) : 'Unknown time';

            const authorEl = wrapper.querySelector('a[data-test-id="user-name"]');
            const author = authorEl ? authorEl.textContent.trim() : 'Unknown';

            // Look for visible signature (format: "Signature: TR-XXXXX-YYYYY")
            let isVerified = false;
            const signatureMatch = content.match(/Signature:\s*(TR-[A-Z0-9]+-[A-Z0-9]+)/);
            if (signatureMatch) {
                const signature = signatureMatch[1];
                isVerified = verifySignature(signature);
                console.log(`[Signature Check] Found: ${signature}, Valid: ${isVerified}`);
            }

            matches.push({
                index: idx,
                time: timeText,
                author: author,
                verified: isVerified,
                content: content.substring(0, 150) + (content.length > 150 ? '...' : ''),
                fullContent: contentEl ? contentEl.innerHTML : content
            });
        }
    });

    if (matches.length === 0) {
        listContainer.innerHTML = `
            <div style="padding:10px; color:#555; background:#fff3cd; border-radius:4px;">
                <strong>No previous transfer notes found.</strong><br>
                <small>Notes must contain "${NOTE_MARKER}" to be detected.</small>
            </div>`;
        document.getElementById('existing-note-actions').style.display = 'none';
    } else {
        let html = '<p style="margin-bottom:8px; color:#28a745;"><strong>Found ' + matches.length + ' matching note(s):</strong></p>';
        html += '<div style="max-height:200px; overflow-y:auto;">';

        matches.forEach((m, i) => {
            const verifiedBadge = m.verified
                ? '<span style="background:#28a745;color:#fff;padding:2px 6px;border-radius:3px;font-size:10px;margin-left:8px;">✓ Script Verified</span>'
                : '<span style="background:#ffc107;color:#333;padding:2px 6px;border-radius:3px;font-size:10px;margin-left:8px;">Manual Entry</span>';
            html += `
                <div style="border:1px solid #ddd; padding:8px; margin-bottom:8px; border-radius:4px; background:#fff;">
                    <label style="cursor:pointer; display:block;">
                        <input type="radio" name="selected_existing_note" value="${i}" data-full-content="${encodeURIComponent(m.fullContent)}">
                        <strong>${m.author}</strong> - <span style="color:#666;">${m.time}</span>
                        ${verifiedBadge}
                        <div style="font-size:12px; color:#555; margin-top:4px;">${m.content}</div>
                    </label>
                </div>`;
        });

        html += '</div>';
        listContainer.innerHTML = html;

        // Show actions section
        document.getElementById('existing-note-actions').style.display = 'block';

        // Add listeners
        listContainer.querySelectorAll('input[name="selected_existing_note"]').forEach(inp => {
            inp.addEventListener('change', validateModalForm);
        });
    }
}

function validateModalForm() {
    const overlay = document.getElementById('transfer-modal-overlay');
    const submitBtn = document.getElementById('btn-submit-transfer');
    let isValid = true;

    // recursive checking of VISIBLE fields
    function checkVisibleFields(container) {
        if (!isValid) return; // fail fast

        // Find direct inputs in this container
        // Note: we need to handle inputs that are visible only
        const wrapper = container.querySelectorAll('.form-field-wrapper');

        // Filter to only those that are NOT inside a hidden sub-group
        // Actually, just check offsetParent !== null is easier to detecting visibility

        container.querySelectorAll('input, select, textarea').forEach(el => {
            if (!isValid) return;
            if (el.offsetParent === null) return; // Hidden (in a collapsed sub-group)

            // Special: ignore search inputs or helper inputs
            if (el.type === 'button') return;

            // Special: Existing logic
            if (el.name === 'readd_note' || el.name === 'selected_existing_note') return; // Handled separately
            if (el.name === 'root_choice' && el.value === 'existing') {
                if (el.checked) {
                    // Check existing logic requirements
                    const note = document.querySelector('input[name="selected_existing_note"]:checked');
                    const action = document.querySelector('input[name="readd_note"]:checked');
                    if (!note || !action) isValid = false;
                }
                return;
            }

            // A. Check Required (for Radios/Checkboxes)
            if (el.type === 'radio') {
                // Find the group name
                const groupName = el.name;
                // If any radio in this group is checked?
                // But only if one of them is marked required... wait, "required" attribute is on the data structure, not necessarily the input
                // My render function puts "required" text in label, we assume checking 'checked' status

                // Issue: render function didn't put 'required' attribute on input tag for Radio group logic
                // New logic: Check if the FIELD containing these radios is required
                const wrapper = el.closest('.form-field-wrapper');
                const label = wrapper.querySelector('label');
                if (label && label.innerText.includes('*')) {
                    const checked = overlay.querySelector(`input[name="${groupName}"]:checked`);
                    if (!checked) isValid = false;
                }
            }
            else if (el.type === 'checkbox') {
                // Check if the wrapper label has *
                const wrapper = el.parentElement; // label
                if (wrapper.innerText.includes('*') && !el.checked) isValid = false;
            }
            else {
                // Text/Select/Textarea
                // Check required
                const wrapper = el.closest('.form-field-wrapper');
                const label = wrapper ? wrapper.querySelector('label') : null;
                const isRequired = (label && label.innerText.includes('*'));

                if (isRequired && !el.value.trim()) isValid = false;

                // Check Regex
                if (el.dataset.regex && el.value.trim()) {
                    try {
                        const regex = new RegExp(el.dataset.regex);
                        if (!regex.test(el.value.trim())) isValid = false;
                    } catch (e) { console.warn("Invalid regex", e); }
                }
            }
        });
    }

    checkVisibleFields(overlay);

    submitBtn.disabled = !isValid;
    submitBtn.style.opacity = isValid ? '1' : '0.5';
}

async function handleSubmit() {
    const submitBtn = document.getElementById('btn-submit-transfer');
    const statusMsg = document.getElementById('modal-status-msg');

    submitBtn.disabled = true;
    submitBtn.textContent = "Processing...";
    statusMsg.textContent = "";

    try {
        // Collect Data
        // 1. Check if Existing Note logic is active
        const existingRadio = document.querySelector('input[name="root_choice"][value="existing"]:checked');
        if (existingRadio) {
            const action = document.querySelector('input[name="readd_note"]:checked').value;
            if (action === 'yes') {
                const selectedNote = document.querySelector('input[name="selected_existing_note"]:checked');
                const fullContent = decodeURIComponent(selectedNote.dataset.fullContent);
                await addNoteToTicket(fullContent);
            } else {
                console.log("User chose to skip adding note.");
            }
        } else {
            // 2. Build Note Content from Form
            const signature = generateSignature();
            let noteContent = `<b>${NOTE_MARKER}</b><br/>`;

            // Iterate over all VISIBLE inputs to build validation log
            const overlay = document.getElementById('transfer-modal-overlay');
            const inputs = Array.from(overlay.querySelectorAll('input, select, textarea'));

            // Group by field for display
            let details = [];

            inputs.forEach(el => {
                if (el.offsetParent === null) return; // Hidden
                if (el.type === 'button') return;

                let label = '';
                let val = '';

                if (el.type === 'radio') {
                    if (el.checked) {
                        const wrapper = el.closest('.form-field-wrapper');
                        label = wrapper.querySelector('label').innerText.replace('*', '').trim();
                        // Find label for this option
                        val = el.parentElement.innerText.trim();
                        details.push(`<b>${label}:</b> ${val}`);
                    }
                } else if (el.type === 'checkbox') {
                    if (el.checked) {
                        val = el.parentElement.innerText.replace('*', '').trim();
                        details.push(`• ${val}`);
                    }
                } else if (el.tagName === 'SELECT') {
                    if (el.value) {
                        const wrapper = el.closest('.form-field-wrapper');
                        label = wrapper.querySelector('label').innerText.replace('*', '').trim();
                        // Get text of selected option, not the value
                        val = el.options[el.selectedIndex].text;
                        details.push(`<b>${label}:</b> ${val}`);
                    }
                } else {
                    if (el.value.trim()) {
                        const wrapper = el.closest('.form-field-wrapper');
                        label = wrapper.querySelector('label').innerText.replace('*', '').trim();
                        val = el.value.trim();
                        details.push(`<b>${label}:</b> ${val}`);
                    }
                }
            });

            noteContent += details.join('<br/>') + '<br/>';
            noteContent += `<br/><small style="color:#999;">Signature: ${signature}</small>`;

            await addNoteToTicket(noteContent);
        }

        // Success - close modal & refresh
        console.log("Note added successfully!");
        setTransferCompleted(); // Persist state

        const overlay = document.getElementById('transfer-modal-overlay');
        if (overlay) {
            overlay.remove();
        }
        isModalOpen = false;

        // Re-enable update button (though page will reload)
        enableUpdateBtn();

        // Restore dropdown state and do NOT refresh
        console.log("Restoring dropdown to Transfer...");
        await setDropdownToTransfer();

    } catch (err) {
        console.error("Submit failed:", err);
        statusMsg.textContent = "Error: " + err.message;
        statusMsg.style.color = "red";
        submitBtn.disabled = false;
        submitBtn.textContent = "Retry";
    }
}

async function addNoteToTicket(htmlContent) {
    console.log("Adding note to ticket...");

    // 1. Click the "Add note" button
    const addNoteBtn = document.querySelector('[data-test-note-action="add"]');
    if (!addNoteBtn) {
        throw new Error("Could not find 'Add note' button");
    }
    addNoteBtn.click();

    // 2. Wait for editor to appear
    await sleep(500);

    // 3. Find the editor
    const editor = document.querySelector('.redactor-editor, [contenteditable="true"]');
    if (!editor) {
        throw new Error("Could not find note editor");
    }

    // 4. Set content
    editor.innerHTML = htmlContent;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));

    // 5. Wait a moment for FD to process
    await sleep(300);

    // 6. Click submit button
    const submitBtn = document.querySelector('[data-test-id="submit"], #send-and-set');
    if (!submitBtn) {
        throw new Error("Could not find submit button");
    }

    // Enable if disabled
    submitBtn.disabled = false;
    submitBtn.click();

    console.log("Note submitted!");

    // Wait for it to be saved
    await sleep(1000);
}

// -----------------------------------------------------------------------------
// Status Change Modal
// -----------------------------------------------------------------------------

function showStatusChangeModal(fromStatus, toStatus) {
    if (document.getElementById('status-modal-overlay')) return;
    if (!statusFormData) {
        console.warn("Status form data not loaded. Allowing status change.");
        lastKnownStatus = toStatus;
        return;
    }

    isModalOpen = true;

    const overlay = document.createElement('div');
    overlay.id = 'status-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:2147483647;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';

    overlay.innerHTML = `
        <div id="status-modal-content" style="background:white;border-radius:12px;width:500px;max-width:95%;box-shadow:0 20px 60px rgba(0,0,0,0.2);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;overflow:hidden;">
            <div id="status-modal-header" style="padding:16px 20px;background:linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%);color:white;">
                <h3 style="margin:0;font-size:18px;font-weight:600;">${statusFormData.title}</h3>
            </div>
            <div id="status-modal-body" style="padding:20px;">
                <div style="background:#f3f4f6;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <span style="padding:6px 12px;background:#ef4444;color:white;border-radius:6px;font-size:13px;font-weight:500;">${fromStatus}</span>
                        <span style="color:#6b7280;">→</span>
                        <span style="padding:6px 12px;background:#22c55e;color:white;border-radius:6px;font-size:13px;font-weight:500;">${toStatus}</span>
                    </div>
                </div>
                <label style="font-weight:500;display:block;margin-bottom:8px;color:#374151;font-size:14px;">
                    Reason for Status Change <span style="color:#dc2626;">*</span>
                </label>
                <textarea id="status-reason-input" placeholder="Enter a brief reason for this status change..." 
                    style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;min-height:100px;resize:vertical;box-sizing:border-box;font-family:inherit;"></textarea>
            </div>
            <div id="status-modal-footer" style="padding:14px 20px;display:flex;justify-content:flex-end;gap:10px;background:#f8fafc;border-top:1px solid #e2e8f0;">
                <span id="status-modal-status" style="font-size:12px;color:#dc2626;margin-right:auto;display:flex;align-items:center;"></span>
                <button id="btn-cancel-status" style="padding:10px 20px;border-radius:6px;border:none;cursor:pointer;font-size:14px;font-weight:500;background:#e2e8f0;color:#475569;">Cancel</button>
                <button id="btn-submit-status" style="padding:10px 20px;border-radius:6px;border:none;cursor:pointer;font-size:14px;font-weight:500;background:linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%);color:white;box-shadow:0 2px 4px rgba(124,58,237,0.3);" disabled>Submit</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const reasonInput = document.getElementById('status-reason-input');
    const submitBtn = document.getElementById('btn-submit-status');
    const cancelBtn = document.getElementById('btn-cancel-status');

    // Enable submit when text is entered
    reasonInput.addEventListener('input', () => {
        const hasValue = reasonInput.value.trim().length > 0;
        submitBtn.disabled = !hasValue;
        submitBtn.style.opacity = hasValue ? '1' : '0.5';
    });

    // Cancel button - refresh page
    cancelBtn.addEventListener('click', () => {
        console.log("Status change cancelled - reloading page");
        location.reload();
    });

    // Submit button
    submitBtn.addEventListener('click', async () => {
        submitBtn.disabled = true;
        submitBtn.textContent = "Processing...";

        try {
            const reason = reasonInput.value.trim();
            const signature = generateSignature();

            const noteContent = `<b>Status Change</b><br/>
                <b>From:</b> ${fromStatus}<br/>
                <b>To:</b> ${toStatus}<br/>
                <b>Reason:</b> ${reason}<br/>
                <br/><small style="color:#999;">Signature: ${signature}</small>`;

            await addNoteToTicket(noteContent);

            console.log("Status change note added successfully!");

            lastKnownStatus = toStatus;

            // Remove modal
            overlay.style.display = 'none';
            overlay.remove();
            isModalOpen = false;

        } catch (err) {
            console.error("Status change submit failed:", err);
            document.getElementById('status-modal-status').textContent = "Error: " + err.message;
            submitBtn.disabled = false;
            submitBtn.textContent = "Retry";
        }
    });

    // Focus on textarea
    setTimeout(() => reasonInput.focus(), 100);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Start
init();
