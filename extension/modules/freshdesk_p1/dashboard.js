// ==========================================
// 1. UTILS.JS LOGIC (unchanged)
// ==========================================
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 21;
const P1_SLA_HOURS = 6;
const MS_PER_HOUR = 60 * 60 * 1000;

function parseISTString(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    try {
        if (dateString.includes('T') && dateString.endsWith('Z')) {
            const date = new Date(dateString);
            return !isNaN(date.getTime()) ? date : null;
        }
        let year, month, day, hour, minute, second;
        dateString = dateString.trim();
        let match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{1,2}):(\d{2}):(\d{2})/);
        if (match) { [, year, month, day, hour, minute, second] = match.map(Number); }
        else {
            match = dateString.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s(\d{1,2}):(\d{2}):(\d{2})/);
            if (match) { [, day, month, year, hour, minute, second] = match.map(Number); }
        }
        if (year && month) {
            const utcTimestamp = Date.UTC(year, month - 1, day, hour, minute, second) - IST_OFFSET_MS;
            return new Date(utcTimestamp);
        }
        return new Date(dateString);
    } catch (e) { return null; }
}

function isWeekend(date) { const day = date.getDay(); return day === 0 || day === 6; }

function getNextBusinessDayStart(date) {
    let nextDay = new Date(date.getTime());
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(BUSINESS_START_HOUR, 0, 0, 0);
    while (isWeekend(nextDay)) { nextDay.setDate(nextDay.getDate() + 1); }
    return nextDay;
}

function calculateBusinessDurationMs(startDate, endDate) {
    if (!startDate || !endDate || startDate >= endDate) return 0;
    let current = new Date(startDate.getTime());
    let end = new Date(endDate.getTime());
    let totalBusinessMs = 0;
    if (isWeekend(current) || current.getHours() >= BUSINESS_END_HOUR) current = getNextBusinessDayStart(current);
    else if (current.getHours() < BUSINESS_START_HOUR) current.setHours(BUSINESS_START_HOUR, 0, 0, 0);
    if (current >= end) return 0;
    while (current < end) {
        const currentDayEnd = new Date(current.getTime());
        currentDayEnd.setHours(BUSINESS_END_HOUR, 0, 0, 0);
        const effectiveEndTime = Math.min(end.getTime(), currentDayEnd.getTime());
        if (!isWeekend(current) && current.getHours() < BUSINESS_END_HOUR && current.getHours() >= BUSINESS_START_HOUR) {
            totalBusinessMs += (effectiveEndTime - current.getTime());
        }
        if (effectiveEndTime === currentDayEnd.getTime()) current = getNextBusinessDayStart(current);
        else current.setTime(effectiveEndTime);
    }
    return totalBusinessMs;
}

function addBusinessMilliseconds(startDate, msToAdd) {
    if (msToAdd <= 0) return new Date(startDate.getTime());
    let current = new Date(startDate.getTime());
    let msRemaining = msToAdd;
    if (isWeekend(current) || current.getHours() >= BUSINESS_END_HOUR) current = getNextBusinessDayStart(current);
    else if (current.getHours() < BUSINESS_START_HOUR) current.setHours(BUSINESS_START_HOUR, 0, 0, 0);
    while (msRemaining > 0) {
        const dayEnd = new Date(current.getTime());
        dayEnd.setHours(BUSINESS_END_HOUR, 0, 0, 0);
        const msLeftInDay = dayEnd.getTime() - current.getTime();
        if (msRemaining <= msLeftInDay) { current.setTime(current.getTime() + msRemaining); msRemaining = 0; }
        else { msRemaining -= msLeftInDay; current = getNextBusinessDayStart(current); }
    }
    return current;
}

