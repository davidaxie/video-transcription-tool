// sidepanel.js — UI controller for Transcript Grabber.
import {
  getVideoId,
  PAGE_readMeta,
  PAGE_scrapeTranscript,
  PAGE_switchLanguage,
} from "./transcript.js";

const els = {
  reload: document.getElementById("reload"),
  meta: document.getElementById("meta"),
  title: document.getElementById("videoTitle"),
  author: document.getElementById("videoAuthor"),
  toolbar: document.getElementById("toolbar"),
  langField: document.querySelector(".field"),
  langSelect: document.getElementById("langSelect"),
  tsToggle: document.getElementById("tsToggle"),
  copyBtn: document.getElementById("copyBtn"),
  copyAiBtn: document.getElementById("copyAiBtn"),
  dlMdBtn: document.getElementById("dlMdBtn"),
  dlTxtBtn: document.getElementById("dlTxtBtn"),
  stats: document.getElementById("stats"),
  status: document.getElementById("status"),
  transcript: document.getElementById("transcript"),
  toast: document.getElementById("toast"),
};

const AI_PROMPT =
  "Summarize the following video transcript. Give me a short overview, " +
  "the key points as bullets, and any important takeaways or action items.\n\n";

const state = {
  tabId: null,
  videoId: null,
  videoUrl: "",
  title: "",
  author: "",
  tracks: [],
  trackIndex: 0,
  segments: [],
  showTimestamps: false,
};

/* ---------------- Injection ---------------- */

async function inject(func, args = [], world = "MAIN") {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: state.tabId },
    world,
    func,
    args,
  });
  return res?.result;
}

/* ---------------- Helpers ---------------- */

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function sanitizeFilename(name) {
  return (
    (name || "transcript")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "transcript"
  );
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");
  requestAnimationFrame(() => els.toast.classList.add("show"));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    els.toast.classList.remove("show");
    setTimeout(() => els.toast.classList.add("hidden"), 220);
  }, 1600);
}

function setStatus(title, sub, { error = false, loading = false } = {}) {
  els.transcript.classList.add("hidden");
  els.status.classList.remove("hidden");
  els.status.classList.toggle("error", error);
  els.status.innerHTML = `
    ${loading ? '<div class="spinner"></div>' : ""}
    <p class="status-title"></p>
    ${sub ? '<p class="status-sub"></p>' : ""}`;
  els.status.querySelector(".status-title").textContent = title;
  if (sub) els.status.querySelector(".status-sub").textContent = sub;
}

/**
 * Group short caption cues into readable paragraphs. Without per-cue durations
 * we break on a sentence end once a paragraph is long enough, or hard-break if
 * it runs too long without punctuation.
 */
function toParagraphs(segments) {
  const paras = [];
  const SOFT = 260; // prefer to end a paragraph here if a sentence closes
  const HARD = 500; // force a break here (e.g. auto-captions with no punctuation)
  let cur = null;
  for (const seg of segments) {
    if (!cur) cur = { start: seg.start, text: seg.text };
    else cur.text += " " + seg.text;
    const len = cur.text.length;
    const endsSentence = /[.!?]["')\]]?$/.test(cur.text.trim());
    if ((len >= SOFT && endsSentence) || len >= HARD) {
      paras.push(cur);
      cur = null;
    }
  }
  if (cur) paras.push(cur);
  return paras;
}

/* ---------------- Rendering ---------------- */

function render() {
  els.status.classList.add("hidden");
  els.transcript.classList.remove("hidden");
  els.transcript.innerHTML = "";

  const makeTs = (cls, seconds) => {
    const a = document.createElement("a");
    a.className = cls;
    a.textContent = formatTime(seconds);
    a.href = "#";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      seekTo(seconds);
    });
    return a;
  };

  if (state.showTimestamps) {
    for (const seg of state.segments) {
      const cue = document.createElement("div");
      cue.className = "cue";
      const text = document.createElement("div");
      text.className = "cue-text";
      text.textContent = seg.text;
      cue.append(makeTs("cue-ts", seg.start), text);
      els.transcript.appendChild(cue);
    }
  } else {
    for (const para of toParagraphs(state.segments)) {
      const p = document.createElement("p");
      p.className = "para";
      p.appendChild(makeTs("para-ts", para.start));
      p.appendChild(document.createTextNode(para.text));
      els.transcript.appendChild(p);
    }
  }

  const words = state.segments.reduce(
    (n, s) => n + s.text.split(/\s+/).filter(Boolean).length,
    0
  );
  const last = state.segments[state.segments.length - 1];
  const len = last ? formatTime(last.start) : "0:00";
  els.stats.textContent = `${state.segments.length} lines · ${words.toLocaleString()} words · to ${len}`;
}

/* ---------------- Export formats ---------------- */

function plainText() {
  if (state.showTimestamps) {
    return state.segments
      .map((s) => `[${formatTime(s.start)}] ${s.text}`)
      .join("\n");
  }
  return toParagraphs(state.segments)
    .map((p) => p.text)
    .join("\n\n");
}

function markdown() {
  const lines = [`# ${state.title || "Video Transcript"}`, ""];
  if (state.author) lines.push(`**Channel:** ${state.author}  `);
  if (state.videoUrl) lines.push(`**Source:** ${state.videoUrl}  `);
  const track = state.tracks[state.trackIndex];
  if (track) lines.push(`**Language:** ${track.name}  `);
  lines.push("", "---", "");

  if (state.showTimestamps) {
    for (const s of state.segments) {
      lines.push(`- \`${formatTime(s.start)}\` ${s.text}`);
    }
  } else {
    for (const p of toParagraphs(state.segments)) {
      lines.push(`\`${formatTime(p.start)}\``, "", p.text, "");
    }
  }
  return lines.join("\n");
}

