const fs = require('fs');

async function run() {
    const harData = JSON.parse(fs.readFileSync('./referthis.har', 'utf8'));
    let activities = [];

    // Find the activities response
    for (const entry of harData.log.entries) {
        if (entry.request.url.includes('/activities')) {
            const content = entry.response.content.text;
            if (content) {
                const json = JSON.parse(content);
                if (json.activities) {
                    activities = activities.concat(json.activities);
                }
            }
        }
    }

    const sorted = activities.sort((a, b) => {
        const tA = new Date(a.performed_at).getTime();
        const tB = new Date(b.performed_at).getTime();
        if (tA === tB) return a.id - b.id;
        return tA - tB;
    });

    let humanACERaiserId = null;
    let currentGroup = 'Unknown';
    let lastPSEAssignerId = null;

    let assignedAgents = [];
    let interactingHumans = [];
    let isCurrentlyAssigned = false;
    let groupChangedBySystemAt = null;

    for (const act of sorted) {
        const performerId = act.performer?.user_id || act.performer?.system?.id;
        const isHumanPerformer = act.performer?.type === 'user';
        const time = act.performed_at;

        const hasValidAction = (act.actions || []).some(a => ['note', 'property_update'].includes(a.type));
        if (isHumanPerformer && performerId && hasValidAction) {
            if (interactingHumans.length === 0 || interactingHumans[interactingHumans.length - 1].id !== performerId) {
                interactingHumans.push({ id: performerId, time: time });
            }
        }

        for (const action of (act.actions || [])) {
            let newAgentId = null;
            let newAgentName = null;

            if (action.type === 'property_update' && action.content) {
                if (action.content.group_name !== undefined) {
                    currentGroup = action.content.group_name;

                    if (currentGroup.includes('TS-PSE Support Group')) {
                        lastPSEAssignerId = performerId;
                    } else if (currentGroup.includes('ACE')) {
                        if (isHumanPerformer) {
                            humanACERaiserId = performerId;
                            groupChangedBySystemAt = null;
                        } else {
                            humanACERaiserId = null;
                            groupChangedBySystemAt = time;
                        }
                    }
                }

                if (action.content.responder_id !== undefined || action.content.agent_name !== undefined) {
                    if (action.content.responder_id === null || action.content.agent_name === null) {
                        isCurrentlyAssigned = false;
                    } else {
                        newAgentId = action.content.responder_id || newAgentId;
                        newAgentName = action.content.agent_name || newAgentName;
                    }
                }
            }

            if (action.type === 'round_robin' && action.content && action.content.responder_id) {
                newAgentId = action.content.responder_id;
            }

            if (newAgentId && String(newAgentId) !== 'null') {
                isCurrentlyAssigned = true;
                if (assignedAgents.length === 0 || String(assignedAgents[assignedAgents.length - 1].id) !== String(newAgentId)) {
                    assignedAgents.push({ id: newAgentId, name: newAgentName, time: time });
                }
            }
        }
    }

    let targetAgentId = null;
    let targetAgentName = null;

    const cache = {
        data: {
            agents: [
                { id: 82218776560, contact: { name: 'Rishika Biswakarma' } },
                { id: 82208991420, contact: { name: 'Thouheed' } },
            ]
        }
    };
    const currentUser = 'Unknown';

    const getAgentNameById = (id) => {
        if (!id) return null;
        const ag = cache.data.agents.find(a => String(a.id) === String(id));
        return ag ? (ag.contact?.name || ag.user?.name) : null;
    };

    const findLastValidAgent = (agentsList, interactingList, limitTime = null) => {
        let currentTicketOwnerId = null;
        if (agentsList.length > 0) {
            currentTicketOwnerId = agentsList[agentsList.length - 1].id;
        }

        for (let i = agentsList.length - 1; i >= 0; i--) {
            const id = agentsList[i].id;
            const time = agentsList[i].time;

            if (String(id) === String(currentTicketOwnerId)) continue;

            // Must not have been assigned at or after the group was moved to ACE
            if (limitTime && new Date(time) >= new Date(limitTime)) continue;

            return { id, name: agentsList[i].name || getAgentNameById(id) };
        }

        // Fallback to interacting humans
        for (let i = interactingList.length - 1; i >= 0; i--) {
            const id = interactingList[i].id;
            const time = interactingList[i].time;

            if (String(id) === String(currentTicketOwnerId)) continue;
            if (limitTime && new Date(time) >= new Date(limitTime)) continue;

            return { id, name: getAgentNameById(id) };
        }
        return null;
    };


    if (currentGroup.includes('TS-PSE Support Group')) {
        targetAgentId = lastPSEAssignerId;
    } else if (currentGroup.includes('ACE')) {
        if (humanACERaiserId) {
            targetAgentId = humanACERaiserId;
        } else {
            const prev = findLastValidAgent(assignedAgents, interactingHumans, groupChangedBySystemAt);
            if (prev) {
                targetAgentId = prev.id;
                targetAgentName = prev.name;
            }
        }
    } else {
        const prev = findLastValidAgent(assignedAgents, interactingHumans);
        if (prev) {
            targetAgentId = prev.id;
            targetAgentName = prev.name;
        }
    }

    if (targetAgentId && !targetAgentName) {
        targetAgentName = getAgentNameById(targetAgentId);
    }

    console.log("FINAL:", { targetAgentId, targetAgentName });
}

run().catch(console.error);
