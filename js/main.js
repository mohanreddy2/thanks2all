const nav = document.querySelector("[data-nav]");
const toggle = document.querySelector("[data-menu]");
if (toggle && nav) {
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  document.addEventListener("click", (event) => {
    if (!nav.classList.contains("open")) return;
    if (nav.contains(event.target) || toggle.contains(event.target)) return;
    nav.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  });
}

const form = document.querySelector("[data-form]");
if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector(".form-note");
    const button = form.querySelector("[type=submit]");
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    const message = String(data.get("message") || "").trim();
    if (!name || !email || !message) {
      note.textContent = "Please fill in every field.";
      note.classList.remove("ok");
      return;
    }
    button.disabled = true;
    note.textContent = "Sending…";
    try {
      const response = await fetch("https://formsubmit.co/ajax/mohan.reddy02@gmail.com", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: data
      });
      const result = await response.json();
      if (response.ok && String(result.success) === "true") {
        note.textContent = "Message sent. Thank you.";
        note.classList.add("ok");
        form.reset();
      } else {
        note.textContent = "Could not send. Email mohan.reddy02@gmail.com.";
      }
    } catch (error) {
      form.removeAttribute("data-form");
      form.submit();
    }
    button.disabled = false;
  });
}
