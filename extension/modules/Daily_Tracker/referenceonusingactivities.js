// ============================================================================
// n8n CODE NODE: PSE Metrics Analysis (OPTIMIZED)
// ============================================================================
// Webhook Input: { "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }
// ============================================================================

const FRESHDESK_DOMAIN = 'razorpay-ind.freshdesk.com';
const FRESHDESK_API_KEY = 'rn7el0rUb4saSCDwNSyf';
const FRESHDESK_COOKIE = '_hp2_props.2826793817=%7B%22account_state%22%3A%22active%22%2C%22account_plan%22%3A%22Enterprise%2021%22%2C%22billing_cycle%22%3Anull%7D; _BEAMER_USER_ID_CkAnkUkX19260=3ad9fbb1-05e7-42f1-b0b7-42af9ae3324b; _BEAMER_FIRST_VISIT_CkAnkUkX19260=2025-11-01T09:27:14.617Z; zarget_user_id=2d890a40-7ff6-4faf-909c-048d61866917; 2d890a40-7ff6-4faf-909c-048d61866917=1; zarget_visitor_info=%7B%22BVUVZSX%22%3A1747822%7D; _ga_V3GE8E4VBD=GS2.2.s1765514852$o4$g0$t1765514852$j60$l0$h0; _ga_5S1FBQDGB1=GS2.1.s1765514853$o1$g1$t1765514870$j43$l0$h0; _BEAMER_DATE_CkAnkUkX19260=2025-12-31T04:06:08.000Z; _ga=GA1.2.32905952.1762072635; _ga_DD6NQ1ZNV7=GS2.1.s1769657117$o14$g0$t1769657120$j57$l0$h0; _gid=GA1.2.952339807.1770736320; _ga_DG3E5QV3Q6=GS2.2.s1770736327$o4$g0$t1770736327$j60$l0$h0; _x_w=2; return_to=/a/tickets/17011010; authorize=true; helpdesk_node_session=9e54541abaf847e11a011c015ec8ed30c2b82c8ca75f1fb77e69486805c2fe21348dc6489628b32e5be204238c111ffc46c6b7c550f8d0175238dc541413466c; user_credentials=BAhJIgGNZGE2YzgwZGU5OTQ2YjBiYTYwNjRmNGRlN2M2MTA5OTk2ODkzMjI4MWYxMTRkZDI4ZTRiMzU1OGY2YWZjZDI5NjAxYmY0M2RiZDY0YjJkZmQyNGM3OTBhODY0MzEyZTc0MWZhYmI4ODQ3ZDI0ODkyYTY5MGI4Yzc4ZjIwOWQwZjU6OjgyMjE0NjI4ODcwBjoGRVQ%3D--6a595bddab69f50605baa5d80c02204de5d1c834; fd=be720414-d6d2-4f78-9162-6b5eb6b4c4d4; helpdesk_url=razorpay-ind.freshdesk.com; session_state=NmE3NTQyZGJmMjcyOWE2YmZkMTAzNmU0NGFmMGQ1ODdlOTViZjI1YjViYmMzMDNmMDMxYzNiYTYyODFkNzdlNg%3D%3D.941539365840347154; session_token=0e5cd5e33fba92ddf5b593da2c448bbc972c9c30f1d801acc622c93d0b52596ad9a42628c5618650ac1281b055d8f2c0d0391bbb9111749d59a3e985132f6dacf9b155a75f3ef3923585b66e2292bbf2eb860014f7ca1bbe4e3a230739bcbb881269d5eb6a6777fd91d2546cbcb56602; service_worker=true; _BEAMER_FILTER_BY_URL_CkAnkUkX19260=false';

const PSE_GROUP_ID = 82000662332;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const AUTH_HEADER = 'Basic ' + Buffer.from(FRESHDESK_API_KEY + ':X').toString('base64');
const PAUSE_STATUS_KEYWORDS = ['waiting on customer', 'pending'];

const cookieHeaders = {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
    'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    'x-client-instance-id': '1770785378000',
    'x-requested-with': 'XMLHttpRequest',
    'Cookie': FRESHDESK_COOKIE,
};

