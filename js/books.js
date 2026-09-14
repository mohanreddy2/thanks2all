(() => {
  const LS_SALT = "thanks2all-books-salt";
  const LS_VAULT = "thanks2all-books-vault";
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
    notice: ""
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
    localStorage.setItem(LS_VAULT, await encryptData(state.data, state.key));
    if (notice) state.notice = notice;
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
    return Boolean(localStorage.getItem(LS_SALT) && localStorage.getItem(LS_VAULT));
  }

  function renderLock() {
    const setup = !hasVault();
    app.innerHTML = `
      <section class="page-head books-lock">
        <p class="eyebrow">Private ledger</p>
        <h1>${setup ? "Set a PIN for your books" : "Open your books"}</h1>
        <p class="lead">${setup
          ? "Choose a PIN. After that, unlock anytime, add a person, record credit you gave or credit they gave you, and save. Each person keeps a running balance by currency."
          : "Enter your PIN to add or edit the ledger. Everything already saved on this phone stays here."}</p>
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
        <p class="lead">Unlock with your PIN. Add any person. Save each credit you gave them, and each credit they gave you. The balance sheet for that person stays for the future.</p>
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
            <p class="muted">${state.data.txns.filter((t) => t.personId === p.id).length} ledger line(s)</p>
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
        <h2>${txn ? "Edit ledger line" : "Save a credit"}</h2>
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
          <button class="btn btn-primary" type="submit">${txn ? "Save changes" : "Save to ledger"}</button>
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
      </section>
      ${sheetCards(p.id)}
      ${txnForm(null, p.id)}
      <h2>Running ledger</h2>
      <p class="muted">Oldest first. Balance after each line is for that currency only. Tap a line to edit.</p>
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
                <td class="muted">${esc(t.currency)}${skip}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : `<p class="muted">No lines yet. Save a credit above. It will stay on this ledger.</p>`}`;
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
        <h1>Edit ledger line</h1>
      </section>
      ${txnForm(t, t.personId)}`;
  }

  function renderPersonNew() {
    app.innerHTML = `
      <section class="page-head">
        <p><a class="back" href="#">← Books</a></p>
        <h1>Add person</h1>
        <p class="lead">Anyone you give credit to, or who gives you credit. Their ledger starts at zero and grows as you save lines.</p>
      </section>
      <form class="books-panel" data-person>
        <label>Name<input name="name" required placeholder="New person"></label>
        <label>Notes<input name="notes" placeholder="Optional"></label>
        <button class="btn btn-primary" type="submit">Save person</button>
      </form>`;
  }

  function renderSettings() {
    app.innerHTML = `
      <section class="page-head">
        <p><a class="back" href="#">← Books</a></p>
        <p class="eyebrow">This device</p>
        <h1>Backup & PIN</h1>
        <p class="lead">The ledger is saved on this phone or computer when you tap Save. Download JSON if you will open it on another device.</p>
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
        <p>Browser menu → <strong>Add to Home Screen</strong>. Open with your PIN each time, then keep adding ledger lines.</p>
      </div>`;
  }

  function render() {
    if (!state.key) {
      renderLock();
      return;
    }
    parseHash();
    if (state.view === "person") renderPerson();
    else if (state.view === "new") renderNew();
    else if (state.view === "edit") renderEdit();
    else if (state.view === "person-new") renderPersonNew();
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
      localStorage.setItem(LS_SALT, b64(salt));
      state.key = await deriveKey(pin, salt);
      state.data = {
        version: 1,
        people: STARTER_PEOPLE.map((p) => ({ id: uid(), ...p })),
        txns: []
      };
      await save("Books created. Add a person or save a credit — it stays on this device.");
      location.hash = "";
      render();
      return;
    }
    try {
      const salt = unb64(localStorage.getItem(LS_SALT));
      const key = await deriveKey(pin, salt);
      state.data = await decryptData(localStorage.getItem(LS_VAULT), key);
      if (!Array.isArray(state.data.people)) state.data = emptyData();
      state.key = key;
      state.notice = "Unlocked. Save any new credit and the balance sheet updates.";
      render();
    } catch {
      state.error = "Wrong PIN, or the saved books on this device cannot be read.";
      renderLock();
    }
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
      const person = { id: uid(), name, notes: String(fd.get("notes") || "").trim() };
      state.data.people.push(person);
      await save(`${name} saved. You can now record credits with them.`);
      location.hash = `#p/${person.id}`;
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
        await save("Ledger line updated. Balance sheet refreshed.");
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
        const salt = unb64(localStorage.getItem(LS_SALT));
        const check = await deriveKey(oldPin, salt);
        await decryptData(localStorage.getItem(LS_VAULT), check);
        const nextSalt = crypto.getRandomValues(new Uint8Array(16));
        localStorage.setItem(LS_SALT, b64(nextSalt));
        state.key = await deriveKey(newPin, nextSalt);
        await save("PIN updated on this device.");
        state.error = "";
        render();
      } catch {
        state.error = "Current PIN is wrong.";
        render();
      }
    }
  });

  app.addEventListener("click", async (e) => {
    const lockNow = e.target.closest("[data-lock-now]");
    if (lockNow) {
      state.key = null;
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
    if (state.key) {
      state.error = "";
      render();
    }
  });

  render();
})();