function download(content, ext) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(state.title)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(label);
  } catch {
    showToast("Copy failed");
  }
}

/* ---------------- Video control ---------------- */

async function seekTo(seconds) {
  if (state.tabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      world: "MAIN",
      func: (t) => {
        const v = document.querySelector("video");
        if (v) {
          v.currentTime = t;
          v.play?.();
        }
      },
      args: [seconds],
    });
  } catch {
    /* tab may have navigated away; ignore */
  }
}

/* ---------------- Loading ---------------- */

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function load() {
  els.reload.classList.add("spin");
  try {
    const tab = await getActiveTab();
    if (!tab) {
      setStatus("No active tab", "Open a YouTube video and try again.");
      return hideChrome();
    }
    state.tabId = tab.id;
    const videoId = getVideoId(tab.url);
    if (!videoId) {
      setStatus(
        "Not a YouTube video",
        "Open a youtube.com watch, Shorts, or embed page, then click Reload."
      );
      return hideChrome();
    }
    state.videoId = videoId;
    state.videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    setStatus("Reading video…", "", { loading: true });
    let meta = {};
    try {
      meta = (await inject(PAGE_readMeta, [], "MAIN")) || {};
    } catch (e) {
      // Injection blocked (e.g. not granted on this page)
    }
    state.title = meta.title || "";
    state.author = meta.author || "";
    state.tracks = meta.tracks || [];

    setStatus("Opening transcript…", "This can take a few seconds.", {
      loading: true,
    });
    const result = await inject(PAGE_scrapeTranscript, [12000], "MAIN");

    if (!result || result.error) {
      const code = result?.error;
      if (code === "no-captions") {
        setStatus(
          "No transcript available",
          "This video has no captions, or the uploader disabled them."
        );
      } else {
        setStatus(
          "Couldn't load the transcript",
          "Make sure the video has captions and is playing, then click Reload.",
          { error: true }
        );
      }
      return hideChrome();
    }

    state.segments = result.segments;

    // Pick the language track that matches what the panel showed.
    if (state.tracks.length) {
      const label = (result.langLabel || meta.defaultName || "").toLowerCase();
      const idx = state.tracks.findIndex(
        (t) => t.name.toLowerCase() === label
      );
      state.trackIndex = idx !== -1 ? idx : 0;
      populateLangSelect();
      els.langField?.classList.remove("hidden");
    } else {
      els.langField?.classList.add("hidden");
    }

    els.title.textContent = state.title || "Untitled video";
    els.author.textContent = state.author || "";
    els.meta.classList.remove("hidden");
    els.toolbar.classList.remove("hidden");
    render();
  } catch (err) {
    console.error(err);
    setStatus("Something went wrong", String(err?.message || err), {
      error: true,
    });
    hideChrome();
  } finally {
    els.reload.classList.remove("spin");
  }
}

function populateLangSelect() {
  els.langSelect.innerHTML = "";
  state.tracks.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = t.kind === "asr" ? `${t.name} (auto)` : t.name;
    els.langSelect.appendChild(opt);
  });
  els.langSelect.value = String(state.trackIndex);
}

async function changeLanguage() {
  const idx = parseInt(els.langSelect.value, 10) || 0;
  if (idx === state.trackIndex) return;
  const prevIndex = state.trackIndex;
  const track = state.tracks[idx];
  setStatus(`Switching to ${track.name}…`, "", { loading: true });
  try {
    const sw = await inject(PAGE_switchLanguage, [track.name], "MAIN");
    if (!sw?.ok) throw new Error("switch-failed");
    const result = await inject(PAGE_scrapeTranscript, [10000], "MAIN");
    if (!result?.segments?.length) throw new Error("no-segments");
    state.trackIndex = idx;
    state.segments = result.segments;
    render();
  } catch {
    els.langSelect.value = String(prevIndex);
    render();
    showToast("Couldn't switch language");
  }
}

function hideChrome() {
  els.meta.classList.add("hidden");
  els.toolbar.classList.add("hidden");
}

/* ---------------- Events ---------------- */

els.reload.addEventListener("click", load);
els.langSelect.addEventListener("change", changeLanguage);

els.tsToggle.addEventListener("change", () => {
  state.showTimestamps = els.tsToggle.checked;
  render();
});

els.copyBtn.addEventListener("click", () =>
  copy(plainText(), "Transcript copied")
);
els.copyAiBtn.addEventListener("click", () =>
  copy(AI_PROMPT + plainText(), "Copied with AI prompt")
);
els.dlMdBtn.addEventListener("click", () => download(markdown(), "md"));
els.dlTxtBtn.addEventListener("click", () => download(plainText(), "txt"));

// Auto-refresh when the user switches to a different video/tab.
let lastLoadedId = null;
async function maybeAutoLoad() {
  const tab = await getActiveTab();
  const id = tab ? getVideoId(tab.url) : null;
  if (id && id !== lastLoadedId) {
    lastLoadedId = id;
    await load();
  }
}

chrome.tabs.onActivated.addListener(maybeAutoLoad);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) maybeAutoLoad();
});

// Initial load.
(async () => {
  const tab = await getActiveTab();
  lastLoadedId = tab ? getVideoId(tab.url) : null;
  await load();
})();