// --- INPUT ---
const input = $input.first().json;
const startDate = input.body?.start_date || input.start_date;
const endDate = input.body?.end_date || input.end_date;
if (!startDate || !endDate) {
    return [{ json: { error: 'start_date and end_date required' } }];
}
console.log(`PSE Metrics: ${startDate} to ${endDate}`);

// --- HELPERS ---
function formatDateTimeIST(utcDate) {
    if (!utcDate) return '';
    const d = new Date(utcDate);
    if (isNaN(d.getTime())) return '';
    const ist = new Date(d.getTime() + IST_OFFSET_MS);
    return `${String(ist.getUTCDate()).padStart(2, '0')}/${String(ist.getUTCMonth() + 1).padStart(2, '0')}/${ist.getUTCFullYear()} ${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

function fmtDuration(ms) {
    if (!ms || ms < 0) return 'N/A';
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

// ============================================================================
// STEP 1: Fetch Agent Map (quick, single call)
// ============================================================================
let agentMap = {};
try {
    const agentRes = await this.helpers.httpRequest({
        method: 'GET',
        url: `https://${FRESHDESK_DOMAIN}/api/_/bootstrap/agents_groups`,
        headers: cookieHeaders,
        json: true,
    });
    const agents = agentRes.data?.agents || agentRes.agents || [];
    for (const a of agents) agentMap[a.id] = a.contact?.name || a.name || String(a.id);
    console.log(`Agents loaded: ${Object.keys(agentMap).length}`);
} catch (e) {
    console.log(`Agent fetch warning: ${e.message}`);
}

// ============================================================================
// STEP 2: Search tickets — day-by-day (proven working), 3 days in parallel
// ============================================================================
const dates = [];
const dtStart = new Date(startDate + 'T00:00:00Z');
const dtEnd = new Date(endDate + 'T00:00:00Z');
for (let d = new Date(dtStart); d <= dtEnd; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
}
console.log(`Searching ${dates.length} days...`);

const seenIds = new Set();
let allTickets = [];

// Search 3 days in parallel for speed
const DAY_BATCH = 3;
for (let i = 0; i < dates.length; i += DAY_BATCH) {
    const dayBatch = dates.slice(i, i + DAY_BATCH);

    const dayResults = await Promise.all(dayBatch.map(async (dateStr) => {
        const tickets = [];
        let page = 1;
        while (page <= 10) {
            const query = `"group_id:${PSE_GROUP_ID} AND created_at:'${dateStr}' AND (status:4 OR status:5)"`;
            const url = `https://${FRESHDESK_DOMAIN}/api/v2/search/tickets?query=${encodeURIComponent(query)}&page=${page}`;
            try {
                const res = await this.helpers.httpRequest({
                    method: 'GET', url, headers: { 'Authorization': AUTH_HEADER, 'Content-Type': 'application/json' }, json: true,
                });
                const results = res.results || [];
                tickets.push(...results);
                if (results.length < 30) break;
                page++;
            } catch (e) {
                console.log(`Search ${dateStr} p${page}: ${e.message}`);
                break;
            }
        }
        return tickets;
    }));

    for (const dayTickets of dayResults) {
        for (const t of dayTickets) {
            if (!seenIds.has(t.id)) { seenIds.add(t.id); allTickets.push(t); }
        }
    }
}
console.log(`Found ${allTickets.length} tickets (before filter)`);

// Filter out Merged_ticket tagged tickets
const beforeFilter = allTickets.length;
allTickets = allTickets.filter(t => {
    const tags = t.tags || [];
    return !tags.some(tag => tag.toLowerCase() === 'merged_ticket');
});
console.log(`After Merged_ticket filter: ${allTickets.length} tickets (${beforeFilter - allTickets.length} skipped)`);

// ============================================================================
// STEP 3: Process tickets — 10 in parallel, fetch activities+convos together
// ============================================================================
const BATCH_SIZE = 10;
const results = [];

