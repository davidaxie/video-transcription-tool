// transcript.js
// Pure helpers + self-contained functions that are INJECTED into the YouTube
// tab via chrome.scripting.executeScript.
//
// Why scrape the page instead of fetching captions directly?
// YouTube now requires a "poToken" (proof-of-origin) on its timedtext and
// get_transcript endpoints, so fetching caption URLs returns an empty body —
// even from the page's own context. The one thing that still works everywhere
// is YouTube's *native* transcript panel: if the user can open "Show transcript"
// on the video, we can read it out of the DOM. That is what we do here.
//
// IMPORTANT: every PAGE_* function must be fully self-contained. It is
// serialized with func.toString() and runs in the page, so it may only use its
// own arguments, page globals (document/window), and helpers defined inline.

/**
 * Extract a YouTube video ID from any common URL shape.
 * (Runs in the extension, not the page.)
 * @returns {string|null}
 */
export function getVideoId(rawUrl) {
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    return url.pathname.slice(1).split("/")[0] || null;
  }
  if (host.endsWith("youtube.com")) {
    const v = url.searchParams.get("v");
    if (v) return v;
    const m = url.pathname.match(/\/(shorts|embed|live)\/([^/?#]+)/);
    if (m) return m[2];
  }
  return null;
}

/* ============================================================
 * INJECTED (MAIN world): read metadata + caption track list
 * ============================================================ */
export function PAGE_readMeta() {
  const pr = window.ytInitialPlayerResponse || {};
  const details = pr.videoDetails || {};
  const renderer = pr.captions?.playerCaptionsTracklistRenderer || {};
  const trackList = renderer.captionTracks || [];

  const tracks = trackList.map((t) => ({
    code: t.languageCode || "",
    kind: t.kind || "",
    name:
      t.name?.simpleText ||
      (t.name?.runs ? t.name.runs.map((r) => r.text).join("") : "") ||
      t.languageCode ||
      "",
  }));

  // Index of the track YouTube considers the default translation.
  const defaultIndex =
    renderer.audioTracks?.[0]?.defaultCaptionTrackIndex ?? 0;

  return {
    title: details.title || document.title.replace(/\s*-\s*YouTube\s*$/, ""),
    author: details.author || "",
    tracks,
    defaultName: tracks[defaultIndex]?.name || tracks[0]?.name || "",
  };
}

/* ============================================================
 * INJECTED (ISOLATED world): open the transcript panel & scrape
 * @param {number} waitMs  how long to wait for the panel to fill
 * @returns {Promise<{segments?, langLabel?, error?}>}
 * ============================================================ */
export async function PAGE_scrapeTranscript(waitMs) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const PANEL =
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';

  const parseTs = (t) => {
    const parts = String(t).trim().split(":").map(Number);
    if (!parts.length || parts.some((n) => Number.isNaN(n))) return 0;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  };

  const findOpenButton = () => {
    const section = document.querySelector(
      "ytd-video-description-transcript-section-renderer"
    );
    const list = [];
    if (section) list.push(...section.querySelectorAll("button"));
    list.push(...document.querySelectorAll("button[aria-label]"));
    return (
      list.find((b) => {
        const a = (b.getAttribute("aria-label") || "").toLowerCase();
        return a.includes("transcript") && !a.includes("close");
      }) || null
    );
  };

  const scrape = () => {
    const panel = document.querySelector(PANEL);
    if (!panel) return [];
    const segs = [];
    const seen = new Set();
    const push = (start, text) => {
      text = (text || "").replace(/\s+/g, " ").trim();
      if (!text) return;
      const key = start + "|" + text;
      if (seen.has(key)) return;
      seen.add(key);
      segs.push({ start, text });
    };

    // Classic renderer (still used for most accounts).
    const classic = panel.querySelectorAll("ytd-transcript-segment-renderer");
    if (classic.length) {
      classic.forEach((row) => {
        const ts =
          row.querySelector(".segment-timestamp")?.textContent?.trim() ||
          "0:00";
        const text = row.querySelector(".segment-text")?.textContent || "";
        push(parseTs(ts), text);
      });
    }

    // Structural fallback for redesigned UIs: any leaf that is exactly a
    // timestamp, paired with the caption text that follows it in its row.
    if (!segs.length) {
      const leaves = [...panel.querySelectorAll("*")].filter(
        (e) =>
          e.children.length === 0 &&
          /^\d{1,2}:\d{2}(:\d{2})?$/.test(e.textContent.trim())
      );
      leaves.forEach((tsEl) => {
        const tsText = tsEl.textContent.trim();
        let row = tsEl.parentElement;
        let guard = 0;
        while (row && guard++ < 6) {
          const full = row.textContent.replace(/\s+/g, " ").trim();
          if (full.length > tsText.length + 1 && full.startsWith(tsText)) {
            push(parseTs(tsText), full.slice(tsText.length));
            break;
          }
          row = row.parentElement;
        }
      });
    }
    return segs;
  };

  // Open the panel if it isn't already expanded.
  let panel = document.querySelector(PANEL);
  const isExpanded =
    panel &&
    panel.getAttribute("visibility") ===
      "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";

  if (!isExpanded) {
    const btn = findOpenButton();
    if (!btn) return { error: "no-captions" };
    btn.click();
    await sleep(400);
    panel = document.querySelector(PANEL);
    if (!panel) return { error: "no-panel" };
  }

  // Wait for the panel to fill (it lazy-loads behind a spinner).
  const deadline = Date.now() + (waitMs || 10000);
  let segments = [];
  while (Date.now() < deadline) {
    segments = scrape();
    if (segments.length) break;
    await sleep(250);
  }

  const langLabel =
    document
      .querySelector(
        PANEL +
          " ytd-transcript-footer-renderer #label-text, " +
          PANEL +
          " #footer #label-text"
      )
      ?.textContent?.trim() || "";

  if (!segments.length) return { error: "timeout", langLabel };
  return { segments, langLabel };
}

/* ============================================================
 * INJECTED (ISOLATED world): switch the transcript language by
 * clicking YouTube's footer language menu. Best-effort.
 * @param {string} targetName  language label to select (e.g. "Spanish")
 * @returns {Promise<{ok:boolean}>}
 * ============================================================ */
export async function PAGE_switchLanguage(targetName) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const PANEL =
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
  const panel = document.querySelector(PANEL);
  if (!panel) return { ok: false };

  // The footer holds a dropdown button showing the current language.
  const trigger =
    panel.querySelector(
      "ytd-transcript-footer-renderer tp-yt-paper-button, #footer tp-yt-paper-button, ytd-transcript-footer-renderer #label"
    ) || null;
  if (!trigger) return { ok: false };
  trigger.click();
  await sleep(350);

  // Menu items render in a popup container appended to <body>.
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const want = norm(targetName);
  const items = [
    ...document.querySelectorAll(
      "tp-yt-paper-listbox tp-yt-paper-item, ytd-menu-service-item-renderer, tp-yt-paper-item"
    ),
  ].filter((el) => el.offsetParent !== null);

  const match =
    items.find((el) => norm(el.textContent) === want) ||
    items.find((el) => norm(el.textContent).startsWith(want));

  if (!match) {
    // close the menu again
    document.body.click();
    return { ok: false };
  }
  match.click();
  await sleep(400);
  return { ok: true };
}
