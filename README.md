# Transcript Grabber

A Chrome extension that pulls the transcript from any YouTube video, presents it
in a clean side-panel reader, and — with one click — sends it to Claude for a
detailed summary, or copies / downloads it as **Markdown** or **plain text**.

![icon](icons/icon128.png)

## Features

- **One-click transcript** — open the side panel on any YouTube video and the
  transcript loads automatically.
- **Summarize with Claude** — one click opens Claude, pastes the transcript with
  a tailored prompt, and asks for a **detailed, paragraph-form** summary (no
  bullet points). The prompt adapts to the video's category (educational,
  how-to, news, talk/podcast, entertainment). The prompt + transcript are also
  copied to your clipboard as a fallback.
- **Clean reading view** — captions are merged into readable paragraphs, or
  flip on **Timestamps** to see every cue with a clickable time.
- **Click to seek** — click any timestamp to jump the video to that moment.
- **Language picker** — choose between every caption track the video offers
  (manual and auto-generated).
- **Copy / Copy for AI** — copy the raw transcript, or copy it prefixed with a
  ready-made "summarize in detail, in paragraphs" prompt.
- **Download** — save as `.md` (with title, channel, and source link) or `.txt`.
- **Light & dark** — follows your system theme.

Works on standard videos (`watch?v=`), Shorts, embeds, and `youtu.be` links.

## Install (developer / unpacked)

This extension isn't on the Chrome Web Store — load it unpacked:

1. Open `chrome://extensions` in Chrome (or any Chromium browser: Edge, Brave, Arc).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `video transcription tool` folder.
4. Pin **Transcript Grabber** to your toolbar (puzzle-piece icon → pin).

## Use

1. Open any YouTube video.
2. Click the Transcript Grabber toolbar icon — the side panel opens and pulls
   the transcript.
3. Read it, pick a language, toggle timestamps, then **Copy for AI** or
   **Download .md** to send it to your summarizer of choice.

If a video shows "No transcript available," the uploader has disabled captions
for it.

## How it works

The extension leans on YouTube's **own** transcript feature rather than fetching
caption files directly — YouTube now requires a `poToken` on its caption
endpoints, so raw caption URLs return nothing (even from the page's own context).

Instead, when you open the side panel it uses `chrome.scripting.executeScript` to
run two small functions inside the active YouTube tab:

1. A **main-world** read of `ytInitialPlayerResponse` for the title, channel, and
   the list of available caption languages.
2. An **isolated** routine that opens YouTube's native "Show transcript" panel and
   scrapes the rendered segments out of the DOM (with a classic-selector path plus
   a structural fallback that survives YouTube UI redesigns).

Because it reads the same transcript YouTube shows you, it works whenever the
video's captions do. Switching languages drives YouTube's transcript language
menu. (The native transcript panel is left open on the page as the source of
truth.)

**Summarize with Claude** opens `claude.ai/new` in a new tab and injects the
prompt + transcript into Claude's composer (`PAGE_fillClaude`), then presses
send. This needs the `https://claude.ai/*` host permission and you must be
signed in to Claude. Auto-fill is best-effort — if Claude's editor can't be
found, the prompt + transcript are already on your clipboard, so just press
⌘V / Ctrl+V.

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest — side panel, permissions |
| `background.js` | Opens the side panel on toolbar click |
| `transcript.js` | URL parsing + the functions injected into the YouTube tab |
| `sidepanel.html/.css/.js` | The reader UI |

## Notes & limitations

- YouTube only. The architecture could extend to other sites, but transcript
  extraction is YouTube-specific today.
- Extraction runs entirely locally — the transcript is read from the page you're
  already viewing, with no third-party servers involved. The only time anything
  leaves your browser is when *you* click **Summarize with Claude**, which sends
  the transcript to your own Claude session.
- The video must actually have captions (a "Show transcript" option). If YouTube
  can't show a transcript, neither can the extension.
- YouTube occasionally changes its internal page structure; if extraction breaks,
  the scraping logic in `transcript.js` (`PAGE_scrapeTranscript`) is where to look.

## License

MIT
