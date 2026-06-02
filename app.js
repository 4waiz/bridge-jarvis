const CONFIG = {
    cameraSize: { width: 1280, height: 720 },
    globe: {
        radius: 1.2,
        segments: 32,
        color: 0x00f3ff,
        position: { x: 0, y: 0, z: 0 }
    },
    maxLogEntries: 15,
    handOverlay: {
        connectorColor: '#00e5ff',
        landmarkColor: '#ffffff',
        pinchColor: '#ffaa00',
        lineWidth: 2
    }
};

const state = {
    face: { detected: false },
    hands: {
        detected: false,
        pinching: false,
        count: 0,
        summary: 'NO_HANDS',
        lastGesture: 'WAITING_FOR_USER'
    },
    voice: {
        listening: false,
        speaking: false,
        thinking: false,
        wakeArmed: true,
        manualStop: false,
        wakeActive: false,
        wakeTimer: null
    },
    smoothFaceX: 0,
    smoothFaceY: 0,
    targetRotationX: 0,
    targetRotationY: 0,
    targetScale: 1
};

const dom = {};
const graphData = new Array(60).fill(50);

let scene;
let camera;
let renderer;
let globeMesh;
let globeMaterial;
let faceMesh;

const GLOBE_COLOR_CYCLE = [0x00f3ff, 0xffffff, 0xff8800, 0x888888];
let globeColorIndex = 0;
const blinkState = { closed: false, lastToggle: 0 };
let hands;
let recognition;
let activeAudio;

function initIntro() {
    const overlay = document.getElementById('intro');
    if (!overlay) return;

    let dismissed = false;
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        overlay.classList.add('is-hiding');
        setTimeout(() => overlay.classList.add('is-hidden'), 750);
    };

    let spoke = false;
    const speakIntro = () => {
        if (spoke) return;
        spoke = true;
        if (!('speechSynthesis' in window)) return;
        try {
            window.speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance('Systems online, Sir.');
            utter.rate = 1.05;
            utter.pitch = 0.95;
            utter.lang = 'en-GB';
            window.speechSynthesis.speak(utter);
        } catch (_) {}
    };

    speakIntro();

    overlay.addEventListener('click', () => {
        speakIntro();
        dismiss();
    });
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            speakIntro();
            dismiss();
        }
    });

    setTimeout(dismiss, 3000);
}

function cacheDom() {
    dom.video = document.getElementById('input_video');
    dom.canvas = document.getElementById('output_canvas');
    dom.handCanvas = document.getElementById('hand_canvas');
    dom.handCtx = dom.handCanvas.getContext('2d');
    dom.snapshotCanvas = document.getElementById('snapshot_canvas');
    dom.clock = document.getElementById('clock');
    dom.terminalLog = document.getElementById('terminal-log');
    dom.loadingOverlay = document.getElementById('loading');
    dom.reactorGraph = document.getElementById('reactor-graph');
    dom.reactorOutput = document.getElementById('reactor-output');
    dom.reactorTemp = document.getElementById('reactor-temp');
    dom.reactorCapacity = document.getElementById('reactor-capacity');
    dom.reactorCapacityValue = document.getElementById('reactor-capacity-val');
    dom.cpuValue = document.getElementById('cpu-val');
    dom.cpuBar = document.getElementById('cpu-bar');
    dom.bioValue = document.getElementById('bio-val');
    dom.bioBar = document.getElementById('bio-bar');
    dom.faceTracker = document.getElementById('face-tracker-ui');
    dom.voiceToggle = document.getElementById('voice-toggle');
    dom.voiceStatus = document.getElementById('voice-status');
    dom.voiceTranscript = document.getElementById('voice-transcript');
    dom.jarvisResponse = document.getElementById('jarvis-response');
    dom.jarvisOrb = document.getElementById('jarvis-orb');
}