for (let i = 0; i < allTickets.length; i += BATCH_SIZE) {
    const batch = allTickets.slice(i, i + BATCH_SIZE);
    console.log(`Analyzing ${i + 1}-${Math.min(i + BATCH_SIZE, allTickets.length)} of ${allTickets.length}...`);

    const batchResults = await Promise.all(batch.map(async (ticket) => {
        const ticketId = ticket.id;

        // Fetch activities + conversations IN PARALLEL
        const [allActivities, conversations] = await Promise.all([
            // Activities (internal API, paginated)
            (async () => {
                let acts = [];
                let beforeId = null;
                for (let loop = 0; loop < 50; loop++) {
                    const qs = beforeId ? { before_id: beforeId } : {};
                    try {
                        const r = await this.helpers.httpRequest({
                            method: 'GET',
                            url: `https://${FRESHDESK_DOMAIN}/api/_/tickets/${ticketId}/activities`,
                            headers: { ...cookieHeaders, 'referer': `https://${FRESHDESK_DOMAIN}/a/tickets/${ticketId}` },
                            qs, json: true,
                        });
                        const batch = r.activities || [];
                        if (batch.length === 0) break;
                        acts.push(...batch);
                        beforeId = batch[batch.length - 1].id;
                    } catch { break; }
                }
                return acts;
            })(),
            // Conversations (v2 API)
            (async () => {
                try {
                    const r = await this.helpers.httpRequest({
                        method: 'GET',
                        url: `https://${FRESHDESK_DOMAIN}/api/v2/tickets/${ticketId}/conversations?per_page=100`,
                        headers: { 'Authorization': AUTH_HEADER, 'Content-Type': 'application/json' },
                        json: true,
                    });
                    return Array.isArray(r) ? r : [];
                } catch { return []; }
            })(),
        ]);

        // --- ANALYZE ---
        const sorted = [...allActivities].sort((a, b) => new Date(a.performed_at) - new Date(b.performed_at));
        const groupSegments = [];
        let curGroup = 'Unknown', curGroupStart = new Date(ticket.created_at);
        const statusChanges = [];
        const agentAssignments = []; // Track all agent assignment changes

        for (const act of sorted) {
            const time = new Date(act.performed_at);
            const performerId = act.performer?.user_id || act.performer?.system?.id || null;
            for (const action of (act.actions || [])) {
                if (action.type === 'property_update' && action.content) {
                    if (action.content.group_name) {
                        groupSegments.push({ group: curGroup, start: curGroupStart, end: time });
                        curGroup = action.content.group_name;
                        curGroupStart = time;
                    }
                    if (action.content.status_label || action.content.status) {
                        statusChanges.push({ label: action.content.status_label || '', id: action.content.status, time, performerId });
                    }
                    // Track agent/responder assignment changes from property_update
                    if (action.content.agent_name || action.content.responder_id) {
                        agentAssignments.push({
                            name: action.content.agent_name || null,
                            id: action.content.responder_id || null,
                            time: time,
                        });
                    }
                }
                // Track agent assignments from round_robin (automatic ticket assignment)
                if (action.type === 'round_robin' && action.content && action.content.responder_id) {
                    agentAssignments.push({
                        name: null,
                        id: action.content.responder_id,
                        time: time,
                    });
                }
            }
        }
        groupSegments.push({ group: curGroup, start: curGroupStart, end: new Date() });

        const wasInPSE = groupSegments.some(s => (s.group || '').toLowerCase().includes('pse'));
        if (!wasInPSE) return null;

        // METRIC 1: IPT
        let iptCount = 0;
        for (const c of conversations) {
            if (c.incoming) {
                const cTime = new Date(c.created_at);
                if (groupSegments.some(s => (s.group || '').toLowerCase().includes('pse') && cTime >= s.start && cTime <= s.end)) iptCount++;
            }
        }

        // METRIC 2a: DevRev Creation Time — GROUP LEVEL (from PSE group push)
        // Take FIRST PSE group entry (not last — consecutive PSE entries are duplicates)
        let latestPushTime = null;
        for (const s of groupSegments) {
            if ((s.group || '').toLowerCase().includes('pse')) {
                latestPushTime = s.start;
                break; // first PSE entry
            }
        }
        let devrevGroupMs = 0, devrevGroupFound = false;
        if (latestPushTime) {
            let clockStart = latestPushTime, clockRunning = true;
            for (const change of statusChanges.filter(s => s.time >= latestPushTime)) {
                const label = (change.label || '').toLowerCase();
                if (clockRunning) devrevGroupMs += (change.time - clockStart);
                clockStart = change.time;
                if (label.includes('pending on pse') || label.includes('raised to devrev')) { devrevGroupFound = true; break; }
                clockRunning = !(PAUSE_STATUS_KEYWORDS.some(k => label.includes(k)) && !label.includes('pending on pse'));
            }
        }

        // Find who raised DevRev (first "Pending on PSE" status change) and when
        const agentName = ticket.responder_id ? (agentMap[ticket.responder_id] || String(ticket.responder_id)) : 'Unassigned';
        let devrevRaiserId = null;
        let devrevRaiserName = 'N/A';
        let devrevRaisedAt = null;
        for (const sc of statusChanges) {
            const label = (sc.label || '').toLowerCase();
            if (label.includes('pending on pse') || label.includes('raised to devrev')) {
                devrevRaiserId = sc.performerId;
                devrevRaiserName = devrevRaiserId ? (agentMap[devrevRaiserId] || String(devrevRaiserId)) : 'N/A';
                devrevRaisedAt = sc.time;
                break;
            }
        }

        // Find latest PSE Resolved time
        let pseResolvedAt = null;
        for (let j = statusChanges.length - 1; j >= 0; j--) {
            const label = (statusChanges[j].label || '').toLowerCase();
            if (label.includes('pse resolved')) {
                pseResolvedAt = statusChanges[j].time;
                break;
            }
        }

        // METRIC 2b: DevRev — AGENT LEVEL (from DevRev raiser's assignment time)
        let devrevRaiserAssignTime = null;
        if (devrevRaiserId && agentAssignments.length > 0) {
            for (let k = agentAssignments.length - 1; k >= 0; k--) {
                const aa = agentAssignments[k];
                if ((aa.id && String(aa.id) === String(devrevRaiserId)) ||
                    (aa.name && aa.name === devrevRaiserName)) {
                    devrevRaiserAssignTime = aa.time;
                    break;
                }
            }
        }
        if (!devrevRaiserAssignTime && devrevRaiserId) {
            devrevRaiserAssignTime = new Date(ticket.created_at);
        }
        if (devrevRaiserAssignTime && latestPushTime && devrevRaiserAssignTime < latestPushTime) {
            devrevRaiserAssignTime = latestPushTime;
        }

        let devrevAgentMs = 0, devrevAgentFound = false;
        if (devrevRaiserAssignTime) {
            let clockStart = devrevRaiserAssignTime, clockRunning = true;
            for (const change of statusChanges.filter(s => s.time >= devrevRaiserAssignTime)) {
                const label = (change.label || '').toLowerCase();
                if (clockRunning) devrevAgentMs += (change.time - clockStart);
                clockStart = change.time;
                if (label.includes('pending on pse') || label.includes('raised to devrev')) { devrevAgentFound = true; break; }
                clockRunning = !(PAUSE_STATUS_KEYWORDS.some(k => label.includes(k)) && !label.includes('pending on pse'));
            }
        }

        // Assigned on for current agent (for display)
        let latestAgentAssignTime = null;
        if (ticket.responder_id && agentAssignments.length > 0) {
            for (let k = agentAssignments.length - 1; k >= 0; k--) {
                const aa = agentAssignments[k];
                if ((aa.id && String(aa.id) === String(ticket.responder_id)) ||
                    (aa.name && aa.name === agentName)) {
                    latestAgentAssignTime = aa.time;
                    break;
                }
            }
        }
        if (!latestAgentAssignTime && ticket.responder_id) {
            latestAgentAssignTime = new Date(ticket.created_at);
        }
        if (latestAgentAssignTime && latestPushTime && latestAgentAssignTime < latestPushTime) {
            latestAgentAssignTime = latestPushTime;
        }

        // METRIC 3: Action Time — only after valid Pending on PSE → PSE Resolved
        let maxActionTimeMs = 0;
        for (let j = 0; j < statusChanges.length; j++) {
            const label = (statusChanges[j].label || '').toLowerCase();
            if (label.includes('pse resolved') && statusChanges[j + 1]) {
                // Check prior "Pending on PSE" exists before this PSE Resolved
                let hasPriorPending = false;
                for (let k = j - 1; k >= 0; k--) {
                    const pl = (statusChanges[k].label || '').toLowerCase();
                    if (pl.includes('pending on pse')) { hasPriorPending = true; break; }
                    if (pl.includes('pse resolved')) break;
                }
                if (hasPriorPending) {
                    const diff = statusChanges[j + 1].time - statusChanges[j].time;
                    if (diff > maxActionTimeMs) maxActionTimeMs = diff;
                }
            }
        }

        // Find "Resolved" status time (not PSE Resolved — only actual Resolved)
        let resolvedTime = null;
        for (let j = statusChanges.length - 1; j >= 0; j--) {
            const label = (statusChanges[j].label || '').toLowerCase();
            if (label === 'resolved' || label === 'closed') {
                resolvedTime = statusChanges[j].time;
                break;
            }
        }
        const endTime = resolvedTime || new Date(); // fallback to now if not yet resolved

        // Age: Group level = pushed → resolved, Agent level = raiser assigned → resolved
        const ageGroupDays = latestPushTime ? Math.max(0, Math.floor((endTime - latestPushTime) / 86400000)) : 0;
        const ageAgentDays = devrevRaiserAssignTime ? Math.max(0, Math.floor((endTime - devrevRaiserAssignTime) / 86400000)) : 0;

        // Assigned On display
        let assignedOn = 'N/A';
        if (latestAgentAssignTime) {
            assignedOn = formatDateTimeIST(latestAgentAssignTime.toISOString());
        }

        return {
            ticket_id: ticket.id,
            created_at: formatDateTimeIST(ticket.created_at),
            agent: agentName,
            devrev_raised_by: devrevRaiserName,
            devrev_raised_at: devrevRaisedAt ? formatDateTimeIST(devrevRaisedAt.toISOString()) : 'N/A',
            pse_resolved_at: pseResolvedAt ? formatDateTimeIST(pseResolvedAt.toISOString()) : 'N/A',
            resolved_at: resolvedTime ? formatDateTimeIST(resolvedTime.toISOString()) : 'N/A',
            assigned_on: assignedOn,
            devrev_raiser_assigned_on: devrevRaiserAssignTime ? formatDateTimeIST(devrevRaiserAssignTime.toISOString()) : 'N/A',
            pushed_on: latestPushTime ? formatDateTimeIST(latestPushTime.toISOString()) : 'N/A',
            age_group_days: ageGroupDays,
            age_agent_days: ageAgentDays,
            ipt: iptCount,
            ipt_breach: iptCount > 3 ? 'BREACHED' : 'OK',
            devrev_group_time: devrevGroupFound ? fmtDuration(devrevGroupMs) : 'N/A',
            devrev_group_ms: devrevGroupMs,
            devrev_group_breach: devrevGroupFound && devrevGroupMs > 7200000 ? 'BREACHED' : 'OK',
            devrev_agent_time: devrevAgentFound ? fmtDuration(devrevAgentMs) : 'N/A',
            devrev_agent_ms: devrevAgentMs,
            devrev_agent_breach: devrevAgentFound && devrevAgentMs > 7200000 ? 'BREACHED' : 'OK',
            action_time: maxActionTimeMs > 0 ? fmtDuration(maxActionTimeMs) : '0h 0m',
            action_time_ms: maxActionTimeMs,
            action_breach: maxActionTimeMs > 7200000 ? 'BREACHED' : 'OK',
        };
    }));

    for (const r of batchResults) { if (r) results.push(r); }
}

console.log(`DONE: ${results.length} PSE tickets analyzed`);
return [{ json: { tickets: results, total: results.length, date_range: { start: startDate, end: endDate } } }];
