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
  return response.json();
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

(async function startDiary() {
  const mount = document.querySelector("[data-diary]");
  const formFrame = document.querySelector("[data-form-embed]");
  if (!mount) return;
  const config = window.THANKS_DIARY || {};
  if (formFrame && config.formEmbed) {
    formFrame.src = config.formEmbed;
    formFrame.hidden = false;
  }
  try {
    const entries = config.sheetCsv ? await loadSheet(config.sheetCsv) : await loadSeed();
    renderEntries(entries, mount);
  } catch (error) {
    const entries = await loadSeed();
    renderEntries(entries, mount);
  }
})();