function updateOrbState() {
    if (!dom.jarvisOrb) return;
    let next = 'idle';
    if (state.voice.speaking) next = 'speaking';
    else if (state.voice.thinking) next = 'thinking';
    else if (state.voice.wakeActive) next = 'wake';
    else if (state.voice.listening) next = 'listening';
    if (dom.jarvisOrb.dataset.state !== next) {
        dom.jarvisOrb.dataset.state = next;
    }
}

function init() {
    cacheDom();
    initIntro();
    addLogEntry('INITIALIZING CORE SYSTEMS...');
    initThree();
    initMediaPipe();
    initVoice();
    startCamera();
    startClock();
    simulateMetrics();
    startFakeLogStream();
    updateReactorCard();

    setTimeout(() => {
        if (dom.loadingOverlay) dom.loadingOverlay.style.display = 'none';
        addLogEntry('HUD INTERFACE: ONLINE');
        setVoiceStatus('STANDBY');
    }, 2500);
}

function startClock() {
    setInterval(() => {
        const now = new Date();
        dom.clock.textContent = `${now.toLocaleTimeString()} | T-MINUS`;
    }, 1000);
}

function simulateMetrics() {
    setInterval(() => {
        const cpu = Math.floor(Math.random() * 30) + 30;
        const bpm = Math.floor(Math.random() * 20) + 70;

        dom.cpuValue.textContent = `${cpu}%`;
        dom.cpuBar.style.width = `${cpu}%`;

        dom.bioValue.textContent = `${bpm} BPM`;
        dom.bioBar.style.width = `${Math.max(0, bpm - 40)}%`;
    }, 900);
}

function startFakeLogStream() {
    const messages = [
        'Scanning environment...',
        'Calibrating sensors...',
        'Neural net synced.',
        'Updating holographic projection...',
        'Thermal signature stable.',
        'Processing spatial data...',
        'Background radiation normal.',
        'Optimizing power distribution...',
        'Hand landmark solver active.',
        'Camera context buffer refreshed.'
    ];

    setInterval(() => {
        if (Math.random() > 0.65) {
            const msg = messages[Math.floor(Math.random() * messages.length)];
            addLogEntry(msg);
        }
    }, 1500);
}

function updateReactorCard() {
    let output = 100 + (Math.random() * 5 - 2.5);
    output = Math.min(110, Math.max(90, output));
    dom.reactorOutput.textContent = `${output.toFixed(1)}%`;

    const temp = 3200 + (Math.random() * 50 - 25);
    dom.reactorTemp.textContent = `${Math.round(temp)} K`;

    let capacity = 95 + (Math.random() * 2 - 1);
    capacity = Math.min(100, Math.max(90, capacity));
    dom.reactorCapacity.style.height = `${capacity}%`;
    dom.reactorCapacityValue.textContent = `${Math.round(capacity)}%`;

    graphData.shift();
    graphData.push(output - 50);
    renderReactorGraph();

    updateOrbState();

    requestAnimationFrame(updateReactorCard);
}

function renderReactorGraph() {
    dom.reactorGraph.innerHTML = '';

    for (let i = 0; i < graphData.length - 1; i++) {
        const x1 = (i / (graphData.length - 1)) * 100;
        const y1 = graphData[i];
        const x2 = ((i + 1) / (graphData.length - 1)) * 100;
        const y2 = graphData[i + 1];

        const line = document.createElement('div');
        line.className = 'graph-line';
        line.style.left = `${x1}%`;
        line.style.bottom = `${y1}%`;

        const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        line.style.width = `${length}%`;

        const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
        line.style.transform = `rotate(${-angle}deg)`;
        dom.reactorGraph.appendChild(line);
    }
}

