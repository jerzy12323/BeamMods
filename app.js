const defaultMods = [];

const grid = document.querySelector("#mods-grid");
const emptyState = document.querySelector("#empty-state");
const searchInput = document.querySelector("#search-input");
const sortSelect = document.querySelector("#sort-select");
const panelSearch = document.querySelector("#panel-search");
const authorSearch = document.querySelector("#author-search");
const categorySelect = document.querySelector("#category-select");
let activeFilter = "All";
if (!localStorage.getItem("beammods-reset-v2")) {
  localStorage.removeItem("beammods-mods");
  localStorage.setItem("beammods-reset-v2", "done");
}

function showDashboardBugView() {
  if (!currentUser) return;
  saveView("dashboard-bug");
  document.body.classList.add("dashboard-mode");
  bugPage.hidden = true;
  dmcaPage.hidden = true;
  howPage.hidden = true;
  librarySections.forEach((section) => { section.hidden = true; });
  dashboardPage.hidden = false;
  document.querySelector("#published-view").hidden = true;
  document.querySelector("#owner-view").hidden = true;
  document.querySelector("#dashboard-bug-view").hidden = false;
  document.querySelectorAll(".dashboard-action").forEach((button) => button.classList.remove("active"));
  document.querySelector("#report-bug-link").classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function leaveStandalonePage() {
  if (standaloneReturn === "dashboard" && currentUser) showDashboard();
  else showLibrary();
}

function saveView(view) {
  localStorage.setItem("beammods-current-view", view);
}

function showStandalonePage(page) {
  saveView(page === bugPage ? "bug-page" : page === dmcaPage ? "dmca-page" : "how-page");
  standaloneReturn = dashboardPage.hidden ? "library" : "dashboard";
  authModal.hidden = true;
  document.body.classList.remove("dashboard-mode");
  librarySections.forEach((section) => { section.hidden = true; });
  dashboardPage.hidden = true;
  howPage.hidden = true;
  document.querySelector(".site-footer").hidden = true;
  page.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showAuthPage() {
  document.body.classList.remove("dashboard-mode");
  librarySections.forEach((section) => { section.hidden = true; });
  dashboardPage.hidden = true;
  bugPage.hidden = true;
  dmcaPage.hidden = true;
  howPage.hidden = true;
  authModal.hidden = false;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function isRemovedLegacyMod(mod) {
  return /bmw\s*g20/i.test(String(mod.name || ""));
}

let mods = JSON.parse(localStorage.getItem("beammods-mods") || "[]")
  .filter((mod) => !isRemovedLegacyMod(mod));
localStorage.setItem("beammods-mods", JSON.stringify(mods));
let authMode = "login";
let currentUser = readStoredUser();
const ownerUsernames = [localStorage.getItem("beammods-owner-username"), "jerzy", "testuser", "owner", "admin"].filter(Boolean);
const authModal = document.querySelector("#auth-modal");
const authForm = document.querySelector("#auth-form");
const dashboardPage = document.querySelector("#dashboard-page");
const librarySections = document.querySelectorAll("main > section:not(#dashboard-page):not(#bug-page):not(#dmca-page):not(#how-page)");

function readStoredUser() {
  const savedUser = localStorage.getItem("beammods-current-user");
  if (!savedUser) return null;
  try {
    return JSON.parse(savedUser);
  } catch {
    localStorage.removeItem("beammods-current-user");
    return null;
  }
}

function getUsers() {
  return JSON.parse(localStorage.getItem("beammods-users") || "[]");
}

function updateAccountButton() {
  if (!currentUser) currentUser = readStoredUser();
  const button = document.querySelector("[data-open-auth]");
  button.textContent = currentUser ? `@${currentUser.username}` : "Sign in";
}

function showDashboard() {
  if (!currentUser) return;
  saveView("dashboard-published");
  document.body.classList.add("dashboard-mode");
  document.querySelector(".site-footer").hidden = false;
  bugPage.hidden = true;
  dmcaPage.hidden = true;
  howPage.hidden = true;
  librarySections.forEach((section) => { section.hidden = true; });
  dashboardPage.hidden = false;
  showPublishedView();
  document.querySelector("#dashboard-name").textContent = `@${currentUser.username}`;
  document.querySelector("#dashboard-email").textContent = currentUser.email || "Google account";
  document.querySelector("#dashboard-avatar").textContent = currentUser.username.slice(0, 1).toUpperCase();
  document.querySelector("#dashboard-date").textContent = new Date(currentUser.createdAt || Date.now()).toLocaleDateString();
  const ownMods = mods.filter((mod) => mod.owner === currentUser.username);
  document.querySelector("#dashboard-count").textContent = ownMods.length;
  document.querySelector("#profile-mods").innerHTML = ownMods.length
    ? ownMods.map((mod) => `<div class="profile-mod"><div class="profile-mod-image" style="${mod.image ? `background-image:url('${escapeHtml(mod.image)}')` : ""}">${mod.image ? "" : escapeHtml(mod.icon)}</div><div class="profile-mod-main"><strong>${escapeHtml(mod.name)}</strong><span>${new Date(mod.publishedAt).toLocaleDateString()} · ${escapeHtml(mod.category)} · ${mod.approved === false ? "Pending owner approval" : "Approved"}</span></div><button class="text-button delete-mod" data-mod-name="${escapeHtml(mod.name)}">Delete</button></div>`).join("")
    : "<p class='form-note'>You have not published any mods yet.</p>";
  const isOwner = ownerUsernames.includes(currentUser.username.toLowerCase());
  document.querySelector("#owner-panel-link").hidden = !isOwner;
  if (isOwner) renderPendingMods();
}

function renderPendingMods() {
  const pending = mods.filter((mod) => mod.approved === false && !mod.isTest);
  document.querySelector("#pending-mods").innerHTML = pending.length
    ? pending.map((mod) => `<article class="approval-card"><div class="profile-mod-image approval-image" style="${mod.image ? `background-image:url('${escapeHtml(mod.image)}')` : ""}">${mod.image ? "" : escapeHtml(mod.icon)}</div><div class="profile-mod-main"><strong>${escapeHtml(mod.name)}</strong><span>by ${escapeHtml(mod.author)} · ${escapeHtml(mod.category)} · v${escapeHtml(mod.version)}</span><p>${escapeHtml(mod.description)}</p><small>${escapeHtml(mod.size)} · ${escapeHtml(mod.configs)} configs</small></div><div class="approval-actions"><button class="preview-mod back-button" data-mod-name="${escapeHtml(mod.name)}">Preview details</button>${mod.downloadUrl ? `<button class="preview-mod back-button" data-url="${escapeHtml(mod.downloadUrl)}">Check download</button>` : ""}<button class="approve-mod submit-button" data-mod-name="${escapeHtml(mod.name)}">Accept</button><button class="reject-mod text-button" data-mod-name="${escapeHtml(mod.name)}">Reject</button></div></article>`).join("")
    : "<p class='form-note'>No mods are waiting for approval.</p>";
}

function showLibrary() {
  saveView("library");
  authModal.hidden = true;
  document.body.classList.remove("dashboard-mode");
  dashboardPage.hidden = true;
  bugPage.hidden = true;
  dmcaPage.hidden = true;
  howPage.hidden = true;
  document.querySelector(".site-footer").hidden = false;
  librarySections.forEach((section) => { section.hidden = false; });
}

function showPublishedView() {
  saveView("dashboard-published");
  document.querySelector("#published-view").hidden = false;
  document.querySelector("#owner-view").hidden = true;
  document.querySelector("#dashboard-bug-view").hidden = true;
  document.querySelectorAll(".dashboard-action").forEach((button) => button.classList.remove("active"));
  document.querySelector("#published-view-link").classList.add("active");
}

function showOwnerPage() {
  if (!currentUser || !ownerUsernames.includes(currentUser.username.toLowerCase())) return;
  saveView("dashboard-owner");
  document.body.classList.add("dashboard-mode");
  bugPage.hidden = true;
  dmcaPage.hidden = true;
  howPage.hidden = true;
  librarySections.forEach((section) => { section.hidden = true; });
  dashboardPage.hidden = false;
  document.querySelector("#published-view").hidden = true;
  document.querySelector("#owner-view").hidden = false;
  document.querySelector("#dashboard-bug-view").hidden = true;
  document.querySelectorAll(".dashboard-action").forEach((button) => button.classList.remove("active"));
  document.querySelector("#owner-panel-link").classList.add("active");
  renderPendingMods();
}

function renderMods() {
  const query = searchInput.value.trim().toLowerCase();
  const panelQuery = panelSearch.value.trim().toLowerCase();
  const authorQuery = authorSearch.value.trim().toLowerCase();
  const visible = mods
    .filter((mod) => !isRemovedLegacyMod(mod))
    .filter((mod) => mod.approved !== false || mod.isTest)
    .filter((mod) => activeFilter === "All" || mod.category === activeFilter)
    .filter((mod) => categorySelect.value === "All" || mod.category === categorySelect.value)
    .filter((mod) => !query && !panelQuery || `${mod.name} ${mod.author} ${mod.category}`.toLowerCase().includes(query || panelQuery))
    .filter((mod) => mod.author.toLowerCase().includes(authorQuery))
    .sort((a, b) => {
      if (sortSelect.value === "popular") return Number.parseFloat(b.downloads) - Number.parseFloat(a.downloads);
      if (sortSelect.value === "rating") return Number(b.rating) - Number(a.rating);
      return a.age - b.age;
    });
    document.querySelector("#dashboard-bug-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const report = Object.fromEntries(new FormData(event.currentTarget));
      const reports = JSON.parse(localStorage.getItem("beammods-bug-reports") || "[]");
      reports.push({ ...report, reporter: currentUser.username, createdAt: new Date().toISOString() });
      localStorage.setItem("beammods-bug-reports", JSON.stringify(reports));
      event.currentTarget.reset();
      askConfirmation("Bug report sent", "Thanks. The owner can now review this report and investigate the mod.", showDashboard);
    });
    bugPageForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const report = Object.fromEntries(new FormData(bugPageForm));
      const reports = JSON.parse(localStorage.getItem("beammods-bug-reports") || "[]");
      reports.push({ ...report, reporter: currentUser?.username || "guest", createdAt: new Date().toISOString() });
      localStorage.setItem("beammods-bug-reports", JSON.stringify(reports));
      bugPageForm.reset();
      askConfirmation("Bug report sent", "Thanks. The owner can now review this report and investigate the mod.", showLibrary);
    });

  grid.innerHTML = visible.map((mod) => `
    <article class="mod-card" data-mod-name="${escapeHtml(mod.name)}" tabindex="0" role="button" aria-label="View ${escapeHtml(mod.name)} details">
      <div class="mod-cover ${mod.cover} ${mod.image ? "has-image" : ""}" ${mod.image ? `style="background-image: linear-gradient(20deg, rgba(0,0,0,.5), transparent 65%), url('${escapeHtml(mod.image)}')"` : ""}>
        <span class="mod-badge">${escapeHtml(mod.category)}</span>
        <div class="mod-tech"><span>${escapeHtml(mod.size || "Size N/A")}</span><span>v${escapeHtml(mod.version || "N/A")}</span><span>${escapeHtml(mod.configs ?? "-")} configs</span></div>
        ${mod.image ? "" : `<span class="cover-icon">${escapeHtml(mod.icon)}</span>`}
      </div>
      <div class="mod-info">
        <div>
          <h3>${escapeHtml(formatDisplayName(mod.name))}</h3>
          <p class="mod-meta">By ${escapeHtml(formatDisplayName(mod.author))}</p>
        </div>
        <span class="mod-status">${mod.isTest ? "TEST LISTING" : "COMMUNITY UPLOAD"}</span>
      </div>
      <button class="card-details-button" type="button">View page &amp; details <span>→</span></button>
    </article>
  `).join("");
  emptyState.hidden = visible.length > 0;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function formatDisplayName(value) {
  return String(value || "").replace(/\b\w+/g, (word) => {
    const lower = word.toLowerCase();
    if (lower === "bmw") return "BMW";
    if (/^g\d{2,3}$/i.test(word)) return word.toUpperCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

function openFileDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("beammods-files", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("mods");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveModFile(file) {
  const id = crypto.randomUUID();
  const database = await openFileDatabase();
  await new Promise((resolve, reject) => {
    const request = database.transaction("mods", "readwrite").objectStore("mods").put(file, id);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  database.close();
  return id;
}

async function getModFile(id) {
  const database = await openFileDatabase();
  const file = await new Promise((resolve, reject) => {
    const request = database.transaction("mods", "readonly").objectStore("mods").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return file;
}

function openDetails(mod) {
  const detailsCover = document.querySelector("#details-cover");
  detailsCover.className = `details-cover ${mod.cover}`;
  detailsCover.style.backgroundImage = mod.image ? `linear-gradient(20deg, rgba(0,0,0,.5), transparent 65%), url('${mod.image}')` : "";
  document.querySelector("#details-category").textContent = formatDisplayName(mod.category);
  document.querySelector("#details-title").textContent = formatDisplayName(mod.name);
  document.querySelector("#details-author").textContent = `Created by ${formatDisplayName(mod.author)}`;
  document.querySelector("#details-description").textContent = mod.description || "No description was provided for this mod.";
  document.querySelector("#details-extra").innerHTML = `
    <div><span>Format</span><strong>BeamNG.drive ZIP</strong></div>
    <div><span>Availability</span><strong>${mod.downloadUrl || mod.fileId ? "Ready to download" : "Link required"}</strong></div>
    <div><span>Published</span><strong>${mod.publishedAt ? new Date(mod.publishedAt).toLocaleDateString() : "Community upload"}</strong></div>
  `;
  const detailsStats = document.querySelector("#details-stats");
  detailsStats.innerHTML = mod.rating || mod.downloads
    ? `<span>${mod.rating ? `★ ${escapeHtml(mod.rating)}` : ""}</span><span>${mod.downloads ? `↓ ${escapeHtml(mod.downloads)} downloads` : ""}</span>`
    : "";
  detailsStats.hidden = !mod.rating && !mod.downloads;
  document.querySelector(".details-tech")?.remove();
  detailsStats.insertAdjacentHTML("beforebegin", `<div class="details-tech"><span>${escapeHtml(mod.size || "Size N/A")}</span><span>v${escapeHtml(mod.version || "N/A")}</span><span>${escapeHtml(mod.configs ?? "-")} configs</span></div>`);
  const downloadButton = document.querySelector("#details-download");
  downloadButton.onclick = async () => {
    if (mod.fileId) {
      const file = await getModFile(mod.fileId);
      if (!file) {
        alert("The local ZIP file could not be found. Please upload it again.");
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = `${String(mod.name || "beammods-mod").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } else if (mod.downloadUrl) {
      window.open(mod.downloadUrl, "_blank", "noopener");
    } else {
      alert("This uploaded ZIP is no longer available after refreshing the demo. Please upload it again or add a download link.");
    }
  };
  document.querySelector("#details-modal").hidden = false;
}

grid.addEventListener("click", (event) => {
  const detailsButton = event.target.closest(".card-details-button");
  if (detailsButton) {
    const card = detailsButton.closest(".mod-card");
    openDetails(mods.find((mod) => mod.name === card.dataset.modName));
    return;
  }
  if (event.target.closest("button")) return;
  const card = event.target.closest(".mod-card");
  if (card) openDetails(mods.find((mod) => mod.name === card.dataset.modName));
});
grid.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") event.target.click();
});

document.querySelectorAll(".filter").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(".filter.active").classList.remove("active");
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    categorySelect.value = activeFilter;
    renderMods();
  });
});
searchInput.addEventListener("input", () => {
  panelSearch.value = searchInput.value;
  renderMods();
});
panelSearch.addEventListener("input", () => {
  searchInput.value = panelSearch.value;
  renderMods();
});
authorSearch.addEventListener("input", renderMods);
categorySelect.addEventListener("change", () => {
  activeFilter = categorySelect.value;
  document.querySelectorAll(".filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === activeFilter));
  renderMods();
});
document.querySelector("#clear-search").addEventListener("click", () => {
  searchInput.value = "";
  panelSearch.value = "";
  authorSearch.value = "";
  categorySelect.value = "All";
  activeFilter = "All";
  document.querySelectorAll(".filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === "All"));
  renderMods();
});
sortSelect.addEventListener("change", renderMods);

const uploadModal = document.querySelector("#upload-modal");
const detailsModal = document.querySelector("#details-modal");
const securityModal = document.querySelector("#security-modal");
const confirmModal = document.querySelector("#confirm-modal");
const bugModal = document.querySelector("#bug-modal");
const dmcaModal = document.querySelector("#dmca-modal");
const bugForm = document.querySelector("#bug-form");
const bugPage = document.querySelector("#bug-page");
const dmcaPage = document.querySelector("#dmca-page");
const howPage = document.querySelector("#how-page");
const bugPageForm = document.querySelector("#bug-page-form");
let standaloneReturn = "library";
const form = document.querySelector("#upload-form");
const sourceType = document.querySelector("#source-type");
const linkField = document.querySelector("#download-link-field");
const fileInput = form.querySelector('input[name="file"]');
const fileName = document.querySelector("#file-name");
const imageInput = document.querySelector("#image-input");
const imageName = document.querySelector("#image-name");
const imagePreview = document.querySelector("#upload-image-preview");
sourceType.addEventListener("change", () => { linkField.hidden = sourceType.value !== "link"; });
fileInput.required = true;
sourceType.addEventListener("change", () => { fileInput.required = sourceType.value === "file"; });
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileName.textContent = file ? `${file.name} · ${formatBytes(file.size)}` : "Choose a ZIP file (when uploading locally)";
});
imageInput.addEventListener("change", () => {
  const image = imageInput.files[0];
  if (image && !["image/png", "image/jpeg", "image/webp"].includes(image.type)) {
    imageInput.value = "";
    imageName.textContent = "Optional JPG, PNG or WEBP";
    imagePreview.hidden = true;
    imagePreview.removeAttribute("src");
    alert("Choose a PNG, JPG or WEBP preview image.");
    return;
  }
  imageName.textContent = image ? `${image.name} · ${formatBytes(image.size)} · preview ready` : "Optional JPG, PNG or WEBP";
  if (!image) {
    imagePreview.hidden = true;
    imagePreview.removeAttribute("src");
    return;
  }
  fileToDataUrl(image).then((url) => {
    imagePreview.src = url;
    imagePreview.hidden = false;
  }).catch(() => {
    imagePreview.hidden = true;
    alert("The preview image could not be read.");
  });
});
document.querySelectorAll("[data-open-upload]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!currentUser) {
      authMode = "login";
      updateAuthForm();
      showAuthPage();
      return;
    }
    uploadModal.hidden = false;
    uploadModal.querySelector("input").focus();
  });
});
document.querySelectorAll("[data-open-auth]").forEach((button) => {
  button.addEventListener("click", () => {
    if (currentUser) {
      showDashboard();
    } else {
      authMode = "login";
      updateAuthForm();
      showAuthPage();
    }
  });
});
document.querySelectorAll("[data-close-upload]").forEach((button) => {
  button.addEventListener("click", () => { uploadModal.hidden = true; });
});
document.querySelectorAll("[data-close-details]").forEach((button) => {
  button.addEventListener("click", () => { detailsModal.hidden = true; });
});
[uploadModal, detailsModal].forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.hidden = true;
  });
});
securityModal.addEventListener("click", (event) => {
  if (event.target === securityModal) securityModal.hidden = true;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    uploadModal.hidden = true;
    detailsModal.hidden = true;
    securityModal.hidden = true;
    authModal.hidden = true;
    confirmModal.hidden = true;
    bugModal.hidden = true;
    dmcaModal.hidden = true;
  }
});

function updateAuthForm() {
  const register = authMode === "register";
  document.querySelector("#auth-title").innerHTML = register ? "Create your <em>garage.</em>" : "Join the <em>garage.</em>";
  document.querySelector("#auth-submit").innerHTML = `${register ? "Create account" : "Sign in"} <span>↗</span>`;
  document.querySelector("[name=email]").closest("label").hidden = !register;
}

document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    authMode = tab.dataset.authTab;
    document.querySelectorAll(".auth-tab").forEach((item) => item.classList.toggle("active", item === tab));
    updateAuthForm();
  });
});

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(authForm);
  const users = getUsers();
  const username = String(data.get("username")).trim();
  const password = String(data.get("password"));
  if (authMode === "register") {
    if (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      alert("That username is already taken.");
      return;
    }
    const user = { username, email: data.get("email"), password, createdAt: new Date().toISOString() };
    users.push(user);
    localStorage.setItem("beammods-users", JSON.stringify(users));
    if (!localStorage.getItem("beammods-owner-username")) {
      localStorage.setItem("beammods-owner-username", username);
      ownerUsernames.push(username);
    }
    currentUser = user;
  } else {
    const user = users.find((item) => item.username.toLowerCase() === username.toLowerCase() && item.password === password);
    if (!user) {
      alert("Incorrect username or password.");
      return;
    }
    currentUser = user;
  }
  localStorage.setItem("beammods-current-user", JSON.stringify(currentUser));
  authForm.reset();
  authModal.hidden = true;
  updateAccountButton();
  showDashboard();
});

document.querySelector("[data-close-auth]").addEventListener("click", showLibrary);
confirmModal.addEventListener("click", (event) => {
  if (event.target === confirmModal) confirmModal.hidden = true;
});
document.querySelector("#dashboard-sign-out").addEventListener("click", () => {
  askConfirmation("Sign out of BeamMods?", "Your saved account and published mods will stay safe on this device.", () => {
    currentUser = null;
    localStorage.removeItem("beammods-current-user");
    showLibrary();
    updateAccountButton();
  });
});
document.querySelector("#back-to-library").addEventListener("click", showLibrary);
document.querySelector("#owner-panel-link").addEventListener("click", () => {
  showOwnerPage();
});
document.querySelector("#published-view-link").addEventListener("click", showPublishedView);
document.querySelector("#report-bug-link").addEventListener("click", showDashboardBugView);
document.querySelector("#dmca-link").addEventListener("click", () => { showStandalonePage(dmcaPage); });
document.querySelector("#footer-bug-link").addEventListener("click", () => { showStandalonePage(bugPage); });
document.querySelector("#back-from-bug").addEventListener("click", leaveStandalonePage);
document.querySelector("#back-from-dmca").addEventListener("click", leaveStandalonePage);
document.querySelector("#back-from-how").addEventListener("click", showLibrary);
document.querySelector("[data-close-bug]").addEventListener("click", () => { bugModal.hidden = true; });
document.querySelector("[data-close-dmca]").addEventListener("click", () => { dmcaModal.hidden = true; });
bugForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const report = Object.fromEntries(new FormData(bugForm));
  const reports = JSON.parse(localStorage.getItem("beammods-bug-reports") || "[]");
  reports.push({ ...report, reporter: currentUser.username, createdAt: new Date().toISOString() });
  localStorage.setItem("beammods-bug-reports", JSON.stringify(reports));
  bugForm.reset();
  bugModal.hidden = true;
  askConfirmation("Bug report sent", "Thanks. The owner can now review this report and investigate the mod.", () => {});
});
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  showLibrary();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
document.querySelector("#delete-account").addEventListener("click", () => {
  askConfirmation("Delete your account?", "This permanently removes your account and every mod you published. This cannot be undone.", () => {
    const users = getUsers().filter((user) => user.username !== currentUser.username);
    localStorage.setItem("beammods-users", JSON.stringify(users));
    mods = mods.filter((mod) => mod.owner !== currentUser.username);
    localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((mod) => !defaultMods.includes(mod))));
    currentUser = null;
    localStorage.removeItem("beammods-current-user");
    showLibrary();
    updateAccountButton();
    renderMods();
  });
});
document.querySelector("#profile-mods").addEventListener("click", (event) => {
  const button = event.target.closest(".delete-mod");
  if (!button) return;
  event.stopPropagation();
  askConfirmation("Delete this mod?", "This will remove the mod from your account and the community library.", () => {
    mods = mods.filter((mod) => !(mod.name === button.dataset.modName && mod.owner === currentUser.username));
    localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((mod) => !defaultMods.includes(mod))));
    showDashboard();
    renderMods();
  });
});
document.querySelector("#pending-mods").addEventListener("click", (event) => {
  const button = event.target.closest(".approve-mod, .reject-mod, .preview-mod");
  if (!button) return;
  event.stopPropagation();
  if (button.classList.contains("preview-mod")) {
    if (button.dataset.url) window.open(button.dataset.url, "_blank", "noopener");
    else openDetails(mods.find((item) => item.name === button.dataset.modName));
    return;
  }
  const mod = mods.find((item) => item.name === button.dataset.modName);
  if (mod && button.classList.contains("approve-mod")) {
    askConfirmation("Accept this mod?", "Have you checked the preview, description and download source? Accepting makes this mod public.", () => {
      mod.approved = true;
      localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((item) => !defaultMods.includes(item))));
      renderPendingMods();
      renderMods();
    });
    return;
  }
  if (mod && button.classList.contains("reject-mod")) {
    askConfirmation("Reject this mod?", "The submission and its stored preview will be removed from the approval queue.", () => {
      mods = mods.filter((item) => item !== mod);
      localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((item) => !defaultMods.includes(item))));
      renderPendingMods();
      renderMods();
    });
    return;
  }
  localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((item) => !defaultMods.includes(item))));
  renderPendingMods();
  renderMods();
});
function askConfirmation(title, message, onConfirm) {
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  confirmModal.hidden = false;
  const accept = document.querySelector("#confirm-accept");
  const cancel = document.querySelector("#confirm-cancel");
  const close = () => { confirmModal.hidden = true; accept.onclick = null; cancel.onclick = null; };
  cancel.onclick = close;
  accept.onclick = () => { close(); onConfirm(); };
}
document.querySelector("#browse-link").addEventListener("click", (event) => {
  document.querySelector("#browse-link").classList.add("active");
  document.querySelector("#how-link").classList.remove("active");
  if (!dashboardPage.hidden) {
    event.preventDefault();
    showLibrary();
    document.querySelector("#mods").scrollIntoView({ behavior: "smooth" });
  }
});
document.querySelector("#how-link").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#how-link").classList.add("active");
  document.querySelector("#browse-link").classList.remove("active");
  showStandalonePage(howPage);
});
const navSections = [
  { link: document.querySelector("#browse-link"), section: document.querySelector("#mods") },
  { link: document.querySelector("#how-link"), section: document.querySelector("#how-it-works") }
];
const navObserver = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible || !dashboardPage.hidden) return;
  navSections.forEach(({ link, section }) => link.classList.toggle("active", section === visible.target));
}, { threshold: [.25, .6], rootMargin: "-78px 0px -35% 0px" });
navSections.forEach(({ section }) => navObserver.observe(section));
document.querySelector("#google-sign-in").addEventListener("click", () => {
  const username = window.prompt("Demo Google name:");
  if (!username || !username.trim()) return;
  currentUser = { username: username.trim(), email: "google-user@demo.local", provider: "Google", createdAt: new Date().toISOString() };
  if (username.trim().toLowerCase() === "jerzy" && !ownerUsernames.includes("jerzy")) ownerUsernames.push("jerzy");
  localStorage.setItem("beammods-current-user", JSON.stringify(currentUser));
  authModal.hidden = true;
  updateAccountButton();
  showDashboard();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const file = data.get("file");
  const image = data.get("image");
  const downloadUrl = data.get("downloadUrl");
  const source = data.get("sourceType");
  const extensionIsZip = file && file.name.toLowerCase().endsWith(".zip");
  if (source === "file" && (!file || !file.size || !extensionIsZip || file.size > 2 * 1024 * 1024 * 1024)) {
    alert("Security check failed: choose a ZIP file smaller than 2 GB.");
    return;
  }
  if (source === "link" && !/^https?:\/\//i.test(downloadUrl)) {
    alert("Please enter a valid HTTPS download link.");
    return;
  }
  securityModal.hidden = false;
  document.querySelector("#security-progress").style.width = "0%";
  document.querySelector("#security-message").textContent = "Inspecting file name, type and size...";
  setTimeout(() => { document.querySelector("#security-progress").style.width = "100%"; }, 450);
  setTimeout(() => finishUpload(data, file, image, source, downloadUrl), 950);
});

async function finishUpload(data, file, image, source, downloadUrl) {
  securityModal.hidden = true;
  const imageUrl = image && image.size ? await fileToDataUrl(image) : "";
  const isOwner = ownerUsernames.includes(currentUser.username.toLowerCase());
  const fileId = source === "file" && file ? await saveModFile(file) : "";
  const newMod = {
    name: data.get("name"),
    category: data.get("category"),
    author: data.get("author"),
    description: data.get("description"),
    version: data.get("version"),
    configs: Number(data.get("configs")),
    size: file && file.size ? formatBytes(file.size) : "External link",
    rating: "",
    downloads: "",
    age: 0,
    cover: "cover-drift",
    icon: "NEW",
    isTest: false,
    approved: isOwner,
    owner: currentUser.username,
    publishedAt: new Date().toISOString(),
    image: imageUrl,
    downloadUrl: source === "link" ? downloadUrl : "",
    fileId
  };
  mods.unshift(newMod);
  try {
    localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((mod) => !defaultMods.includes(mod))));
  } catch (error) {
    mods = mods.filter((mod) => mod !== newMod);
    alert("This upload is too large for browser storage. Try a smaller preview image.");
    return;
  }
  form.reset();
  imagePreview.hidden = true;
  imagePreview.removeAttribute("src");
  uploadModal.hidden = true;
  renderMods();
  updateAccountButton();
  updateAuthForm();
  showDashboard();
  alert(isOwner
    ? `"${newMod.name}" passed the browser safety checks and is now published.`
    : `"${newMod.name}" passed the browser safety checks and was submitted for owner approval. It will appear publicly after approval.`);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("Could not read preview image.")));
    reader.readAsDataURL(file);
  });
}

renderMods();
currentUser = readStoredUser();
updateAccountButton();
updateAuthForm();
const savedView = localStorage.getItem("beammods-current-view");
if (savedView === "dashboard-owner" && currentUser) { showDashboard(); showOwnerPage(); }
else if (savedView === "dashboard-bug" && currentUser) { showDashboard(); showDashboardBugView(); }
else if (savedView === "dashboard-published" && currentUser) showDashboard();
else if (savedView === "bug-page") showStandalonePage(bugPage);
else if (savedView === "dmca-page") showStandalonePage(dmcaPage);
else if (savedView === "how-page") showStandalonePage(howPage);
else showLibrary();
