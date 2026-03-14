/* 
 * DSM TRACKER API - BACKEND (CORS-enabled)
 * Handles high-concurrency requests securely using LockService
 * Updated to support CORS for Chrome Extension requests
 */

const CONFIG = {
  SHEET_NAME: "Final",
  HEADERS: ["Ticket Id", "Status", "Agent", "Email", "Date", "Timestamp", "Month", "Comment"],
  COL_TICKET: 0,
  COL_STATUS: 1,
  COL_AGENT: 2, 
  COL_EMAIL: 3,
  COL_DATE: 4,
  COL_TIMESTAMP: 5,
  COL_MONTH: 6,
  COL_COMMENT: 7
};

// Handle GET requests
function doGet(e) {
  return handleRequest(e);
}

// Handle POST requests (with CORS support)
function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const lock = LockService.getScriptLock();
  
  if (lock.tryLock(30000)) {
    try {
      // Parse parameters from either URL params or POST body
      let params;
      
      if (e.postData && e.postData.contents) {
        try {
          params = JSON.parse(e.postData.contents);
        } catch (parseError) {
          params = e.parameter;
        }
      } else if (e.parameter.data) {
        params = JSON.parse(e.parameter.data);
      } else {
        params = e.parameter;
      }
      
      const action = params.action;
      
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
      if (!sheet) {
        sheet = ss.insertSheet(CONFIG.SHEET_NAME);
        sheet.appendRow(CONFIG.HEADERS);
      }

      // ACTION: ADD TICKET
      if (action === "add_ticket") {
        const today = new Date();
        const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");
        const monthStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "MMMM");
        const comment = params.comment || "";
        
        sheet.appendRow([
          params.ticket_id, 
          params.status, 
          params.agent_name, 
          params.agent_email, 
          dateStr, 
          new Date(),
          monthStr,
          comment
        ]);
        
        return createCorsResponse({ success: true, message: "Logged successfully" });
      }

      // ACTION: GET ALL TICKETS FOR A DATE
      if (action === "get_tickets") {
        const targetDate = params.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
        const data = sheet.getDataRange().getValues();
        const tickets = [];
        
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          let rowDateStr;
          try {
            rowDateStr = Utilities.formatDate(new Date(row[CONFIG.COL_DATE]), Session.getScriptTimeZone(), "yyyy-MM-dd");
          } catch(e) { continue; }
          
          if (rowDateStr === targetDate) {
            let timeStr = "";
            try {
              timeStr = Utilities.formatDate(new Date(row[CONFIG.COL_TIMESTAMP]), Session.getScriptTimeZone(), "HH:mm");
            } catch(e) {}
            
            tickets.push({
              ticket_id: row[CONFIG.COL_TICKET],
              status: row[CONFIG.COL_STATUS],
              agent: row[CONFIG.COL_AGENT],
              email: row[CONFIG.COL_EMAIL],
              time: timeStr,
              comment: row[CONFIG.COL_COMMENT] || ""
            });
          }
        }
        
        // Sort by time descending (newest first)
        tickets.sort((a, b) => b.time.localeCompare(a.time));
        
        return createCorsResponse({ tickets: tickets });
      }

      // ACTION: GET STATS (Leaderboard, My Count, Status Breakdown)
      if (action === "get_stats") {
        const targetDate = params.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
        
        // Handle boolean conversion (URL params come as strings)
        let includeDocs = true;
        if (params.include_docs !== undefined) {
           includeDocs = String(params.include_docs) === "true"; 
        }
        
        const data = sheet.getDataRange().getValues();
        const stats = {
          my_count: 0,
          leaderboard: [],
          total_today: 0,
          summary: {} // agent -> { status -> count }
        };
        
        const agentMap = {};
        
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          let rowDateStr;
          try {
            rowDateStr = Utilities.formatDate(new Date(row[CONFIG.COL_DATE]), Session.getScriptTimeZone(), "yyyy-MM-dd");
          } catch(e) { continue; }

          if (rowDateStr === targetDate) {
            const agentName = row[CONFIG.COL_AGENT];
            const agentEmail = row[CONFIG.COL_EMAIL];
            const status = row[CONFIG.COL_STATUS];
            
            // Logic for counting (Leaderboard & Totals)
            // If includeDocs is false, SKIP "Transfer/Merge" for counts
            const isTransfer = (status === "Transfer/Merge");
            const shouldCount = includeDocs || !isTransfer;

            if (shouldCount) {
               stats.total_today++;
               if (agentEmail === params.user_email) {
                 stats.my_count++;
               }
               if (agentName) {
                 agentMap[agentName] = (agentMap[agentName] || 0) + 1;
               }
            }
            
            // Summary breakdown (ALWAYS include everything so we can see the data)
            // OR should the summary also hide it? User asked for "count", so table breakdown usually shows raw data.
            // Let's keep summary raw, but if user wants consistency, maybe strict filter.
            // "include transfer/merge for count" implies the numbers on top and leaderboard.
            // Let's filter summary too to match the totals.
            if (shouldCount && agentName) {
                if (!stats.summary[agentName]) {
                  stats.summary[agentName] = {};
                }
                stats.summary[agentName][status] = (stats.summary[agentName][status] || 0) + 1;
            }
          }
        }

        stats.leaderboard = Object.keys(agentMap).map(key => {
          return { name: key, count: agentMap[key] };
        }).sort((a, b) => b.count - a.count);

        return createCorsResponse(stats);
      }

      // ACTION: DELETE TICKET
      if (action === "delete_ticket") {
        const targetDate = params.date;
        const ticketId = String(params.ticket_id);
        const ticketTime = params.time || ""; // Match by time too
        const userEmail = params.user_email; // Security check

        const data = sheet.getDataRange().getValues();
        let rowIndexToDelete = -1;

        // Search for the ticket
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            let rowDateStr, rowTimeStr;
            try { 
                rowDateStr = Utilities.formatDate(new Date(row[CONFIG.COL_DATE]), Session.getScriptTimeZone(), "yyyy-MM-dd"); 
                rowTimeStr = Utilities.formatDate(new Date(row[CONFIG.COL_TIMESTAMP]), Session.getScriptTimeZone(), "HH:mm");
            } catch(e) { continue; }
            
            // Match Date, Ticket ID, Time, and User Email
            const timeMatch = !ticketTime || rowTimeStr === ticketTime;
            if (rowDateStr === targetDate && String(row[CONFIG.COL_TICKET]) === ticketId && timeMatch && row[CONFIG.COL_EMAIL] === userEmail) {
                rowIndexToDelete = i + 1; // 1-based index
                break;
            }
        }

        if (rowIndexToDelete !== -1) {
            sheet.deleteRow(rowIndexToDelete);
            return createCorsResponse({ success: true });
        } else {
            return createCorsResponse({ error: "Ticket not found or permission denied." });
        }
      }

      // ACTION: UPDATE TICKET
      if (action === "update_ticket") {
         const targetDate = params.date;
         const oldTicketId = String(params.old_ticket_id);
         const ticketTime = params.time || ""; // Match by time too
         const newTicketId = String(params.new_ticket_id);
         const newStatus = params.status;
         const newComment = params.comment || "";
         const userEmail = params.user_email;

         const data = sheet.getDataRange().getValues();
         let rowIndexToUpdate = -1;

         for (let i = 1; i < data.length; i++) {
             const row = data[i];
             let rowDateStr, rowTimeStr;
             try { 
                 rowDateStr = Utilities.formatDate(new Date(row[CONFIG.COL_DATE]), Session.getScriptTimeZone(), "yyyy-MM-dd"); 
                 rowTimeStr = Utilities.formatDate(new Date(row[CONFIG.COL_TIMESTAMP]), Session.getScriptTimeZone(), "HH:mm");
             } catch(e) { continue; }
 
             // Match Date, Ticket ID, Time, and User Email
             const timeMatch = !ticketTime || rowTimeStr === ticketTime;
             if (rowDateStr === targetDate && String(row[CONFIG.COL_TICKET]) === oldTicketId && timeMatch && row[CONFIG.COL_EMAIL] === userEmail) {
                 rowIndexToUpdate = i + 1;
                 break;
             }
         }

         if (rowIndexToUpdate !== -1) {
             sheet.getRange(rowIndexToUpdate, CONFIG.COL_TICKET + 1).setValue(newTicketId);
             sheet.getRange(rowIndexToUpdate, CONFIG.COL_STATUS + 1).setValue(newStatus);
             sheet.getRange(rowIndexToUpdate, CONFIG.COL_COMMENT + 1).setValue(newComment);
             return createCorsResponse({ success: true });
         } else {
             return createCorsResponse({ error: "Ticket not found or permission denied." });
         }
      }
      
      return createCorsResponse({ error: "Unknown action" });

    } catch (error) {
      return createCorsResponse({ error: error.toString() });
    } finally {
      lock.releaseLock();
    }
  } else {
    return createCorsResponse({ error: "Server busy, try again in 5s" });
  }
}

// Helper function to create CORS-enabled JSON response
function createCorsResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
