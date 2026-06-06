// qc.js — Quality Control inspection logic for the JARVIS QC station.
//
// Responsibility split (this is the important part):
//   - Roboflow decides FACTS (which parts are present, where, how confident).
//   - This module turns facts into a VERDICT against an expected checklist.
//   - The LLM (in server.js) only PHRASES the verdict. It never decides pass/fail.
//
// Group-aware: each checklist item lists several acceptable class names
// (e.g. a tire in any colour). A detection of ANY listed class counts toward it.

import 'dotenv/config';

// ---------------------------------------------------------------------------
// 1. CONFIG — edit these to match YOUR Roboflow model.
// ---------------------------------------------------------------------------

// From Roboflow: Project -> Versions -> the model id looks like "car-qc-wheels/1".
const ROBOFLOW_MODEL_ID = process.env.ROBOFLOW_MODEL_ID || '';
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY || '';
const ROBOFLOW_URL = process.env.ROBOFLOW_URL || 'https://serverless.roboflow.com';

// Minimum confidence to count a detection as "really present".
const PRESENCE_THRESHOLD = Number(process.env.QC_PRESENCE_THRESHOLD || 0.55);
// Detections between LOW and PRESENCE are "uncertain" -> JARVIS asks for a recheck.
const LOW_THRESHOLD = Number(process.env.QC_LOW_THRESHOLD || 0.35);

// ---------------------------------------------------------------------------
// 2. THE CHECKLIST — what a correct car MUST have at this station.
//    `classes`: every acceptable class name for this part (colour variants).
//               These MUST match the Roboflow class names EXACTLY (note the
//               dataset spells it "tries", not "tires").
//    `label`:   human-friendly name JARVIS will speak.
//    `min`:     how many of the part must be present.
//
//    WHEELS-ONLY TEST: the camera sees one side = 1 front + 1 rear tire.
//    Colour doesn't matter, so all colour variants are grouped per part.
// ---------------------------------------------------------------------------

export const CHECKLIST = [
    {
        label: 'front tire',
        min: 1,
        classes: ['fronttries_beige', 'fronttries_black', 'fronttries_white']
    },
    {
        label: 'rear tire',
        min: 1,
        classes: ['reartries_beige', 'reartries_black', 'reartries_white']
    }
    // --- Phase 2: uncomment to also check body + spoiler ---
    // { label: 'car body', min: 1, classes: ['carbody_beige', 'carbody_black'] },
    // { label: 'spoiler',  min: 1, classes: ['spoiler_beige', 'spoiler_black'] }
];

// Any class here means "a car is in the frame" (used for auto-greeting).
// Union of every class across the checklist + the body/spoiler classes,
// so the greeting fires even before all parts are confirmed.
const CAR_PRESENCE_CLASSES = [
    'fronttries_beige', 'fronttries_black', 'fronttries_white',
    'reartries_beige', 'reartries_black', 'reartries_white',
    'carbody_beige', 'carbody_black',
    'spoiler_beige', 'spoiler_black'
];

// ---------------------------------------------------------------------------
// 3. Call Roboflow's serverless hosted detection API.
//    Sends the base64 frame, gets back
//    { predictions: [{class, confidence, x, y, width, height}, ...] }
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
// 4. Turn raw detections into a structured, group-aware QC verdict.
// ---------------------------------------------------------------------------

export function buildVerdict(predictions) {
    // Per-class tallies.
    const counts = {};     // class -> count at >= PRESENCE_THRESHOLD
    const lowCounts = {};   // class -> count between LOW and PRESENCE
    const bestConf = {};    // class -> best confidence seen

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
        // Sum across ALL acceptable class variants for this part.
        let have = 0;
        let low = 0;
        let best = 0;
        for (const cls of item.classes) {
            have += counts[cls] || 0;
            low += lowCounts[cls] || 0;
            best = Math.max(best, bestConf[cls] || 0);
        }

        const entry = { label: item.label, min: item.min, found: have };

        if (have >= item.min) {
            present.push(entry);
        } else if (have + low >= item.min) {
            // Enough total detections, but some were too weak to trust -> recheck.
            uncertain.push({ ...entry, lowConfidence: low, bestConfidence: Number(best.toFixed(2)) });
        } else {
            missing.push({ ...entry, bestConfidence: Number(best.toFixed(2)) });
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

// Compact summary string the LLM reads as ground truth.
export function verdictToGroundTruth(verdict) {
    const fmt = (arr) =>
        arr.map((x) => `${x.label}${x.min > 1 ? ` (need ${x.min}, found ${x.found})` : ''}`).join(', ') || 'none';
    return [
        `INSPECTION VERDICT: ${verdict.pass ? 'PASS' : 'FAIL'}`,
        `Present and correct: ${fmt(verdict.present)}`,
        `MISSING: ${fmt(verdict.missing)}`,
        `Uncertain / low confidence (needs recheck): ${fmt(verdict.uncertain)}`
    ].join('\n');
}