function calculateDynamicStatus(ticket) {
    const createdAt = parseISTString(ticket.createdAt);
    if (!createdAt) return { state: 'ERROR' };
    if (ticket.promiseOne) return { state: 'GIVEN' };
    const initialBreachTime = addBusinessMilliseconds(createdAt, P1_SLA_HOURS * MS_PER_HOUR);
    let effectiveBreachTime = initialBreachTime;
    const openToWoc = parseISTString(ticket.openToWocTime);
    if (openToWoc && openToWoc < initialBreachTime) {
        const wocReopen = parseISTString(ticket.wocReopenTime);
        if (wocReopen) {
            const pauseDuration = calculateBusinessDurationMs(openToWoc, wocReopen);
            effectiveBreachTime = addBusinessMilliseconds(initialBreachTime, pauseDuration);
        } else {
            const consumed = calculateBusinessDurationMs(createdAt, openToWoc);
            const remaining = P1_SLA_HOURS * MS_PER_HOUR - consumed;
            return { state: 'PAUSED', msLeft: remaining };
        }
    }
    const now = new Date();
    if (now > effectiveBreachTime) return { state: 'BREACHED', msLeft: effectiveBreachTime - now };
    return { state: 'ACTIVE', msLeft: effectiveBreachTime - now };
}

// ==========================================
// 2. PERFORMANCE-OPTIMIZED VISUALIZATION
// ==========================================
// KEY PERF RULES:
// - ZERO ctx.shadowBlur (extremely expensive on canvas)
// - Cache calculateDynamicStatus — recalc only every 60 frames
// - Cap particles at 100, cap shockwaves at 10
// - Breach entities auto-expire fast (80 frames)
// - Simpler draw calls for bulk entities

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let entities = {};
let particles = [];
let projectiles = [];
let shockwaves = [];
let lastTime = 0;
let breachShake = 0;
let seenBreaches = JSON.parse(localStorage.getItem('seenBreaches') || '[]');
let globalTime = 0;
let frameCount = 0;

const MAX_PARTICLES = 100;
const MAX_SHOCKWAVES = 8;

// --- STARFIELD (reduced) ---
const stars = [];
for (let i = 0; i < 60; i++) {
    stars.push({
        x: Math.random(),
        y: Math.random(),
        size: Math.random() * 1.2 + 0.3,
        brightness: Math.random() * 0.4 + 0.15,
        twinkleOffset: Math.random() * Math.PI * 2
    });
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// --- INTERACTIONS ---
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    Object.values(entities).forEach(ent => {
        const dist = Math.sqrt((x - ent.runX) ** 2 + (y - ent.runY) ** 2);
        if (dist < 30 && ent.opacity > 0.1) {
            navigator.clipboard.writeText(ent.id).then(() => showTooltip(x, y, "Copied!"));
        }
    });
});

let tooltips = [];
function showTooltip(x, y, text) { tooltips.push({ x, y, text, life: 1.0 }); }

function resolveCollisions() {
    const ents = Object.values(entities).filter(e => e.opacity > 0.1);

    // Instead of O(N^2) physics checks which freeze with 130+ entities,
    // we just assign targetY based on hash, naturally spreading them out
    for (let i = 0; i < ents.length; i++) {
        const hash = parseInt(ents[i].id) || Math.random() * 1000;
        const targetRange = canvas.height - 200;
        ents[i].targetY = 120 + (hash % targetRange);
    }
}

// --- SHOCKWAVE (no shadowBlur) ---
class Shockwave {
    constructor(x, y, color, maxR = 50) {
        this.x = x; this.y = y; this.color = color;
        this.radius = 0; this.maxR = maxR; this.life = 1.0;
    }
    update() { this.radius += (this.maxR - this.radius) * 0.12; this.life -= 0.04; }
    draw(ctx) {
        if (this.life <= 0) return;
        ctx.globalAlpha = this.life * 0.5;
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2 * this.life;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
}

// --- HERO (TURRET) — no shadowBlur ---
class HeroEntity {
    constructor() {
        this.x = 50; this.y = canvas.height / 2;
        this.target = null; this.cooldown = 0;
        this.gunAngle = 0; this.muzzleFlash = 0; this.recoil = 0;
    }

