(() => {
  const LS_SALT = "thanks2all-books-salt";
  const LS_VAULT = "thanks2all-books-vault";
  const KHATA_API = "https://dailycart-api.onrender.com/api/khata";
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const CURRENCIES = ["INR", "SGD", "MYR"];
  const STARTER_PEOPLE = [
    { name: "Rajesh", notes: "" },
    { name: "Eswaranna", notes: "" },
    { name: "Venky", notes: "" },
    { name: "Lokesh", notes: "" },
    { name: "Vishnu", notes: "" },
    { name: "JB trip", notes: "Malaysia / Johor Bahru split" }
  ];

  const app = document.getElementById("app");
  const state = {
    key: null,
    data: emptyData(),
    view: "home",
    personId: null,
    txnId: null,
    error: "",
    notice: "",
    pin: null,
    saltB64: null,
    cloudClaimed: false,
    cloudReady: false,
    cloudOk: false,
    shareId: null,
    shareSnap: null
  };

  function emptyData() {
    return { version: 1, people: [], txns: [] };
  }

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function b64(bytes) {
    let s = "";
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  }

  function unb64(text) {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function deriveKey(pin, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 180000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptData(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data)));
    return `${b64(iv)}.${b64(new Uint8Array(cipher))}`;
  }

  async function decryptData(blob, key) {
    const [ivPart, dataPart] = String(blob).split(".");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(ivPart) },
      key,
      unb64(dataPart)
    );
    return JSON.parse(dec.decode(plain));
  }

  async function save(notice) {
    if (!state.key) return;
    const blob = await encryptData(state.data, state.key);
    const saltB64 = state.saltB64 || localStorage.getItem(LS_SALT);
    localStorage.setItem(LS_SALT, saltB64);
    localStorage.setItem(LS_VAULT, blob);
    let cloudNote = "";
    try {
      if (!state.cloudClaimed) {
        await khata("register", { pin: state.pin, salt: saltB64, vault: blob });
        state.cloudClaimed = true;
      } else {
        await khata("save", { pin: state.pin, vault: blob });
      }
      state.cloudOk = true;
      cloudNote = " Saved online for every device.";
    } catch (err) {
      if (/already exist/i.test(err.message)) {
        try {
          await khata("save", { pin: state.pin, vault: blob });
          state.cloudClaimed = true;
          state.cloudOk = true;
          cloudNote = " Saved online for every device.";
        } catch (err2) {
          state.cloudOk = false;
          cloudNote = " Saved on this device only — cloud: " + err2.message;
        }
      } else {
        state.cloudOk = false;
        cloudNote = " Saved on this device only — cloud: " + err.message;
      }
    }
    if (notice) state.notice = notice + cloudNote;
  }

  async function khata(path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(`${KHATA_API}/${path}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json.detail;
        const msg = typeof detail === "string" ? detail : (json.error || res.statusText);
        throw new Error(msg);
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  function money(amount, currency) {
    const n = Number(amount) || 0;
    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency,
        maximumFractionDigits: 2
      }).format(n);
    } catch {
      return `${currency} ${n.toLocaleString("en-IN")}`;
    }
  }

  function sheetFor(personId) {
    const given = {};
    const received = {};
    for (const t of state.data.txns) {
      if (t.personId !== personId || t.include === false) continue;
      const cur = t.currency || "INR";
      const amt = Number(t.amount) || 0;
      if (t.direction === "in") received[cur] = (received[cur] || 0) + amt;
      else given[cur] = (given[cur] || 0) + amt;
    }
    const currencies = [...new Set([...Object.keys(given), ...Object.keys(received)])];
    return currencies.map((cur) => {
      const g = given[cur] || 0;
      const r = received[cur] || 0;
      return { currency: cur, given: g, received: r, balance: g - r };
    });
  }

  function balancesFor(personId) {
    const sums = {};
    for (const row of sheetFor(personId)) sums[row.currency] = row.balance;
    return sums;
  }

  function formatBals(sums) {
    const parts = Object.entries(sums).filter(([, n]) => Math.abs(n) > 0.0001);
    if (!parts.length) return '<span class="bal bal-zero">Settled</span>';
    return parts.map(([cur, n]) => {
      const cls = n > 0 ? "bal-out" : "bal-in";
      const label = n > 0 ? "they owe you" : "you owe them";
      return `<div class="bal ${cls}">${esc(money(Math.abs(n), cur))} ${label}</div>`;
    }).join("");
  }

  function ledgerFor(personId) {
    const rows = state.data.txns
      .filter((t) => t.personId === personId)
      .slice()
      .sort((a, b) => {
        const d = String(a.date).localeCompare(String(b.date));
        return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
      });
    const run = {};
    return rows.map((t) => {
      const cur = t.currency || "INR";
      if (t.include !== false) {
        const signed = t.direction === "in" ? -Number(t.amount) : Number(t.amount);
        run[cur] = (run[cur] || 0) + signed;
      }
      return { ...t, running: run[cur] || 0 };
    });
  }

  function personById(id) {
    return state.data.people.find((p) => p.id === id);
  }

  function noticeHtml() {
    if (!state.notice) return "";
    return `<p class="notice">${esc(state.notice)}</p>`;
  }

  function parseHash() {
    const h = (location.hash || "#").slice(1);
    if (h.startsWith("s/")) {
      state.view = "share";
      state.shareId = h.slice(2);
      state.personId = null;
      state.txnId = null;
      return;
    }
    if (h.startsWith("p/")) {
      state.view = "person";
      state.personId = h.slice(2);
      state.txnId = null;
      return;
    }
    if (h.startsWith("edit/")) {
      state.view = "edit";
      state.txnId = h.slice(5);
      const t = state.data.txns.find((x) => x.id === state.txnId);
      state.personId = t ? t.personId : null;
      return;
    }
    if (h === "new") {
      state.view = "new";
      return;
    }
    if (h === "person-new") {
      state.view = "person-new";
      state.personId = null;
      return;
    }
    if (h.startsWith("person-edit/")) {
      state.view = "person-edit";
      state.personId = h.slice("person-edit/".length);
      return;
    }
    if (h === "settings") {
      state.view = "settings";
      return;
    }
    state.view = "home";
    state.personId = null;
    state.txnId = null;
  }

  function hasVault() {
    return state.cloudClaimed || Boolean(localStorage.getItem(LS_SALT) && localStorage.getItem(LS_VAULT));
  }

  function renderLock() {
    if (!state.cloudReady) {
      app.innerHTML = `
        <section class="page-head books-lock">
          <p class="eyebrow">Private ledger</p>
          <h1>Connecting to your books</h1>
          <p class="lead">Opening the online vault so you can use the same PIN on any device…</p>
        </section>`;
      return;
    }
    const setup = !hasVault();
    app.innerHTML = `
      <section class="page-head books-lock">
        <p class="eyebrow">Private ledger</p>
        <h1>${setup ? "Set a PIN for your books" : "Open your books"}</h1>
        <p class="lead">${setup
          ? "Choose a PIN. The ledger is saved online. Use this same PIN on your phone, laptop, or any browser."
          : "Enter the same PIN on any device. Your running ledger is stored in the cloud."}</p>
        <form class="books-panel" data-lock>
          <label>${setup ? "New PIN (4 or more digits)" : "PIN"}
            <input name="pin" type="password" inputmode="numeric" autocomplete="off" required minlength="4">
          </label>
          ${setup ? `<label>Type PIN again<input name="pin2" type="password" inputmode="numeric" autocomplete="off" required minlength="4"></label>` : ""}
          <p class="form-note warn">${esc(state.error)}</p>
          <button class="btn btn-primary" type="submit">${setup ? "Create books" : "Unlock"}</button>
        </form>
        ${setup ? `<p class="muted">If you forget the PIN, restore from a JSON backup in Backup & PIN.</p>` : ""}
      </section>`;
  }

  function homeTotals() {
    const sums = {};
    for (const p of state.data.people) {
      const b = balancesFor(p.id);
      for (const [cur, n] of Object.entries(b)) sums[cur] = (sums[cur] || 0) + n;
    }
    return sums;
  }

  function renderHome() {
    const totals = homeTotals();
    const people = [...state.data.people].sort((a, b) => a.name.localeCompare(b.name));
    const usedCur = [...new Set(people.flatMap((p) => Object.keys(balancesFor(p.id))))];
    const cols = usedCur.length ? usedCur : CURRENCIES;
    app.innerHTML = `
      <section class="page-head">
        <p class="eyebrow">Private ledger</p>
        <h1>Accounts with me</h1>
        <p class="lead">Unlock with your PIN from any device. Add or edit a person, then save or change any credit. Every save publishes the same balance sheet online.</p>
        ${noticeHtml()}
      </section>
      <div class="books-stats">
        ${Object.keys(totals).length
          ? Object.entries(totals).map(([cur, n]) => `
            <div class="books-stat">
              <strong>${esc(money(Math.abs(n), cur))}</strong>
              <span>${n >= 0 ? "they owe you" : "you owe them"} · ${esc(cur)}</span>
            </div>`).join("")
          : `<div class="books-stat"><strong>${people.length} ${people.length === 1 ? "person" : "people"}</strong><span>${people.length ? "No ledger lines yet — add a credit below" : "Add a person to start"}</span></div>`}
      </div>
      <div class="toolbar">
        <a class="btn btn-primary" href="#person-new">Add person</a>
        <a class="btn btn-ghost" href="#new">Save a credit</a>
        <a class="btn btn-ghost" href="#settings">Backup & PIN</a>
        <button class="btn btn-ghost" type="button" data-lock-now>Lock</button>
      </div>
      ${people.length ? `
      <h2>Balance sheet</h2>
      <p class="muted">Positive means they owe you. Negative means you owe them. INR, SGD and MYR are never added together.</p>
      <div class="ledger-wrap">
        <table class="ledger home-sheet">
          <thead>
            <tr>
              <th>Person</th>
              ${cols.map((c) => `<th class="num">${esc(c)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${people.map((p) => {
              const b = balancesFor(p.id);
              return `<tr data-open-person="${esc(p.id)}">
                <td><strong>${esc(p.name)}</strong></td>
                ${cols.map((c) => {
                  const n = b[c] || 0;
                  if (Math.abs(n) < 0.0001) return `<td class="num muted">—</td>`;
                  const cls = n > 0 ? "bal-out" : "bal-in";
                  return `<td class="num ${cls}">${esc(money(n, c))}</td>`;
                }).join("")}
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : ""}
      <div class="people-grid">
        ${people.length ? people.map((p) => `
          <a class="person-card" href="#p/${esc(p.id)}">
            <h2>${esc(p.name)}</h2>
            ${formatBals(balancesFor(p.id))}
            ${p.notes ? `<p class="muted">${esc(p.notes)}</p>` : ""}
            <p class="muted">${state.data.txns.filter((t) => t.personId === p.id).length} ledger line(s) · tap to open, edit any time</p>
          </a>`).join("") : `<p class="muted">Add the first person, then save credits as they happen.</p>`}
      </div>`;
  }

  function sheetCards(personId) {
    const rows = sheetFor(personId);
    if (!rows.length) {
      return `<div class="sheet-card"><span class="bal bal-zero">Settled — no counted credits yet</span></div>`;
    }
    return `<div class="books-stats">${rows.map((row) => `
      <div class="sheet-card">
        <h3>${esc(row.currency)}</h3>
        <div class="sheet-line"><span>I gave them</span><strong class="bal-out">${esc(money(row.given, row.currency))}</strong></div>
        <div class="sheet-line"><span>They gave me</span><strong class="bal-in">${esc(money(row.received, row.currency))}</strong></div>
        <div class="sheet-line"><span>Balance</span><strong class="${row.balance > 0 ? "bal-out" : row.balance < 0 ? "bal-in" : "bal-zero"}">${
          Math.abs(row.balance) < 0.0001
            ? "Settled"
            : `${esc(money(Math.abs(row.balance), row.currency))} ${row.balance > 0 ? "they owe you" : "you owe them"}`
        }</strong></div>
      </div>`).join("")}</div>`;
  }

  function txnForm(txn, personId) {
    const t = txn || {
      date: new Date().toISOString().slice(0, 10),
      description: "",
      amount: "",
      currency: "INR",
      direction: "out",
      include: true,
      remarks: "",
      personId
    };
    return `
      <form class="books-panel" data-txn="${esc(txn ? txn.id : "")}">
        <h2>${txn ? "Edit this transaction" : "Save a new credit"}</h2>
        <label>Person
          <select name="personId" required>
            ${state.data.people.map((p) => `<option value="${esc(p.id)}" ${p.id === t.personId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
          </select>
        </label>
        <div class="row-2">
          <label>Date<input name="date" type="date" required value="${esc(t.date || "")}"></label>
          <label>Amount<input name="amount" type="number" step="0.01" min="0" required value="${esc(t.amount ?? "")}"></label>
        </div>
        <div class="row-2">
          <label>Currency
            <select name="currency">
              ${CURRENCIES.map((c) => `<option ${c === t.currency ? "selected" : ""}>${c}</option>`).join("")}
            </select>
          </label>
          <label>Who gave credit
            <select name="direction">
              <option value="out" ${t.direction === "out" ? "selected" : ""}>I gave them (they owe me)</option>
              <option value="in" ${t.direction === "in" ? "selected" : ""}>They gave me (I owe them)</option>
            </select>
          </label>
        </div>
        <label>Particulars<input name="description" required value="${esc(t.description || "")}" placeholder="PhonePe, Trust Bank, mangoes"></label>
        <label>Remarks<input name="remarks" value="${esc(t.remarks || "")}" placeholder="Optional"></label>
        <label class="check"><input name="include" type="checkbox" ${t.include !== false ? "checked" : ""}> Count on the balance sheet</label>
        <p class="form-note warn">${esc(state.error)}</p>
        <div class="toolbar">
          <button class="btn btn-primary" type="submit">${txn ? "Update & publish" : "Save to ledger"}</button>
          ${txn ? `<button class="btn danger" type="button" data-delete-txn="${esc(txn.id)}">Delete</button>` : ""}
        </div>
      </form>`;
  }

  function renderPerson() {
    const p = personById(state.personId);
    if (!p) {
      app.innerHTML = `<p>Person not found. <a class="back" href="#">Back</a></p>`;
      return;
    }
    const rows = ledgerFor(p.id);
    app.innerHTML = `
      <section class="page-head">
        <p><a class="back" href="#">← Balance sheet</a></p>
        <p class="eyebrow">Ledger</p>
        <h1>${esc(p.name)}</h1>
        ${p.notes ? `<p class="lead">${esc(p.notes)}</p>` : ""}
        ${noticeHtml()}
        <div class="toolbar">
          <a class="btn btn-ghost" href="#person-edit/${esc(p.id)}">Edit person</a>
        </div>
      </section>
      ${sheetCards(p.id)}
      <div class="books-panel share-box">
        <h2>Share with ${esc(p.name)}</h2>
        <p class="muted">WhatsApp gets only these transactions — no extra links.</p>
        <pre class="share-preview">${esc(shareMessage(p))}</pre>
        <div class="toolbar">
          <button class="btn btn-primary" type="button" data-share-wa="${esc(p.id)}">Share on WhatsApp</button>
          <button class="btn btn-ghost" type="button" data-copy-share="${esc(p.id)}">Copy text</button>
        </div>
      </div>
      <h2>Running ledger</h2>
      <p class="muted">Oldest first. Tap <strong>Edit</strong> on any existing line to change it. Save publishes the same books on every device.</p>
      ${rows.length ? `
      <div class="ledger-wrap">
        <table class="ledger">
          <thead>
            <tr>
              <th>Date</th>
              <th>Particulars</th>
              <th class="num">I gave</th>
              <th class="num">They gave</th>
              <th class="num">Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((t) => {
              const gave = t.direction === "out" ? money(t.amount, t.currency) : "—";
              const got = t.direction === "in" ? money(t.amount, t.currency) : "—";
              const skip = t.include === false ? " · note only" : "";
              return `<tr data-edit-txn="${esc(t.id)}">
                <td>${esc(t.date)}</td>
                <td>${esc(t.description)}${t.remarks ? `<div class="muted">${esc(t.remarks)}</div>` : ""}</td>
                <td class="num bal-out">${esc(gave)}</td>
                <td class="num bal-in">${esc(got)}</td>
                <td class="num">${t.include === false ? "—" : esc(money(t.running, t.currency))}</td>
                <td class="ledger-actions">
                  <span class="muted">${esc(t.currency)}${skip}</span>
                  <a class="btn btn-ghost btn-edit" href="#edit/${esc(t.id)}">Edit</a>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : `<p class="muted">No lines yet. Save a credit below. It will stay on this ledger.</p>`}
      ${txnForm(null, p.id)}`;
  }

  function renderNew() {
    if (!state.data.people.length) {
      app.innerHTML = `<section class="page-head"><h1>Add a person first</h1><p><a class="btn btn-primary" href="#person-new">Add person</a></p></section>`;
      return;
    }
    app.innerHTML = `
      <section class="page-head">
        <p><a class="back" href="#">← Books</a></p>
        <h1>Save a credit</h1>
        ${noticeHtml()}
      </section>
      ${txnForm(null, state.data.people[0].id)}`;
  }

  function renderEdit() {
    const t = state.data.txns.find((x) => x.id === state.txnId);
    if (!t) {
      app.innerHTML = `<p>Entry not found. <a class="back" href="#">Back</a></p>`;
      return;
    }
    app.innerHTML = `
      <section class="page-head">
        <p><a class="back" href="#p/${esc(t.personId)}">← ${esc(personById(t.personId)?.name || "Person")}</a></p>
        <p class="eyebrow">Existing credit</p>
        <h1>Edit this transaction</h1>
        <p class="lead">Change date, amount, currency, or particulars any time. Save publishes the same line on every device.</p>
        ${noticeHtml()}
      </section>
      ${txnForm(t, t.personId)}`;
  }

  function personForm(person) {
    const p = person || { id: "", name: "", notes: "" };
    return `
      <form class="books-panel" data-person="${esc(p.id)}">
        <label>Name<input name="name" required placeholder="New person" value="${esc(p.name)}"></label>
        <label>Notes<input name="notes" placeholder="Optional" value="${esc(p.notes)}"></label>
        <p class="form-note warn">${esc(state.error)}</p>
        <div class="toolbar">
          <button class="btn btn-primary" type="submit">${p.id ? "Save person" : "Add person"}</button>
          ${p.id ? `<button class="btn danger" type="button" data-delete-person="${esc(p.id)}">Delete person</button>` : ""}
        </div>
      </form>`;
  }

  function renderPersonNew() {
    app.innerHTML = `
      <section class="page-head">
        <p><a class="back" href="#">← Books</a></p>
        <h1>Add person</h1>
        <p class="lead">Anyone you give credit to, or who gives you credit. Their ledger starts at zero and grows as you save lines.</p>
      </section>
      ${personForm(null)}`;
  }

  function renderPersonEdit() {
    const p = personById(state.personId);
    if (!p) {
      app.innerHTML = `<p>Person not found. <a class="back" href="#">Back</a></p>`;
      return;
    }
    app.innerHTML = `
      <section class="page-head">
        <p><a class="back" href="#p/${esc(p.id)}">← ${esc(p.name)}</a></p>
        <h1>Edit person</h1>
        <p class="lead">Change the name or notes any time. The running ledger stays with them. Save publishes the same books on every device.</p>
        ${noticeHtml()}
      </section>
      ${personForm(p)}`;
  }

  function renderSettings() {
    app.innerHTML = `
      <section class="page-head">
        <p><a class="back" href="#">← Books</a></p>
        <p class="eyebrow">This device</p>
        <h1>Backup & PIN</h1>
        <p class="lead">Your ledger is saved online. Same PIN on phone, laptop, or any browser. Download JSON as an extra backup.</p>
        ${noticeHtml()}
      </section>
      <div class="books-panel">
        <h2>Backup</h2>
        <div class="toolbar">
          <button class="btn btn-primary" type="button" data-export>Download JSON</button>
          <label class="btn btn-ghost">Import JSON<input type="file" accept="application/json,.json" hidden data-import></label>
        </div>
        <p class="muted">To load the Excel accounts once, import <code>thanks2all-books-seed.json</code>.</p>
      </div>
      <form class="books-panel" data-pin>
        <h2>Change PIN</h2>
        <label>Current PIN<input name="old" type="password" inputmode="numeric" required></label>
        <label>New PIN<input name="pin" type="password" inputmode="numeric" required minlength="4"></label>
        <p class="form-note warn">${esc(state.error)}</p>
        <button class="btn btn-primary" type="submit">Update PIN</button>
      </form>
      <div class="books-panel">
        <h2>On your phone</h2>
        <p>Browser menu → <strong>Add to Home Screen</strong>. Open with your PIN from this phone or any other device on the internet.</p>
      </div>`;
  }

  function encodeInlineShare(snapshot) {
    const json = JSON.stringify(snapshot);
    return `~${b64(enc.encode(json)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
  }

  function decodeInlineShare(token) {
    let raw = token.slice(1).replace(/-/g, "+").replace(/_/g, "/");
    while (raw.length % 4) raw += "=";
    return JSON.parse(dec.decode(unb64(raw)));
  }

  function sharePageUrl(shareId) {
    return `https://thanks2all.org/books.html#s/${shareId}`;
  }

  function isShortShareUrl(url) {
    return Boolean(url) && url.startsWith("https://thanks2all.org/books.html#s/") && !url.includes("#s/~");
  }

  function formatAmt(amount, currency) {
    const n = Number(amount) || 0;
    return `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${currency || "INR"}`;
  }

  function formatShareText(name, txns, sheet) {
    const all = (txns || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const counted = all.filter((t) => t.include !== false);
    const given = counted.filter((t) => t.direction !== "in");
    const received = counted.filter((t) => t.direction === "in");
    const lines = [`${name} — our account`, "", "I gave:"];
    if (!given.length) lines.push("none");
    else given.forEach((t) => lines.push(`${t.date}  ${t.description}  ${formatAmt(t.amount, t.currency)}`));
    lines.push("", "They gave:");
    if (!received.length) lines.push("none");
    else received.forEach((t) => lines.push(`${t.date}  ${t.description}  ${formatAmt(t.amount, t.currency)}`));
    lines.push("", "Balance:");
    const bals = sheet || [];
    if (!bals.length) lines.push("settled");
    else {
      for (const row of bals) {
        const n = Number(row.balance) || 0;
        if (Math.abs(n) < 0.0001) lines.push(`${row.currency}: settled`);
        else if (n > 0) lines.push(`${row.currency}: ${name} owes ${formatAmt(n, row.currency)}`);
        else lines.push(`${row.currency}: I owe ${name} ${formatAmt(Math.abs(n), row.currency)}`);
      }
    }
    return lines.join("\n");
  }

  function shareMessage(person) {
    return formatShareText(
      person.name,
      state.data.txns.filter((t) => t.personId === person.id),
      sheetFor(person.id)
    );
  }

  function whatsAppHref(text) {
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  function openWhatsAppNow(text) {
    const href = whatsAppHref(text);
    const mobile = /Mobi|Android|iPhone/i.test(navigator.userAgent || "");
    if (mobile && navigator.share) {
      navigator.share({ text }).catch((error) => {
        if (error && error.name === "AbortError") return;
        window.location.href = href;
      });
      return;
    }
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function ledgerRowsFromTxns(txns) {
    const rows = (txns || []).slice().sort((a, b) => {
      const d = String(a.date).localeCompare(String(b.date));
      return d !== 0 ? d : String(a.description || "").localeCompare(String(b.description || ""));
    });
    const run = {};
    return rows.map((t) => {
      const cur = t.currency || "INR";
      if (t.include !== false) {
        const signed = t.direction === "in" ? -Number(t.amount) : Number(t.amount);
        run[cur] = (run[cur] || 0) + signed;
      }
      return { ...t, running: run[cur] || 0 };
    });
  }

  function paintShare(snap) {
    const rows = ledgerRowsFromTxns(snap.txns);
    const sheet = Array.isArray(snap.sheet) ? snap.sheet : [];
    const waText = formatShareText(snap.name, snap.txns, snap.sheet);
    app.innerHTML = `
      <section class="page-head">
        <p class="eyebrow">Shared reference</p>
        <h1>${esc(snap.name)}</h1>
        <p class="lead">Same balance sheet for both of us. This page is a snapshot — it does not need a PIN.</p>
        ${snap.notes ? `<p class="muted">${esc(snap.notes)}</p>` : ""}
        ${snap.updated_at ? `<p class="muted">Updated ${esc(String(snap.updated_at).slice(0, 16).replace("T", " "))} UTC</p>` : ""}
        <div class="toolbar">
          <a class="btn btn-primary" href="https://wa.me/?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener">Share this page on WhatsApp</a>
        </div>
      </section>
      ${sheet.length ? `<div class="books-stats">${sheet.map((row) => {
        const bal = Number(row.balance) || 0;
        return `<div class="sheet-card">
          <h3>${esc(row.currency)}</h3>
          <div class="sheet-line"><span>I gave</span><strong class="bal-out">${esc(money(row.given, row.currency))}</strong></div>
          <div class="sheet-line"><span>They gave</span><strong class="bal-in">${esc(money(row.received, row.currency))}</strong></div>
          <div class="sheet-line"><span>Balance</span><strong class="${bal > 0 ? "bal-out" : bal < 0 ? "bal-in" : "bal-zero"}">${
            Math.abs(bal) < 0.0001
              ? "Settled"
              : `${esc(money(Math.abs(bal), row.currency))} ${bal > 0 ? "they owe me" : "I owe them"}`
          }</strong></div>
        </div>`;
      }).join("")}</div>` : `<div class="sheet-card"><span class="bal bal-zero">Settled — no counted credits yet</span></div>`}
      <h2>Running ledger</h2>
      ${rows.length ? `
      <div class="ledger-wrap">
        <table class="ledger readonly">
          <thead>
            <tr>
              <th>Date</th>
              <th>Particulars</th>
              <th class="num">I gave</th>
              <th class="num">They gave</th>
              <th class="num">Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((t) => {
              const gave = t.direction === "out" ? money(t.amount, t.currency) : "—";
              const got = t.direction === "in" ? money(t.amount, t.currency) : "—";
              const skip = t.include === false ? " · note only" : "";
              return `<tr>
                <td>${esc(t.date)}</td>
                <td>${esc(t.description)}${t.remarks ? `<div class="muted">${esc(t.remarks)}</div>` : ""}</td>
                <td class="num bal-out">${esc(gave)}</td>
                <td class="num bal-in">${esc(got)}</td>
                <td class="num">${t.include === false ? "—" : esc(money(t.running, t.currency))}</td>
                <td class="muted">${esc(t.currency || "INR")}${skip}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : `<p class="muted">No ledger lines on this shared sheet.</p>`}`;
  }

  function renderShare() {
    const id = state.shareId;
    if (!id) {
      app.innerHTML = `<section class="page-head"><h1>Missing share</h1><p><a class="back" href="books.html">Back to books</a></p></section>`;
      return;
    }
    if (id.startsWith("~")) {
      try {
        const snap = decodeInlineShare(id);
        snap.id = id;
        state.shareSnap = snap;
        paintShare(snap);
      } catch {
        app.innerHTML = `<section class="page-head"><h1>Sheet not found</h1><p class="lead">This WhatsApp link is incomplete. Ask them to share again.</p></section>`;
      }
      return;
    }
    if (state.shareSnap && state.shareSnap.id === id) {
      paintShare(state.shareSnap);
      return;
    }
    app.innerHTML = `
      <section class="page-head books-lock">
        <p class="eyebrow">Shared reference</p>
        <h1>Opening the balance sheet</h1>
        <p class="lead">Loading the same page for both of you…</p>
      </section>`;
    khata(`share/${id}`).then((snap) => {
      state.shareSnap = snap;
      if (state.view === "share" && state.shareId === id) paintShare(snap);
    }).catch((err) => {
      if (state.view !== "share") return;
      app.innerHTML = `
        <section class="page-head">
          <h1>Sheet not found</h1>
          <p class="lead">${esc(err.message || "Ask them to tap Share on WhatsApp again.")}</p>
        </section>`;
    });
  }

  async function shareOnWhatsApp(personId) {
    const person = personById(personId);
    if (!person) return;
    const text = shareMessage(person);
    openWhatsAppNow(text);
    state.notice = "WhatsApp opened with only the transactions.";
    render();
  }

  async function copyShareText(personId) {
    const person = personById(personId);
    if (!person) return;
    const text = shareMessage(person);
    try {
      await navigator.clipboard.writeText(text);
      state.notice = "Copied. Paste it in WhatsApp.";
    } catch {
      window.prompt("Copy this text", text);
      state.notice = "Copy the text, then paste it in WhatsApp.";
    }
    render();
  }

  function render() {
    parseHash();
    if (state.view === "share") {
      renderShare();
      return;
    }
    if (!state.key) {
      renderLock();
      return;
    }
    if (state.view === "person") renderPerson();
    else if (state.view === "new") renderNew();
    else if (state.view === "edit") renderEdit();
    else if (state.view === "person-new") renderPersonNew();
    else if (state.view === "person-edit") renderPersonEdit();
    else if (state.view === "settings") renderSettings();
    else renderHome();
  }

  async function unlock(pin, isSetup, pin2) {
    state.error = "";
    if (isSetup) {
      if (pin !== pin2) {
        state.error = "PINs do not match.";
        renderLock();
        return;
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const saltB64 = b64(salt);
      state.saltB64 = saltB64;
      state.pin = pin;
      localStorage.setItem(LS_SALT, saltB64);
      state.key = await deriveKey(pin, salt);
      state.data = {
        version: 1,
        people: STARTER_PEOPLE.map((p) => ({ id: uid(), ...p })),
        txns: []
      };
      const vault = await encryptData(state.data, state.key);
      localStorage.setItem(LS_VAULT, vault);
      try {
        await khata("register", { pin, salt: saltB64, vault });
        state.cloudClaimed = true;
        state.cloudOk = true;
        state.notice = "Books created online. Use this PIN on any device.";
      } catch (err) {
        if (/already exist/i.test(err.message)) {
          state.error = "Cloud books already exist. Unlock with your PIN.";
          state.cloudClaimed = true;
          state.key = null;
          state.pin = null;
          renderLock();
          return;
        }
        state.notice = "Created on this device. Cloud: " + err.message;
      }
      location.hash = "";
      render();
      return;
    }

    try {
      const remote = await khata("unlock", { pin });
      state.saltB64 = remote.salt;
      localStorage.setItem(LS_SALT, remote.salt);
      localStorage.setItem(LS_VAULT, remote.vault);
      state.key = await deriveKey(pin, unb64(remote.salt));
      state.data = await decryptData(remote.vault, state.key);
      if (!Array.isArray(state.data.people)) state.data = emptyData();
      state.pin = pin;
      state.cloudOk = true;
      state.notice = "Unlocked from the cloud. Saves go to every device.";
      render();
      return;
    } catch (err) {
      if (err.message === "Wrong PIN.") {
        state.error = "Wrong PIN.";
        renderLock();
        return;
      }
      const localSalt = localStorage.getItem(LS_SALT);
      const localVault = localStorage.getItem(LS_VAULT);
      if (!localSalt || !localVault) {
        state.error = err.message || "Could not reach the cloud vault.";
        renderLock();
        return;
      }
      try {
        const key = await deriveKey(pin, unb64(localSalt));
        state.data = await decryptData(localVault, key);
        if (!Array.isArray(state.data.people)) state.data = emptyData();
        state.key = key;
        state.pin = pin;
        state.saltB64 = localSalt;
        state.notice = "Opened from this device. Cloud: " + err.message;
        render();
      } catch {
        state.error = "Wrong PIN, or the saved books cannot be read.";
        renderLock();
      }
    }
  }

  async function boot() {
    parseHash();
    if (state.view === "share") {
      state.cloudReady = true;
      renderShare();
      return;
    }
    renderLock();
    const slow = setTimeout(() => {
      if (!state.cloudReady) {
        state.cloudReady = true;
        if (localStorage.getItem(LS_SALT) && localStorage.getItem(LS_VAULT)) render();
      }
    }, 2000);
    try {
      const st = await khata("status");
      state.cloudClaimed = Boolean(st.claimed);
      state.cloudOk = true;
    } catch {
      state.cloudOk = false;
    }
    clearTimeout(slow);
    state.cloudReady = true;
    render();
  }

  function readTxnForm(form) {
    const fd = new FormData(form);
    return {
      personId: String(fd.get("personId")),
      date: String(fd.get("date")),
      description: String(fd.get("description") || "").trim(),
      amount: Number(fd.get("amount")),
      currency: String(fd.get("currency") || "INR"),
      direction: String(fd.get("direction") || "out"),
      remarks: String(fd.get("remarks") || "").trim(),
      include: form.querySelector('[name="include"]').checked
    };
  }

  app.addEventListener("submit", async (e) => {
    const lock = e.target.closest("[data-lock]");
    if (lock) {
      e.preventDefault();
      const fd = new FormData(lock);
      await unlock(String(fd.get("pin") || ""), !hasVault(), String(fd.get("pin2") || ""));
      return;
    }
    const personForm = e.target.closest("[data-person]");
    if (personForm) {
      e.preventDefault();
      const fd = new FormData(personForm);
      const name = String(fd.get("name") || "").trim();
      if (!name) return;
      const notes = String(fd.get("notes") || "").trim();
      const existingId = personForm.getAttribute("data-person");
      if (existingId) {
        const person = personById(existingId);
        if (!person) return;
        person.name = name;
        person.notes = notes;
        await save(`${name} updated. Same books on every device.`);
        location.hash = `#p/${person.id}`;
      } else {
        const person = { id: uid(), name, notes };
        state.data.people.push(person);
        await save(`${name} saved. You can now record credits with them.`);
        location.hash = `#p/${person.id}`;
      }
      render();
      return;
    }
    const txnFormEl = e.target.closest("[data-txn]");
    if (txnFormEl) {
      e.preventDefault();
      const fields = readTxnForm(txnFormEl);
      if (!fields.description || !(fields.amount > 0)) {
        state.error = "Need particulars and an amount.";
        render();
        return;
      }
      const existingId = txnFormEl.getAttribute("data-txn");
      if (existingId) {
        const idx = state.data.txns.findIndex((t) => t.id === existingId);
        if (idx >= 0) state.data.txns[idx] = { ...state.data.txns[idx], ...fields };
        await save("Existing transaction updated. Same books published online.");
      } else {
        state.data.txns.push({ id: uid(), ...fields });
        await save("Saved to ledger. The running balance is updated.");
      }
      state.error = "";
      location.hash = `#p/${fields.personId}`;
      render();
      return;
    }
    const pinForm = e.target.closest("[data-pin]");
    if (pinForm) {
      e.preventDefault();
      const fd = new FormData(pinForm);
      const oldPin = String(fd.get("old") || "");
      const newPin = String(fd.get("pin") || "");
      try {
        const oldSalt = state.saltB64 || localStorage.getItem(LS_SALT);
        const check = await deriveKey(oldPin, unb64(oldSalt));
        await decryptData(localStorage.getItem(LS_VAULT), check);
        const nextSalt = crypto.getRandomValues(new Uint8Array(16));
        const nextB64 = b64(nextSalt);
        state.saltB64 = nextB64;
        localStorage.setItem(LS_SALT, nextB64);
        state.key = await deriveKey(newPin, nextSalt);
        const vault = await encryptData(state.data, state.key);
        localStorage.setItem(LS_VAULT, vault);
        state.pin = newPin;
        await khata("pin", { old_pin: oldPin, new_pin: newPin, salt: nextB64, vault });
        state.cloudClaimed = true;
        state.notice = "PIN updated online. Use the new PIN on every device.";
        state.error = "";
        render();
      } catch {
        state.error = "Current PIN is wrong, or cloud could not update.";
        render();
      }
    }
  });

  app.addEventListener("click", async (e) => {
    const shareWa = e.target.closest("[data-share-wa]");
    if (shareWa) {
      e.preventDefault();
      e.stopPropagation();
      await shareOnWhatsApp(shareWa.getAttribute("data-share-wa"));
      return;
    }
    const copyShare = e.target.closest("[data-copy-share]");
    if (copyShare) {
      e.preventDefault();
      e.stopPropagation();
      await copyShareText(copyShare.getAttribute("data-copy-share"));
      return;
    }
    const lockNow = e.target.closest("[data-lock-now]");
    if (lockNow) {
      state.key = null;
      state.pin = null;
      state.notice = "";
      location.hash = "";
      render();
      return;
    }
    const openPerson = e.target.closest("[data-open-person]");
    if (openPerson) {
      location.hash = `#p/${openPerson.getAttribute("data-open-person")}`;
      return;
    }
    const editTxn = e.target.closest("[data-edit-txn]");
    if (editTxn) {
      location.hash = `#edit/${editTxn.getAttribute("data-edit-txn")}`;
      return;
    }
    const delPerson = e.target.closest("[data-delete-person]");
    if (delPerson) {
      const id = delPerson.getAttribute("data-delete-person");
      const person = personById(id);
      const lines = state.data.txns.filter((t) => t.personId === id).length;
      const ok = confirm(
        lines
          ? `Delete ${person?.name || "this person"} and ${lines} ledger line(s)? This publishes to every device.`
          : `Delete ${person?.name || "this person"}? This publishes to every device.`
      );
      if (!ok) return;
      state.data.people = state.data.people.filter((p) => p.id !== id);
      state.data.txns = state.data.txns.filter((t) => t.personId !== id);
      await save(`${person?.name || "Person"} removed. Balance sheet updated.`);
      location.hash = "";
      render();
      return;
    }
    const del = e.target.closest("[data-delete-txn]");
    if (del) {
      const id = del.getAttribute("data-delete-txn");
      const t = state.data.txns.find((x) => x.id === id);
      state.data.txns = state.data.txns.filter((x) => x.id !== id);
      await save("Line removed. Balance sheet updated.");
      location.hash = t ? `#p/${t.personId}` : "";
      render();
      return;
    }
    if (e.target.closest("[data-export]")) {
      const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `thanks2all-books-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      state.notice = "Backup downloaded. Keep that file if you change phones.";
      render();
    }
  });

  app.addEventListener("change", async (e) => {
    const input = e.target.closest("[data-import]");
    if (!input || !input.files?.[0]) return;
    try {
      const parsed = JSON.parse(await input.files[0].text());
      if (!Array.isArray(parsed.people) || !Array.isArray(parsed.txns)) throw new Error("shape");
      state.data = { version: 1, people: parsed.people, txns: parsed.txns };
      await save("Imported. Each person now has a running ledger.");
      location.hash = "";
      render();
    } catch {
      alert("That file is not a books JSON backup.");
    }
    input.value = "";
  });

  window.addEventListener("hashchange", () => {
    state.error = "";
    if ((location.hash || "").startsWith("#s/")) {
      state.shareSnap = null;
      render();
      return;
    }
    if (state.key) render();
  });

  boot();
})();