function addLogEntry(message, type = 'sys') {
    if (!dom.terminalLog) return;

    const entry = document.createElement('div');
    entry.className = `log-entry log-entry--${type}`;
    const timestamp = new Date().toLocaleTimeString([], { hour12: false });
    entry.textContent = `[${timestamp}] > ${message}`;

    dom.terminalLog.prepend(entry);

    while (dom.terminalLog.children.length > CONFIG.maxLogEntries) {
        dom.terminalLog.removeChild(dom.terminalLog.lastChild);
    }
}

function initThree() {
    scene = new THREE.Scene();
    addLogEntry('THREE.JS ENGINE: STARTED');

    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const pointLight = new THREE.PointLight(0x00f3ff, 1);
    pointLight.position.set(5, 5, 5);
    scene.add(pointLight);

    const globeGeometry = new THREE.IcosahedronGeometry(CONFIG.globe.radius, 2);
    globeMaterial = new THREE.MeshBasicMaterial({
        color: CONFIG.globe.color,
        wireframe: true,
        transparent: true,
        opacity: 0.3
    });
    globeMesh = new THREE.Mesh(globeGeometry, globeMaterial);

    const coreGeometry = new THREE.IcosahedronGeometry(CONFIG.globe.radius * 0.95, 2);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: 0x001133, transparent: true, opacity: 0.8 });
    globeMesh.add(new THREE.Mesh(coreGeometry, coreMaterial));

    globeMesh.position.set(
        CONFIG.globe.position.x,
        CONFIG.globe.position.y,
        CONFIG.globe.position.z
    );
    scene.add(globeMesh);
    addLogEntry('HOLOGRAPHIC GLOBE: PROJECTED');

    createLocationMarkers();
    window.addEventListener('resize', handleResize);
    animateThree();
}

function createLocationMarkers() {
    const markerGeometry = new THREE.SphereGeometry(0.05, 8, 8);
    const locations = [
        { name: 'AVENGERS HQ (NY)', lat: 41.505, lon: -73.9, color: 0x00ff00 },
        { name: 'WAKANDA MONITORS', lat: 2.0, lon: 30.0, color: 0xffaa00 },
        { name: 'ENERGY SURGE (0259-S)', lat: -45.0, lon: 160.0, color: 0xff00ff },
        { name: 'USER ACTUAL (BDG)', lat: -6.9175, lon: 107.6191, color: 0x00f3ff }
    ];

    locations.forEach((loc) => {
        const material = new THREE.MeshBasicMaterial({ color: loc.color });
        const marker = new THREE.Mesh(markerGeometry, material);
        const phi = (90 - loc.lat) * (Math.PI / 180);
        const theta = (loc.lon + 180) * (Math.PI / 180);
        const r = CONFIG.globe.radius;

        marker.position.x = -(r * Math.sin(phi) * Math.cos(theta));
        marker.position.z = r * Math.sin(phi) * Math.sin(theta);
        marker.position.y = r * Math.cos(phi);

        globeMesh.add(marker);
        addLogEntry(`LOC DETECTED: ${loc.name}`);
    });
}

function animateThree() {
    requestAnimationFrame(animateThree);

    if (!state.hands.pinching) {
        globeMesh.rotation.y += 0.002;
    } else {
        globeMesh.rotation.y = lerp(globeMesh.rotation.y, state.targetRotationX, 0.1);
        globeMesh.rotation.x = lerp(globeMesh.rotation.x, state.targetRotationY, 0.1);
    }

    const targetScale = lerp(globeMesh.scale.x, state.targetScale, 0.1);
    globeMesh.scale.setScalar(targetScale);

    renderer.render(scene, camera);
}

function handleResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    sizeHandCanvas();
}

function initMediaPipe() {
    addLogEntry('LOADING BIOMETRIC MODELS...');

    faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
    faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    faceMesh.onResults(onFaceResults);

    hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
    hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65
    });
    hands.onResults(onHandResults);
}

async function startCamera() {
    const cameraFeed = new Camera(dom.video, {
        onFrame: async () => {
            await faceMesh.send({ image: dom.video });
            await hands.send({ image: dom.video });
        },
        width: CONFIG.cameraSize.width,
        height: CONFIG.cameraSize.height
    });

    cameraFeed.start();
    addLogEntry('CAMERA FEED: ACQUIRED');
}