    update(dt) {
        if (!this.target || this.target.isDead || !entities[this.target.id]) {
            this.target = null;
            const cands = Object.values(entities).filter(e => e.visualState === 'TARGETED' || e.visualState === 'FREEZING');
            if (cands.length > 0) this.target = cands[0];
        }
        if (this.target) {
            const dx = this.target.runX - this.x;
            const dy = this.target.runY - this.y;
            let targetAngle = Math.atan2(dy, dx);
            let diff = targetAngle - this.gunAngle;
            if (diff > Math.PI) diff -= Math.PI * 2;
            if (diff < -Math.PI) diff += Math.PI * 2;
            this.gunAngle += diff * 0.15;
            if (this.cooldown <= 0) { this.shoot(this.target); this.cooldown = 18; }
        } else {
            this.gunAngle += (Math.sin(Date.now() / 2000) * 0.3 - this.gunAngle) * 0.02;
        }
        if (this.cooldown > 0) this.cooldown--;
        if (this.muzzleFlash > 0) this.muzzleFlash -= 0.15;
        if (this.recoil > 0) this.recoil *= 0.85;
    }

    shoot(target) {
        const type = target.visualState === 'FREEZING' ? 'freeze' : 'normal';
        projectiles.push(new Projectile(this.x, this.y, target, type));
        this.muzzleFlash = 1.0;
        this.recoil = 6;
    }

    draw(ctx) {
        this.x += (100 - this.recoil - this.x) * 0.1;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.gunAngle);

        const pulse = Math.sin(globalTime * 2) * 0.1 + 0.9;

        // Outer ring
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 24 * pulse, 0, Math.PI * 2);
        ctx.stroke();

        // Fill
        ctx.fillStyle = "#0c1929";
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.fill();

        // Inner ring
        ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI * 2);
        ctx.stroke();

        // Barrel
        ctx.fillStyle = "#38bdf8";
        ctx.fillRect(12, -5, 28, 10);

        // Fins
        ctx.beginPath(); ctx.moveTo(8, -18); ctx.lineTo(20, -8); ctx.lineTo(8, -8); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(8, 18); ctx.lineTo(20, 8); ctx.lineTo(8, 8); ctx.closePath(); ctx.fill();

        // Core
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();

        // Muzzle flash — simple bright circle
        if (this.muzzleFlash > 0) {
            ctx.globalAlpha = this.muzzleFlash;
            ctx.fillStyle = "#fef08a";
            ctx.beginPath();
            ctx.arc(40, 0, 6 * this.muzzleFlash, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        ctx.restore();
    }
}

// --- PROJECTILE (no shadowBlur) ---
class Projectile {
    constructor(x, y, target, type = 'normal') {
        this.x = x; this.y = y; this.target = target;
        this.type = type; this.speed = 14; this.dead = false;
        const dx = target.runX - x, dy = target.runY - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        this.vx = (dx / dist) * this.speed;
        this.vy = (dy / dist) * this.speed;
        this.trail = [];
    }

    update() {
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 6) this.trail.shift();
        this.x += this.vx;
        this.y += this.vy;

