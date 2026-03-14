// --- Constants ---
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const BUSINESS_START_HOUR = 9; // 9 AM IST
const BUSINESS_END_HOUR = 21; // 9 PM IST
const P1_SLA_HOURS = 6;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const BUSINESS_DAY_DURATION_MS = (BUSINESS_END_HOUR - BUSINESS_START_HOUR) * MS_PER_HOUR; // 12 hours in ms

// --- Date Parsing (UPDATED FUNCTION) ---
function parseISTString(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    try {
        let year, month, day, hour, minute, second;
        dateString = dateString.trim(); // Clean up whitespace

        // *** NEW: Try to parse as ISO 8601 (T/Z) format first ***
        // This format (e.g., "2025-10-28T05:00:20.000Z") is UTC
        if (dateString.includes('T') && dateString.endsWith('Z')) {
            const date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                return date; // This is a valid UTC date, return it directly
            }
        }

        // Try YYYY-MM-DD HH:MM:SS format (or with single digit hour)
        let match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{1,2}):(\d{2}):(\d{2})/);
        if (match) {
            [, year, month, day, hour, minute, second] = match.map(Number);
        } else {
            // Try MM/DD/YYYY HH:MM:SS format
            match = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s(\d{1,2}):(\d{2}):(\d{2})/);
            if (match) {
                [, month, day, year, hour, minute, second] = match.map(Number);
            } else {
                // Try DD-MM-YYYY HH:MM:SS format
                match = dateString.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s(\d{1,2}):(\d{2}):(\d{2})/);
                if (match) {
                    [, day, month, year, hour, minute, second] = match.map(Number);
                } else {
                    // Try DD-MM-YYYY HH:MM format
                    match = dateString.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s(\d{1,2}):(\d{2})$/);
                    if (match) {
                        [, day, month, year, hour, minute] = match.map(Number);
                        second = 0; // Default seconds to 0
                    } else {
                        // Try MM/DD/YY HH:MM format
                        match = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\s(\d{1,2}):(\d{2})$/);
                        if (match) {
                            [, month, day, year, hour, minute] = match.map(Number);
                            year += 2000; // Assume 21st century
                            second = 0;
                        } else {
                            throw new Error("Unrecognized date format: " + dateString);
                        }
                    }
                }
            }
        }

        // --- This part is for non-ISO dates assumed to be in IST ---
        // Construct Date using UTC values that represent the IST time
        // Month is 0-indexed in Date.UTC
        const utcTimestamp = Date.UTC(year, month - 1, day, hour, minute, second) - IST_OFFSET_MS;
        const date = new Date(utcTimestamp);

        if (isNaN(date.getTime())) {
            throw new Error("Parsed date is invalid: " + dateString);
        }
        return date;
    } catch (e) {
        console.error("Error parsing date string:", dateString, e);
        return null;
    }
}


// --- Business Time Calculation Helpers ---

function isWeekend(date) {
    const day = date.getDay(); // 0 = Sunday, 6 = Saturday
    return day === 0 || day === 6;
}

function getNextBusinessDayStart(date) {
    let nextDay = new Date(date.getTime());
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(BUSINESS_START_HOUR, 0, 0, 0);
    while (isWeekend(nextDay)) {
        nextDay.setDate(nextDay.getDate() + 1);
    }
    return nextDay;
}

function calculateBusinessDurationMs(startDate, endDate) {
    if (!startDate || !endDate || startDate >= endDate) {
        return 0;
    }
    let current = new Date(startDate.getTime());
    let end = new Date(endDate.getTime());
    let totalBusinessMs = 0;
    if (isWeekend(current) || current.getHours() >= BUSINESS_END_HOUR) {
        current = getNextBusinessDayStart(current);
    } else if (current.getHours() < BUSINESS_START_HOUR) {
        current.setHours(BUSINESS_START_HOUR, 0, 0, 0);
    }
    if (current >= end) return 0;
    while (current < end) {
        const currentDayEnd = new Date(current.getTime());
        currentDayEnd.setHours(BUSINESS_END_HOUR, 0, 0, 0);
        const effectiveEndTimeThisIteration = Math.min(end.getTime(), currentDayEnd.getTime());
        if (!isWeekend(current) && current.getHours() < BUSINESS_END_HOUR && current.getHours() >= BUSINESS_START_HOUR) {
            totalBusinessMs += (effectiveEndTimeThisIteration - current.getTime());
        }
        if (effectiveEndTimeThisIteration === currentDayEnd.getTime()) {
            current = getNextBusinessDayStart(current);
        } else {
            current.setTime(effectiveEndTimeThisIteration);
        }
    }
    return totalBusinessMs;
}

function addBusinessMilliseconds(startDate, msToAdd) {
    if (msToAdd <= 0) return new Date(startDate.getTime());
    let current = new Date(startDate.getTime());
    let msRemaining = msToAdd;
    if (isWeekend(current) || current.getHours() >= BUSINESS_END_HOUR) {
        current = getNextBusinessDayStart(current);
    } else if (current.getHours() < BUSINESS_START_HOUR) {
        current.setHours(BUSINESS_START_HOUR, 0, 0, 0);
    }
    while (msRemaining > 0) {
        const dayEnd = new Date(current.getTime());
        dayEnd.setHours(BUSINESS_END_HOUR, 0, 0, 0);
        const msLeftInDay = dayEnd.getTime() - current.getTime();
        if (msRemaining <= msLeftInDay) {
            current.setTime(current.getTime() + msRemaining);
            msRemaining = 0;
        } else {
            msRemaining -= msLeftInDay;
            current = getNextBusinessDayStart(current);
        }
    }
    return current;
}

