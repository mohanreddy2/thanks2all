(function () {
  const form = document.querySelector("[data-form]");
  if (!form) return;
  const phone = String(form.getAttribute("data-wa") || "919110759384").replace(/\D/g, "");
  let button = form.querySelector("[data-whatsapp]");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-ghost";
    button.setAttribute("data-whatsapp", "1");
    button.textContent = "Send on WhatsApp";
    const submit = form.querySelector("[type=submit]");
    if (submit && submit.parentNode) submit.parentNode.insertBefore(button, submit.nextSibling);
    else form.appendChild(button);
  }
  button.addEventListener("click", function () {
    const data = new FormData(form);
    const lines = [];
    data.forEach(function (value, key) {
      if (key.charAt(0) === "_") return;
      const text = String(value || "").trim();
      if (!text) return;
      lines.push(key + ": " + text);
    });
    if (!lines.length) {
      const note = form.querySelector(".form-note");
      if (note) note.textContent = "Fill the form first, then Send on WhatsApp.";
      return;
    }
    const message = "Hello DailyCart, I would like to order / enquire.\n\n" + lines.join("\n") + "\n\nFrom " + window.location.hostname;
    window.open("https://wa.me/" + phone + "?text=" + encodeURIComponent(message), "_blank", "noopener");
  });
})();