        if (this.target) {
            const dx = this.x - this.target.runX, dy = this.y - this.target.runY;
            if (Math.sqrt(dx * dx + dy * dy) < 20) {
                this.dead = true;
                if (this.type === 'freeze') this.target.freeze();
                else this.target.explode();
                const c = this.type === 'freeze' ? "#0ea5e9" : "#22c55e";
                if (shockwaves.length < MAX_SHOCKWAVES)
                    shockwaves.push(new Shockwave(this.target.runX, this.target.runY, c, 35));
            }
        }
        if (this.x > canvas.width || this.x < 0 || this.y > canvas.height || this.y < 0) this.dead = true;
    }

    draw(ctx) {
        const color = this.type === 'freeze' ? "#0ea5e9" : "#fef08a";

        // Simple trail line
        if (this.trail.length > 1) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.moveTo(this.trail[0].x, this.trail[0].y);
            for (let i = 1; i < this.trail.length; i++) ctx.lineTo(this.trail[i].x, this.trail[i].y);
            ctx.lineTo(this.x, this.y);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Head
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

// --- TICKET ENTITY (no shadowBlur, cached status) ---
class TicketEntity {
    constructor(id, data) {
        this.id = id;
        this.data = data;
        this.status = calculateDynamicStatus(data);
        this._statusFrame = 0; // Frame counter for cache

        this.targetY = Math.random() * (canvas.height - 200) + 120;
        this.y = this.targetY;
        this.x = canvas.width + 50;
        this.runX = this.x;
        this.runY = this.y;

        this.visualState = 'NORMAL';
        this.breachLife = 80;
        this.opacity = 1;
        this.frozenStart = 0;

        this.angle = Math.random() * Math.PI * 2;
        this.rotSpeed = (Math.random() - 0.5) * 0.04;
        this.pulse = Math.random();
        this.spawnAnim = 0;
    }

    // Cached status — only recalculate every 60 frames (~1 second)
    _getStatus() {
        if (frameCount - this._statusFrame >= 60) {
            this.status = calculateDynamicStatus(this.data);
            this._statusFrame = frameCount;
        }
        return this.status;
    }

    explode() {
        createExplosion(this.runX, this.runY, '#22c55e', 10);
        if (shockwaves.length < MAX_SHOCKWAVES)
            shockwaves.push(new Shockwave(this.runX, this.runY, '#22c55e', 50));
        delete entities[this.id];
    }

    iceBreak() {
        createExplosion(this.runX, this.runY, '#0ea5e9', 8);
    }

    freeze() {
        createExplosion(this.runX, this.runY, '#0ea5e9', 8);
        if (shockwaves.length < MAX_SHOCKWAVES)
            shockwaves.push(new Shockwave(this.runX, this.runY, '#0ea5e9', 40));
        this.visualState = 'FROZEN';
        this.frozenStart = Date.now();
    }

    update(dt) {
        this.angle += this.rotSpeed;
        this.pulse += 0.05;
        if (this.spawnAnim < 1) this.spawnAnim += 0.05;

        const prevState = this.status.state;
        const newStatus = this._getStatus();

        if (prevState === 'PAUSED' && newStatus.state === 'ACTIVE') {
            this.iceBreak();
            this.opacity = 1;
        }

        if (newStatus.state === 'GIVEN' && this.visualState !== 'TARGETED') {
            this.visualState = 'TARGETED';
            return;
        }
        if (this.visualState === 'TARGETED') return;

        if (newStatus.state === 'PAUSED' && prevState !== 'PAUSED' && this.visualState !== 'FREEZING' && this.visualState !== 'FROZEN') {
            this.visualState = 'FREEZING';
            return;
        }
        if (this.visualState === 'FREEZING') return;

        const VIEW_MS = 6 * 60 * 60 * 1000;

        if (newStatus.state === 'ACTIVE') {
            this.breachLife = 80;
            this.frozenStart = 0;
            this.opacity = 1;
            let pct = Math.min(1.05, newStatus.msLeft / VIEW_MS);
            this.x = 100 + (Math.max(0, pct) * (canvas.width - 200));

        } else if (newStatus.state === 'BREACHED') {
            if (!this.breachX) {
                const hash = parseInt(this.id) || Math.random() * 1000;
                this.breachX = 15 + (hash % 8) * 10;
            }
            this.x += (this.breachX - this.x) * 0.1;
            this.breachLife--;
            if (this.breachLife < 20) this.opacity = this.breachLife / 20;

            if (this.breachLife <= 0) {
                if (!seenBreaches.includes(this.id)) {
                    seenBreaches.push(this.id);
                    if (seenBreaches.length > 300) seenBreaches.shift(); // Keep bounded!
                    localStorage.setItem('seenBreaches', JSON.stringify(seenBreaches));
                }
                delete entities[this.id];
                return;
            }

            // Very rare mini explosion
            if (Math.random() > 0.999 && particles.length < 50) {
                createExplosion(this.runX, this.runY, '#ef4444', 3);
                breachShake = 1.5;
            }

        } else if (newStatus.state === 'PAUSED') {
            if (this.frozenStart === 0) this.frozenStart = Date.now();
            let pct = Math.min(1.05, newStatus.msLeft / VIEW_MS);
            this.x = 100 + (Math.max(0, pct) * (canvas.width - 200));

            if (Date.now() - this.frozenStart > 15000) {
                this.opacity -= 0.05;
                if (this.opacity < 0) this.opacity = 0;
            }
        }

        this.runX += (this.x - this.runX) * 0.08;
        this.runY += (this.targetY - this.runY) * 0.08;
    }

    draw(ctx) {
        if (this.opacity <= 0.01) return;
        ctx.globalAlpha = this.opacity * Math.min(1, this.spawnAnim);
        const s = Math.min(1, this.spawnAnim);

        // --- TARGETED (P1 Given) ---
        if (this.status.state === 'GIVEN' || this.visualState === 'TARGETED') {
            ctx.save();
            ctx.translate(this.runX, this.runY);
            ctx.strokeStyle = "#22c55e";
            ctx.lineWidth = 2;

            // Rotating arcs
            const rot = globalTime * 0.5;
            ctx.rotate(rot);
            ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 0.4); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, 15, Math.PI, Math.PI * 1.4); ctx.stroke();
            ctx.rotate(-rot);

            // Cross
            ctx.beginPath();
            ctx.moveTo(-18, 0); ctx.lineTo(-7, 0);
            ctx.moveTo(7, 0); ctx.lineTo(18, 0);
            ctx.moveTo(0, -18); ctx.lineTo(0, -7);
            ctx.moveTo(0, 7); ctx.lineTo(0, 18);
            ctx.stroke();

            // Center
            ctx.fillStyle = "#22c55e";
            ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();

            ctx.restore();
            ctx.globalAlpha = 1;
            return;
        }

        // --- FREEZING ---
        if (this.visualState === 'FREEZING') {
            ctx.save();
            ctx.translate(this.runX, this.runY);
            ctx.strokeStyle = "#0ea5e9";
            ctx.lineWidth = 2;

            const rot = -globalTime * 0.8;
            ctx.rotate(rot);
            ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 0.3); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, 15, Math.PI * 0.7, Math.PI); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, 15, Math.PI * 1.3, Math.PI * 1.6); ctx.stroke();
            ctx.rotate(-rot);

            ctx.fillStyle = "#fff";
            ctx.font = "12px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("❄", 0, 1);

            ctx.restore();
            ctx.globalAlpha = 1;
            return;
        }

        // --- Timeline thread (dotted) ---
        ctx.save();
        ctx.setLineDash([3, 8]);
        ctx.strokeStyle = "rgba(255,255,255,0.03)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.runX, this.runY + 20);
        ctx.lineTo(this.runX, canvas.height - 35);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        ctx.save();
        ctx.translate(this.runX, this.runY);

        // --- PAUSED (FROZEN) ---
        if (this.status.state === 'PAUSED') {
            ctx.strokeStyle = "#0ea5e9";
            ctx.fillStyle = "rgba(14, 165, 233, 0.1)";
            ctx.lineWidth = 2;

            // Hexagon
            ctx.rotate(this.angle * 0.15);
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.rotate(-this.angle * 0.15);

            // Snowflake
            ctx.fillStyle = "#fff";
            ctx.font = "12px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("❄", 0, 1);

            // ID
            ctx.fillStyle = "#0ea5e9";
            ctx.font = "bold 10px 'JetBrains Mono'";
            ctx.fillText(`#${this.id}`, 0, -24);

            // --- BREACHED ---
        } else if (this.status.state === 'BREACHED') {
            const shake = (Math.random() - 0.5) * 3;
            ctx.translate(shake, shake);

            // Pulsing dot
            ctx.fillStyle = "#ef4444";
            const r = 8 + Math.sin(this.pulse * 5) * 2;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

            // Inner bright
            ctx.fillStyle = "#fca5a5";
            ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();

            // Outer ring
            ctx.strokeStyle = "rgba(239, 68, 68, 0.3)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(0, 0, 16, 0, Math.PI * 2);
            ctx.stroke();

            // ID
            ctx.fillStyle = "#ef4444";
            ctx.font = "bold 10px 'JetBrains Mono'";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(`#${this.id}`, 0, -20);

            // --- ACTIVE ---
        } else {
            const urgency = Math.max(0, Math.min(1, this.status.msLeft / (2 * MS_PER_HOUR)));
            let color;
            if (urgency < 0.2) color = "#ef4444";
            else if (urgency < 0.6) color = "#f59e0b";
            else color = "#22c55e";
            if (this.status.msLeft > 6 * MS_PER_HOUR) color = "#22c55e";

            // Core
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();

            // Bright center
            ctx.fillStyle = "#fff";
            ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();

            // Ring
            const pulseScale = 1 + Math.sin(this.pulse) * 0.08;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(0, 0, 14 * pulseScale, 0, Math.PI * 2); ctx.stroke();

            // 3 orbiting dots
            ctx.fillStyle = color;
            ctx.rotate(this.angle);
            for (let i = 0; i < 3; i++) {
                const a = (i / 3) * Math.PI * 2;
                ctx.beginPath();
                ctx.arc(Math.cos(a) * 16, Math.sin(a) * 16, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.rotate(-this.angle);

            // Urgency bar
            if (this.status.msLeft) {
                const barW = 26;
                const pct = Math.min(1, this.status.msLeft / (P1_SLA_HOURS * MS_PER_HOUR));
                ctx.fillStyle = "rgba(255,255,255,0.08)";
                ctx.fillRect(-barW / 2, 16, barW, 2);
                ctx.fillStyle = color;
                ctx.fillRect(-barW / 2, 16, barW * pct, 2);
            }

            // ID & Time
            ctx.fillStyle = "#94a3b8";
            ctx.font = "10px 'JetBrains Mono'";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(`#${this.id}`, 0, -24);

            if (this.status.msLeft) {
                const h = Math.floor(this.status.msLeft / 3600000);
                const m = Math.floor((this.status.msLeft % 3600000) / 60000);
                const timeStr = h > 24 ? `>${Math.floor(h / 24)}d` : `${h}h ${m}m`;
                ctx.fillStyle = "#fff";
                ctx.fillText(timeStr, 0, 26);
            }
        }

        ctx.restore();
        ctx.globalAlpha = 1;
    }
}

