(async function applyLiveContent() {
  const nodes = document.querySelectorAll("[data-content], [data-content-html], [data-href], [data-src]");
  if (!nodes.length) return;
  try {
    const response = await fetch("content.json", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    let sheet = {};
    if (data.sheetCsv) {
      try {
        const csv = await (await fetch(data.sheetCsv, { cache: "no-store" })).text();
        sheet = parseSheet(csv);
      } catch (error) {
        sheet = {};
      }
    }
    const content = { ...data, ...sheet };
    if (content.support_email) {
      content.support_email_mailto = "mailto:" + String(content.support_email).replace(/^mailto:/, "");
    }
    nodes.forEach((node) => {
      const hrefKey = node.getAttribute("data-href");
      const srcKey = node.getAttribute("data-src");
      const htmlKey = node.getAttribute("data-content-html");
      const key = hrefKey || srcKey || htmlKey || node.getAttribute("data-content");
      const value = content[key];
      if (value == null || value === "") return;
      if (hrefKey) {
        node.setAttribute("href", value);
        if (node.matches("a[data-content]")) node.textContent = value.replace(/^mailto:/, "");
        return;
      }
      if (srcKey) {
        node.setAttribute("src", value);
        return;
      }
      if (htmlKey) {
        node.innerHTML = String(value)
          .split(/\n{2,}/)
          .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
          .join("");
      } else {
        node.textContent = value;
      }
    });
  } catch (error) {
    return;
  }
})();

function parseSheet(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return {};
  const header = splitCsvLine(lines[0]).map((value) => value.trim().toLowerCase());
  const keyIndex = header.findIndex((value) => value === "key" || value === "field");
  const valueIndex = header.findIndex((value) => value === "value" || value === "text");
  if (keyIndex < 0 || valueIndex < 0) return {};
  const out = {};
  lines.slice(1).forEach((line) => {
    const cols = splitCsvLine(line);
    const key = (cols[keyIndex] || "").trim();
    const value = (cols[valueIndex] || "").trim();
    if (key) out[key] = value;
  });
  return out;
}

function splitCsvLine(line) {
  const cols = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"" && quoted && line[i + 1] === "\"") {
      cell += "\"";
      i += 1;
    } else if (ch === "\"") {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      cols.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cols.push(cell);
  return cols;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
