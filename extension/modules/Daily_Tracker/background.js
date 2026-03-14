// Daily Tracker Background Script - Supabase Backend

console.log("[Daily Tracker Background] Loaded - Supabase Mode");

const SUPABASE_URL = 'https://ioupmkzhoqndbbkltevc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvdXBta3pob3FuZGJia2x0ZXZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNDY1NTcsImV4cCI6MjA4NDkyMjU1N30.wP-UPJ4i28xBLIoEnbexwSeLIehnfLmrnkpTm9br4DA';

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "DAILY_TRACKER_API") {
        handleApiRequest(request.payload)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep the message channel open for async response
    }
});

async function handleApiRequest(payload) {
    const { action, ...params } = payload;

    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    };

    if (action === "add_ticket") {
        const insertData = {
            ticket_id: params.ticket_id,
            status: params.status,
            agent: params.agent_name,
            email: params.agent_email,
            date: params.date,
            month: new Date().toLocaleString('default', { month: 'long' }),
            comment: params.comment || "",
            is_invalid: params.is_invalid || false,
            invalid_description: params.invalid_description || null,
            invalid_agent: params.invalid_agent || null,
            level: params.level || null
        };

        const response = await fetch(`${SUPABASE_URL}/rest/v1/daily_tracker`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(insertData)
        });

        if (!response.ok) throw new Error(await response.text());
        return await response.json();

    } else if (action === "get_stats") {
        // Fetch all tickets for the date to compute stats locally
        let url = `${SUPABASE_URL}/rest/v1/daily_tracker?date=eq.${encodeURIComponent(params.date)}`;
        if (params.level) url += `&level=eq.${encodeURIComponent(params.level)}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();

        let includeDocs = params.include_docs !== false;
        const stats = {
            my_count: 0,
            leaderboard: [],
            total_today: 0,
            summary: {},
            invalid_summary: []
        };
        const agentMap = {};
        const invalidAgentMap = {}; // Tracks who routed the invalid tickets

        for (const row of data) {
            const isTransfer = (row.status === "Transfer/Merge");
            const shouldCount = includeDocs || !isTransfer;

            if (shouldCount) {
                stats.total_today++;
                if (row.email === params.user_email) stats.my_count++;

                if (row.agent) {
                    agentMap[row.agent] = (agentMap[row.agent] || 0) + 1;
                    if (!stats.summary[row.agent]) stats.summary[row.agent] = {};
                    stats.summary[row.agent][row.status] = (stats.summary[row.agent][row.status] || 0) + 1;
                    // Keep for historical summary
                    if (row.is_invalid) {
                        stats.summary[row.agent]['Invalid'] = (stats.summary[row.agent]['Invalid'] || 0) + 1;
                    }
                }

                if (row.is_invalid && row.invalid_agent) {
                    invalidAgentMap[row.invalid_agent] = (invalidAgentMap[row.invalid_agent] || 0) + 1;
                }
            }
        }

        stats.leaderboard = Object.keys(agentMap).map(key => {
            return { name: key, count: agentMap[key] };
        }).sort((a, b) => b.count - a.count);

        stats.invalid_summary = Object.keys(invalidAgentMap).map(key => {
            return { name: key, count: invalidAgentMap[key] };
        }).sort((a, b) => b.count - a.count);

        return stats;

    } else if (action === "get_tickets") {
        let url = `${SUPABASE_URL}/rest/v1/daily_tracker?date=eq.${encodeURIComponent(params.date)}`;
        if (params.level) url += `&level=eq.${encodeURIComponent(params.level)}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();

        // Map to format content script expects
        const tickets = data.map(row => {
            let timeStr = "";
            try {
                // Ensure padding of hours/minutes
                const d = new Date(row.created_at);
                timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            } catch (e) { }
            return {
                id: row.id, // Supabase primary key
                ticket_id: row.ticket_id,
                status: row.status,
                agent: row.agent,
                email: row.email,
                time: timeStr,
                comment: row.comment || "",
                is_invalid: row.is_invalid,
                invalid_description: row.invalid_description,
                invalid_agent: row.invalid_agent,
                level: row.level,
                created_at: row.created_at
            };
        });

        // Sort descending (newest first)
        tickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        return { tickets: tickets };

    } else if (action === "update_ticket") {
        const updateData = {
            ticket_id: params.new_ticket_id,
            status: params.status,
            comment: params.comment || "",
            is_invalid: params.is_invalid || false,
            invalid_description: params.invalid_description || null,
            invalid_agent: params.invalid_agent || null,
            level: params.level || null
        };

        // Find using ID (safer) or match by ticket_id + user_email + date
        const supabaseUrl = params.db_id
            ? `${SUPABASE_URL}/rest/v1/daily_tracker?id=eq.${params.db_id}`
            : `${SUPABASE_URL}/rest/v1/daily_tracker?ticket_id=eq.${encodeURIComponent(params.old_ticket_id)}&date=eq.${encodeURIComponent(params.date)}&email=eq.${encodeURIComponent(params.user_email)}`;

        const response = await fetch(supabaseUrl, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify(updateData)
        });

        if (!response.ok) throw new Error(await response.text());
        return { success: true };

    } else if (action === "delete_ticket") {
        const supabaseUrl = params.db_id
            ? `${SUPABASE_URL}/rest/v1/daily_tracker?id=eq.${params.db_id}`
            : `${SUPABASE_URL}/rest/v1/daily_tracker?ticket_id=eq.${encodeURIComponent(params.ticket_id)}&date=eq.${encodeURIComponent(params.date)}&email=eq.${encodeURIComponent(params.user_email)}`;

        const response = await fetch(supabaseUrl, {
            method: 'DELETE',
            headers: headers
        });

        if (!response.ok) throw new Error(await response.text());
        return { success: true };

    } else {
        throw new Error("Unknown action: " + action);
    }
}