// --- EXPLOSION (capped) ---
function createExplosion(x, y, color, count = 8) {
    if (particles.length >= MAX_PARTICLES) return;
    const allowed = Math.min(count, MAX_PARTICLES - particles.length);
    for (let i = 0; i < allowed; i++) {
        const angle = (i / count) * Math.PI * 2;
        const speed = 2 + Math.random() * 5;
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 2,
            vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 2,
            life: 1.0,
            color,
            size: Math.random() * 2 + 0.5
        });
    }
}

const hero = new HeroEntity();

// ==========================================
// 3. MAIN APP LOGIC
// ==========================================

let lastSyncTime = null;

function fetchData() {
    if (chrome && chrome.runtime) {
        chrome.runtime.sendMessage({ action: 'getSheetData' }, (response) => {
            if (chrome.runtime.lastError || !response || response.error) {
                console.error("Extension Error:", chrome.runtime.lastError || response.error);
                return;
            }
            processData(response);
            lastSyncTime = new Date();
            updateSyncBadge();
        });
    } else {
        console.error("Chrome Runtime not found.");
    }
}

function updateSyncBadge() {
    const badge = document.getElementById('sync-badge');
    if (badge && lastSyncTime) {
        const h = String(lastSyncTime.getHours()).padStart(2, '0');
        const m = String(lastSyncTime.getMinutes()).padStart(2, '0');
        const s = String(lastSyncTime.getSeconds()).padStart(2, '0');
        badge.textContent = `SYNCED: ${h}:${m}:${s}`;
    }
}

