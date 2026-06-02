// qc.js — Quality Control inspection logic for the JARVIS QC station.
//
// Responsibility split (this is the important part):
//   - Roboflow decides FACTS (which parts are present, where, how confident).
//   - This module turns facts into a VERDICT against an expected checklist.
//   - The LLM (in server.js) only PHRASES the verdict. It never decides pass/fail.
//
// This keeps quality decisions deterministic and auditable instead of relying
// on a language model's guess about what it "sees".

import 'dotenv/config';

// ---------------------------------------------------------------------------
// 1. CONFIG — edit these to match YOUR Roboflow model.
// ---------------------------------------------------------------------------

// From Roboflow: Project -> Versions -> the model id looks like "my-car-qc/3".
// Set ROBOFLOW_MODEL_ID="my-car-qc/3" in your .env
const ROBOFLOW_MODEL_ID = process.env.ROBOFLOW_MODEL_ID || '';
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY || '';
const ROBOFLOW_URL = process.env.ROBOFLOW_URL || 'https://serverless.roboflow.com';

// Minimum confidence to count a detection as "really present".
const PRESENCE_THRESHOLD = Number(process.env.QC_PRESENCE_THRESHOLD || 0.55);
// Detections between LOW and PRESENCE are "uncertain" -> JARVIS asks for a recheck.
const LOW_THRESHOLD = Number(process.env.QC_LOW_THRESHOLD || 0.35);

// ---------------------------------------------------------------------------
// 2. THE CHECKLIST — what a correct car MUST have at this station.
//    The keys MUST match the class names you label in Roboflow exactly.
//    label: human-friendly name JARVIS will speak.
//    min:   how many of this class must be present (e.g. 4 tires).
// ---------------------------------------------------------------------------

export const CHECKLIST = [
    { class: 'tire',            label: 'tires',              min: 4 },
    { class: 'battery',         label: 'battery',            min: 1 },
    { class: 'front_bumper',    label: 'front bumper',       min: 1 },
    { class: 'rear_bumper',     label: 'rear bumper',        min: 1 },
    { class: 'headlight',       label: 'headlights',         min: 2 },
    { class: 'side_mirror',     label: 'side mirrors',       min: 2 },
    { class: 'hood',            label: 'hood',               min: 1 }
    // ... add every part you trained the model to detect.
];

// Any class in this list means "a car is in the frame" (used for auto-greeting).
// Keep it broad — any car part counts as the car being present.
const CAR_PRESENCE_CLASSES = CHECKLIST.map((c) => c.class);

// ---------------------------------------------------------------------------
// 3. Call Roboflow's serverless hosted detection API.
//    Sends the base64 frame, gets back { predictions: [{class, confidence, x, y, width, height}, ...] }
// ---------------------------------------------------------------------------

export async function detectParts(frameDataUrl) {
    if (!ROBOFLOW_MODEL_ID || !ROBOFLOW_API_KEY) {
        throw new Error('Roboflow not configured. Set ROBOFLOW_MODEL_ID and ROBOFLOW_API_KEY in .env');
    }
    if (typeof frameDataUrl !== 'string' || !frameDataUrl.startsWith('data:image/')) {
        throw new Error('No valid camera frame to inspect.');
    }

    // Roboflow's REST endpoint wants the raw base64 (no "data:image/jpeg;base64," prefix).
    const base64 = frameDataUrl.split(',')[1];

    const url = `${ROBOFLOW_URL}/${ROBOFLOW_MODEL_ID}?api_key=${encodeURIComponent(ROBOFLOW_API_KEY)}&confidence=${LOW_THRESHOLD}&overlap=30&format=json`;

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: base64
    });

    if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`Roboflow ${resp.status}: ${txt.slice(0, 200)}`);
    }

    const data = await resp.json();
    return Array.isArray(data.predictions) ? data.predictions : [];
}

// ---------------------------------------------------------------------------
// 4. Turn raw detections into a structured QC verdict.
// ---------------------------------------------------------------------------

export function buildVerdict(predictions) {
    // Count high-confidence and low-confidence detections per class.
    const counts = {};    // class -> number seen at >= PRESENCE_THRESHOLD
    const lowCounts = {};  // class -> number seen between LOW and PRESENCE
    const bestConf = {};   // class -> best confidence seen

    for (const p of predictions) {
        const cls = p.class;
        const conf = Number(p.confidence) || 0;
        bestConf[cls] = Math.max(bestConf[cls] || 0, conf);
        if (conf >= PRESENCE_THRESHOLD) {
            counts[cls] = (counts[cls] || 0) + 1;
        } else if (conf >= LOW_THRESHOLD) {
            lowCounts[cls] = (lowCounts[cls] || 0) + 1;
        }
    }

    const present = [];
    const missing = [];
    const uncertain = [];

    for (const item of CHECKLIST) {
        const have = counts[item.class] || 0;
        const low = lowCounts[item.class] || 0;

        if (have >= item.min) {
            present.push({ ...item, found: have });
        } else if (have + low >= item.min) {
            // Some detections were too weak to trust -> flag for recheck.
            uncertain.push({
                ...item,
                found: have,
                lowConfidence: low,
                bestConfidence: Number((bestConf[item.class] || 0).toFixed(2))
            });
        } else {
            missing.push({
                ...item,
                found: have,
                bestConfidence: Number((bestConf[item.class] || 0).toFixed(2))
            });
        }
    }

    const pass = missing.length === 0 && uncertain.length === 0;

    return { pass, present, missing, uncertain, rawCount: predictions.length };
}

// Convenience: true if any car part is detected with reasonable confidence.
// Used by the frontend's auto-greet trigger.
export function isCarPresent(predictions) {
    return predictions.some(
        (p) => CAR_PRESENCE_CLASSES.includes(p.class) && Number(p.confidence) >= PRESENCE_THRESHOLD
    );
}

// Compact summary string the LLM can read as ground truth.
export function verdictToGroundTruth(verdict) {
    const fmt = (arr) => arr.map((x) => `${x.label}${x.min > 1 ? ` (need ${x.min}, found ${x.found})` : ''}`).join(', ') || 'none';
    return [
        `INSPECTION VERDICT: ${verdict.pass ? 'PASS' : 'FAIL'}`,
        `Present and correct: ${fmt(verdict.present)}`,
        `MISSING: ${fmt(verdict.missing)}`,
        `Uncertain / low confidence (needs recheck): ${fmt(verdict.uncertain)}`
    ].join('\n');
}
