{
    // --- Global State ---
    let pageMode = 'unknown'; // 'list', 'details', or 'unknown'
    let listPageTimers = {}; // Stores { ticketId: intervalId } for the list page
    let listProcessedTickets = new Set(); // Tracks processed tickets on the list page
    let detailsPageTimerInterval = null; // Stores the interval for the single timer on the details page
    let detailsPageTicketId = null; // Tracks the ID of the ticket being viewed
    let detailsPageTimerElement = null; // Caches the timer element on the details page
    let lastUrl = window.location.href; // Tracks navigation
    let scanTimeout; // For debouncing


    // --- Page Detection & Main Logic ---

    function detectPageMode() {
        const newUrl = window.location.href;

        if (newUrl !== lastUrl) {
            console.log("URL changed, clearing all timers and resetting page mode.");
            lastUrl = newUrl;
            clearAllTimersAndElements();
            pageMode = 'unknown';
        }

        if (!newUrl.includes('/a/tickets')) {
            return;
        }

        // Check for Details Page (Reverted to user's "working" selector)
        const breadcrumb = document.querySelector('div[data-test-id="breadcrumb-item"]');

        if (breadcrumb) {
            // --- DETAILS page ---
            const newTicketId = breadcrumb.textContent.trim();

            if (pageMode !== 'details' || detailsPageTicketId !== newTicketId) {
                console.log(`Page Mode: Switched to DETAILS for Ticket ID: ${newTicketId}`);
                clearAllTimersAndElements();
                pageMode = 'details';
                detailsPageTicketId = newTicketId;
                runDetailsPageLogic(detailsPageTicketId);
            } else {
                if (!detailsPageTimerElement || !document.body.contains(detailsPageTimerElement)) {
                    console.log("Details page: DOM update, re-running logic.");
                    runDetailsPageLogic(detailsPageTicketId);
                }
            }
        } else {
            // --- LIST page ---
            if (pageMode !== 'list') {
                console.log("Page Mode: Switched to LIST.");
                clearAllTimersAndElements();
                pageMode = 'list';
            }
            runListPageLogic();
        }
    }

    function debounceRunTimerLogic(delay = 750) {
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(detectPageMode, delay);
    }


    // --- Details Page Logic (Reverted to user's provided version) ---

    function runDetailsPageLogic(ticketId) {
        if (!ticketId) return;
        if (detailsPageTimerElement && document.body.contains(detailsPageTimerElement)) return;
        console.log(`Details page: Processing ticket ${ticketId}`);

        chrome.runtime.sendMessage({ action: 'getSheetData' }, (response) => {
            if (chrome.runtime.lastError || !response || response.error) {
                console.error("Details page error:", chrome.runtime.lastError?.message || response?.error);
                return; // Per user request, do not inject on error
            }
            const ticketData = response[ticketId];
            if (!ticketData) {
                console.log(`Ticket ${ticketId} not found in sheet. Not injecting timer.`);
                return;
            }
            injectDetailsPageTimer(ticketId, ticketData);
        });
    }

    function injectDetailsPageTimer(ticketId, ticketData) {
        if (document.getElementById('p1-timer-details-page')) return;
        const { createdAt, promiseOne, openToWocTime, wocReopenTime } = ticketData;
        if (!createdAt) {
            console.warn(`Ticket ${ticketId}: No Created Date found.`);
            return;
        }

        const insertionPoint = document.querySelector('div[data-test-id="tkt-properties-cf_end_state_action"]');
        if (!insertionPoint || !insertionPoint.parentElement) {
            console.warn(`Details page: Could not find "End State Action" insertion point.`);
            return;
        }

        detailsPageTimerElement = document.createElement('div');
        detailsPageTimerElement.id = 'p1-timer-details-page';
        detailsPageTimerElement.classList.add('p1-timer-details-property');
        detailsPageTimerElement.innerHTML = `
        <span class="timer-label">SLA STATUS</span>
        <div class="timer-value">Loading...</div>
    `;

        // Reverted Logic: Insert as a sibling to the insertion point, inside its parent.
        insertionPoint.parentElement.insertBefore(detailsPageTimerElement, insertionPoint.nextSibling);
        console.log(`Details page: Injected timer element for ticket ${ticketId}`);

        function runUpdate() {
            if (!detailsPageTimerElement || !document.body.contains(detailsPageTimerElement)) {
                clearDetailsPageTimer();
                return;
            }
            try {
                const p1Status = calculateP1Status(createdAt, promiseOne, openToWocTime, wocReopenTime);
                updateDetailsTimerDisplay(detailsPageTimerElement, p1Status);
                // Only clear if BREACHED, PAUSED, or ERROR. Keep running for Given (Countdown) and P2 (Countdown).
                if (p1Status.isBreached || p1Status.isPaused || p1Status.error) {
                    clearDetailsPageTimer();
                }
            } catch (e) {
                console.error(`Error calculating P1 for ticket ${ticketId}:`, e);
                updateDetailsTimerDisplay(detailsPageTimerElement, { error: 'Calc Error' });
                clearDetailsPageTimer();
            }
        }

        runUpdate();
        const initialState = calculateP1Status(createdAt, promiseOne, openToWocTime, wocReopenTime);
        // Start interval if not already closed (not breached/paused/error) - removed isGiven check
        if (!initialState.isBreached && !initialState.isPaused && !initialState.error && initialState.diffMillis !== null) {
            if (!detailsPageTimerInterval) {
                detailsPageTimerInterval = setInterval(runUpdate, 1000);
            }
        } else {
            clearDetailsPageTimer();
        }
    }


    function updateDetailsTimerDisplay(timerElement, p1Status) {
        const valueElement = timerElement.querySelector('.timer-value');
        if (!valueElement) return;
        timerElement.classList.remove('p1-timer-loading', 'p1-timer-due', 'p1-timer-breached', 'p1-timer-given', 'p1-timer-paused', 'p1-timer-error', 'p1-timer-p2-due');
        timerElement.title = '';

        if (p1Status.error) {
            timerElement.classList.add('p1-timer-error');
            switch (p1Status.error) {
                case 'No Created Date': valueElement.textContent = 'No Date in Sheet'; timerElement.title = '"Created At (IST)" is empty.'; break;
                case 'Invalid Create Date': valueElement.textContent = 'Date Parse Error'; timerElement.title = 'Could not parse the "Created At (IST)" date.'; break;
                case 'Calc Error': valueElement.textContent = 'Calculation Error'; timerElement.title = 'Check console for details.'; break;
                default: valueElement.textContent = `Error: ${p1Status.error}`;
            }
        } else if (p1Status.isGiven) {
            timerElement.classList.add('p1-timer-given');
            const { hours, minutes, seconds } = formatTimeDiff(p1Status.diffMillis);
            valueElement.textContent = `P1 Promise: ${hours}h ${minutes}m ${seconds}s`;
            timerElement.title = `P1 promised at: ${p1Status.promiseTime || 'N/A'}`;
        } else if (p1Status.isP2) {
            if (p1Status.isBreached) {
                timerElement.classList.add('p1-timer-breached');
                valueElement.textContent = 'P2 Breached';
            } else if (p1Status.isPaused) {
                timerElement.classList.add('p1-timer-paused');
                const { days, hours, minutes } = formatMsToTimeUnits(p1Status.diffMillis);
                let remainingText = '';
                if (days > 0) remainingText += `${days}d `;
                remainingText += `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m left`;
                valueElement.textContent = `P2 Paused (${remainingText})`;
            } else {
                timerElement.classList.add('p1-timer-p2-due');
                const { hours, minutes, seconds } = formatTimeDiff(p1Status.diffMillis);
                valueElement.textContent = `P2 Due: ${hours}h ${minutes}m ${seconds}s`;
            }
            timerElement.title = `P2 countdown from P1 Promise: ${p1Status.promiseTime || 'N/A'}`;
        } else if (p1Status.isPaused) {
            timerElement.classList.add('p1-timer-paused');
            const { days, hours, minutes } = formatMsToTimeUnits(p1Status.diffMillis);
            let remainingText = '';
            if (days > 0) remainingText += `${days}d `;
            remainingText += `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m left`;
            valueElement.textContent = `P1 Paused (${remainingText})`;
            timerElement.title = `Paused at: ${p1Status.pausedAt || 'N/A'}. Waiting for reopen.`;
        } else if (p1Status.isBreached) {
            timerElement.classList.add('p1-timer-breached');
            valueElement.textContent = 'Give P1 Breached';
            timerElement.title = `Breached at: ${p1Status.breachTime?.toLocaleString() || 'N/A'}`;
        } else if (p1Status.diffMillis !== null) {
            timerElement.classList.add('p1-timer-due');
            const { hours, minutes, seconds } = formatTimeDiff(p1Status.diffMillis);
            valueElement.textContent = `P1 Due: ${hours}h ${minutes}m ${seconds}s`;
            timerElement.title = `Breaches at: ${p1Status.breachTime?.toLocaleString() || 'N/A'}`;
        } else {
            timerElement.classList.add('p1-timer-error');
            valueElement.textContent = 'Unknown State';
        }
    }


    // --- List Page Logic (MODIFIED) ---

    function runListPageLogic() {
        // Check for card view
        const cardTickets = document.querySelectorAll('div.tickets__list');
        if (cardTickets.length > 0) {
            console.log("Running List Page Logic for CARD view");
            listProcessedTickets.clear(); // Clear processed list for this view
            chrome.runtime.sendMessage({ action: 'getSheetData' }, (response) => {
                if (handleBackgroundError(response, cardTickets)) return;
                cardTickets.forEach(card => processListPageCard(card, response));
                cleanupRemovedListTickets(cardTickets, getTicketIdFromCard); // Pass the card ID getter
            });
            return; // Exit
        }

        // Check for table view
        const tableRows = document.querySelectorAll('tr[data-test-id^="ticket-row-"]');
        if (tableRows.length > 0) {
            console.log("Running List Page Logic for TABLE view");
            listProcessedTickets.clear(); // Clear processed list for this view
            chrome.runtime.sendMessage({ action: 'getSheetData' }, (response) => {
                if (chrome.runtime.lastError || !response || response.error) {
                    console.error("List page (table) error:", chrome.runtime.lastError?.message || response?.error);
                    // We could inject an error into the rows, but let's just return for now.
                    return;
                }
                tableRows.forEach(row => processTableViewRow(row, response));
                cleanupRemovedListTickets(tableRows, getTicketIdFromTableRow); // Pass the new table row ID getter
            });
            return; // Exit
        }
    }


    function handleBackgroundError(response, ticketCards) {
        let errorMsg = null;
        if (chrome.runtime.lastError) {
            errorMsg = 'BG Comms Error';
            console.error("List page error:", chrome.runtime.lastError.message);
        } else if (!response) {
            errorMsg = 'Invalid BG Response';
            console.error("List page error: Invalid BG Response");
        } else if (response.error) {
            console.error("List page error from BG:", response.error);
            if (response.error === 'CONFIG_ERROR') errorMsg = 'Config Error: Set URL in background.js';
            else if (response.error === 'Sheet Columns Missing') errorMsg = 'Sheet Error: Check Columns';
            else errorMsg = `Script Error`; // Generic error for any other script issue
        }

        if (errorMsg) {
            // This function is for card view, so it's fine.
            ticketCards.forEach(card => {
                const tempId = getTicketIdFromCard(card) || `unknown-${Math.random().toString(36).substring(2, 8)}`;
                const timerEl = createListTimerElement(tempId);
                if (timerEl) updateListTimerDisplay(timerEl, { error: errorMsg });
            });
            return true; // Error handled
        }
        return false; // No error
    }

    // --- Card View Functions (Original) ---

    function getTicketIdFromCard(cardElement) {
        const idSpan = cardElement.querySelector('span[data-test-ticket-id]');
        if (idSpan && idSpan.textContent.trim()) {
            const idMatch = idSpan.textContent.trim().match(/^#?(\d+)$/);
            if (idMatch && idMatch[1]) return idMatch[1];
        }
        const contentDiv = cardElement.querySelector('div[data-test-ticket-content]');
        if (contentDiv) {
            const contentMatch = contentDiv.getAttribute('data-test-ticket-content');
            if (contentMatch && /^\d+$/.test(contentMatch)) return contentMatch;
        }
        const checkbox = cardElement.querySelector('input[data-test-checkbox^="ticket-"]');
        if (checkbox) {
            const dataAttrMatch = checkbox.getAttribute('data-test-checkbox')?.match(/ticket-(\d+)/);
            if (dataAttrMatch && dataAttrMatch[1]) return dataAttrMatch[1];
        }
        return null;
    }

    function processListPageCard(cardElement, sheetData) {
        const ticketId = getTicketIdFromCard(cardElement);
        if (!ticketId || listProcessedTickets.has(ticketId)) return;
        listProcessedTickets.add(ticketId);
        const timerElement = createListTimerElement(ticketId);
        if (!timerElement) { listProcessedTickets.delete(ticketId); return; }

        const ticketData = sheetData[ticketId];
        if (!ticketData) {
            updateListTimerDisplay(timerElement, { error: null }); // Hide for "Not in Sheet"
            timerElement.style.display = 'none';
            clearListTimerInterval(ticketId);
            return;
        }
        timerElement.style.display = 'inline-block';

        const { createdAt, promiseOne, openToWocTime, wocReopenTime } = ticketData;
        if (!createdAt) {
            updateListTimerDisplay(timerElement, { error: 'No Created Date' });
            clearListTimerInterval(ticketId);
            return;
        }

        function runUpdate() {
            const currentTimerElement = document.getElementById(`p1-timer-${ticketId}`);
            if (!currentTimerElement) { clearListTimerInterval(ticketId); return; }
            try {
                const p1Status = calculateP1Status(createdAt, promiseOne, openToWocTime, wocReopenTime);
                updateListTimerDisplay(currentTimerElement, p1Status);
                // Keep interval for isGiven and isP2 countdowns
                if (p1Status.isBreached || p1Status.isPaused || p1Status.error) {
                    clearListTimerInterval(ticketId);
                }
            } catch (e) {
                console.error(`Error calculating P1 for ticket ${ticketId}:`, e);
                updateListTimerDisplay(currentTimerElement, { error: 'Calc Error' });
                clearListTimerInterval(ticketId);
            }
        }
        runUpdate();
        const initialState = calculateP1Status(createdAt, promiseOne, openToWocTime, wocReopenTime);
        // Start interval if not already closed (not breached/paused/error)
        if (!initialState.isBreached && !initialState.isPaused && !initialState.error && initialState.diffMillis !== null) {
            if (!listPageTimers[ticketId]) {
                listPageTimers[ticketId] = setInterval(runUpdate, 1000);
            }
        } else {
            clearListTimerInterval(ticketId);
        }
    }

    function createListTimerElement(ticketId) {
        let timerContainer = document.getElementById(`p1-timer-${ticketId}`);
        if (!timerContainer) {
            timerContainer = document.createElement('div');
            timerContainer.id = `p1-timer-${ticketId}`;
            timerContainer.classList.add('p1-timer-container', 'p1-timer-loading');
            timerContainer.textContent = 'Loading P1...';

            const cardElement = document.querySelector(`span[data-test-ticket-id="#${ticketId}"]`)?.closest('div.tickets__list') || document.querySelector(`div[data-test-ticket-content="${ticketId}"]`)?.closest('div.tickets__list') || document.querySelector(`input[data-test-checkbox="ticket-${ticketId}"]`)?.closest('div.tickets__list');
            if (!cardElement) return null;
            const statusContainer = cardElement.querySelector('div.list-filter__status');
            if (statusContainer && statusContainer.parentElement) {
                statusContainer.parentElement.insertBefore(timerContainer, statusContainer.nextSibling);
            } else {
                const filterWrapArea = cardElement.querySelector('.list-filter-wrap');
                if (filterWrapArea) filterWrapArea.appendChild(timerContainer);
                else {
                    const infoArea = cardElement.querySelector('.list-content--info');
                    if (infoArea) infoArea.appendChild(timerContainer);
                    else return null;
                }
            }
        }
        return timerContainer;
    }


    // --- NEW: Table View Functions (Modified) ---

    /**
     * Gets the ticket ID from a table row element.
     */
    function getTicketIdFromTableRow(rowElement) {
        const testId = rowElement.getAttribute('data-test-id');
        if (testId) {
            const idMatch = testId.match(/ticket-row-(\d+)/);
            if (idMatch && idMatch[1]) {
                return idMatch[1];
            }
        }
        // Fallback: Check for the span in the subject link
        const idSpan = rowElement.querySelector('span[data-test-ticket-id]');
        if (idSpan && idSpan.textContent.trim()) {
            const idMatch = idSpan.textContent.trim().match(/^#?(\d+)$/);
            if (idMatch && idMatch[1]) return idMatch[1];
        }
        return null;
    }

    /**
     * Creates and injects the timer element into a table row.
     * (MODIFIED to inject into State column)
     */
    function createListTimerElementForTable(ticketId, rowElement) {
        let timerContainer = document.getElementById(`p1-timer-${ticketId}`);
        if (!timerContainer) {
            timerContainer = document.createElement('div');
            timerContainer.id = `p1-timer-${ticketId}`;
            timerContainer.classList.add('p1-timer-container', 'p1-timer-loading'); // Use existing CSS class
            timerContainer.textContent = 'Loading P1...';

            // Find the "State" cell
            const stateCell = rowElement.querySelector('td.lt-cell-ticket-states');

            if (stateCell) {
                // Find the wrapper for the tags ("New", "Overdue", etc.)
                const tagWrap = stateCell.querySelector('div.status-tag-wrap');
                if (tagWrap) {
                    // Append the timer inside the tag wrapper, so it appears after the tags
                    tagWrap.appendChild(timerContainer);
                } else {
                    // As a fallback, if no tag wrapper exists, just append to the cell
                    stateCell.appendChild(timerContainer);
                }
            } else {
                console.warn(`Could not find "State" cell for ticket ${ticketId} in table view.`);
                return null;
            }
        }
        return timerContainer;
    }


    /**
     * Processes a single table row to add the timer.
     */
    function processTableViewRow(rowElement, sheetData) {
        const ticketId = getTicketIdFromTableRow(rowElement);
        if (!ticketId || listProcessedTickets.has(ticketId)) return;
        listProcessedTickets.add(ticketId);

        const timerElement = createListTimerElementForTable(ticketId, rowElement);
        if (!timerElement) {
            listProcessedTickets.delete(ticketId);
            return;
        }

        const ticketData = sheetData[ticketId];
        if (!ticketData) {
            updateListTimerDisplay(timerElement, { error: null }); // Hide for "Not in Sheet"
            timerElement.style.display = 'none';
            clearListTimerInterval(ticketId);
            return;
        }
        timerElement.style.display = 'inline-block'; // Make it visible

        const { createdAt, promiseOne, openToWocTime, wocReopenTime } = ticketData;
        if (!createdAt) {
            updateListTimerDisplay(timerElement, { error: 'No Created Date' });
            clearListTimerInterval(ticketId);
            return;
        }

        function runUpdate() {
            const currentTimerElement = document.getElementById(`p1-timer-${ticketId}`);
            if (!currentTimerElement) { clearListTimerInterval(ticketId); return; }
            try {
                const p1Status = calculateP1Status(createdAt, promiseOne, openToWocTime, wocReopenTime);
                updateListTimerDisplay(currentTimerElement, p1Status);
                if (p1Status.isBreached || p1Status.isPaused || p1Status.error) {
                    clearListTimerInterval(ticketId);
                }
            } catch (e) {
                console.error(`Error calculating P1 for ticket ${ticketId}:`, e);
                updateListTimerDisplay(currentTimerElement, { error: 'Calc Error' });
                clearListTimerInterval(ticketId);
            }
        }
        runUpdate();
        const initialState = calculateP1Status(createdAt, promiseOne, openToWocTime, wocReopenTime);
        if (!initialState.isBreached && !initialState.isPaused && !initialState.error && initialState.diffMillis !== null) {
            if (!listPageTimers[ticketId]) {
                listPageTimers[ticketId] = setInterval(runUpdate, 1000);
            }
        } else {
            clearListTimerInterval(ticketId);
        }
    }


    // --- Common Functions (Original and Modified) ---

    /**
     * Updates the display of a list timer (used by both card and table views).
     */
    function updateListTimerDisplay(timerElement, p1Status) {
        timerElement.classList.remove('p1-timer-loading', 'p1-timer-due', 'p1-timer-breached', 'p1-timer-given', 'p1-timer-paused', 'p1-timer-error', 'p1-timer-p2-due');
        timerElement.title = '';

        if (p1Status.error === null) { // Hide for "Not in Sheet"
            timerElement.style.display = 'none'; return;
        }
        timerElement.style.display = 'inline-block';

        if (p1Status.error) {
            timerElement.classList.add('p1-timer-error');
            switch (p1Status.error) {
                case 'CONFIG_ERROR': timerElement.textContent = 'Config Error'; timerElement.title = 'Set Web App URL in background.js'; break;
                case 'Sheet Error': timerElement.textContent = 'Sheet Error'; timerElement.title = 'Check sheet columns.'; break;
                case 'No Created Date': timerElement.textContent = 'No Date'; timerElement.title = '"Created At (IST)" is empty.'; break;
                case 'Invalid Create Date': timerElement.textContent = 'Date Error'; timerElement.title = 'Could not parse "Created At (IST)".'; break;
                case 'Calc Error': timerElement.textContent = 'Calc Error'; timerElement.title = 'Check console.'; break;
                default: timerElement.textContent = 'Error'; timerElement.title = p1Status.error;
            }
        } else if (p1Status.isGiven) {
            timerElement.classList.add('p1-timer-given');
            const { hours, minutes, seconds } = formatTimeDiff(p1Status.diffMillis);
            timerElement.textContent = `P1 Promise: ${hours}h ${minutes}m ${seconds}s`;
            timerElement.title = `P1 promised at: ${p1Status.promiseTime || 'N/A'}`;
        } else if (p1Status.isP2) {
            if (p1Status.isBreached) {
                timerElement.classList.add('p1-timer-breached');
                timerElement.textContent = `P2 Breached`;
            } else if (p1Status.isPaused) {
                timerElement.classList.add('p1-timer-paused');
                const { days, hours, minutes } = formatMsToTimeUnits(p1Status.diffMillis);
                let remainingText = '';
                if (days > 0) remainingText += `${days}d `;
                remainingText += `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
                timerElement.textContent = `P2 Paused (${remainingText})`;
            } else {
                timerElement.classList.add('p1-timer-p2-due');
                const { hours, minutes, seconds } = formatTimeDiff(p1Status.diffMillis);
                timerElement.textContent = `P2: ${hours}h ${minutes}m ${seconds}s`;
            }
            timerElement.title = `P2 countdown from P1 Promise: ${p1Status.promiseTime || 'N/A'}`;
        } else if (p1Status.isPaused) {
            timerElement.classList.add('p1-timer-paused');
            const { days, hours, minutes } = formatMsToTimeUnits(p1Status.diffMillis);
            let remainingText = '';
            if (days > 0) remainingText += `${days}d `;
            remainingText += `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
            timerElement.textContent = `Paused (${remainingText})`;
            timerElement.title = `P1 Paused. Remaining: ${remainingText}. Paused at: ${p1Status.pausedAt || 'N/A'}.`;
        } else if (p1Status.isBreached) {
            timerElement.classList.add('p1-timer-breached');
            timerElement.textContent = `Give P1 Breached`;
            timerElement.title = `Breached at: ${p1Status.breachTime?.toLocaleString() || 'N/A'}`;
        } else if (p1Status.diffMillis !== null) {
            timerElement.classList.add('p1-timer-due');
            const { hours, minutes, seconds } = formatTimeDiff(p1Status.diffMillis);
            timerElement.textContent = `P1: ${hours}h ${minutes}m ${seconds}s`;
            timerElement.title = `Breaches at: ${p1Status.breachTime?.toLocaleString() || 'N/A'}`;
        } else {
            timerElement.classList.add('p1-timer-error');
            timerElement.textContent = 'Unknown State';
        }
    }


    // --- Cleanup Functions (Modified) ---

    function clearListTimerInterval(ticketId) {
        if (listPageTimers[ticketId]) {
            clearInterval(listPageTimers[ticketId]);
            delete listPageTimers[ticketId];
        }
    }

    function clearDetailsPageTimer() {
        if (detailsPageTimerInterval) {
            clearInterval(detailsPageTimerInterval);
            detailsPageTimerInterval = null;
        }
    }

    // Reverted to user's provided version
    function clearAllTimersAndElements() {
        console.log("Clearing all timers and removing elements...");
        // Clear list page timers
        Object.keys(listPageTimers).forEach(ticketId => { clearInterval(listPageTimers[ticketId]); });
        listPageTimers = {};
        listProcessedTickets.clear();
        document.querySelectorAll('.p1-timer-container').forEach(el => el.remove());

        // Clear details page timer
        clearDetailsPageTimer();
        if (detailsPageTimerElement) {
            detailsPageTimerElement.remove();
            detailsPageTimerElement = null;
        }
        detailsPageTicketId = null;

        console.log("All timers and elements cleared.");
    }

    /**
     * Cleans up timers for elements that are no longer on the page.
     * @param {NodeListOf<Element>} currentElements - The list of currently visible ticket elements (cards or rows).
     * @param {function(Element): string|null} idGetterFunction - The function to extract a ticket ID from an element.
     */
    function cleanupRemovedListTickets(currentElements, idGetterFunction) {
        const visibleTicketIds = new Set();
        currentElements.forEach(el => {
            const id = idGetterFunction(el);
            if (id) visibleTicketIds.add(id);
        });

        Object.keys(listPageTimers).forEach(ticketId => {
            if (!visibleTicketIds.has(ticketId)) {
                clearListTimerInterval(ticketId);
                const timerElement = document.getElementById(`p1-timer-${ticketId}`);
                if (timerElement) timerElement.remove();
            }
        });
    }


    // --- Initialization and Observation ---
    const observer = new MutationObserver((mutationsList, observer) => {
        debounceRunTimerLogic(750); // Just re-run detection on any significant change
    });

    function startObserver() {
        const targetNode = document.body;
        const config = { childList: true, subtree: true };
        observer.observe(targetNode, config);
        console.log("MutationObserver started on BODY.");
    }

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "forceRefresh" || request.action === "authSuccessful") { // Handle both
            console.log("Refresh message received, clearing and rescanning.");
            clearAllTimersAndElements();
            detectPageMode(); // Run detection immediately
        }
    });

    // Initial setup
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log("DOMContentLoaded.");
            startObserver();
            setTimeout(detectPageMode, 1000); // Initial scan
        });
    } else {
        console.log("DOM already loaded.");
        startObserver();
        setTimeout(detectPageMode, 1000); // Initial scan
    }

    console.log("Content script loaded (v10 - Proxy Mode, Dual Page, Table State Position, Details Revert).");
}