function onFaceResults(results) {
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length) {
        if (!state.face.detected) {
            addLogEntry('FACE TRACKING: LOCKED');
            state.face.detected = true;
        }
        const landmarks = results.multiFaceLandmarks[0];
        const nose = landmarks[1];
        const x = (1 - nose.x) * window.innerWidth;
        const y = nose.y * window.innerHeight;

        state.smoothFaceX = lerp(state.smoothFaceX || x, x, 0.1);
        state.smoothFaceY = lerp(state.smoothFaceY || y, y, 0.1);
        updateHUDPosition(state.smoothFaceX, state.smoothFaceY);

        detectBlink(landmarks);
    } else if (state.face.detected) {
        state.face.detected = false;
        addLogEntry('FACE TRACKING: LOST', 'warn');
    }
}

function eyeAspectRatio(landmarks, topIdx, bottomIdx, leftIdx, rightIdx) {
    const dy = Math.hypot(
        landmarks[topIdx].x - landmarks[bottomIdx].x,
        landmarks[topIdx].y - landmarks[bottomIdx].y
    );
    const dx = Math.hypot(
        landmarks[leftIdx].x - landmarks[rightIdx].x,
        landmarks[leftIdx].y - landmarks[rightIdx].y
    );
    return dx > 0 ? dy / dx : 1;
}

function detectBlink(landmarks) {
    const leftEAR = eyeAspectRatio(landmarks, 159, 145, 33, 133);
    const rightEAR = eyeAspectRatio(landmarks, 386, 374, 362, 263);
    const ear = (leftEAR + rightEAR) / 2;

    const now = performance.now();
    const CLOSE_THRESHOLD = 0.18;
    const OPEN_THRESHOLD = 0.25;
    const DEBOUNCE_MS = 250;

    if (!blinkState.closed && ear < CLOSE_THRESHOLD && now - blinkState.lastToggle > DEBOUNCE_MS) {
        blinkState.closed = true;
        blinkState.lastToggle = now;
    } else if (blinkState.closed && ear > OPEN_THRESHOLD && now - blinkState.lastToggle > DEBOUNCE_MS) {
        blinkState.closed = false;
        blinkState.lastToggle = now;
        cycleGlobeColor();
    }
}

function cycleGlobeColor() {
    if (!globeMaterial) return;
    globeColorIndex = (globeColorIndex + 1) % GLOBE_COLOR_CYCLE.length;
    const next = GLOBE_COLOR_CYCLE[globeColorIndex];
    globeMaterial.color.setHex(next);
    addLogEntry(`GLOBE COLOR: #${next.toString(16).padStart(6, '0').toUpperCase()}`);
}

function updateHUDPosition(x, y) {
    const offsetX = 120;
    const offsetY = -100;
    dom.faceTracker.style.transform = `translate(${x + offsetX}px, ${y + offsetY}px)`;
}