function addBusinessHours(startDate, hoursToAdd) {
    return addBusinessMilliseconds(startDate, hoursToAdd * MS_PER_HOUR);
}

// --- Main P1 Status Calculation ---
function calculateP1Status(createdAtISTString, promiseOneString, openToWocTimeString, wocReopenTimeString) {
    const createdAtDate = parseISTString(createdAtISTString);
    if (!createdAtDate) {
        return { error: 'Invalid Create Date', isGiven: false, isP2: false, isBreached: false, isPaused: false, diffMillis: null, breachTime: null, promiseTime: null };
    }

    const now = new Date();
    const isP1Given = !!promiseOneString;
    const promiseDate = isP1Given ? parseISTString(promiseOneString) : null;
    const promiseTime = promiseDate ? promiseDate.toLocaleString() : null;

    if (isP1Given && promiseDate) {
        if (now < promiseDate) {
            // Still within P1 Promise window -> Countdown to Promise Date (Blue Timer)
            return {
                isGiven: true,
                isP2: false,
                isBreached: false,
                isPaused: false,
                diffMillis: promiseDate.getTime() - now.getTime(),
                breachTime: promiseDate,
                promiseTime: promiseTime
            };
        } else {
            // Promise Date passed -> P2 Countdown (4 business hours from Promise Date) (Yellow-Green Timer)
            const initialP2BreachTime = addBusinessHours(promiseDate, 4);
            let effectiveBreachTime = initialP2BreachTime;
            let isPaused = false;
            let pauseDurationMs = 0;
            const openToWocTime = parseISTString(openToWocTimeString);

            if (openToWocTime && openToWocTime < initialP2BreachTime && openToWocTime > promiseDate) {
                const wocReopenTime = parseISTString(wocReopenTimeString);
                if (wocReopenTime && wocReopenTime > openToWocTime) {
                    pauseDurationMs = calculateBusinessDurationMs(openToWocTime, wocReopenTime);
                    effectiveBreachTime = addBusinessMilliseconds(initialP2BreachTime, pauseDurationMs);
                } else if (!wocReopenTime) {
                    isPaused = true;
                    const elapsedBeforePauseMs = calculateBusinessDurationMs(promiseDate, openToWocTime);
                    const remainingSlaMs = Math.max(0, (4 * MS_PER_HOUR) - elapsedBeforePauseMs);
                    return {
                        isGiven: false,
                        isP2: true,
                        isBreached: false,
                        isPaused: true,
                        diffMillis: remainingSlaMs,
                        breachTime: null,
                        promiseTime: promiseTime,
                        pausedAt: openToWocTime.toLocaleString()
                    };
                }
            }

            const isBreached = now > effectiveBreachTime;
            const diffMillis = isBreached ? null : effectiveBreachTime.getTime() - now.getTime();

            if (isBreached) {
                return {
                    isGiven: false,
                    isP2: true,
                    isBreached: true,
                    isPaused: false,
                    diffMillis: null,
                    breachTime: effectiveBreachTime,
                    promiseTime: promiseTime
                };
            }

            return {
                isGiven: false,
                isP2: true,
                isBreached: false,
                isPaused: false,
                diffMillis: diffMillis,
                breachTime: effectiveBreachTime,
                promiseTime: promiseTime
            };
        }
    }

    // Standard P1 Logic (6 business hours)
    const initialBreachTime = addBusinessHours(createdAtDate, P1_SLA_HOURS);
    let effectiveBreachTime = initialBreachTime;
    let isPaused = false;
    let pauseDurationMs = 0;
    const openToWocTime = parseISTString(openToWocTimeString);

    if (openToWocTime && openToWocTime < initialBreachTime) {
        const wocReopenTime = parseISTString(wocReopenTimeString);
        if (wocReopenTime && wocReopenTime > openToWocTime) {
            pauseDurationMs = calculateBusinessDurationMs(openToWocTime, wocReopenTime);
            effectiveBreachTime = addBusinessMilliseconds(initialBreachTime, pauseDurationMs);
        } else if (!wocReopenTime) {
            isPaused = true;
            const elapsedBeforePauseMs = calculateBusinessDurationMs(createdAtDate, openToWocTime);
            const remainingSlaMs = Math.max(0, (P1_SLA_HOURS * MS_PER_HOUR) - elapsedBeforePauseMs);
            return {
                isGiven: false,
                isP2: false,
                isBreached: false,
                isPaused: true,
                diffMillis: remainingSlaMs,
                breachTime: null,
                promiseTime: null,
                pausedAt: openToWocTime.toLocaleString()
            };
        }
    }

    const isBreached = now > effectiveBreachTime;
    const diffMillis = isBreached ? null : effectiveBreachTime.getTime() - now.getTime();
    return {
        isGiven: false,
        isP2: false,
        isBreached: isBreached,
        isPaused: false,
        diffMillis: diffMillis,
        breachTime: effectiveBreachTime,
        promiseTime: null
    };
}

// --- Formatting ---
function formatTimeDiff(milliseconds) {
    if (milliseconds === null || milliseconds < 0) {
        return { hours: '00', minutes: '00', seconds: '00' };
    }
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return {
        hours: String(hours).padStart(2, '0'),
        minutes: String(minutes).padStart(2, '0'),
        seconds: String(seconds).padStart(2, '0')
    };
}

function formatMsToTimeUnits(milliseconds) {
    if (milliseconds === null || milliseconds < 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    }
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const days = Math.floor(totalSeconds / (3600 * 24));
    const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { days, hours, minutes, seconds };
}