# JARVIS Quality Control Station

JARVIS voice HUD + Roboflow vision = an always-on car inspector for the QC station.

## How it works

1. **Idle watch** — the browser polls `/api/qc-detect` ~2x/sec with the live Logitech
   frame. As soon as a car is detected for ~1.8s, JARVIS greets the operator.
2. **Auto inspection** — on arrival it calls `/api/qc-inspect`: the backend runs the
   Roboflow detection model, builds a deterministic pass/fail **verdict** against a
   checklist (`CHECKLIST` in `qc.js`), then has the LLM *phrase* it and speaks via TTS.
3. **Spoken questions** — "are the tires ok?", "what's missing?", "re-inspect" are
   answered from the SAME verdict, so JARVIS never contradicts the vision model.
4. **Verdict UI** — a checklist panel (bottom-right) shows ✔ present / ? recheck / ✗ missing.

### Key design rule
**Roboflow decides facts; the LLM only chooses words.** Quality decisions are
deterministic and auditable — the language model cannot declare a missing part "fine".

## Setup

```bash
npm install
cp .env.example .env   # then fill in your keys
npm start              # http://localhost:3000
```

`.env` needs your `OPENAI_API_KEY` and your Roboflow `ROBOFLOW_API_KEY` +
`ROBOFLOW_MODEL_ID` (e.g. `my-car-qc/3`, from the Versions page in Roboflow).

## Train the model (your ~1000 photos)

1. Roboflow → create an **Object Detection** project.
2. Upload photos. **Shoot/augment from the mounted-camera angle** for production accuracy.
3. Label one class per part — match the class names in `CHECKLIST` (qc.js) exactly:
   `tire`, `battery`, `front_bumper`, `rear_bumper`, `headlight`, `side_mirror`, `hood`...
4. **Add defective / incomplete cars** — a model trained only on perfect cars cannot
   detect "missing". Include images with parts removed.
5. Train → Deploy → copy the model id into `.env`.
6. Phase 2 (condition: scratched/misaligned): add those as extra classes
   (e.g. `tire_loose`, `scratch`) once presence detection is solid.

## Tuning
- `QC_PRESENCE_THRESHOLD` (default 0.55) — confidence to count a part as present.
- `QC_LOW_THRESHOLD` (0.35) — below presence but above this = "recheck", not "missing".
- Greet timing: `SEEN_TO_GREET` / `GONE_TO_RESET` in `qc-client.js`.

## Files added/changed
- `qc.js` — detection call + verdict logic + checklist (EDIT THE CHECKLIST).
- `server.js` — adds `/api/qc-detect` and `/api/qc-inspect`.
- `qc-client.js` — auto-greet, inspection, checklist UI, QC question routing.
- `app.js` — routes QC questions to the verdict before the general chat route.
- `styles.css` — QC panel styles.
- `.env.example` — all keys/thresholds.
