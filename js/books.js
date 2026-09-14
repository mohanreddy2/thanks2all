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
    error: ""
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

  async function save() {
    if (!state.key) return;
    localStorage.setItem(LS_VAULT, await encryptData(state.data, state.key));
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

  function balancesFor(personId) {
    const sums = {};
    for (const t of state.data.txns) {
      if (t.personId !== personId || t.include === false) continue;
      const cur = t.currency || "INR";
      const signed = t.direction === "in" ? -Number(t.amount) : Number(t.amount);
      sums[cur] = (sums[cur] || 0) + signed;
    }
    return sums;
  }

  function formatBals(sums) {
    const parts = Object.entries(sums).filter(([, n]) => Math.abs(n) > 0.0001);
    if (!parts.length) return '<span class="bal bal-zero">Settled</span>';
    return parts.map(([cur, n]) => {
      const cls = n > 0 ? "bal-out" : "bal-in";
      const label = n > 0 ? "you sent" : "toward you";
      return `<div class="bal ${cls}">${esc(money(Math.abs(n), cur))} ${label}</div>`;
    }).join("");
  }

  function personById(id) {
    return state.data.people.find((p) => p.id === id);
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
        <p class="eyebrow">Private khata</p>
        <h1>${setup ? "Set a PIN for your books" : "Open your books"}</h1>
        <p class="lead">${setup
          ? "This page is only for you. Choose a PIN. Entries stay encrypted on this phone or computer — they are not published on thanks2all.org."
          : "Enter the PIN you set on this device."}</p>
        <form class="books-panel" data-lock>
          <label>${setup ? "New PIN (4 or more digits)" : "PIN"}
            <input name="pin" type="password" inputmode="numeric" autocomplete="off" required minlength="4">
          </label>
          ${setup ? `<label>Type PIN again<input name="pin2" type="password" inputmode="numeric" autocomplete="off" required minlength="4"></label>` : ""}
          <p class="form-note warn">${esc(state.error)}</p>
          <button class="btn btn-primary" type="submit">${setup ? "Create books" : "Unlock"}</button>
        </form>
        ${setup ? `<p class="muted">If you forget the PIN, you will need a backup JSON file. Export one after you add entries.</p>` : ""}
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
    app.innerHTML = `
      <section class="page-head">
        <p class="eyebrow">Private khata</p>
        <h1>Accounts with me</h1>
        <p class="lead">Add a person, then add what you sent and what came back. INR, SGD, and MYR stay separate.</p>
      </section>
      <div class="books-stats">
        ${Object.keys(totals).length
          ? Object.entries(totals).map(([cur, n]) => `
            <div class="books-stat">
              <strong>${esc(money(Math.abs(n), cur))}</strong>
              <span>${n >= 0 ? "net you sent" : "net toward you"} · ${esc(cur)}</span>
            </div>`).join("")
          : `<div class="books-stat"><strong>${people.length} ${people.length === 1 ? "person" : "people"}</strong><span>${people.length ? "No counted entries yet" : "Import your Excel file or add a person"}</span></div>`}
      </div>
      <div class="toolbar">
        <a class="btn btn-primary" href="#person-new">Add person</a>
        <a class="btn btn-ghost" href="#new">Add entry</a>
        <a class="btn btn-ghost" href="#settings">Backup & PIN</a>
      </div>
      <div class="people-grid">
        ${people.length ? people.map((p) => `
          <a class="person-card" href="#p/${esc(p.id)}">
            <h2>${esc(p.name)}</h2>
            ${formatBals(balancesFor(p.id))}
            ${p.notes ? `<p class="muted">${esc(p.notes)}</p>` : ""}
          </a>`).join("") : `<p class="muted">No people yet. Add Rajesh, Venky, and the others, or import the Excel JSON from Settings.</p>`}
      </div>`;
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
          <label>Direction
            <select name="direction">
              <option value="out" ${t.direction === "out" ? "selected" : ""}>I sent / I paid</option>
              <option value="in" ${t.direction === "in" ? "selected" : ""}>They sent / they paid for me</option>
            </select>
          </label>
        </div>
        <label>What<input name="description" required value="${esc(t.description || "")}" placeholder="PhonePe, Trust Bank, mangoes"></label>
        <label>Remarks<input name="remarks" value="${esc(t.remarks || "")}" placeholder="Optional"></label>
        <label class="check"><input name="include" type="checkbox" ${t.include !== false ? "checked" : ""}> Count in the running balance</label>
        <p class="form-note warn">${esc(state.error)}</p>
        <div class="toolbar">
          <button class="btn btn-primary" type="submit">${txn ? "Save entry" : "Add entry"}</button>
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
    const txns = state.data.txns
      .filter((t) => t.personId === p.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    app.innerHTML = `
      <section class="page-head">
        <p><a class="back" href="#">← All people</a></p>
        <p class="eyebrow">Account</p>
        <h1>${esc(p.name)}</h1>
        ${formatBals(balancesFor(p.id))}
        ${p.notes ? `<p class="lead">${esc(p.notes)}</p>` : ""}
      </section>
      ${txnForm(null, p.id)}
      <h2>Entries</h2>
      ${txns.length ? txns.map((t) => `
        <a class="txn-row" href="#edit/${esc(t.id)}">
          <div>
            <time>${esc(t.date)}</time>
            <div>${esc(t.description)}</div>
          </div>
          <div class="txn-amt ${t.direction === "in" ? "bal-in" : "bal-out"}">
            ${t.direction === "in" ? "+" : "−"} ${esc(money(t.amount, t.currency))}
          </div>
          <div class="txn-meta">${t.direction === "in" ? "Toward you" : "You sent"}${t.include === false ? " · not in total" : ""}${t.remarks ? " · " + esc(t.remarks) : ""}</div>
        </a>`).join("") : `<p class="muted">No entries yet.</p>`}`;
  }

  function renderNew() {
    if (!state.data.people.length) {
      app.innerHTML = `<section class="page-head"><h1>Add a person first</h1><p><a class="btn btn-primary" href="#person-new">Add person</a></p></section>`;
      return;
    }
    app.innerHTML = `
      <section class="page-head">
        <p><a class="back" href="#">← Books</a></p>
        <h1>New entry</h1>
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
        <h1>Edit entry</h1>
      </section>
      ${txnForm(t, t.personId)}`;
  }

  function renderPersonNew() {
    app.innerHTML = `
      <section class="page-head">
        <p><a class="back" href="#">← Books</a></p>
        <h1>Add person</h1>
      </section>
      <form class="books-panel" data-person>
        <label>Name<input name="name" required placeholder="Venky"></label>
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
        <p class="lead">Your numbers never go to GitHub. Keep a JSON backup if you switch phones.</p>
      </section>
      <div class="books-panel">
        <h2>Backup</h2>
        <div class="toolbar">
          <button class="btn btn-primary" type="button" data-export>Download JSON</button>
          <label class="btn btn-ghost">Import JSON<input type="file" accept="application/json,.json" hidden data-import></label>
        </div>
        <p class="muted">Use the file <code>thanks2all-books-seed.json</code> to load the Excel accounts once.</p>
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
        <p>Open this page, then browser menu → <strong>Add to Home Screen</strong>. It opens like an app.</p>
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
      await save();
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
      state.data.people.push({
        id: uid(),
        name: String(fd.get("name") || "").trim(),
        notes: String(fd.get("notes") || "").trim()
      });
      await save();
      location.hash = "";
      render();
      return;
    }
    const txnFormEl = e.target.closest("[data-txn]");
    if (txnFormEl) {
      e.preventDefault();
      const fields = readTxnForm(txnFormEl);
      if (!fields.description || !(fields.amount > 0)) {
        state.error = "Need a description and an amount.";
        render();
        return;
      }
      const existingId = txnFormEl.getAttribute("data-txn");
      if (existingId) {
        const idx = state.data.txns.findIndex((t) => t.id === existingId);
        if (idx >= 0) state.data.txns[idx] = { ...state.data.txns[idx], ...fields };
      } else {
        state.data.txns.push({ id: uid(), ...fields });
      }
      await save();
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
        await save();
        state.error = "";
        alert("PIN updated on this device.");
        render();
      } catch {
        state.error = "Current PIN is wrong.";
        render();
      }
    }
  });

  app.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delete-txn]");
    if (del) {
      const id = del.getAttribute("data-delete-txn");
      const t = state.data.txns.find((x) => x.id === id);
      state.data.txns = state.data.txns.filter((x) => x.id !== id);
      await save();
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
    }
  });

  app.addEventListener("change", async (e) => {
    const input = e.target.closest("[data-import]");
    if (!input || !input.files?.[0]) return;
    try {
      const parsed = JSON.parse(await input.files[0].text());
      if (!Array.isArray(parsed.people) || !Array.isArray(parsed.txns)) throw new Error("shape");
      state.data = { version: 1, people: parsed.people, txns: parsed.txns };
      await save();
      location.hash = "";
      render();
    } catch {
      alert("That file is not a books JSON backup.");
    }
    input.value = "";
  });

  window.addEventListener("hashchange", () => {
    if (state.key) render();
  });

  render();
})();
