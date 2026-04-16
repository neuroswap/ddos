// ==UserScript==
// @name         NeuroHub Kour.io
// @match        *://kour.io/*
// @version      7.0.0
// @author       NeuroHub
// @description  ESP (Box/Line/Radar) + Aimbot + Crosshair - Press INSERT
// @run-at       document-end
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

    // ========== SETTINGS ==========
    let settings = {
        // ESP
        espEnabled: false,
        espStyle: "box", // box, corner, filled, line, glow
        espColor: "#ff3366",
        espOutline: true,

        // Aimbot
        aimbotEnabled: false,
        aimbotSpeed: 2.5,
        aimbotFOV: 150,
        aimbotBone: "head", // head, chest
        aimbotSmoothness: 4,
        aimbotTriggerbot: false,

        // Radar
        radarEnabled: false,
        radarSize: 150,
        radarPosition: "bottom-right", // top-left, top-right, bottom-left, bottom-right

        // Crosshair
        crosshairEnabled: false,
        crosshairType: "cross",
        crosshairColor: "#00ffcc",
        crosshairSize: 8,

        // Visual
        fovEnabled: true,
        fovRadius: 150,
        showEnemyCount: true
    };

    function saveSettings() {
        localStorage.setItem("neurohub_settings", JSON.stringify(settings));
    }

    function loadSettings() {
        try {
            const saved = localStorage.getItem("neurohub_settings");
            if (saved) Object.assign(settings, JSON.parse(saved));
        } catch(e) {}
    }
    loadSettings();

    // ========== GLOBALS ==========
    let gl = null;
    let gameCanvas = null;
    let enemies = [];
    let frameCount = 0;
    let aimbotTarget = null;

    // Enemy colors to detect (RGB values that appear on enemies)
    const enemyColors = [
        { r: 255, g: 0, b: 0 },     // Pure red nametags
        { r: 255, g: 50, b: 50 },   // Light red
        { r: 255, g: 100, b: 100 }, // Pinkish
        { r: 200, g: 0, b: 0 },     // Dark red
        { r: 255, g: 80, b: 80 },   // Salmon
    ];

    // ========== WAIT FOR GAME ==========
    function waitForGame() {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const canvas = document.getElementById('unity-canvas') || document.querySelector('canvas');
                if (canvas && canvas.width > 100) {
                    clearInterval(checkInterval);
                    console.log('[NeuroHub] Game loaded');
                    resolve(canvas);
                }
            }, 500);
            setTimeout(() => {
                clearInterval(checkInterval);
                const canvas = document.getElementById('unity-canvas') || document.querySelector('canvas');
                if (canvas) resolve(canvas);
            }, 15000);
        });
    }

    // ========== ENEMY DETECTION (PIXEL-BASED) ==========
    function detectEnemies() {
        if (!gameCanvas || !settings.espEnabled && !settings.aimbotEnabled) return [];

        try {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = gameCanvas.width;
            tempCanvas.height = gameCanvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(gameCanvas, 0, 0);
            const imageData = tempCtx.getImageData(0, 0, gameCanvas.width, gameCanvas.height);
            const data = imageData.data;

            const width = gameCanvas.width;
            const height = gameCanvas.height;
            const step = 8; // Scan every 8th pixel for performance
            const detected = [];
            const processed = new Set();

            for (let y = 0; y < height; y += step) {
                for (let x = 0; x < width; x += step) {
                    const idx = (y * width + x) * 4;
                    const r = data[idx];
                    const g = data[idx+1];
                    const b = data[idx+2];
                    const a = data[idx+3];

                    if (a < 50) continue;

                    // Check if pixel matches enemy colors
                    let isEnemy = false;
                    for (const color of enemyColors) {
                        const dr = Math.abs(r - color.r);
                        const dg = Math.abs(g - color.g);
                        const db = Math.abs(b - color.b);
                        if (dr < 60 && dg < 60 && db < 60) {
                            isEnemy = true;
                            break;
                        }
                    }

                    // Also detect bright red/pink nametags
                    if (!isEnemy && r > 180 && g < 120 && b < 120) {
                        isEnemy = true;
                    }

                    if (isEnemy) {
                        const key = `${Math.floor(x/20)},${Math.floor(y/20)}`;
                        if (processed.has(key)) continue;
                        processed.add(key);

                        // Find cluster center
                        let sumX = 0, sumY = 0, count = 0;
                        const clusterSize = 35;

                        for (let dy = -clusterSize; dy <= clusterSize; dy += 4) {
                            for (let dx = -clusterSize; dx <= clusterSize; dx += 4) {
                                const nx = x + dx;
                                const ny = y + dy;
                                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                    const nidx = (ny * width + nx) * 4;
                                    const nr = data[nidx];
                                    const ng = data[nidx+1];
                                    const nb = data[nidx+2];
                                    let match = (nr > 180 && ng < 120 && nb < 120);
                                    if (!match) {
                                        for (const color of enemyColors) {
                                            if (Math.abs(nr - color.r) < 60 && Math.abs(ng - color.g) < 60 && Math.abs(nb - color.b) < 60) {
                                                match = true;
                                                break;
                                            }
                                        }
                                    }
                                    if (match) {
                                        sumX += nx;
                                        sumY += ny;
                                        count++;
                                    }
                                }
                            }
                        }

                        if (count > 15) {
                            const enemyX = sumX / count;
                            const enemyY = sumY / count;
                            const enemyWidth = Math.sqrt(count) * 1.2;
                            const enemyHeight = Math.sqrt(count) * 2;

                            // Calculate distance (approximate - larger = closer)
                            const distance = Math.floor(3000 / Math.sqrt(count));

                            detected.push({
                                x: enemyX,
                                y: enemyY,
                                width: enemyWidth,
                                height: enemyHeight,
                                distance: Math.min(300, distance),
                                count: count
                            });
                        }
                    }
                }
            }

            // Merge close enemies
            const merged = [];
            for (const e of detected) {
                let mergedFlag = false;
                for (const m of merged) {
                    if (Math.hypot(m.x - e.x, m.y - e.y) < 60) {
                        m.x = (m.x + e.x) / 2;
                        m.y = (m.y + e.y) / 2;
                        m.width = Math.max(m.width, e.width);
                        m.height = Math.max(m.height, e.height);
                        m.distance = Math.min(m.distance, e.distance);
                        mergedFlag = true;
                        break;
                    }
                }
                if (!mergedFlag) merged.push(e);
            }

            return merged.slice(0, 12);

        } catch(e) {
            return [];
        }
    }

    // ========== ESP DRAWING ==========
    let overlayCanvas = null;
    let overlayCtx = null;

    function createOverlay() {
        if (overlayCanvas) return;

        overlayCanvas = document.createElement('canvas');
        overlayCanvas.style.position = 'fixed';
        overlayCanvas.style.top = '0';
        overlayCanvas.style.left = '0';
        overlayCanvas.style.width = '100%';
        overlayCanvas.style.height = '100%';
        overlayCanvas.style.pointerEvents = 'none';
        overlayCanvas.style.zIndex = '9998';
        document.body.appendChild(overlayCanvas);
        overlayCtx = overlayCanvas.getContext('2d');

        function resize() {
            overlayCanvas.width = window.innerWidth;
            overlayCanvas.height = window.innerHeight;
        }

        window.addEventListener('resize', resize);
        resize();
    }

    function drawESP(enemies) {
        if (!overlayCtx || !settings.espEnabled) return;

        const cx = overlayCanvas.width / 2;
        const cy = overlayCanvas.height / 2;

        for (const enemy of enemies) {
            // Get screen position (enemy is already in canvas coords, need to map to screen)
            const scaleX = overlayCanvas.width / gameCanvas.width;
            const scaleY = overlayCanvas.height / gameCanvas.height;
            const screenX = enemy.x * scaleX;
            const screenY = enemy.y * scaleY;
            const boxW = enemy.width * scaleX;
            const boxH = enemy.height * scaleY;

            // Draw line to enemy
            if (settings.espStyle === 'line' || settings.espStyle === 'glow') {
                overlayCtx.beginPath();
                overlayCtx.moveTo(cx, cy);
                overlayCtx.lineTo(screenX, screenY);
                overlayCtx.strokeStyle = settings.espColor;
                overlayCtx.lineWidth = 1.5;
                overlayCtx.stroke();
            }

            // Draw box
            if (settings.espStyle === 'box' || settings.espStyle === 'glow') {
                overlayCtx.strokeStyle = settings.espColor;
                overlayCtx.lineWidth = 2;
                overlayCtx.strokeRect(screenX - boxW/2, screenY - boxH, boxW, boxH);
            }

            // Corner box
            if (settings.espStyle === 'corner') {
                const cornerLen = 12;
                overlayCtx.strokeStyle = settings.espColor;
                overlayCtx.lineWidth = 2;
                // Top-left
                overlayCtx.beginPath();
                overlayCtx.moveTo(screenX - boxW/2, screenY - boxH + cornerLen);
                overlayCtx.lineTo(screenX - boxW/2, screenY - boxH);
                overlayCtx.lineTo(screenX - boxW/2 + cornerLen, screenY - boxH);
                overlayCtx.stroke();
                // Top-right
                overlayCtx.beginPath();
                overlayCtx.moveTo(screenX + boxW/2 - cornerLen, screenY - boxH);
                overlayCtx.lineTo(screenX + boxW/2, screenY - boxH);
                overlayCtx.lineTo(screenX + boxW/2, screenY - boxH + cornerLen);
                overlayCtx.stroke();
                // Bottom-left
                overlayCtx.beginPath();
                overlayCtx.moveTo(screenX - boxW/2, screenY + boxH - cornerLen);
                overlayCtx.lineTo(screenX - boxW/2, screenY + boxH);
                overlayCtx.lineTo(screenX - boxW/2 + cornerLen, screenY + boxH);
                overlayCtx.stroke();
                // Bottom-right
                overlayCtx.beginPath();
                overlayCtx.moveTo(screenX + boxW/2 - cornerLen, screenY + boxH);
                overlayCtx.lineTo(screenX + boxW/2, screenY + boxH);
                overlayCtx.lineTo(screenX + boxW/2, screenY + boxH - cornerLen);
                overlayCtx.stroke();
            }

            // Filled box
            if (settings.espStyle === 'filled') {
                overlayCtx.fillStyle = settings.espColor + '30';
                overlayCtx.fillRect(screenX - boxW/2, screenY - boxH, boxW, boxH);
                overlayCtx.strokeStyle = settings.espColor;
                overlayCtx.lineWidth = 1;
                overlayCtx.strokeRect(screenX - boxW/2, screenY - boxH, boxW, boxH);
            }

            // Distance text
            overlayCtx.font = 'bold 11px "Segoe UI"';
            overlayCtx.fillStyle = '#ffffff';
            overlayCtx.shadowBlur = 3;
            overlayCtx.shadowColor = 'black';
            overlayCtx.fillText(`${enemy.distance}m`, screenX - 15, screenY - boxH - 5);
            overlayCtx.shadowBlur = 0;
        }

        // Draw FOV circle
        if (settings.fovEnabled) {
            overlayCtx.beginPath();
            const fovScale = (settings.fovRadius / gameCanvas.width) * overlayCanvas.width;
            overlayCtx.arc(cx, cy, fovScale, 0, Math.PI * 2);
            overlayCtx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
            overlayCtx.lineWidth = 1.5;
            overlayCtx.setLineDash([5, 8]);
            overlayCtx.stroke();
            overlayCtx.setLineDash([]);
        }

        // Enemy count
        if (settings.showEnemyCount && enemies.length > 0) {
            overlayCtx.font = 'bold 14px "Segoe UI"';
            overlayCtx.fillStyle = settings.espColor;
            overlayCtx.shadowBlur = 0;
            overlayCtx.fillText(`Enemies: ${enemies.length}`, 15, 40);
        }
    }

    // ========== RADAR ==========
    let radarCanvas = null;
    let radarCtx = null;

    function createRadar() {
        if (radarCanvas) return;

        radarCanvas = document.createElement('canvas');
        radarCanvas.style.position = 'fixed';
        radarCanvas.style.pointerEvents = 'none';
        radarCanvas.style.zIndex = '9999';
        radarCanvas.style.width = `${settings.radarSize}px`;
        radarCanvas.style.height = `${settings.radarSize}px`;

        // Position
        const padding = 15;
        switch(settings.radarPosition) {
            case 'top-left':
                radarCanvas.style.top = `${padding}px`;
                radarCanvas.style.left = `${padding}px`;
                break;
            case 'top-right':
                radarCanvas.style.top = `${padding}px`;
                radarCanvas.style.right = `${padding}px`;
                break;
            case 'bottom-left':
                radarCanvas.style.bottom = `${padding}px`;
                radarCanvas.style.left = `${padding}px`;
                break;
            case 'bottom-right':
                radarCanvas.style.bottom = `${padding}px`;
                radarCanvas.style.right = `${padding}px`;
                break;
        }

        radarCanvas.width = settings.radarSize;
        radarCanvas.height = settings.radarSize;
        document.body.appendChild(radarCanvas);
        radarCtx = radarCanvas.getContext('2d');
    }

    function drawRadar(enemies) {
        if (!radarCtx || !settings.radarEnabled) return;

        radarCtx.clearRect(0, 0, settings.radarSize, settings.radarSize);

        // Background
        radarCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        radarCtx.fillRect(0, 0, settings.radarSize, settings.radarSize);

        // Border
        radarCtx.strokeStyle = '#333';
        radarCtx.lineWidth = 2;
        radarCtx.strokeRect(0, 0, settings.radarSize, settings.radarSize);

        // Center crosshair
        const center = settings.radarSize / 2;
        radarCtx.beginPath();
        radarCtx.moveTo(center - 5, center);
        radarCtx.lineTo(center + 5, center);
        radarCtx.moveTo(center, center - 5);
        radarCtx.lineTo(center, center + 5);
        radarCtx.strokeStyle = '#fff';
        radarCtx.stroke();

        // Draw radar circle
        radarCtx.beginPath();
        radarCtx.arc(center, center, settings.radarSize/2 - 10, 0, Math.PI * 2);
        radarCtx.strokeStyle = '#555';
        radarCtx.stroke();

        // Draw enemies on radar
        for (const enemy of enemies) {
            // Calculate radar position (simplified - based on screen position)
            const maxDist = 500;
            const dist = Math.min(enemy.distance, maxDist);
            const radarDist = (dist / maxDist) * (settings.radarSize/2 - 15);

            // Get angle from screen center
            const screenCenterX = overlayCanvas.width / 2;
            const screenCenterY = overlayCanvas.height / 2;
            const dx = (enemy.x * (overlayCanvas.width/gameCanvas.width)) - screenCenterX;
            const dy = (enemy.y * (overlayCanvas.height/gameCanvas.height)) - screenCenterY;
            const angle = Math.atan2(dy, dx);

            const radarX = center + Math.cos(angle) * radarDist;
            const radarY = center + Math.sin(angle) * radarDist;

            radarCtx.beginPath();
            radarCtx.arc(radarX, radarY, 3, 0, Math.PI * 2);
            radarCtx.fillStyle = settings.espColor;
            radarCtx.fill();
        }

        // Title
        radarCtx.font = 'bold 10px "Segoe UI"';
        radarCtx.fillStyle = '#fff';
        radarCtx.fillText('RADAR', 8, 15);
    }

    // ========== CROSSHAIR ==========
    function drawCrosshair() {
        if (!overlayCtx || !settings.crosshairEnabled) return;

        const cx = overlayCanvas.width / 2;
        const cy = overlayCanvas.height / 2;
        const size = settings.crosshairSize;

        overlayCtx.beginPath();
        overlayCtx.strokeStyle = settings.crosshairColor;
        overlayCtx.fillStyle = settings.crosshairColor;
        overlayCtx.lineWidth = 2;
        overlayCtx.lineCap = 'round';

        if (settings.crosshairType === 'dot') {
            overlayCtx.beginPath();
            overlayCtx.arc(cx, cy, 3, 0, Math.PI * 2);
            overlayCtx.fill();
        }
        else if (settings.crosshairType === 'cross') {
            overlayCtx.beginPath();
            overlayCtx.moveTo(cx, cy - size);
            overlayCtx.lineTo(cx, cy + size);
            overlayCtx.moveTo(cx - size, cy);
            overlayCtx.lineTo(cx + size, cy);
            overlayCtx.stroke();
        }
        else if (settings.crosshairType === 'circle') {
            overlayCtx.beginPath();
            overlayCtx.arc(cx, cy, size, 0, Math.PI * 2);
            overlayCtx.stroke();
        }
    }

    // ========== AIMBOT (WORKING) ==========
    let mouseButtons = { left: false, right: false };
    let currentTarget = null;

    document.addEventListener("mousedown", (e) => {
        if (e.button === 0) mouseButtons.left = true;
        if (e.button === 2) mouseButtons.right = true;
    });
    document.addEventListener("mouseup", (e) => {
        if (e.button === 0) mouseButtons.left = false;
        if (e.button === 2) mouseButtons.right = false;
    });

    function findBestTarget(enemies) {
        if (!enemies.length) return null;

        const centerX = gameCanvas.width / 2;
        const centerY = gameCanvas.height / 2;
        let bestTarget = null;
        let bestScore = Infinity;

        for (const enemy of enemies) {
            const dx = enemy.x - centerX;
            const dy = enemy.y - centerY;
            const dist = Math.hypot(dx, dy);

            // Adjust target based on bone selection
            let targetY = enemy.y;
            if (settings.aimbotBone === 'head') {
                targetY = enemy.y - enemy.height / 2;
            }

            const targetDx = enemy.x - centerX;
            const targetDy = targetY - centerY;
            const targetDist = Math.hypot(targetDx, targetDy);

            if (targetDist < bestScore && targetDist < settings.aimbotFOV) {
                bestScore = targetDist;
                bestTarget = { ...enemy, aimX: enemy.x, aimY: targetY };
            }
        }

        return bestTarget;
    }

    function updateAimbot(enemies) {
        if (!settings.aimbotEnabled || !gameCanvas) return;

        // Triggerbot - auto shoot when on target
        if (settings.aimbotTriggerbot && currentTarget) {
            const centerX = gameCanvas.width / 2;
            const centerY = gameCanvas.height / 2;
            const dx = currentTarget.aimX - centerX;
            const dy = currentTarget.aimY - centerY;
            if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
                // Auto shoot
                const shootEvent = new MouseEvent('mousedown', { button: 0, bubbles: true });
                gameCanvas.dispatchEvent(shootEvent);
                setTimeout(() => {
                    const shootUpEvent = new MouseEvent('mouseup', { button: 0, bubbles: true });
                    gameCanvas.dispatchEvent(shootUpEvent);
                }, 50);
            }
        }

        // Only aim when mouse button is pressed
        if (!mouseButtons.left && !mouseButtons.right) {
            currentTarget = null;
            return;
        }

        const target = findBestTarget(enemies);
        if (!target) {
            currentTarget = null;
            return;
        }

        currentTarget = target;

        const centerX = gameCanvas.width / 2;
        const centerY = gameCanvas.height / 2;
        let dx = target.aimX - centerX;
        let dy = target.aimY - centerY;

        // Apply smoothing
        if (settings.aimbotSmoothness > 1) {
            dx /= settings.aimbotSmoothness;
            dy /= settings.aimbotSmoothness;
        }

        // Apply speed multiplier
        dx *= settings.aimbotSpeed;
        dy *= settings.aimbotSpeed;

        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            // Dispatch mouse movement
            const moveEvent = new MouseEvent('mousemove', {
                movementX: dx,
                movementY: dy,
                clientX: (centerX + dx) * (overlayCanvas.width / gameCanvas.width),
                clientY: (centerY + dy) * (overlayCanvas.height / gameCanvas.height),
                bubbles: true
            });
            gameCanvas.dispatchEvent(moveEvent);

            // Also try to move via Unity instance if available
            if (window.unityInstance) {
                try {
                    window.unityInstance.SendMessage('MainManager', 'MouseMove', `${dx},${dy}`);
                } catch(e) {}
            }
        }
    }

    // ========== ANIMATED STARS BACKGROUND ==========
    function createStarsBackground() {
        const starsCanvas = document.createElement('canvas');
        starsCanvas.style.position = 'fixed';
        starsCanvas.style.top = '0';
        starsCanvas.style.left = '0';
        starsCanvas.style.width = '100%';
        starsCanvas.style.height = '100%';
        starsCanvas.style.pointerEvents = 'none';
        starsCanvas.style.zIndex = '9997';
        document.body.appendChild(starsCanvas);
        const starsCtx = starsCanvas.getContext('2d');

        let stars = [];
        const STAR_COUNT = 80;

        function resizeStars() {
            starsCanvas.width = window.innerWidth;
            starsCanvas.height = window.innerHeight;
            initStars();
        }

        function initStars() {
            stars = [];
            for (let i = 0; i < STAR_COUNT; i++) {
                stars.push({
                    x: Math.random() * starsCanvas.width,
                    y: Math.random() * starsCanvas.height,
                    size: Math.random() * 3 + 1,
                    speed: Math.random() * 2 + 0.5,
                    opacity: Math.random() * 0.6 + 0.2
                });
            }
        }

        function animateStars() {
            if (!starsCanvas.parentNode) return;
            starsCtx.clearRect(0, 0, starsCanvas.width, starsCanvas.height);

            for (let star of stars) {
                star.y += star.speed;
                if (star.y > starsCanvas.height) {
                    star.y = 0;
                    star.x = Math.random() * starsCanvas.width;
                }
                starsCtx.beginPath();
                starsCtx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
                starsCtx.fillStyle = `rgba(0, 0, 0, ${star.opacity})`;
                starsCtx.fill();
            }
            requestAnimationFrame(animateStars);
        }

        window.addEventListener('resize', resizeStars);
        resizeStars();
        animateStars();
    }

    // ========== MAIN RENDER LOOP ==========
    function startRenderLoop() {
        function render() {
            if (gameCanvas && overlayCanvas) {
                // Detect enemies
                const detectedEnemies = detectEnemies();
                enemies = detectedEnemies;

                // Draw everything
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                drawESP(enemies);
                drawCrosshair();
                drawRadar(enemies);

                // Update aimbot
                updateAimbot(enemies);
            }
            requestAnimationFrame(render);
        }
        render();
    }

    // ========== MENU ==========
    let menuOpen = false;
    let menu = null;

    function createMenu() {
        if (menu) return menu;

        const menuHTML = `
            <div id="neurohub-menu" style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 420px;
                max-height: 85vh;
                overflow-y: auto;
                background: white;
                border-radius: 16px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.3);
                z-index: 10000;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                display: none;
            ">
                <div style="background: white; padding: 20px; text-align: center; border-bottom: 2px solid #f0f0f0;">
                    <h2 style="margin: 0; color: #000; font-size: 28px;">NEUROHUB</h2>
                    <p style="margin: 5px 0 0; color: #666; font-size: 12px;">KOUR.IO COMPLETE MENU</p>
                </div>

                <div style="display: flex; border-bottom: 1px solid #e0e0e0; background: #fafafa; flex-wrap: wrap;">
                    <button id="tab-esp" style="flex:1; padding:12px; border:none; background:white; color:#000; font-weight:bold; cursor:pointer;">ESP</button>
                    <button id="tab-aimbot" style="flex:1; padding:12px; border:none; background:#fafafa; color:#888; cursor:pointer;">AIMBOT</button>
                    <button id="tab-radar" style="flex:1; padding:12px; border:none; background:#fafafa; color:#888; cursor:pointer;">RADAR</button>
                    <button id="tab-crosshair" style="flex:1; padding:12px; border:none; background:#fafafa; color:#888; cursor:pointer;">CROSSHAIR</button>
                </div>

                <!-- ESP TAB -->
                <div id="esp-content" style="padding:20px;">
                    <div style="margin-bottom:15px;">
                        <label style="display:flex; justify-content:space-between;">
                            <span>Enable ESP</span>
                            <input type="checkbox" id="esp-enabled" ${settings.espEnabled ? 'checked' : ''}>
                        </label>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label>ESP Style</label>
                        <select id="esp-style" style="width:100%; padding:8px; margin-top:5px; border-radius:8px;">
                            <option value="box" ${settings.espStyle === 'box' ? 'selected' : ''}>Box</option>
                            <option value="corner" ${settings.espStyle === 'corner' ? 'selected' : ''}>Corner Box</option>
                            <option value="filled" ${settings.espStyle === 'filled' ? 'selected' : ''}>Filled Box</option>
                            <option value="line" ${settings.espStyle === 'line' ? 'selected' : ''}>Line to Enemy</option>
                            <option value="glow" ${settings.espStyle === 'glow' ? 'selected' : ''}>Glow + Line</option>
                        </select>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label>ESP Color</label>
                        <input type="color" id="esp-color" value="${settings.espColor}" style="width:100%; margin-top:5px;">
                    </div>
                    <div>
                        <label style="display:flex; justify-content:space-between;">
                            <span>Show Enemy Count</span>
                            <input type="checkbox" id="show-count" ${settings.showEnemyCount ? 'checked' : ''}>
                        </label>
                    </div>
                </div>

                <!-- AIMBOT TAB -->
                <div id="aimbot-content" style="padding:20px; display:none;">
                    <div style="margin-bottom:15px;">
                        <label style="display:flex; justify-content:space-between;">
                            <span>Enable Aimbot</span>
                            <input type="checkbox" id="aimbot-enabled" ${settings.aimbotEnabled ? 'checked' : ''}>
                        </label>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label>Aimbot Speed: <span id="speed-val">${settings.aimbotSpeed}</span></label>
                        <input type="range" id="aimbot-speed" min="1" max="5" step="0.2" value="${settings.aimbotSpeed}" style="width:100%;">
                    </div>
                    <div style="margin-bottom:15px;">
                        <label>Smoothness: <span id="smooth-val">${settings.aimbotSmoothness}</span></label>
                        <input type="range" id="aimbot-smooth" min="1" max="10" step="1" value="${settings.aimbotSmoothness}" style="width:100%;">
                    </div>
                    <div style="margin-bottom:15px;">
                        <label>Aimbot FOV: <span id="fov-val">${settings.aimbotFOV}</span></label>
                        <input type="range" id="aimbot-fov" min="50" max="300" step="10" value="${settings.aimbotFOV}" style="width:100%;">
                    </div>
                    <div style="margin-bottom:15px;">
                        <label>Target Bone</label>
                        <select id="aimbot-bone" style="width:100%; padding:8px; margin-top:5px;">
                            <option value="head" ${settings.aimbotBone === 'head' ? 'selected' : ''}>Head</option>
                            <option value="chest" ${settings.aimbotBone === 'chest' ? 'selected' : ''}>Chest</option>
                        </select>
                    </div>
                    <div>
                        <label style="display:flex; justify-content:space-between;">
                            <span>Triggerbot (Auto-shoot)</span>
                            <input type="checkbox" id="triggerbot" ${settings.aimbotTriggerbot ? 'checked' : ''}>
                        </label>
                    </div>
                    <div style="margin-top:15px;">
                        <label style="display:flex; justify-content:space-between;">
                            <span>Show FOV Circle</span>
                            <input type="checkbox" id="fov-enabled" ${settings.fovEnabled ? 'checked' : ''}>
                        </label>
                    </div>
                </div>

                <!-- RADAR TAB -->
                <div id="radar-content" style="padding:20px; display:none;">
                    <div style="margin-bottom:15px;">
                        <label style="display:flex; justify-content:space-between;">
                            <span>Enable Radar</span>
                            <input type="checkbox" id="radar-enabled" ${settings.radarEnabled ? 'checked' : ''}>
                        </label>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label>Radar Size: <span id="radar-size-val">${settings.radarSize}</span></label>
                        <input type="range" id="radar-size" min="100" max="250" step="10" value="${settings.radarSize}" style="width:100%;">
                    </div>
                    <div>
                        <label>Radar Position</label>
                        <select id="radar-position" style="width:100%; padding:8px; margin-top:5px;">
                            <option value="top-left" ${settings.radarPosition === 'top-left' ? 'selected' : ''}>Top Left</option>
                            <option value="top-right" ${settings.radarPosition === 'top-right' ? 'selected' : ''}>Top Right</option>
                            <option value="bottom-left" ${settings.radarPosition === 'bottom-left' ? 'selected' : ''}>Bottom Left</option>
                            <option value="bottom-right" ${settings.radarPosition === 'bottom-right' ? 'selected' : ''}>Bottom Right</option>
                        </select>
                    </div>
                </div>

                <!-- CROSSHAIR TAB -->
                <div id="crosshair-content" style="padding:20px; display:none;">
                    <div style="margin-bottom:15px;">
                        <label style="display:flex; justify-content:space-between;">
                            <span>Enable Crosshair</span>
                            <input type="checkbox" id="ch-enabled" ${settings.crosshairEnabled ? 'checked' : ''}>
                        </label>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label>Crosshair Type</label>
                        <select id="ch-type" style="width:100%; padding:8px; margin-top:5px;">
                            <option value="dot" ${settings.crosshairType === 'dot' ? 'selected' : ''}>Dot</option>
                            <option value="cross" ${settings.crosshairType === 'cross' ? 'selected' : ''}>Cross</option>
                            <option value="circle" ${settings.crosshairType === 'circle' ? 'selected' : ''}>Circle</option>
                        </select>
                    </div>
                    <div style="margin-bottom:15px;">
                        <label>Crosshair Color</label>
                        <input type="color" id="ch-color" value="${settings.crosshairColor}" style="width:100%; margin-top:5px;">
                    </div>
                    <div>
                        <label>Size: <span id="ch-size-val">${settings.crosshairSize}</span></label>
                        <input type="range" id="ch-size" min="4" max="20" value="${settings.crosshairSize}" style="width:100%;">
                    </div>
                </div>

                <div style="padding:12px; text-align:center; border-top:1px solid #e0e0e0; background:#fafafa;">
                    <span style="font-size:11px; color:#999;">Press INSERT to close | NeuroHub</span>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', menuHTML);
        menu = document.getElementById('neurohub-menu');

        // Tab switching
        const tabs = {
            esp: { btn: 'tab-esp', content: 'esp-content' },
            aimbot: { btn: 'tab-aimbot', content: 'aimbot-content' },
            radar: { btn: 'tab-radar', content: 'radar-content' },
            crosshair: { btn: 'tab-crosshair', content: 'crosshair-content' }
        };

        function switchTab(tab) {
            Object.keys(tabs).forEach(t => {
                const btn = document.getElementById(tabs[t].btn);
                const content = document.getElementById(tabs[t].content);
                if (t === tab) {
                    btn.style.background = 'white';
                    btn.style.color = '#000';
                    btn.style.fontWeight = 'bold';
                    content.style.display = 'block';
                } else {
                    btn.style.background = '#fafafa';
                    btn.style.color = '#888';
                    btn.style.fontWeight = 'normal';
                    content.style.display = 'none';
                }
            });
        }

        document.getElementById('tab-esp').onclick = () => switchTab('esp');
        document.getElementById('tab-aimbot').onclick = () => switchTab('aimbot');
        document.getElementById('tab-radar').onclick = () => switchTab('radar');
        document.getElementById('tab-crosshair').onclick = () => switchTab('crosshair');

        // ESP listeners
        document.getElementById('esp-enabled').onchange = (e) => { settings.espEnabled = e.target.checked; saveSettings(); };
        document.getElementById('esp-style').onchange = (e) => { settings.espStyle = e.target.value; saveSettings(); };
        document.getElementById('esp-color').onchange = (e) => { settings.espColor = e.target.value; saveSettings(); };
        document.getElementById('show-count').onchange = (e) => { settings.showEnemyCount = e.target.checked; saveSettings(); };

        // Aimbot listeners
        document.getElementById('aimbot-enabled').onchange = (e) => { settings.aimbotEnabled = e.target.checked; saveSettings(); };
        document.getElementById('aimbot-speed').oninput = (e) => { settings.aimbotSpeed = parseFloat(e.target.value); document.getElementById('speed-val').innerText = settings.aimbotSpeed; saveSettings(); };
        document.getElementById('aimbot-smooth').oninput = (e) => { settings.aimbotSmoothness = parseInt(e.target.value); document.getElementById('smooth-val').innerText = settings.aimbotSmoothness; saveSettings(); };
        document.getElementById('aimbot-fov').oninput = (e) => { settings.aimbotFOV = parseInt(e.target.value); document.getElementById('fov-val').innerText = settings.aimbotFOV; saveSettings(); };
        document.getElementById('aimbot-bone').onchange = (e) => { settings.aimbotBone = e.target.value; saveSettings(); };
        document.getElementById('triggerbot').onchange = (e) => { settings.aimbotTriggerbot = e.target.checked; saveSettings(); };
        document.getElementById('fov-enabled').onchange = (e) => { settings.fovEnabled = e.target.checked; saveSettings(); };

        // Radar listeners
        document.getElementById('radar-enabled').onchange = (e) => { settings.radarEnabled = e.target.checked; if(settings.radarEnabled) createRadar(); saveSettings(); };
        document.getElementById('radar-size').oninput = (e) => { settings.radarSize = parseInt(e.target.value); document.getElementById('radar-size-val').innerText = settings.radarSize; if(radarCanvas) radarCanvas.remove(); createRadar(); saveSettings(); };
        document.getElementById('radar-position').onchange = (e) => { settings.radarPosition = e.target.value; if(radarCanvas) radarCanvas.remove(); createRadar(); saveSettings(); };

        // Crosshair listeners
        document.getElementById('ch-enabled').onchange = (e) => { settings.crosshairEnabled = e.target.checked; saveSettings(); };
        document.getElementById('ch-type').onchange = (e) => { settings.crosshairType = e.target.value; saveSettings(); };
        document.getElementById('ch-color').onchange = (e) => { settings.crosshairColor = e.target.value; saveSettings(); };
        document.getElementById('ch-size').oninput = (e) => { settings.crosshairSize = parseInt(e.target.value); document.getElementById('ch-size-val').innerText = settings.crosshairSize; saveSettings(); };

        return menu;
    }

    // ========== INIT ==========
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Insert') {
            e.preventDefault();
            if (!menu) menu = createMenu();
            menuOpen = !menuOpen;
            menu.style.display = menuOpen ? 'block' : 'none';
        }
    });

    waitForGame().then((canvas) => {
        gameCanvas = canvas;
        createOverlay();
        createStarsBackground();
        startRenderLoop();
        console.log('[NeuroHub] Ready! Press INSERT to open menu.');
    });

})();