function processData(json) {
    let stats = { active: 0, breach: 0, safe: 0, paused: 0 };
    const ids = Object.keys(json);

    ids.forEach(id => {
        const tData = json[id];
        if (seenBreaches.includes(id)) return;

        let entity = entities[id];
        const status = calculateDynamicStatus(tData);

        if (status.state === 'ACTIVE') stats.active++;
        if (status.state === 'BREACHED') stats.breach++;
        if (status.state === 'PAUSED') stats.paused++;
        if (status.state === 'GIVEN') stats.safe++;

        if (!entity) {
            if (status.state !== 'GIVEN') {
                entities[id] = new TicketEntity(id, tData);
            }
        } else {
            entity.data = tData;
        }
    });

    animateStat('count-active', stats.active);
    animateStat('count-breach', stats.breach);
    animateStat('count-safe', stats.safe);
    animateStat('count-paused', stats.paused);

    const overlay = document.getElementById('loading-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
        overlay.classList.add('hidden');
        setTimeout(() => overlay.style.display = 'none', 600);
    }
}

function animateStat(id, newVal) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = parseInt(el.innerText) || 0;
    if (current !== newVal) {
        el.innerText = newVal;
        el.style.transform = 'scale(1.3)';
        el.style.transition = 'transform 0.2s ease';
        setTimeout(() => el.style.transform = 'scale(1)', 200);
    }
}

