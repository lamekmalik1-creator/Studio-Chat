const $ = (id) => document.getElementById(id);

// Switch between the three launcher panels.
document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === button));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === button.dataset.panel));
  });
});

// PWA installation prompt.
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("installBtn").hidden = false;
});
$("installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("installBtn").hidden = true;
});
window.addEventListener("appinstalled", () => {
  $("installBtn").hidden = true;
  deferredInstallPrompt = null;
});

// Install help dialog.
const dialog = $("installHelp");
$("helpInstall").addEventListener("click", () => dialog.showModal());
$("closeHelp").addEventListener("click", () => dialog.close());
$("okHelp").addEventListener("click", () => dialog.close());

// Cache only the Studio Chat app shell. Perchance tools are opened directly
// in a separate tab and always require an internet connection.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service worker:", err));
  });
}