function onHandResults(results) {
    const landmarksList = results.multiHandLandmarks || [];
    const count = landmarksList.length;
    state.hands.detected = count > 0;
    state.hands.count = count;

    drawHandOverlay(landmarksList);

    if (count === 1) {
        const landmarks = landmarksList[0];
        const thumb = landmarks[4];
        const index = landmarks[8];
        const distance = Math.hypot(index.x - thumb.x, index.y - thumb.y);

        if (distance < 0.05) {
            if (!state.hands.pinching) addLogEntry('GESTURE: ROTATION ENGAGED');
            state.hands.pinching = true;
            state.hands.lastGesture = 'PINCH_ROTATE';
            state.hands.summary = 'ONE_HAND_PINCH';
            document.body.style.cursor = 'grabbing';
            state.targetRotationX = (landmarks[8].x - 0.5) * 10;
            state.targetRotationY = (landmarks[8].y - 0.5) * 10;
        } else {
            state.hands.pinching = false;
            state.hands.lastGesture = 'ONE_HAND_TRACKED';
            state.hands.summary = 'ONE_HAND_OPEN';
            document.body.style.cursor = 'default';
        }
    } else if (count === 2) {
        if (state.hands.lastGesture !== 'DUAL_HAND_SCALE') addLogEntry('GESTURE: DUAL-HAND SCALE ENGAGED');
        state.hands.pinching = false;
        state.hands.lastGesture = 'DUAL_HAND_SCALE';
        state.hands.summary = 'TWO_HAND_SCALE';
        const hand1 = landmarksList[0][9];
        const hand2 = landmarksList[1][9];
        const distance = Math.hypot(hand1.x - hand2.x, hand1.y - hand2.y);
        state.targetScale = Math.max(0.5, Math.min(3, distance * 4));
    } else {
        state.hands.pinching = false;
        state.hands.lastGesture = 'WAITING_FOR_USER';
        state.hands.summary = 'NO_HANDS';
        document.body.style.cursor = 'default';
    }
}

function sizeHandCanvas() {
    dom.handCanvas.width = window.innerWidth;
    dom.handCanvas.height = window.innerHeight;
}

function drawHandOverlay(landmarksList) {
    sizeHandCanvas();
    const ctx = dom.handCtx;
    const width = dom.handCanvas.width;
    const height = dom.handCanvas.height;
    ctx.clearRect(0, 0, width, height);

    if (!landmarksList.length) return;

    for (const landmarks of landmarksList) {
        ctx.save();
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
            color: CONFIG.handOverlay.connectorColor,
            lineWidth: CONFIG.handOverlay.lineWidth
        });
        drawLandmarks(ctx, landmarks, {
            color: CONFIG.handOverlay.landmarkColor,
            lineWidth: 1,
            radius: 2
        });
        ctx.restore();

        const thumb = landmarks[4];
        const index = landmarks[8];
        const pinchPoint = {
            x: (thumb.x + index.x) / 2,
            y: (thumb.y + index.y) / 2
        };
        const isPinching = Math.hypot(thumb.x - index.x, thumb.y - index.y) < 0.05;
        const screenX = (1 - pinchPoint.x) * width;
        const screenY = pinchPoint.y * height;

        ctx.beginPath();
        ctx.arc(screenX, screenY, isPinching ? 14 : 28, 0, Math.PI * 2);
        ctx.strokeStyle = isPinching ? CONFIG.handOverlay.pinchColor : '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(screenX, screenY, 3, 0, Math.PI * 2);
        ctx.fillStyle = isPinching ? CONFIG.handOverlay.pinchColor : CONFIG.handOverlay.connectorColor;
        ctx.fill();

        ctx.font = '12px Orbitron, sans-serif';
        ctx.fillStyle = isPinching ? CONFIG.handOverlay.pinchColor : CONFIG.handOverlay.connectorColor;
        ctx.fillText(isPinching ? 'PINCH_LOCK' : 'HAND_TRACK', screenX + 18, screenY - 18);
    }
}

function initVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        setVoiceStatus('SPEECH API NOT SUPPORTED');
        addLogEntry('VOICE INPUT: BROWSER UNSUPPORTED', 'warn');
        dom.voiceToggle.disabled = true;
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        state.voice.listening = true;
        dom.voiceToggle.classList.add('is-listening');
        dom.voiceToggle.textContent = 'LISTENING';
        setVoiceStatus('SAY "HEY JARVIS"');
        addLogEntry('VOICE LINK: OPEN', 'voice');
    };

    recognition.onresult = (event) => {
        let interim = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const text = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalText += text;
            } else {
                interim += text;
            }
        }

        const display = (finalText || interim).trim();
        dom.voiceTranscript.textContent = display || 'Listening for "Hey Jarvis"...';

        if (finalText.trim()) {
            handleHeardSpeech(finalText.trim());
        }
    };

    recognition.onerror = (event) => {
        addLogEntry(`VOICE ERROR: ${event.error}`, 'err');
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            state.voice.manualStop = true;
            setVoiceStatus('MIC BLOCKED');
        }
    };

    recognition.onend = () => {
        state.voice.listening = false;
        dom.voiceToggle.classList.remove('is-listening');
        if (state.voice.manualStop) {
            dom.voiceToggle.textContent = 'TALK TO JARVIS';
            setVoiceStatus('STANDBY');
            return;
        }
        if (!state.voice.thinking && !state.voice.speaking) {
            setTimeout(safeStartRecognition, 250);
        }
    };

    dom.voiceToggle.addEventListener('click', toggleVoiceListening);

    state.voice.manualStop = false;
    safeStartRecognition();
}

function safeStartRecognition() {
    if (!recognition || state.voice.listening || state.voice.manualStop) return;
    try {
        recognition.start();
    } catch (_) {
        // already started or transitioning — ignore
    }
}

const WAKE_PATTERN = /\b(?:hey|hi|hello|yo|ok|okay)\s+jarvis\b|\bjarvis\b/i;
const WAKE_WINDOW_MS = 10000;

function armWakeWindow() {
    state.voice.wakeActive = true;
    if (state.voice.wakeTimer) clearTimeout(state.voice.wakeTimer);
    state.voice.wakeTimer = setTimeout(() => {
        state.voice.wakeActive = false;
        if (!state.voice.thinking && !state.voice.speaking) {
            setVoiceStatus('SAY "HEY JARVIS"');
        }
    }, WAKE_WINDOW_MS);
}

function disarmWakeWindow() {
    state.voice.wakeActive = false;
    if (state.voice.wakeTimer) {
        clearTimeout(state.voice.wakeTimer);
        state.voice.wakeTimer = null;
    }
}

function handleHeardSpeech(text) {
    if (state.voice.thinking || state.voice.speaking) return;

    const match = text.match(WAKE_PATTERN);

    if (match) {
        const command = text.slice(match.index + match[0].length).replace(/^[\s,.!?-]+/, '').trim();
        if (command) {
            handleUserSpeech(command);
        } else {
            armWakeWindow();
            deliverWakeGreeting();
        }
        return;
    }

    if (state.voice.wakeActive) {
        handleUserSpeech(text);
        return;
    }

    dom.voiceTranscript.textContent = text;
}

function deliverWakeGreeting() {
    const greetings = [
        'Hello, Sir. How may I assist you today with Industry 5.0?',
        'At your service, Sir. Shall we explore Industry 5.0 today?',
        'Good to hear you, Sir. Where would you like to begin with Industry 5.0?'
    ];
    const reply = greetings[Math.floor(Math.random() * greetings.length)];

    dom.jarvisResponse.textContent = reply;
    addLogEntry(`JARVIS: ${truncate(reply, 55)}`, 'voice');
    speakLocally(reply);
}

