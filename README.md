# Transcript Grabber

A Chrome extension that pulls the transcript from any YouTube video into a clean side-panel reader, then lets you copy it, download it, or send it to Claude for a detailed summary.

![Transcript Grabber icon](icons/icon128.png)

## What it does

- **Loads the transcript automatically.** Open the side panel on a YouTube video and the transcript appears, merged into readable paragraphs.
- **Timestamps you can click.** Turn on Timestamps to see every caption cue; click any time to jump the video there.
- **Every caption language.** Pick from all the tracks the video offers, manual or auto-generated.
- **Summarize with Claude.** One click opens claude.ai, fills in the transcript with a prompt tailored to the video's category (educational, how-to, news, talk or podcast, entertainment), and asks for a detailed summary in paragraphs. The prompt and transcript are also copied to your clipboard as a fallback.
- **Copy and download.** Copy the raw transcript, copy it with the summary prompt in front ("Copy for AI"), or save it as `.md` (with title, channel and source link) or `.txt`.
- Light and dark themes follow your system. Works on standard videos, Shorts, embeds and `youtu.be` links.

## How it works

YouTube now requires a proof-of-origin token on its caption endpoints, so fetching caption files directly returns nothing. The extension relies on YouTube's own transcript feature instead. When the panel opens, it uses `chrome.scripting.executeScript` to run two small functions in the YouTube tab (`transcript.js`):

1. A **main-world** read of `ytInitialPlayerResponse` for the title, channel, category and the list of caption languages.
2. An **isolated-world** routine that opens YouTube's "Show transcript" panel and scrapes the rendered segments out of the DOM, using the classic selectors first and a structural fallback that survives UI redesigns. Switching languages drives YouTube's own language menu.

Because it reads the same transcript YouTube shows you, it works whenever the video's captions do. The side panel then groups the cues into paragraphs, breaking at the end of a sentence once a paragraph is long enough, or forcing a break when auto-captions run on without punctuation.

**Summarize with Claude** opens `claude.ai/new`, waits for the composer to render, inserts the prompt and transcript, and presses Send if the button is enabled. You need to be signed in to Claude. If the composer cannot be found, everything is already on your clipboard, so just paste.

Permissions are kept narrow: `sidePanel` and `scripting`, plus host access to YouTube and claude.ai only. There is no `tabs` or `activeTab` permission.

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest: side panel and permissions |
| `background.js` | Opens the side panel on toolbar click |
| `transcript.js` | URL parsing and the functions injected into the YouTube and Claude tabs |
| `sidepanel.html`, `.css`, `.js` | The reader UI |

## Tech stack

Vanilla JavaScript, HTML and CSS on Chrome Manifest V3. No build step and no dependencies.

## Running locally

The extension is not on the Chrome Web Store, so load it unpacked:

1. Open `chrome://extensions` in Chrome or any Chromium browser (Edge, Brave, Arc).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this repository's folder.
4. Pin **Transcript Grabber** to the toolbar, open a YouTube video and click the icon.

## Limitations

- YouTube only.
- The video must have captions. If YouTube cannot show a transcript, neither can the extension.
- YouTube changes its page structure from time to time. If extraction breaks, `PAGE_scrapeTranscript` in `transcript.js` is where to look.
- Extraction runs entirely in your browser. Nothing leaves it unless you click Summarize with Claude, which sends the transcript to your own Claude session.

## License

MIT
