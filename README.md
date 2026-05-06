# Shorthand

Shorthand is a local-first browser app for recording meeting audio, taking shorthand notes in sectioned tables, recovering interrupted sessions from IndexedDB, and exporting a ZIP bundle with DOCX, audio, and JSON.

## Run locally

On Mac, double-click:

```text
Start Shorthand.command
```

That starts the local server from this folder and opens the app in Chrome, Edge, or your default browser. Keep the Terminal window open while using the app.

If you prefer Terminal, use the included helper server:

```bash
python3 serve.py
```

Then open [http://127.0.0.1:4174](http://127.0.0.1:4174) in Chrome or Edge desktop.

## Speaker CSV

Use `members.example.csv` as the format reference:

```csv
name,alias
Example Member,ABC
Another Speaker,DEF
```

Keep real speaker lists local. `members.csv` is intentionally ignored by Git.

## What it does

- Stores sessions, sections, rows, speakers, audio segments, and audio chunks in IndexedDB
- Uses a minimal top command bar and a Word-like document page for note entry, with the large document title editable in place
- Opens straight into a blank draft when there is no saved session yet
- Confirms before `New` replaces a meeting that already has content
- Records audio continuously in short MediaRecorder chunks for better crash recovery
- Uses `Mute` instead of pause, so audio capture stops while the session clock keeps running
- Saves and waits for an IndexedDB audio checkpoint whenever a new section is added during recording without stopping the recorder
- Shows browser storage usage/free space in the top bar when the browser exposes storage estimates
- Provides `Past Meetings` to inspect stored IndexedDB meetings, including sections, rows, audio clips, chunks, size, and export count
- Lets you clear stopped meetings from IndexedDB after you have exported anything you need
- Shows a playback modal after Stop, with section-by-section playback and active speaker row highlighting
- Restores interrupted sessions after refresh or reopen
- Uses agenda sections with `Speaker | Notes` inputs and a grey read-only timestamp rail
- Keeps speaker and notes rows locked until `Start` is clicked, with an in-page prompt pointing back to Start
- Lets you import speakers from CSV, mark each member Present or Absent, and keep adding more speakers manually afterward
- Keeps speaker entry tied to the speaker list: type a few letters, use ArrowUp/ArrowDown, then press Enter or Tab to select
- Does not create new speakers from typed note rows; add or import them in Speakers first
- Groups newly added speakers at the top and allows those manual speakers to be deleted
- Exports the attendance list with aliases such as `Adrian · HTD`
- Locks a row timestamp only when the speaker is typed or deliberately selected
- Auto-adds another blank row when you focus the current final row, so there is always an empty row ready
- Moves from a notes cell to the next row only when ArrowDown is pressed from the last text line
- Offers `Add Section` beside `Add Row` inside the document
- Keeps native browser undo/redo behavior in the editable fields
- Exports `minutes.docx`, `session.json`, `upload-this-to-ai-bots.json`, and one or more audio segment files in a ZIP bundle

## Notes

- Run on `localhost`, not `file://`
- This version is designed for Chrome and Edge desktop
- Recording continues while the window is minimized, but it cannot survive a fully closed tab or browser; recovery resumes in a new segment on reopen