function speakLocally(text) {
    if (!('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 1.1;
        utter.pitch = 0.95;
        utter.lang = 'en-GB';
        state.voice.speaking = true;
        setVoiceStatus('SPEAKING');
        utter.onend = () => {
            state.voice.speaking = false;
            setVoiceStatus('SAY "HEY JARVIS"');
        };
        utter.onerror = () => {
            state.voice.speaking = false;
            setVoiceStatus('SAY "HEY JARVIS"');
        };
        window.speechSynthesis.speak(utter);
    } catch (_) {
        state.voice.speaking = false;
    }
}

function toggleVoiceListening() {
    if (!recognition) return;

    if (state.voice.listening || !state.voice.manualStop) {
        state.voice.manualStop = true;
        try { recognition.stop(); } catch (_) {}
        dom.voiceToggle.textContent = 'TALK TO JARVIS';
        setVoiceStatus('STANDBY');
        return;
    }

    state.voice.manualStop = false;
    stopActiveAudio();
    dom.voiceTranscript.textContent = 'Listening...';
    safeStartRecognition();
}

async function handleUserSpeech(text) {
    // If this is a quality-control question, answer it from the vision verdict
    // (deterministic) instead of the generic visual-chat route.
    if (typeof window.qcMaybeHandle === 'function' && window.qcMaybeHandle(text)) {
        addLogEntry(`USER (QC): ${truncate(text, 55)}`, 'voice');
        if (!state.voice.manualStop) {
            dom.voiceToggle.textContent = 'LISTENING';
            armWakeWindow();
            setVoiceStatus('FOLLOW-UP READY');
            safeStartRecognition();
        }
        return;
    }

    state.voice.thinking = true;
    dom.voiceToggle.textContent = 'PROCESSING';
    setVoiceStatus('THINKING');
    addLogEntry(`USER: ${truncate(text, 55)}`, 'voice');

    try { recognition && recognition.stop(); } catch (_) {}

    try {
        const frame = captureVideoFrame();
        const telemetry = collectTelemetry();

        const response = await fetch('/api/jarvis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, frame, telemetry })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        dom.jarvisResponse.textContent = data.text;
        addLogEntry(`JARVIS: ${truncate(data.text, 55)}`, 'voice');

        state.voice.thinking = false;
        state.voice.speaking = true;
        dom.voiceToggle.textContent = 'SPEAKING';
        setVoiceStatus('SPEAKING');

        if (data.audio) {
            await playBase64Audio(data.audio, data.mime || 'audio/mpeg');
        } else {
            speakLocally(data.text);
        }
    } catch (error) {
        state.voice.thinking = false;
        state.voice.speaking = false;
        dom.jarvisResponse.textContent = `Voice system fault: ${error.message}`;
        addLogEntry(`OPENAI LINK ERROR: ${error.message}`, 'err');
    } finally {
        state.voice.thinking = false;
        state.voice.speaking = false;
        if (!state.voice.manualStop) {
            dom.voiceToggle.textContent = 'LISTENING';
            armWakeWindow();
            setVoiceStatus('FOLLOW-UP READY');
            safeStartRecognition();
        } else {
            dom.voiceToggle.textContent = 'TALK TO JARVIS';
            setVoiceStatus('STANDBY');
        }
    }
}

function captureVideoFrame() {
    if (!dom.video.videoWidth || !dom.video.videoHeight) return null;

    const canvas = dom.snapshotCanvas;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(dom.video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.72);
}

function collectTelemetry() {
    return {
        faceDetected: state.face.detected,
        handsDetected: state.hands.detected,
        handCount: state.hands.count,
        handGesture: state.hands.lastGesture,
        handSummary: state.hands.summary,
        reactorOutput: dom.reactorOutput.textContent,
        reactorTemp: dom.reactorTemp.textContent,
        reactorCapacity: dom.reactorCapacityValue.textContent,
        clock: dom.clock.textContent
    };
}

function playBase64Audio(base64, mime) {
    return new Promise((resolve) => {
        stopActiveAudio();
        activeAudio = new Audio(`data:${mime};base64,${base64}`);
        activeAudio.playbackRate = 1.15;
        activeAudio.preservesPitch = true;
        activeAudio.mozPreservesPitch = true;
        activeAudio.webkitPreservesPitch = true;
        activeAudio.onended = resolve;
        activeAudio.onerror = resolve;
        activeAudio.play().catch(resolve);
    });
}

function stopActiveAudio() {
    if (!activeAudio) return;
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
}

function setVoiceStatus(text) {
    if (dom.voiceStatus) dom.voiceStatus.textContent = text;
}

function truncate(value, maxLength) {
    return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

window.addEventListener('load', init);
