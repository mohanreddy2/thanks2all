function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "\"" && quoted && next === "\"") {
      cell += "\"";
      i += 1;
    } else if (ch === "\"") {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function findCol(header, tests) {
  for (let t = 0; t < tests.length; t += 1) {
    const index = header.findIndex(tests[t]);
    if (index >= 0) return index;
  }
  return -1;
}

function extractUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const fromIframe = raw.match(/\bsrc=["']([^"']+)["']/i);
  return (fromIframe && fromIframe[1]) || raw;
}

function safeHttpUrl(value) {
  const raw = extractUrl(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw, window.location.href);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.href;
  } catch (error) {
    return "";
  }
  return "";
}

function renderEntries(entries, mount) {
  if (!entries.length) {
    mount.innerHTML = "<p class=\"lead\">No diary notes yet. Add one in Google Forms and refresh.</p>";
    return;
  }
  mount.innerHTML = entries.map((entry) => `
    <article class="entry">
      <time>${escapeHtml(entry.date)}</time>
      <h3>${escapeHtml(entry.title)}</h3>
      <p>${escapeHtml(entry.note)}</p>
    </article>
  `).join("");
}

async function loadSeed() {
  const response = await fetch("data/diary.json", { cache: "no-store" });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data) ? data : data.entries || [];
}

async function loadSheet(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("sheet");
  const text = await response.text();
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error("sheet-html");
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((value) => value.trim().toLowerCase());
  const dateIndex = findCol(header, [
    (value) => value === "date",
    (value) => /^date\b/.test(value),
    (value) => value.includes("timestamp")
  ]);
  const titleIndex = findCol(header, [
    (value) => value === "title",
    (value) => value.includes("title"),
    (value) => value.includes("thank")
  ]);
  const noteIndex = findCol(header, [
    (value) => value === "note",
    (value) => value.includes("note"),
    (value) => value.includes("message")
  ]);
  return rows.slice(1).map((row) => ({
    date: ((dateIndex >= 0 ? row[dateIndex] : "") || "").trim(),
    title: ((titleIndex >= 0 ? row[titleIndex] : "") || "Daily note").trim() || "Daily note",
    note: ((noteIndex >= 0 ? row[noteIndex] : "") || row.slice(1).join(" ")).trim()
  })).filter((entry) => entry.note || entry.title !== "Daily note").reverse();
}

const FORMS_HOME = "https://docs.google.com/forms/u/0/?pli=1";
const SHEETS_HOME = "https://docs.google.com/spreadsheets/u/0/?pli=1";

function sheetEmbedUrl(config) {
  const embed = safeHttpUrl(config.sheetEmbed);
  if (embed) return embed;
  const csv = safeHttpUrl(config.sheetCsv);
  const published = csv.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/([^/?]+)\/pub/i);
  if (published) {
    return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pubhtml?widget=true&headers=false`;
  }
  return "";
}

function formShareUrl(config) {
  return safeHttpUrl(config.formShare) || FORMS_HOME;
}

function sheetShareUrl(config) {
  const share = safeHttpUrl(config.sheetShare);
  if (share) return share;
  const embed = safeHttpUrl(config.sheetEmbed);
  if (embed && !/\/pubhtml/i.test(embed)) return embed;
  return SHEETS_HOME;
}

function shareMessage(kind, url) {
  if (kind === "form") return `thanks2all diary — Google Forms\n${url}`;
  return `thanks2all diary — Google Sheets\n${url}`;
}

function openWhatsApp(text) {
  const href = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const mobile = /Mobi|Android|iPhone/i.test(navigator.userAgent || "");
  if (mobile && navigator.share) {
    navigator.share({ text }).catch((error) => {
      if (error && error.name === "AbortError") return;
      window.location.href = href;
    });
    return;
  }
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function copyLink(url, button) {
  const label = button ? button.textContent : "";
  try {
    await navigator.clipboard.writeText(url);
    if (button) {
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = label; }, 1600);
    }
  } catch (error) {
    window.prompt("Copy this link", url);
  }
}

function wireShare(config) {
  const formUrl = formShareUrl(config);
  const sheetUrl = sheetShareUrl(config);
  const formPreview = document.querySelector("[data-form-preview]");
  const sheetPreview = document.querySelector("[data-sheet-preview]");
  if (formPreview) formPreview.textContent = shareMessage("form", formUrl);
  if (sheetPreview) sheetPreview.textContent = shareMessage("sheet", sheetUrl);
  document.querySelector("[data-share-form-wa]")?.addEventListener("click", () => {
    openWhatsApp(shareMessage("form", formUrl));
  });
  document.querySelector("[data-copy-form]")?.addEventListener("click", (event) => {
    copyLink(formUrl, event.currentTarget);
  });
  document.querySelector("[data-share-sheet-wa]")?.addEventListener("click", () => {
    openWhatsApp(shareMessage("sheet", sheetUrl));
  });
  document.querySelector("[data-copy-sheet]")?.addEventListener("click", (event) => {
    copyLink(sheetUrl, event.currentTarget);
  });
}

(async function startDiary() {
  const mount = document.querySelector("[data-diary]");
  const formFrame = document.querySelector("[data-form-embed]");
  const sheetFrame = document.querySelector("[data-sheet-embed]");
  if (!mount) return;
  let config = window.THANKS_DIARY || {};
  try {
    const live = await (await fetch("content.json", { cache: "no-store" })).json();
    config = { ...config, ...live };
  } catch (error) {
    config = window.THANKS_DIARY || {};
  }
  const formEmbed = safeHttpUrl(config.formEmbed);
  if (formFrame && formEmbed) {
    formFrame.src = formEmbed;
    formFrame.hidden = false;
  }
  const embed = sheetEmbedUrl(config);
  if (sheetFrame && embed) {
    sheetFrame.src = embed;
    sheetFrame.hidden = false;
  }
  wireShare(config);
  try {
    const csvUrl = safeHttpUrl(config.sheetCsv);
    const entries = csvUrl ? await loadSheet(csvUrl) : await loadSeed();
    renderEntries(entries, mount);
  } catch (error) {
    const entries = await loadSeed();
    renderEntries(entries, mount);
  }
})();
