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

function renderEntries(entries, mount) {
  if (!entries.length) {
    mount.innerHTML = "<p class=\"lead\">No diary notes yet. Add one in Google Sheets and refresh.</p>";
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
  const response = await fetch("data/diary.json");
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data) ? data : data.entries || [];
}

async function loadSheet(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("sheet");
  const rows = parseCsv(await response.text());
  if (rows.length < 2) return [];
  const header = rows[0].map((value) => value.trim().toLowerCase());
  const dateIndex = header.findIndex((value) => value.includes("date"));
  const titleIndex = header.findIndex((value) => value.includes("title") || value.includes("thank"));
  const noteIndex = header.findIndex((value) => value.includes("note") || value.includes("message"));
  return rows.slice(1).map((row) => ({
    date: (row[dateIndex] || "").trim(),
    title: (row[titleIndex] || "Daily note").trim(),
    note: (row[noteIndex] || row.slice(1).join(" ")).trim()
  })).filter((entry) => entry.note).reverse();
}

const FORMS_HOME = "https://docs.google.com/forms/u/0/?pli=1";
const SHEETS_HOME = "https://docs.google.com/spreadsheets/u/0/?pli=1";

function cleanUrl(value) {
  return String(value || "").trim();
}

function sheetEmbedUrl(config) {
  const embed = cleanUrl(config.sheetEmbed);
  if (embed) return embed;
  const csv = cleanUrl(config.sheetCsv);
  const published = csv.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/([^/?]+)\/pub/i);
  if (published) {
    return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pubhtml?widget=true&headers=false`;
  }
  return "";
}

function formShareUrl(config) {
  return cleanUrl(config.formShare) || FORMS_HOME;
}

function sheetShareUrl(config) {
  const share = cleanUrl(config.sheetShare);
  if (share) return share;
  const embed = cleanUrl(config.sheetEmbed);
  if (embed && !/\/pubhtml/i.test(embed)) return embed;
  return SHEETS_HOME;
}

function shareMessage(kind, url) {
  if (kind === "form") return `thanks2all diary — Google Forms\n${url}`;
  return `thanks2all diary — Google Sheets\n${url}`;
}

function openWhatsApp(text) {
  const href = `https://wa.me/?text=${encodeURIComponent(text)}`;
  if (navigator.share) {
    navigator.share({ text }).catch(() => { window.location.href = href; });
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
  if (formFrame && config.formEmbed) {
    formFrame.src = config.formEmbed;
    formFrame.hidden = false;
  }
  const embed = sheetEmbedUrl(config);
  if (sheetFrame && embed) {
    sheetFrame.src = embed;
    sheetFrame.hidden = false;
  }
  wireShare(config);
  try {
    const entries = config.sheetCsv ? await loadSheet(config.sheetCsv) : await loadSeed();
    renderEntries(entries, mount);
  } catch (error) {
    const entries = await loadSeed();
    renderEntries(entries, mount);
  }
})();

