# JARVIS HUD: OpenAI Voice + Hand Tracking Patch

This patch merges the visual HUD with live MediaPipe hand skeletons and a server-side OpenAI voice assistant.

## Install

```bash
npm install
cp .env.example .env
```

Edit `.env` and add your API key:

```bash
OPENAI_API_KEY=sk-your-key-here
```

## Run

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## What changed

- Added `hand_canvas` for MediaPipe hand skeleton drawing.
- Kept the Three.js globe on `output_canvas`.
- Added pinch reticle and hand gesture state.
- Added a voice panel.
- Added browser speech recognition for microphone input.
- Added `/api/jarvis` backend route for OpenAI text response and OpenAI TTS audio.
- Sends a mirrored camera snapshot to the model with each spoken command.

## Voice control

Press `TALK TO JARVIS`, speak, then wait. The browser handles speech-to-text. The Node backend sends text plus the current camera frame to OpenAI, then returns generated speech audio.

## Important

Do not put your OpenAI API key in `app.js`. It belongs only in `.env` on the backend.