// --- DRAW FUNCTIONS (all shadow-free) ---

function drawStarfield(ctx) {
    for (const star of stars) {
        const twinkle = Math.sin(globalTime * 0.5 + star.twinkleOffset) * 0.3 + 0.7;
        ctx.globalAlpha = star.brightness * twinkle;
        ctx.fillStyle = "#c8d6e5";
        ctx.fillRect(star.x * canvas.width, star.y * canvas.height, star.size, star.size);
    }
    ctx.globalAlpha = 1;
}

function drawDefenseLine(ctx) {
    const x = 100;

    // Subtle shield glow (gradient fill, no shadow)
    const shieldGrad = ctx.createLinearGradient(x - 12, 0, x + 12, 0);
    shieldGrad.addColorStop(0, 'transparent');
    shieldGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.04)');
    shieldGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = shieldGrad;
    ctx.fillRect(x - 12, 0, 24, canvas.height);

    // Line
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();

    // Energy nodes (every 3rd frame for perf)
    if (frameCount % 3 === 0) {
        for (let i = 0; i < 6; i++) {
            const ny = ((i / 6) * canvas.height + globalTime * 30) % canvas.height;
            ctx.globalAlpha = Math.sin(globalTime * 2 + i) * 0.3 + 0.4;
            ctx.fillStyle = "#38bdf8";
            ctx.beginPath(); ctx.arc(x, ny, 2, 0, Math.PI * 2); ctx.fill();
        }
    }
    ctx.globalAlpha = 1;

    // Label
    ctx.save();
    ctx.translate(40, canvas.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 12px 'Orbitron', 'JetBrains Mono'";
    ctx.textAlign = "center";
    ctx.fillText("BREACH DEFENSE", 0, 0);
    ctx.restore();
}

