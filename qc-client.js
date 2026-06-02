// qc-client.js — front-end glue for the QC station.
// Load this AFTER app.js in index.html. It reuses app.js's captureVideoFrame(),
// playBase64Audio(), addLogEntry(), and the #jarvis-response element.
//
// What it does:
//   1. While idle, polls /api/qc-detect a few times a second using the live camera frame.
//   2. When a car is seen for long enough -> greets, then runs a full inspection.
//   3. Speaks the pass/fail verdict; renders a checklist panel.
//   4. Lets the operator ask spoken QC questions that are answered from the verdict.

(function () {
    const QC = {
        carPresent: false,
        greeted: false,
        inspecting: false,
        lastVerdict: null,
        seenStreak: 0,
        goneStreak: 0,
        POLL_MS: 600,           // how often to check for a car while idle
        SEEN_TO_GREET: 3,       // ~1.8s of continuous detection before greeting
        GONE_TO_RESET: 6,       // ~3.6s of no car before arming for the next one
    };

    // ---- helpers that lean on functions already defined in app.js ----
    function frame() {
        return (typeof captureVideoFrame === 'function') ? captureVideoFrame() : null;
    }
    function log(msg, type) {
        if (typeof addLogEntry === 'function') addLogEntry(msg, type || 'sys');
    }
    async function speak(data) {
        const respEl = document.getElementById('jarvis-response');
        if (respEl && data.text) respEl.textContent = data.text;
        if (data.audio && typeof playBase64Audio === 'function') {
            await playBase64Audio(data.audio, data.mime || 'audio/mpeg');
        } else if (data.text && typeof speakLocally === 'function') {
            speakLocally(data.text);
        }
    }

    // ---- idle polling loop ----
    async function poll() {
        if (QC.inspecting) return; // don't poll mid-inspection
        const f = frame();
        if (!f) return;

        try {
            const r = await fetch('/api/qc-detect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frame: f })
            });
            const data = await r.json();

            if (data.carPresent) {
                QC.seenStreak++;
                QC.goneStreak = 0;
            } else {
                QC.goneStreak++;
                QC.seenStreak = 0;
            }

            // Car has arrived and settled -> greet + inspect, once.
            if (!QC.greeted && QC.seenStreak >= QC.SEEN_TO_GREET) {
                QC.greeted = true;
                QC.carPresent = true;
                onCarArrived();
            }

            // Car has left -> re-arm for the next vehicle.
            if (QC.greeted && QC.goneStreak >= QC.GONE_TO_RESET) {
                QC.greeted = false;
                QC.carPresent = false;
                QC.lastVerdict = null;
                log('QC: station clear, ready for next vehicle.', 'sys');
            }
        } catch (_) { /* ignore transient errors during idle polling */ }
    }

    async function onCarArrived() {
        log('QC: vehicle detected at station.', 'voice');
        // Immediate friendly greeting (local TTS so it's instant, no round trip).
        if (typeof speakLocally === 'function') {
            speakLocally('Hi there, welcome to the quality control station. Running inspection now, Sir.');
        }
        const respEl = document.getElementById('jarvis-response');
        if (respEl) respEl.textContent = 'Hi there, welcome to the quality control station. Running inspection...';
        await runInspection('report');
    }

    // ---- full inspection ----
    async function runInspection(mode, question) {
        const f = frame();
        if (!f) return;
        QC.inspecting = true;
        log('QC: inspecting...', 'sys');
        try {
            const r = await fetch('/api/qc-inspect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frame: f, mode: mode || 'report', question: question || '' })
            });
            if (!r.ok) {
                const e = await r.json().catch(() => ({}));
                throw new Error(e.error || ('HTTP ' + r.status));
            }
            const data = await r.json();
            QC.lastVerdict = data.verdict;
            renderChecklist(data.verdict);
            log('JARVIS: ' + (data.text || '').slice(0, 55), 'voice');
            await speak(data);
        } catch (err) {
            log('QC ERROR: ' + err.message, 'err');
            if (typeof speakLocally === 'function') {
                speakLocally('I could not complete the inspection, Sir. Please check the vision system.');
            }
        } finally {
            QC.inspecting = false;
        }
    }

    // ---- checklist UI panel ----
    function renderChecklist(verdict) {
        if (!verdict) return;
        let panel = document.getElementById('qc-panel');
        if (!panel) {
            panel = document.createElement('section');
            panel.id = 'qc-panel';
            panel.className = 'hud-card qc-panel';
            document.getElementById('hud-layer').appendChild(panel);
        }
        const row = (item, cls, mark) =>
            `<div class="qc-row qc-row--${cls}"><span>${mark}</span><span>${item.label}</span></div>`;
        panel.innerHTML =
            `<h3>QC INSPECTION — ${verdict.pass ? 'PASS' : 'HOLD'}</h3>` +
            verdict.present.map((i) => row(i, 'ok', '\u2714')).join('') +
            verdict.uncertain.map((i) => row(i, 'warn', '\u003f')).join('') +
            verdict.missing.map((i) => row(i, 'bad', '\u2717')).join('') +
            `<div class="qc-verdict qc-verdict--${verdict.pass ? 'pass' : 'fail'}">` +
            (verdict.pass ? 'PROCEED TO NEXT STATION' : 'HOLD CAR — ISSUES FOUND') + '</div>';
        panel.classList.toggle('qc-panel--pass', verdict.pass);
        panel.classList.toggle('qc-panel--fail', !verdict.pass);
    }

    // ---- route spoken QC questions through the verdict ----
    // Words that mean "this is a QC question" rather than general chat.
    const QC_KEYWORDS = /\b(tire|tyre|battery|bumper|headlight|mirror|hood|missing|wrong|ok|okay|check|inspect|proceed|status|part|part s|defect|scratch)\b/i;

    // Expose a hook app.js can call before sending to /api/jarvis.
    // Returns true if the QC client handled it.
    window.qcMaybeHandle = function (text) {
        if (!text) return false;
        const t = text.toLowerCase();
        if (/\b(re-?inspect|inspect again|run inspection|check the car|full check)\b/.test(t)) {
            runInspection('report');
            return true;
        }
        if (QC_KEYWORDS.test(t)) {
            runInspection('question', text);
            return true;
        }
        return false;
    };

    // Public manual trigger (e.g. bind to a button).
    window.qcInspectNow = function () { runInspection('report'); };

    // Start polling once the camera is likely up.
    setTimeout(() => setInterval(poll, QC.POLL_MS), 4000);
    log('QC client armed. Watching for vehicles.', 'sys');
})();