function drawTimeline(ctx) {
    const y = canvas.height - 30;
    const startX = 100;
    const endX = canvas.width - 100;
    const w = endX - startX;

    // Gradient line
    const lineGrad = ctx.createLinearGradient(startX, 0, endX, 0);
    lineGrad.addColorStop(0, "#ef4444");
    lineGrad.addColorStop(0.3, "#f59e0b");
    lineGrad.addColorStop(1, "#334155");
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(endX, y); ctx.stroke();

    ctx.fillStyle = "#64748b";
    ctx.font = "10px 'JetBrains Mono'";
    ctx.textAlign = "center";

    for (let i = 0; i <= 6; i++) {
        const x = startX + (i / 6) * w;
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke();
        ctx.fillText(`${i}h`, x, y + 16);
    }

    // NOW marker
    ctx.fillStyle = "#ef4444";
    ctx.font = "bold 10px 'Orbitron', 'JetBrains Mono'";
    ctx.fillText("NOW", startX, y - 10);

    // Pulse dot at NOW
    const nowPulse = Math.sin(globalTime * 3) * 0.3 + 0.7;
    ctx.globalAlpha = nowPulse;
    ctx.fillStyle = "#ef4444";
    ctx.beginPath(); ctx.arc(startX, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
}

// Subtle grid — only a few lines, drawn every 2nd frame
function drawGrid(ctx) {
    if (frameCount % 2 !== 0) return;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.012)";
    ctx.lineWidth = 1;
    const spacing = 120;
    for (let x = 100; x < canvas.width; x += spacing) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += spacing) {
        ctx.beginPath(); ctx.moveTo(100, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
}

// --- MAIN LOOP ---
function loop(timestamp) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;
    globalTime += dt * 0.001;
    frameCount++;

    // Background clear
    ctx.fillStyle = "#030810";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();

    // Screen shake (reduced)
    if (breachShake > 0) {
        ctx.translate((Math.random() - 0.5) * breachShake, (Math.random() - 0.5) * breachShake);
        breachShake *= 0.9;
        if (breachShake < 0.3) breachShake = 0;
    }

    // Layer 1: Background (lightweight)
    drawGrid(ctx);
    drawStarfield(ctx);

    // Layer 2: Defense line
    drawDefenseLine(ctx);

    // Layer 3: Collision (every 3rd frame for perf)
    if (frameCount % 3 === 0) resolveCollisions();

    // Layer 4: Timeline
    drawTimeline(ctx);

    // Layer 5: Turret
    hero.update(dt);
    hero.draw(ctx);

    // Layer 6: Projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
        projectiles[i].update();
        projectiles[i].draw(ctx);
        if (projectiles[i].dead) projectiles.splice(i, 1);
    }

    // Layer 7: Entities — cap total rendered to prevent freezing
    const allEntities = Object.values(entities);
    const renderLimit = Math.min(allEntities.length, 80); // NEVER draw more than 80
    for (let i = 0; i < renderLimit; i++) {
        allEntities[i].update(dt);
        allEntities[i].draw(ctx);
    }

    // Layer 8: Shockwaves
    for (let i = shockwaves.length - 1; i >= 0; i--) {
        shockwaves[i].update();
        shockwaves[i].draw(ctx);
        if (shockwaves[i].life <= 0) shockwaves.splice(i, 1);
    }

    // Layer 9: Particles (no shadowBlur!)
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.life -= 0.03;

        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0, p.size * p.life), 0, Math.PI * 2);
        ctx.fill();

        if (p.life <= 0) particles.splice(i, 1);
    }

    ctx.globalAlpha = 1;

    // Layer 10: Tooltips (simple)
    for (let i = tooltips.length - 1; i >= 0; i--) {
        const t = tooltips[i];
        t.life -= 0.025;
        t.y -= 1;
        ctx.globalAlpha = t.life;

        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.font = "bold 11px 'JetBrains Mono'";
        const tw = ctx.measureText(t.text).width + 14;
        ctx.fillRect(t.x - tw / 2, t.y - 9, tw, 18);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1;
        ctx.strokeRect(t.x - tw / 2, t.y - 9, tw, 18);

        ctx.fillStyle = "#38bdf8";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(t.text, t.x, t.y);

        if (t.life <= 0) tooltips.splice(i, 1);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
    requestAnimationFrame(loop);
}

fetchData();
setInterval(fetchData, 60000);
requestAnimationFrame(loop);

// ==========================================
// 4. UI INITIALIZATION (Clock & Loader)
// ==========================================

// === Live IST Clock ===
function updateClock() {
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000 - now.getTimezoneOffset() * 60 * 1000));
    const opts = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const formatted = ist.toLocaleDateString('en-IN', opts).toUpperCase();
    const clockEl = document.getElementById('ist-clock');
    if (clockEl) clockEl.textContent = `IST  ${formatted}`;
}
updateClock();
setInterval(updateClock, 1000);

// === Loading Animation ===
const loadStages = [
    { text: 'INITIALIZING SYSTEMS', pct: 15 },
    { text: 'CONNECTING TO EXTENSION', pct: 40 },
    { text: 'SYNCING THREAT DATA', pct: 70 },
    { text: 'DEFENSE GRID ONLINE', pct: 100 }
];
let stageIdx = 0;
const loadInterval = setInterval(() => {
    stageIdx++;
    if (stageIdx < loadStages.length) {
        const ls = document.getElementById('load-status');
        const lb = document.getElementById('load-bar');
        if (ls) ls.textContent = loadStages[stageIdx].text;
        if (lb) lb.style.width = loadStages[stageIdx].pct + '%';
    } else {
        clearInterval(loadInterval);
    }
}, 600);
