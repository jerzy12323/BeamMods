const defaultMods = [];
const remoteMode = /^https?:$/i.test(window.location.protocol);
const remoteUploadLimit = 95 * 1024 * 1024;
async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || 120000);
  const requestOptions = { credentials: "include", ...options, signal: controller.signal };
  delete requestOptions.timeoutMs;
  let response;
  try {
    response = await fetch(path, requestOptions);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The upload took too long. Check the file size and try again.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const message = typeof payload === "string"
      ? (payload.includes("<html") || payload.includes("<!DOCTYPE") ? "The server could not process the approval. Please try again." : payload.slice(0, 240))
      : payload?.error;
    throw new Error(message || `Request failed (${response.status}).`);
  }
  return payload;
}

const grid = document.querySelector("#mods-grid");
const emptyState = document.querySelector("#empty-state");
const searchInput = document.querySelector("#search-input");
const sortSelect = document.querySelector("#sort-select");
const pagination = document.querySelector("#library-pagination");
let currentLibraryPage = 1;
const modsPerPage = 6;
const panelSearch = document.querySelector("#panel-search");
const authorSearch = document.querySelector("#author-search");
const categorySelect = document.querySelector("#category-select");
let activeFilter = "All";
const viewButtons = document.querySelectorAll(".view-button");
let activeView = localStorage.getItem("beammods-view") || "grid";
function setLibraryView(view) {
  activeView = view === "list" ? "list" : "grid";
  grid.classList.toggle("list-view", activeView === "list");
  viewButtons.forEach((button, index) => button.classList.toggle("selected", (activeView === "grid" && index === 0) || (activeView === "list" && index === 1)));
  localStorage.setItem("beammods-view", activeView);
}
viewButtons.forEach((button, index) => button.addEventListener("click", () => setLibraryView(index === 1 ? "list" : "grid")));
setLibraryView(activeView);
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
  passwordResetModal.hidden = true;
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
const ownerEmails = ["beammodshub@gmail.com"];
const authModal = document.querySelector("#auth-modal");
const authForm = document.querySelector("#auth-form");
const passwordResetModal = document.querySelector("#password-reset-modal");
const forgotPasswordForm = document.querySelector("#forgot-password-form");
const resetPasswordForm = document.querySelector("#reset-password-form");
const activationResultModal = document.querySelector("#activation-result-modal");
let passwordResetToken = "";
const authLinkParams = new URLSearchParams(window.location.search);
const hasAuthLink = authLinkParams.has("reset") || authLinkParams.has("activation");
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

function isOwnerAccount(user = currentUser) {
  return Boolean(user && (
    ownerUsernames.includes(String(user.username || "").toLowerCase()) ||
    ownerEmails.includes(String(user.email || "").toLowerCase())
  ));
}

function updateAccountButton() {
  if (!currentUser && !hasAuthLink) currentUser = readStoredUser();
  const button = document.querySelector("[data-open-auth]");
  const avatar = document.querySelector("#account-avatar");
  const label = document.querySelector("#account-label");
  label.textContent = currentUser ? `@${currentUser.username}` : "Sign in";
  avatar.textContent = currentUser?.avatar ? "" : (currentUser ? currentUser.username.slice(0, 1).toUpperCase() : "?");
  avatar.classList.toggle("has-image", Boolean(currentUser?.avatar));
  avatar.style.backgroundImage = currentUser?.avatar ? `url('${currentUser.avatar}')` : "";
}

function updateDashboardAvatar() {
  const avatar = document.querySelector("#dashboard-avatar");
  if (!avatar || !currentUser) return;
  avatar.classList.toggle("has-image", Boolean(currentUser.avatar));
  avatar.style.backgroundImage = currentUser.avatar ? `url('${currentUser.avatar}')` : "";
  avatar.textContent = currentUser.avatar ? "" : currentUser.username.slice(0, 1).toUpperCase();
}

function showDashboard(sync = true) {
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
  document.querySelector("#profile-username").value = currentUser.username;
  updateDashboardAvatar();
  document.querySelector("#dashboard-date").textContent = new Date(currentUser.createdAt || Date.now()).toLocaleDateString();
  const ownMods = mods.filter((mod) => mod.owner === currentUser.username);
  document.querySelector("#dashboard-count").textContent = ownMods.length;
  document.querySelector("#profile-mods").innerHTML = ownMods.length
    ? ownMods.map((mod, index) => `<div class="profile-mod"><div class="profile-mod-image" style="${mod.image ? `background-image:url('${escapeHtml(mod.image)}')` : ""}">${mod.image ? "" : escapeHtml(mod.icon)}</div><div class="profile-mod-main"><strong>${escapeHtml(mod.name)}</strong><span>${new Date(mod.publishedAt).toLocaleDateString()} · ${escapeHtml(mod.category)} · ${mod.approved === false ? "Pending owner approval" : "Approved"}</span></div><button class="text-button delete-mod" data-mod-id="${escapeHtml(mod.id || "")}" data-mod-index="${index}">Delete</button></div>`).join("")
    : "<p class='form-note'>You have not published any mods yet.</p>";
  const isOwner = isOwnerAccount();
  document.querySelector("#owner-panel-link").hidden = !isOwner;
  if (isOwner) renderPendingMods();
  if (remoteMode && sync) syncUserMods().catch((error) => {
    document.querySelector("#profile-mods").innerHTML = `<p class="form-note form-error">${escapeHtml(error.message)}</p>`;
  });
}

function mapRemoteMod(mod) {
  return {
    id: mod.id,
    name: mod.name,
    category: mod.category,
    author: mod.author,
    description: mod.description,
    version: mod.version,
    gameVersion: "0.39",
    configs: mod.configs,
    size: "Community upload",
    rating: mod.rating || "",
    downloads: mod.download_count || 0,
    age: 0,
    cover: "cover-drift",
    icon: "NEW",
    approved: Boolean(mod.approved),
    owner: mod.username || mod.author,
    publishedAt: mod.created_at,
    updatedAt: mod.created_at,
    image: mod.image_path ? `/uploads/${mod.image_path.split("/").pop()}` : "",
    images: mod.image_path ? [`/uploads/${mod.image_path.split("/").pop()}`] : [],
    downloadUrl: mod.download_url || "",
    fileId: "",
    fileName: mod.original_filename || ""
  };
}

async function syncUserMods() {
  if (!remoteMode || !currentUser) return;
  const remoteMods = await apiRequest("/api/mods/mine");
  if (!Array.isArray(remoteMods)) throw new Error("Your mods response was not a list.");
  const remoteById = new Map(remoteMods.map((mod) => [String(mod.id), mod]));
  const localById = new Map(mods.filter((mod) => mod.id).map((mod) => [String(mod.id), mod]));
  remoteMods.forEach((remoteMod) => {
    const localMod = localById.get(String(remoteMod.id));
    if (localMod) Object.assign(localMod, mapRemoteMod(remoteMod));
    else mods.unshift(mapRemoteMod(remoteMod));
  });
  mods = mods.filter((mod) => !mod.id || remoteById.has(String(mod.id)) || mod.owner !== currentUser.username);
  renderMods();
  showDashboard(false);
}

document.querySelector("#profile-name-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#profile-username");
  const message = document.querySelector("#profile-name-message");
  const username = input.value.trim();
  message.textContent = "";
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(username)) {
    message.textContent = "Use 3-24 letters, numbers, _ or -.";
    return;
  }
  try {
    if (remoteMode) {
      const result = await apiRequest("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username })
      });
      currentUser.username = result.username;
    } else {
      const users = getUsers();
      const duplicate = users.some((user) => user.username.toLowerCase() === username.toLowerCase()
        && user.email?.toLowerCase() !== currentUser.email?.toLowerCase());
      if (duplicate) throw new Error("That username is already taken.");
      const oldUsername = currentUser.username;
      users.forEach((user) => {
        if (user.username === oldUsername) user.username = username;
      });
      localStorage.setItem("beammods-users", JSON.stringify(users));
      mods.forEach((mod) => {
        if (mod.owner === oldUsername) mod.owner = username;
      });
      localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((mod) => !defaultMods.includes(mod))));
      currentUser.username = username;
    }
    localStorage.setItem("beammods-current-user", JSON.stringify(currentUser));
    updateAccountButton();
    showDashboard();
    message.textContent = "Username updated.";
  } catch (error) {
    message.textContent = error.message;
  }
});

function renderPendingMods() {
  const pending = mods.filter((mod) => mod.approved === false && !mod.isTest);
  document.querySelector("#pending-mods").innerHTML = pending.length
    ? pending.map((mod) => `<article class="approval-card"><div class="profile-mod-image approval-image" style="${mod.image ? `background-image:url('${escapeHtml(mod.image)}')` : ""}">${mod.image ? "" : escapeHtml(mod.icon)}</div><div class="profile-mod-main"><strong>${escapeHtml(mod.name)}</strong><span>by ${escapeHtml(mod.author)} · ${escapeHtml(mod.category)} · v${escapeHtml(mod.version)}</span><p>${escapeHtml(mod.description)}</p><small>${escapeHtml(mod.size)} · ${escapeHtml(mod.configs)} configs</small></div><div class="approval-actions"><button class="preview-mod back-button" data-mod-name="${escapeHtml(mod.name)}">Preview details</button>${mod.downloadUrl ? `<button class="preview-mod back-button" data-url="${escapeHtml(mod.downloadUrl)}">Check download</button>` : ""}<button class="approve-mod submit-button" data-mod-name="${escapeHtml(mod.name)}">Accept</button><button class="reject-mod text-button" data-mod-name="${escapeHtml(mod.name)}">Reject</button></div></article>`).join("")
    : "<p class='form-note'>No mods are waiting for approval.</p>";
}

async function syncPendingMods() {
  if (!remoteMode || !isOwnerAccount()) return;
  const pending = await apiRequest("/api/mods/pending");
  if (!Array.isArray(pending)) throw new Error("Pending mods response was not a list.");
  const localById = new Set(mods.map((mod) => String(mod.id || "")));
  const imported = pending
    .filter((mod) => !localById.has(String(mod.id)))
    .map((mod) => ({
      id: mod.id,
      name: mod.name,
      category: mod.category,
      author: mod.author,
      description: mod.description,
      version: mod.version,
      gameVersion: "0.39",
      configs: mod.configs,
      size: "Community upload",
      rating: "",
      downloads: 0,
      age: 0,
      cover: "cover-drift",
      icon: "NEW",
      approved: false,
      owner: mod.username || mod.author,
      publishedAt: mod.created_at,
      updatedAt: mod.created_at,
      image: mod.image_path ? `/uploads/${mod.image_path.split("/").pop()}` : "",
      images: mod.image_path ? [`/uploads/${mod.image_path.split("/").pop()}`] : [],
      downloadUrl: mod.download_url || "",
      fileId: "",
      fileName: mod.original_filename || ""
    }));
  if (!imported.length) return;
  mods = [...imported, ...mods];
  renderPendingMods();
}

async function renderOwnerReports() {
  const target = document.querySelector("#owner-reports");
  if (!target) return;
  if (!remoteMode) {
    const reports = JSON.parse(localStorage.getItem("beammods-bug-reports") || "[]");
    target.innerHTML = reports.length ? reports.map((report, index) => `<details class="approval-card report-card"><summary><div class="profile-mod-main"><strong>${escapeHtml(report.modName || report.title)}</strong><span>${escapeHtml(report.reporter || "Guest")} · ${escapeHtml(report.type || "Other")} · ${new Date(report.createdAt).toLocaleString()}</span></div><button class="delete-report text-button" type="button" data-report-index="${index}">Delete</button><span class="report-chevron">+</span></summary><div class="report-details"><p>${escapeHtml(report.details || report.body)}</p></div></details>`).join("") : "<p class='form-note'>No reports yet.</p>";
    return;
  }
  try {
    const reports = await apiRequest("/api/reports");
    target.innerHTML = reports.length ? reports.map((report) => `<details class="approval-card report-card"><summary><div class="profile-mod-main"><strong>${escapeHtml(report.title)}</strong><span>${escapeHtml(report.username)} · ${escapeHtml(report.email)} · ${new Date(report.created_at).toLocaleString()}</span></div><button class="delete-report text-button" type="button" data-report-id="${report.id}">Delete</button><span class="report-chevron">+</span></summary><div class="report-details"><p>${escapeHtml(report.body)}</p></div></details>`).join("") : "<p class='form-note'>No reports yet.</p>";
  } catch (error) {
    target.innerHTML = `<p class="form-note form-error">${escapeHtml(error.message)}</p>`;
  }

  document.querySelector("#owner-reports").addEventListener("click", (event) => {
    const button = event.target.closest(".delete-report");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    askConfirmation("Delete this report?", "This report will be removed from the owner panel.", async () => {
      try {
        if (remoteMode && button.dataset.reportId) {
          await apiRequest(`/api/reports/${button.dataset.reportId}`, { method: "DELETE" });
        } else {
          const reports = JSON.parse(localStorage.getItem("beammods-bug-reports") || "[]");
          reports.splice(Number(button.dataset.reportIndex), 1);
          localStorage.setItem("beammods-bug-reports", JSON.stringify(reports));
        }
        await renderOwnerReports();
        showActionNotice("Report deleted", "The bug report was removed from the owner panel.");
      } catch (error) {
        showActionNotice("Deletion failed", error.message);
      }
    });
  });

}

async function submitBugReport(formElement, successView) {
  const report = Object.fromEntries(new FormData(formElement));
  const errorElement = formElement.querySelector(".form-error");
  if (errorElement) errorElement.textContent = "";
  if (remoteMode) {
    if (!currentUser) {
      showAuthPage();
      showAuthMessage("Sign in before sending a bug report.");
      return;
    }
    await apiRequest("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report)
    });
  } else {
    const reports = JSON.parse(localStorage.getItem("beammods-bug-reports") || "[]");
    reports.push({ ...report, reporter: currentUser?.username || "guest", createdAt: new Date().toISOString() });
    localStorage.setItem("beammods-bug-reports", JSON.stringify(reports));
  }
  formElement.reset();
  if (successView === "dashboard") {
    showActionNotice("Bug report sent", "The owner can now review this report and investigate the problem.");
  } else {
    bugModal.hidden = true;
    showActionNotice("Bug report sent", "The owner can now review this report and investigate the problem.");
  }
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
  document.body.classList.remove("library-enter");
  requestAnimationFrame(() => {
    document.body.classList.add("library-enter");
    window.setTimeout(() => document.body.classList.remove("library-enter"), 700);
  });
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
  if (!isOwnerAccount()) return;
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
  syncPendingMods().catch((error) => {
    document.querySelector("#pending-mods").innerHTML = `<p class="form-note form-error">${escapeHtml(error.message)}</p>`;
  });
  renderOwnerReports();
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
  const pageCount = 3;
  currentLibraryPage = Math.min(currentLibraryPage, pageCount);
  const pageStart = (currentLibraryPage - 1) * modsPerPage;
  const pageMods = visible.slice(pageStart, pageStart + modsPerPage);
  grid.innerHTML = pageMods.map((mod) => `
    <article class="mod-card" data-mod-name="${escapeHtml(mod.name)}" tabindex="0" role="button" aria-label="View ${escapeHtml(mod.name)} details">
      <div class="mod-cover ${mod.cover} ${mod.image ? "has-image" : ""}" ${mod.image ? `style="background-image: linear-gradient(20deg, rgba(0,0,0,.25), transparent 62%), url('${escapeHtml(mod.image)}')"` : ""}>
        <span class="mod-badge">${escapeHtml(mod.category)}</span>
        <div class="mod-tech"><span>${escapeHtml(mod.size || "Size N/A")}</span><span>v${escapeHtml(mod.version || "N/A")}</span><span>${escapeHtml(mod.configs ?? "-")} configs</span><span>${Array.isArray(mod.images) ? mod.images.length : (mod.image ? 1 : 0)} photos</span></div>
        ${mod.image ? "" : `<span class="cover-icon">${escapeHtml(mod.icon)}</span>`}
      </div>
      <div class="mod-info">
        <div>
          <h3>${escapeHtml(formatDisplayName(mod.name))}</h3>
          <p class="mod-meta">By ${escapeHtml(formatDisplayName(mod.author))}</p>
        </div>
        <span class="mod-status">${mod.isTest ? "TEST LISTING" : (mod.updatedAt ? "UPDATED RECENTLY" : "COMMUNITY UPLOAD")}</span>
      </div>
      <div class="mod-card-stats"><span>↓ ${Number(mod.downloads || 0)} downloads</span><span>★ ${escapeHtml(mod.rating || "New")}</span><span>💬 ${getCommentStore()[mod.name]?.length || 0}</span></div>
      <button class="card-details-button" type="button">View page &amp; details <span>→</span></button>
    </article>
  `).join("");
  emptyState.hidden = pageMods.length > 0;
  pagination.hidden = false;
  pagination.querySelectorAll(".page-button").forEach((button) => {
    const page = Number(button.dataset.page);
    button.disabled = false;
    button.classList.toggle("active", page === currentLibraryPage);
  });
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

function getDownloadFilename(response, fallback) {
  const header = response.headers.get("content-disposition") || "";
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) return decodeURIComponent(encoded[1]);
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : fallback;
}

function getExternalDownloadUrl(url) {
  const value = String(url || "").trim();
  const driveFile = value.match(/^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (driveFile) return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveFile[1])}&export=download&confirm=t`;
  return value;
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

function getRatingStore() {
  try {
    return JSON.parse(localStorage.getItem("beammods-ratings") || "{}");
  } catch {
    return {};
  }
}

function getCommentStore() {
  try {
    return JSON.parse(localStorage.getItem("beammods-comments") || "{}");
  } catch {
    return {};
  }
}

function getLikeStore() {
  try {
    return JSON.parse(localStorage.getItem("beammods-likes") || "{}");
  } catch {
    return {};
  }
}

function getLikeIdentity() {
  if (currentUser) return `user:${currentUser.username.toLowerCase()}`;
  let guestId = localStorage.getItem("beammods-guest-id");
  if (!guestId) {
    guestId = `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("beammods-guest-id", guestId);
  }
  return guestId;
}

function getDownloadStore() {
  try {
    return JSON.parse(localStorage.getItem("beammods-downloads") || "{}");
  } catch {
    return {};
  }
}

function openDetails(mod) {
  if (!mod) return;
  const detailsCover = document.querySelector("#details-cover");
  detailsCover.className = `details-cover ${mod.cover}`;
  const galleryImages = Array.isArray(mod.images) && mod.images.length ? mod.images : (mod.image ? [mod.image] : []);
  const mainImage = document.querySelector("#details-main-image");
  const detailsGallery = document.querySelector("#details-gallery");
  const galleryItems = galleryImages.slice(0, 5);
  let galleryIndex = 0;
  const galleryPrev = document.querySelector("#gallery-prev");
  const galleryNext = document.querySelector("#gallery-next");
  const updateGallery = (nextIndex) => {
    galleryIndex = (nextIndex + galleryItems.length) % galleryItems.length;
    const image = galleryItems[galleryIndex];
    mainImage.src = image || "";
    mainImage.hidden = !image;
    mainImage.alt = image ? `${formatDisplayName(mod.name)} screenshot ${galleryIndex + 1}` : "";
    detailsGallery.querySelectorAll("button").forEach((button, index) => button.classList.toggle("active", index === galleryIndex));
  };
  detailsGallery.innerHTML = galleryItems.map((image, index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-gallery-index="${index}" aria-label="Show screenshot ${index + 1}"><img src="${escapeHtml(image)}" alt=""></button>`).join("");
  detailsGallery.hidden = galleryImages.length < 2;
  galleryPrev.hidden = galleryItems.length < 2;
  galleryNext.hidden = galleryItems.length < 2;
  detailsGallery.querySelectorAll("button").forEach((button) => {
    button.onclick = () => updateGallery(Number(button.dataset.galleryIndex));
  });
  galleryPrev.onclick = () => updateGallery(galleryIndex - 1);
  galleryNext.onclick = () => updateGallery(galleryIndex + 1);
  updateGallery(0);
  document.querySelector("#details-category").textContent = formatDisplayName(mod.category);
  document.querySelector("#details-title").textContent = formatDisplayName(mod.name);
  document.querySelector("#details-author").textContent = `Created by ${formatDisplayName(mod.author)}`;
  document.querySelector("#details-description").textContent = mod.description || "No description was provided for this mod.";
  document.querySelector("#details-extra").innerHTML = `
    <div><span>File type</span><strong>BeamNG.drive ZIP</strong></div>
    <div><span>BeamNG version</span><strong>${escapeHtml(mod.gameVersion || "0.39")}</strong></div>
    <div><span>Preview gallery</span><strong>${galleryImages.length} ${galleryImages.length === 1 ? "image" : "images"}</strong></div>
    <div><span>Published</span><strong>${mod.publishedAt ? new Date(mod.publishedAt).toLocaleDateString() : "Community upload"}</strong></div>
  `;
  const detailsStats = document.querySelector("#details-stats");
  const likeStore = getLikeStore();
  const likeEntry = likeStore[mod.name] || { count: 0, users: [] };
  const likes = typeof likeEntry === "number" ? likeEntry : likeEntry.count;
  const hasLiked = typeof likeEntry === "number" ? false : (Array.isArray(likeEntry.users) && likeEntry.users.includes(getLikeIdentity()));
  detailsStats.innerHTML = `<span>${mod.rating ? `★ ${escapeHtml(mod.rating)}` : "★ No rating yet"}</span><span>↓ ${escapeHtml(mod.downloads || 0)} downloads</span><button type="button" class="like-button${hasLiked ? " liked" : ""}" id="details-like" ${hasLiked ? "disabled" : ""}>${hasLiked ? "♥ Liked" : "♡ Like"} · ${likes}</button>`;
  detailsStats.hidden = false;
  document.querySelector("#details-like").onclick = () => {
    if (remoteMode && mod.id) {
      apiRequest(`/api/mods/${mod.id}/favorite`, { method: "POST" })
        .then(() => openDetails(mod))
        .catch((error) => alert(error.message));
      return;
    }
    const store = getLikeStore();
    const entry = typeof store[mod.name] === "number"
      ? { count: store[mod.name], users: [] }
      : (store[mod.name] || { count: 0, users: [] });
    if (entry.users.includes(getLikeIdentity())) return;
    entry.count += 1;
    entry.users.push(getLikeIdentity());
    store[mod.name] = entry;
    localStorage.setItem("beammods-likes", JSON.stringify(store));
    openDetails(mod);
  };
  document.querySelector(".details-tech")?.remove();
  detailsStats.insertAdjacentHTML("beforebegin", `<div class="details-tech"><span>${escapeHtml(mod.size || "Size N/A")}</span><span>v${escapeHtml(mod.version || "N/A")}</span><span>${escapeHtml(mod.configs ?? "-")} configs</span></div>`);
  const ratings = getRatingStore()[mod.name] || [];
  const average = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1) : "";
  document.querySelector("#details-rating-summary").textContent = average
    ? `${average} / 5 from ${ratings.length} ${ratings.length === 1 ? "rating" : "ratings"}`
    : "Be the first to rate this mod";
  document.querySelectorAll("#rating-stars button").forEach((button) => {
    button.classList.toggle("selected", Boolean(average && Number(button.dataset.rating) <= Math.round(Number(average))));
    button.onclick = () => {
      if (remoteMode && mod.id) {
        apiRequest(`/api/mods/${mod.id}/rate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating: Number(button.dataset.rating) })
        }).then(() => openDetails(mod)).catch((error) => alert(error.message));
        return;
      }
      const store = getRatingStore();
      store[mod.name] = [...(store[mod.name] || []), Number(button.dataset.rating)];
      localStorage.setItem("beammods-ratings", JSON.stringify(store));
      openDetails(mod);
    };
  });
  if (remoteMode && mod.id) {
    apiRequest(`/api/mods/${mod.id}/ratings`).then((remoteRatings) => {
      const total = remoteRatings.reduce((sum, item) => sum + Number(item.rating) * Number(item.count), 0);
      const count = remoteRatings.reduce((sum, item) => sum + Number(item.count), 0);
      const remoteAverage = count ? (total / count).toFixed(1) : "";
      document.querySelector("#details-rating-summary").textContent = remoteAverage
        ? `${remoteAverage} / 5 from ${count} ${count === 1 ? "rating" : "ratings"}`
        : "Be the first to rate this mod";
      document.querySelectorAll("#rating-stars button").forEach((button) => button.classList.toggle("selected", Boolean(remoteAverage && Number(button.dataset.rating) <= Math.round(Number(remoteAverage)))));
    }).catch(() => {});
  }
  const comments = remoteMode && mod.id
    ? []
    : (getCommentStore()[mod.name] || []);
  document.querySelector("#comments-count").textContent = `${comments.length} ${comments.length === 1 ? "post" : "posts"}`;
  document.querySelector("#details-comments-list").innerHTML = comments.length
    ? comments.map((comment) => `<article class="comment-item"><div><strong>${escapeHtml(comment.author)}</strong><time>${escapeHtml(comment.date)}</time></div><p>${escapeHtml(comment.body)}</p></article>`).join("")
    : "<p class='comments-empty'>No comments yet. Start the discussion.</p>";
  if (remoteMode && mod.id) {
    apiRequest(`/api/mods/${mod.id}/comments`)
      .then((remoteComments) => {
        document.querySelector("#comments-count").textContent = `${remoteComments.length} ${remoteComments.length === 1 ? "post" : "posts"}`;
        document.querySelector("#details-comments-list").innerHTML = remoteComments.length
          ? remoteComments.map((comment) => `<article class="comment-item"><div><strong>@${escapeHtml(comment.username)}</strong><time>${escapeHtml(new Date(comment.created_at).toLocaleDateString())}</time></div><p>${escapeHtml(comment.body)}</p></article>`).join("")
          : "<p class='comments-empty'>No comments yet. Start the discussion.</p>";
      })
      .catch((error) => { document.querySelector("#details-comments-list").innerHTML = `<p class="comments-empty">${escapeHtml(error.message)}</p>`; });
  }
  const commentForm = document.querySelector("#details-comment-form");
  commentForm.onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData(commentForm);
    const body = String(data.get("comment") || "").trim();
    if (!body) return;
    if (remoteMode && mod.id) {
      try {
        await apiRequest(`/api/mods/${mod.id}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body })
        });
        commentForm.reset();
        openDetails(mod);
      } catch (error) {
        alert(error.message);
      }
      return;
    }
    const store = getCommentStore();
    store[mod.name] = [...(store[mod.name] || []), {
      author: currentUser ? `@${currentUser.username}` : "Guest player",
      body,
      date: new Date().toLocaleDateString()
    }];
    localStorage.setItem("beammods-comments", JSON.stringify(store));
    commentForm.reset();
    openDetails(mod);
  };
  const downloadButton = document.querySelector("#details-download");
  downloadButton.innerHTML = `${mod.fileId ? "Download ZIP file" : "Open ModsFire download"} <span>${mod.fileId ? "↓" : "↗"}</span>`;
  downloadButton.onclick = async () => {
    if (remoteMode && mod.downloadUrl) {
      window.open(getExternalDownloadUrl(mod.downloadUrl), "_blank", "noopener,noreferrer");
      return;
    }
    if (remoteMode && mod.id) {
      try {
        const response = await fetch(`/api/mods/${mod.id}/download`, { credentials: "include" });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || `Download failed (${response.status}).`);
        }
        const blob = await response.blob();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = getDownloadFilename(response, mod.fileName || "beammods-mod.zip");
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      } catch (error) {
        alert(error.message);
      }
      return;
    }
    const store = getDownloadStore();
    const storedEntry = store[mod.name];
    const entry = typeof storedEntry === "number"
      ? { count: storedEntry, users: [] }
      : (storedEntry || { count: 0, users: [] });
    entry.users = Array.isArray(entry.users) ? entry.users : [];
    if (!entry.users.includes(getLikeIdentity())) {
      entry.count += 1;
      entry.users.push(getLikeIdentity());
      store[mod.name] = entry;
      mod.downloads = entry.count;
      localStorage.setItem("beammods-downloads", JSON.stringify(store));
      localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((item) => !defaultMods.includes(item))));
      const downloadStat = Array.from(detailsStats.querySelectorAll("span")).find((item) => item.textContent.includes("downloads"));
      if (downloadStat) downloadStat.textContent = `↓ ${entry.count} downloads`;
    }
    if (mod.fileId) {
      const file = await getModFile(mod.fileId);
      if (!file) {
        alert("The local ZIP file could not be found. Please upload it again.");
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = file.name || mod.fileName || `${String(mod.name || "beammods-mod").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } else if (mod.downloadUrl) {
      window.open(getExternalDownloadUrl(mod.downloadUrl), "_blank", "noopener");
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
    currentLibraryPage = 1;
    renderMods();
  });
});
searchInput.addEventListener("input", () => {
  panelSearch.value = searchInput.value;
  currentLibraryPage = 1;
  renderMods();
});
panelSearch.addEventListener("input", () => {
  searchInput.value = panelSearch.value;
  currentLibraryPage = 1;
  renderMods();
});
authorSearch.addEventListener("input", () => {
  currentLibraryPage = 1;
  renderMods();
});
categorySelect.addEventListener("change", () => {
  activeFilter = categorySelect.value;
  document.querySelectorAll(".filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === activeFilter));
  currentLibraryPage = 1;
  renderMods();
});
document.querySelector("#clear-search").addEventListener("click", () => {
  searchInput.value = "";
  panelSearch.value = "";
  authorSearch.value = "";
  categorySelect.value = "All";
  activeFilter = "All";
  currentLibraryPage = 1;
  document.querySelectorAll(".filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === "All"));
  renderMods();
});
sortSelect.addEventListener("change", () => {
  currentLibraryPage = 1;
  renderMods();
});
pagination.addEventListener("click", (event) => {
  const button = event.target.closest(".page-button");
  if (!button || button.disabled) return;
  currentLibraryPage = Number(button.dataset.page);
  renderMods();
  document.querySelector("#mods").scrollIntoView({ behavior: "smooth", block: "start" });
});

const uploadModal = document.querySelector("#upload-modal");
const detailsModal = document.querySelector("#details-modal");
const securityModal = document.querySelector("#security-modal");
const securityClose = document.querySelector("#security-close");
const uploadConfirmation = document.querySelector("#upload-confirmation");
const uploadConfirmationText = document.querySelector("#upload-confirmation-text");
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
const clearZipButton = document.querySelector("#clear-zip");
const imageInput = document.querySelector("#image-input");
const imageName = document.querySelector("#image-name");
let selectedPreviewImages = [];
const uploadStatus = document.querySelector("#upload-status");
function renderPreviewImageList() {
  const imageFileList = document.querySelector("#image-file-list");
  imageName.textContent = selectedPreviewImages.length
    ? `${selectedPreviewImages.length} image${selectedPreviewImages.length === 1 ? "" : "s"} selected`
    : "Optional JPG, PNG or WEBP · up to 5 images";
  imageFileList.innerHTML = selectedPreviewImages.map((item, index) => `<span class="image-file-row"><b>${String(index + 1).padStart(2, "0")}</b><strong>${escapeHtml(item.name)}</strong><small>${formatBytes(item.size)}</small><button type="button" class="remove-image" data-image-index="${index}" aria-label="Remove ${escapeHtml(item.name)}">×</button></span>`).join("");
  imageFileList.hidden = !selectedPreviewImages.length;
}
sourceType.addEventListener("change", () => { linkField.hidden = sourceType.value !== "link"; });
fileInput.required = true;
sourceType.addEventListener("change", () => { fileInput.required = sourceType.value === "file"; });
function setZipFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".zip")) {
    uploadStatus.textContent = "Only ZIP files can be uploaded.";
    uploadStatus.className = "upload-status error";
    return;
  }
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  fileName.textContent = `${file.name} · ${formatBytes(file.size)}`;
  fileInput.closest(".file-drop").classList.add("has-file");
  clearZipButton.hidden = false;
  uploadStatus.textContent = "ZIP ready to publish.";
  uploadStatus.className = "upload-status success";
}
fileInput.addEventListener("change", () => setZipFile(fileInput.files[0]));
clearZipButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  fileInput.value = "";
  fileName.textContent = "Drop a ZIP here or click to browse";
  fileInput.closest(".file-drop").classList.remove("has-file");
  clearZipButton.hidden = true;
  uploadStatus.textContent = "ZIP removed. Choose the correct file before publishing.";
  uploadStatus.className = "upload-status";
});
imageInput.addEventListener("change", async () => {
 try {
   await addPreviewImages(Array.from(imageInput.files));
 } catch (error) {
   uploadStatus.textContent = error.message;
   uploadStatus.className = "upload-status error";
 }
});
async function addPreviewImages(pickedImages) {
  const images = [...selectedPreviewImages];
 for (const image of pickedImages) {
   if (!["image/png", "image/jpeg", "image/webp"].includes(image.type)) {
     imageInput.value = "";
     uploadStatus.textContent = "Use PNG, JPG or WEBP images only.";
     uploadStatus.className = "upload-status error";
     return;
   }
   const dimensions = await getImageDimensions(image);
   if (dimensions.width < 640 || dimensions.height < 360) {
     imageInput.value = "";
     uploadStatus.textContent = `${image.name} is ${dimensions.width} × ${dimensions.height}px. Use an image at least 640 × 360px.`;
     uploadStatus.className = "upload-status error";
     return;
   }
   if (!images.some((existing) => existing.name === image.name && existing.size === image.size && existing.lastModified === image.lastModified)) {
     images.push(image);
   }
 }
  const imageFileList = document.querySelector("#image-file-list");
  if (images.length > 5) {
    imageInput.value = "";
    imageName.textContent = "Optional JPG, PNG or WEBP · up to 5 images";
    imageFileList.hidden = true;
    imageFileList.innerHTML = "";
    selectedPreviewImages = [];
    uploadStatus.textContent = "Choose up to 5 preview images.";
    uploadStatus.className = "upload-status error";
    return;
  }
  selectedPreviewImages = images;
  renderPreviewImageList();
  imageInput.value = "";
  imageInput.closest(".file-drop").classList.toggle("has-file", selectedPreviewImages.length > 0);
  if (selectedPreviewImages.length) {
    uploadStatus.textContent = `${selectedPreviewImages.length} preview image${selectedPreviewImages.length === 1 ? "" : "s"} ready.`;
    uploadStatus.className = "upload-status success";
  }
}
document.querySelector("#image-file-list").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-image");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  selectedPreviewImages.splice(Number(button.dataset.imageIndex), 1);
  imageInput.value = "";
  renderPreviewImageList();
  imageInput.closest(".file-drop").classList.toggle("has-file", selectedPreviewImages.length > 0);
});
document.querySelectorAll(".upload-drop").forEach((drop) => {
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-dragging");
  });
  ["dragleave", "drop"].forEach((type) => drop.addEventListener(type, () => drop.classList.remove("is-dragging")));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (drop.dataset.dropTarget === "file") setZipFile(files[0]);
    else addPreviewImages(files).catch((error) => {
      uploadStatus.textContent = error.message;
      uploadStatus.className = "upload-status error";
    });
  });
});
document.querySelector("#profile-image-input").addEventListener("change", async (event) => {
  const image = event.target.files[0];
  if (!image) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(image.type)) {
    event.target.value = "";
    alert("Choose a PNG, JPG or WEBP profile image.");
    return;
  }
  askConfirmation("Use this profile photo?", "This image will replace your current profile photo on this device.", async () => {
    currentUser.avatar = await fileToDataUrl(image);
    const users = getUsers();
    const userIndex = users.findIndex((user) => user.username.toLowerCase() === currentUser.username.toLowerCase());
    if (userIndex >= 0) users[userIndex] = { ...users[userIndex], avatar: currentUser.avatar };
    localStorage.setItem("beammods-users", JSON.stringify(users));
    localStorage.setItem("beammods-current-user", JSON.stringify(currentUser));
    updateDashboardAvatar();
    updateAccountButton();
  });
  event.target.value = "";
});
document.querySelector("#profile-image-reset").addEventListener("click", () => {
  if (!currentUser?.avatar) return;
  askConfirmation("Remove profile photo?", "Your profile will return to the default avatar with your first initial.", () => {
    currentUser.avatar = "";
    const users = getUsers();
    const userIndex = users.findIndex((user) => user.username.toLowerCase() === currentUser.username.toLowerCase());
    if (userIndex >= 0) users[userIndex] = { ...users[userIndex], avatar: "" };
    localStorage.setItem("beammods-users", JSON.stringify(users));
    localStorage.setItem("beammods-current-user", JSON.stringify(currentUser));
    updateDashboardAvatar();
    updateAccountButton();
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
  button.addEventListener("click", () => { resetUploadForm(); uploadModal.hidden = true; });
});
document.querySelectorAll("[data-close-details]").forEach((button) => {
  button.addEventListener("click", () => { detailsModal.hidden = true; });
});
[uploadModal, detailsModal].forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      if (modal === uploadModal) resetUploadForm();
      modal.hidden = true;
    }
  });
});
securityModal.addEventListener("click", (event) => {
  if (event.target === securityModal) securityModal.hidden = true;
});
securityClose.addEventListener("click", () => { securityModal.hidden = true; });
function showUploadConfirmation(name, source) {
  uploadConfirmationText.textContent = source === "link"
    ? `"${name}" was submitted with its external download link.`
    : `"${name}" was uploaded successfully and is waiting for owner approval.`;
  uploadConfirmation.hidden = false;
  window.setTimeout(() => { uploadConfirmation.hidden = true; }, 6500);
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    resetUploadForm();
    uploadModal.hidden = true;
    detailsModal.hidden = true;
    securityModal.hidden = true;
    uploadConfirmation.hidden = true;
    authModal.hidden = true;
    passwordResetModal.hidden = true;
    confirmModal.hidden = true;
    bugModal.hidden = true;
    dmcaModal.hidden = true;
  }
});

function resetUploadForm() {
  form.reset();
  selectedPreviewImages = [];
  imageInput.value = "";
  fileInput.value = "";
  document.querySelector("#image-file-list").hidden = true;
  document.querySelector("#image-file-list").innerHTML = "";
  imageName.textContent = "Drop screenshots here or click to browse";
  fileName.textContent = "Drop a ZIP here or click to browse";
  clearZipButton.hidden = true;
  document.querySelectorAll(".upload-drop").forEach((drop) => drop.classList.remove("has-file", "is-dragging"));
  uploadStatus.textContent = "";
  uploadStatus.className = "upload-status";
  document.querySelector("#publish-submit").disabled = false;
  document.querySelector("#publish-submit").innerHTML = "Publish mod <span>↗</span>";
}

function showUploadMessage(message, type = "") {
  uploadStatus.textContent = message;
  uploadStatus.className = `upload-status ${type}`.trim();
}

function showAuthMessage(message, type = "error") {
  const authError = document.querySelector("#auth-error");
  authError.textContent = message;
  authError.className = `auth-message ${type}`.trim();
}

function updateAuthForm() {
  const register = authMode === "register";
  const emailInput = document.querySelector("[name=email]");
  document.querySelector("#auth-title").innerHTML = register ? "Create your <em>garage.</em>" : "Join the <em>garage.</em>";
  document.querySelector("#auth-submit").innerHTML = `${register ? "Create account" : "Sign in"} <span>↗</span>`;
  emailInput.closest("label").hidden = !register;
  emailInput.required = register;
  document.querySelector("#auth-note").textContent = /^https?:$/i.test(window.location.protocol)
    ? "Email and username accounts are stored securely on the server."
    : "Demo accounts are stored locally in this browser.";
}

function openPasswordReset(token = "") {
  passwordResetToken = token;
  passwordResetModal.hidden = false;
  forgotPasswordForm.hidden = Boolean(token);
  resetPasswordForm.hidden = !token;
  document.querySelector("#forgot-password-message").textContent = "";
  document.querySelector("#reset-password-message").textContent = "";
  if (token) document.querySelector("#reset-password-form input[name=password]").focus();
  else document.querySelector("#forgot-password-form input[name=email]").focus();
}

document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    authMode = tab.dataset.authTab;
    showAuthMessage("");
    document.querySelectorAll(".auth-tab").forEach((item) => item.classList.toggle("active", item === tab));
    updateAuthForm();
  });
});

document.querySelector("#forgot-password-link").addEventListener("click", () => {
    authModal.hidden = true;
    openPasswordReset();
  });
  document.querySelector("#password-reset-close").addEventListener("click", () => {
    passwordResetModal.hidden = true;
  });
  forgotPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#forgot-password-message");
    const email = new FormData(forgotPasswordForm).get("email").trim();
    message.textContent = "";
    try {
      if (remoteMode) {
        const result = await apiRequest("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        message.textContent = result.message;
        message.className = "auth-message success";
      } else {
        const user = getUsers().find((item) => String(item.email).toLowerCase() === email.toLowerCase());
        if (!user) throw new Error("No BeamMods account was found with that email.");
        message.textContent = "This demo account can be changed locally. Enter a new password below.";
        message.className = "auth-message success";
        openPasswordReset(`local:${email}`);
      }
    } catch (error) {
      message.textContent = error.message;
      message.className = "auth-message error";
    }
});
resetPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(resetPasswordForm);
    const password = String(data.get("password"));
    const confirmation = String(data.get("confirmation"));
    const message = document.querySelector("#reset-password-message");
    message.textContent = "";
    if (password !== confirmation) {
      message.textContent = "Passwords do not match.";
      message.className = "auth-message error";
      return;
    }
    try {
      if (remoteMode) {
        const result = await apiRequest("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: passwordResetToken, password })
        });
        message.textContent = result.message;
      } else {
        const email = passwordResetToken.slice("local:".length);
        const users = getUsers();
        const user = users.find((item) => String(item.email).toLowerCase() === email.toLowerCase());
        if (!user) throw new Error("This password reset link is invalid.");
        user.password = password;
        localStorage.setItem("beammods-users", JSON.stringify(users));
        message.textContent = "Your password has been changed. You can now sign in.";
      }
      message.className = "auth-message success";
      resetPasswordForm.reset();
      window.setTimeout(() => {
        passwordResetModal.hidden = true;
        authModal.hidden = false;
        updateAuthForm();
      }, 1200);
    } catch (error) {
      message.textContent = error.message;
      message.className = "auth-message error";
    }
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showAuthMessage("");
  const data = new FormData(authForm);
  const users = getUsers();
  const username = String(data.get("username")).trim();
  const password = String(data.get("password"));
  if (/^https?:$/i.test(window.location.protocol)) {
    const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const payload = authMode === "register"
      ? { username, email: String(data.get("email") || "").trim(), password }
      : { identifier: username, password };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Authentication failed.");
      if (authMode === "register") {
        showAuthMessage(result.message || "Registration received. Check your email to activate your account.", "success");
        authForm.reset();
        return;
      }
      currentUser = {
        username: result.username,
        email: result.email || "",
        avatar: "",
        createdAt: result.created_at || new Date().toISOString()
      };
      localStorage.setItem("beammods-current-user", JSON.stringify(currentUser));
      authForm.reset();
      authModal.hidden = true;
      updateAccountButton();
      showDashboard();
    } catch (error) {
      showAuthMessage(error.message);
    }
    return;
  }
  if (authMode === "register") {
    if (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      showAuthMessage("That username is already taken.");
      return;
    }
    const user = { username, email: data.get("email"), password, avatar: "", createdAt: new Date().toISOString() };
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
      showAuthMessage("Incorrect username or password.");
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

async function activateAccountFromLink() {
  const token = new URLSearchParams(window.location.search).get("activation");
  if (!token || !remoteMode) return;
  try {
    const response = await fetch(`/api/auth/activate?token=${encodeURIComponent(token)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Activation failed.");
    activationResultModal.hidden = false;
    document.querySelector("#activation-result-message").textContent =
      "Twój adres e-mail został potwierdzony. Konto jest aktywne — możesz teraz bezpiecznie się zalogować.";
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch (error) {
    activationResultModal.hidden = false;
    document.querySelector("#activation-result-title").innerHTML = "Activation <em>failed.</em>";
    document.querySelector("#activation-result-message").textContent = error.message;
  }
}

function openPasswordResetFromLink() {
  const token = new URLSearchParams(window.location.search).get("reset");
  if (!token) return;
  openPasswordReset(token);
  window.history.replaceState({}, document.title, window.location.pathname);
}

document.querySelector("[data-close-auth]").addEventListener("click", showLibrary);
document.querySelector("#activation-login-button").addEventListener("click", () => {
  activationResultModal.hidden = true;
  authMode = "login";
  authModal.hidden = false;
  updateAuthForm();
});
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
bugForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await submitBugReport(bugForm, "library");
  } catch (error) {
    const message = error.message || "Could not send the bug report.";
    showActionNotice("Report failed", message);
  }
});
document.querySelector("#dashboard-bug-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await submitBugReport(event.currentTarget, "dashboard");
  } catch (error) {
    event.currentTarget.querySelector(".form-error").textContent = error.message || "Could not send the bug report.";
  }
});
bugPageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await submitBugReport(bugPageForm, "library");
  } catch (error) {
    showActionNotice("Report failed", error.message || "Could not send the bug report.");
  }
});
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#browse-link").classList.add("active");
  document.querySelector("#how-link").classList.remove("active");
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
  askConfirmation("Delete this mod?", "This will remove the mod from your account and the community library.", async () => {
    const ownMods = mods.filter((item) => item.owner === currentUser.username);
    const target = button.dataset.modId
      ? ownMods.find((item) => String(item.id) === button.dataset.modId)
      : ownMods[Number(button.dataset.modIndex)];
    if (!target) {
      showActionNotice("Deletion failed", "This mod could not be identified. Refresh the dashboard and try again.");
      return;
    }
    if (remoteMode && target?.id) {
      try {
        await apiRequest(`/api/mods/${target.id}`, { method: "DELETE" });
      } catch (error) {
        showActionNotice("Deletion failed", error.message);
        return;
      }
    }
    mods = mods.filter((mod) => mod !== target);
    localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((mod) => !defaultMods.includes(mod))));
    showDashboard();
    renderMods();
    showActionNotice("Mod deleted", `"${target.name}" was removed successfully.`);
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
    askConfirmation("Accept this mod?", "Have you checked the preview, description and download source? Accepting makes this mod public.", async () => {
      if (remoteMode && mod.id) {
        try {
          await apiRequest(`/api/mods/${mod.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: 1 }) });
          await syncCommunityMods();
        } catch (error) {
          showActionNotice("Approval failed", error.message);
          return;
        }
      }
      mod.approved = true;
      localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((item) => !defaultMods.includes(item))));
      renderPendingMods();
      renderMods();
      showActionNotice("Mod approved", `"${mod.name}" is now approved and visible in the public library.`);
    });
    return;
  }
  if (mod && button.classList.contains("reject-mod")) {
    askConfirmation("Reject this mod?", "The submission and its stored preview will be removed from the approval queue.", async () => {
      if (remoteMode && mod.id) {
        try {
          await apiRequest(`/api/mods/${mod.id}`, { method: "DELETE" });
        } catch (error) {
          showActionNotice("Deletion failed", error.message);
          return;
        }
      }
      mods = mods.filter((item) => item !== mod);
      localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((item) => !defaultMods.includes(item))));
      renderPendingMods();
      renderMods();
      showActionNotice("Mod deleted", `"${mod.name}" was removed successfully.`);
    });
    return;
  }
  localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((item) => !defaultMods.includes(item))));
  renderPendingMods();
  renderMods();
});
function askConfirmation(title, message, onConfirm) {
  confirmModal.querySelector(".eyebrow").textContent = "Please confirm";
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  document.querySelector("#confirm-cancel").hidden = false;
  document.querySelector("#confirm-accept").textContent = "Confirm";
  confirmModal.hidden = false;
  const accept = document.querySelector("#confirm-accept");
  const cancel = document.querySelector("#confirm-cancel");
  const close = () => { confirmModal.hidden = true; accept.onclick = null; cancel.onclick = null; };
  cancel.onclick = close;
  accept.onclick = () => { close(); onConfirm(); };
}
function showActionNotice(title, message) {
  askConfirmation(title, message, () => {});
  confirmModal.querySelector(".eyebrow").textContent = "BeamMods update";
  document.querySelector("#confirm-cancel").hidden = true;
  document.querySelector("#confirm-accept").textContent = "Done";
}
document.querySelector("#browse-link").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#browse-link").classList.add("active");
  document.querySelector("#how-link").classList.remove("active");
  showLibrary();
  document.querySelector("#mods").scrollIntoView({ behavior: "smooth" });
});
document.querySelector("#how-link").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#how-link").classList.add("active");
  document.querySelector("#browse-link").classList.remove("active");
  showStandalonePage(howPage);
});
const navSections = [
  { link: document.querySelector("#browse-link"), section: document.querySelector("#mods") }
];
const navObserver = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible || !dashboardPage.hidden) return;
  navSections.forEach(({ link, section }) => link.classList.toggle("active", section === visible.target));
}, { threshold: [.25, .6], rootMargin: "-78px 0px -35% 0px" });
navSections.forEach(({ section }) => navObserver.observe(section));
document.querySelector("#google-sign-in").addEventListener("click", () => {
  if (/^https?:$/i.test(window.location.protocol)) {
    window.location.href = "/api/auth/google";
    return;
  }
  const username = window.prompt("Demo Google name:");
  if (!username || !username.trim()) return;
  currentUser = { username: username.trim(), email: "google-user@demo.local", provider: "Google", avatar: "", createdAt: new Date().toISOString() };
  if (username.trim().toLowerCase() === "jerzy" && !ownerUsernames.includes("jerzy")) ownerUsernames.push("jerzy");
  localStorage.setItem("beammods-current-user", JSON.stringify(currentUser));
  authModal.hidden = true;
  updateAccountButton();
  showDashboard();
});

function showGoogleAuthResult() {
  const error = new URLSearchParams(window.location.search).get("google_error");
  if (!error) return;
  authMode = "login";
  authModal.hidden = false;
  updateAuthForm();
  showAuthMessage(error === "not_configured"
    ? "Google login is not configured on the server."
    : "Google login could not be completed. Try again.", "error");
  window.history.replaceState({}, document.title, window.location.pathname);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const file = data.get("file");
  const images = [...selectedPreviewImages];
  const downloadUrl = data.get("downloadUrl");
  const source = data.get("sourceType");
  const extensionIsZip = file && file.name.toLowerCase().endsWith(".zip");
  if (source === "file" && (!file || !file.size || !extensionIsZip || file.size > 2 * 1024 * 1024 * 1024)) {
    showUploadMessage("Security check failed: choose a ZIP file smaller than 2 GB.", "error");
    return;
  }
  if (remoteMode && source === "file" && file.size > remoteUploadLimit) {
    showUploadMessage("This ZIP is too large for the online server. Render accepts uploads up to 95 MB. Please use a smaller ZIP or an external download link.", "error");
    return;
  }
  if (images.some((image) => image.size > 8 * 1024 * 1024)) {
    showUploadMessage("Each preview image must be smaller than 8 MB.", "error");
    return;
  }
  if (source === "link" && !/^https?:\/\//i.test(downloadUrl)) {
    showUploadMessage("Please enter a valid HTTPS download link.", "error");
    return;
  }
  securityModal.hidden = false;
  securityModal.querySelector(".security-modal").classList.remove("is-complete");
  securityClose.hidden = true;
  securityClose.textContent = "Continue to BeamMods";
  document.querySelector("#security-title").innerHTML = source === "link" ? "Checking your <em>link.</em>" : "Checking your <em>file.</em>";
  uploadStatus.textContent = "Checking your upload...";
  uploadStatus.className = "upload-status";
  const publishButton = document.querySelector("#publish-submit");
  publishButton.disabled = true;
  publishButton.innerHTML = "Preparing your upload <span>…</span>";
  document.querySelector("#security-progress").style.width = "0%";
  document.querySelector("#security-message").textContent = "Inspecting file name, type and size...";
  await new Promise((resolve) => window.setTimeout(resolve, 450));
  document.querySelector("#security-progress").style.width = "100%";
  try {
    await finishUpload(data, file, images, source, downloadUrl);
  } catch (error) {
    publishButton.disabled = false;
    publishButton.innerHTML = "Publish mod <span>↗</span>";
    document.querySelector("#security-message").textContent = error.message || "The mod could not be submitted. Please try again.";
    securityClose.hidden = false;
    securityClose.textContent = "Back to upload";
    showUploadMessage(error.message || "The mod could not be submitted. Please try again.", "error");
  }
});

async function finishUpload(data, file, images, source, downloadUrl) {
  const securityMessage = document.querySelector("#security-message");
  const securityProgress = document.querySelector("#security-progress");
  const validImages = images.filter((image) => image && image.size).slice(0, 5);
  if (remoteMode) {
    securityMessage.textContent = "Preparing your files...";
    uploadStatus.textContent = "Preparing your files...";
    securityProgress.style.width = "45%";
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    securityMessage.textContent = "Sending your mod to the community library...";
    securityProgress.style.width = "82%";
    uploadStatus.textContent = "Sending your mod to the community library...";
    const upload = new FormData();
    ["name", "category", "author", "description", "version", "configs"].forEach((field) => upload.append(field, data.get(field)));
    if (source === "link") upload.append("downloadUrl", downloadUrl);
    if (source === "file" && file) upload.append("file", file, file.name);
    try {
      if (validImages[0]) {
        upload.append("preview", validImages[0], validImages[0].name);
      }
      const remoteMod = await apiRequest("/api/mods", { method: "POST", body: upload, timeoutMs: 180000 });
      mods.unshift({
        id: remoteMod.id,
        name: remoteMod.name,
        category: remoteMod.category,
        author: remoteMod.author,
        description: remoteMod.description,
        version: remoteMod.version,
        gameVersion: "0.39",
        configs: remoteMod.configs,
        size: file?.size ? formatBytes(file.size) : "Community upload",
        rating: remoteMod.rating || "",
        downloads: remoteMod.download_count || 0,
        age: 0,
        cover: "cover-drift",
        icon: "NEW",
        approved: Boolean(remoteMod.approved),
        owner: remoteMod.username || remoteMod.author,
        publishedAt: remoteMod.created_at,
        updatedAt: remoteMod.created_at,
        image: remoteMod.image_path ? `/uploads/${remoteMod.image_path.split("/").pop()}` : "",
        images: remoteMod.image_path ? [`/uploads/${remoteMod.image_path.split("/").pop()}`] : [],
        downloadUrl: remoteMod.download_url || "",
        fileId: "",
        fileName: remoteMod.original_filename || ""
      });
      resetUploadForm();
      uploadModal.hidden = true;
      securityModal.hidden = true;
      renderMods();
      showDashboard();
      showUploadConfirmation(remoteMod.name, source);
    } catch (error) {
      securityMessage.textContent = error.message || "The mod could not be submitted. Please try again.";
      securityProgress.style.width = "100%";
      securityModal.querySelector(".security-modal").classList.remove("is-complete");
      securityClose.hidden = false;
      securityClose.textContent = "Back to upload";
      showUploadMessage(error.message || "The mod could not be submitted. Please try again.", "error");
      throw error;
    }
    return;
  }
  securityMessage.textContent = "Optimizing preview images...";
  uploadStatus.textContent = "Optimizing preview images...";
  securityProgress.style.width = "45%";
  const imageUrls = await Promise.all(validImages.map((image) => compressImage(image)));
  securityProgress.style.width = "100%";
  securityModal.hidden = true;
  document.querySelector("#publish-submit").disabled = false;
  document.querySelector("#publish-submit").innerHTML = "Publish mod <span>↗</span>";
  const isOwner = isOwnerAccount();
  const fileId = source === "file" && file ? await saveModFile(file) : "";
  const newMod = {
    name: data.get("name"),
    category: data.get("category"),
    author: data.get("author"),
    description: data.get("description"),
    version: data.get("version"),
    gameVersion: "0.39",
    configs: Number(data.get("configs")),
    size: file && file.size ? formatBytes(file.size) : "External link",
    rating: "",
    downloads: 0,
    age: 0,
    cover: "cover-drift",
    icon: "NEW",
    isTest: false,
    approved: isOwner,
    owner: currentUser.username,
    publishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    image: imageUrls[0] || "",
    images: imageUrls,
    imageNames: validImages.map((image) => image.name),
    downloadUrl: source === "link" ? downloadUrl : "",
    fileId,
    fileName: file?.name || ""
  };
  mods.unshift(newMod);
  try {
    localStorage.setItem("beammods-mods", JSON.stringify(mods.filter((mod) => !defaultMods.includes(mod))));
  } catch (error) {
    mods = mods.filter((mod) => mod !== newMod);
    showUploadMessage("This upload is too large for browser storage. Try a smaller preview image.", "error");
    return;
  }
  resetUploadForm();
  uploadModal.hidden = false;
  renderMods();
  updateAccountButton();
  updateAuthForm();
  showDashboard();
  showUploadMessage(isOwner
    ? `"${newMod.name}" passed the browser safety checks and is now published.`
    : `"${newMod.name}" was submitted successfully and is now waiting for review. We'll publish it after the owner checks the files and details.`, "success");
  uploadModal.hidden = true;
  showUploadConfirmation(newMod.name, source);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("Could not read preview image.")));
    reader.readAsDataURL(file);
  });
}

async function syncCommunityMods() {
  if (!/^https?:$/i.test(window.location.protocol)) return;
  const response = await fetch("/api/mods", { credentials: "include" });
  if (!response.ok) throw new Error(`Community mods request failed (${response.status}).`);
  const remoteMods = await response.json();
  if (!Array.isArray(remoteMods)) throw new Error("Community mods response was not a list.");
  const remoteByName = new Map(remoteMods.map((mod) => [String(mod.name).toLowerCase(), mod]));
  mods.forEach((localMod) => {
    const remoteMod = remoteByName.get(String(localMod.name).toLowerCase());
    if (remoteMod) {
      Object.assign(localMod, mapRemoteMod(remoteMod), {
        image: remoteMod.image_path ? `/uploads/${remoteMod.image_path.split("/").pop()}` : localMod.image,
        images: remoteMod.image_path ? [`/uploads/${remoteMod.image_path.split("/").pop()}`] : localMod.images
      });
    }
  });
  const localNames = new Set(mods.map((mod) => String(mod.name).toLowerCase()));
  const imported = remoteMods
    .filter((mod) => !localNames.has(String(mod.name).toLowerCase()))
    .map((mod) => ({
      id: mod.id,
      name: mod.name,
      category: mod.category,
      author: mod.username || mod.author,
      description: mod.description,
      version: mod.version,
      gameVersion: "0.39",
      configs: mod.configs,
      size: "Community upload",
      rating: "",
      downloads: mod.download_count || 0,
      age: 0,
      cover: "cover-drift",
      icon: "NEW",
      approved: true,
      owner: mod.username || mod.author,
      publishedAt: mod.created_at,
      updatedAt: mod.created_at,
      image: mod.image_path ? `/uploads/${mod.image_path.split("/").pop()}` : "",
      images: mod.image_path ? [`/uploads/${mod.image_path.split("/").pop()}`] : [],
      downloadUrl: mod.download_url || "",
      fileId: "",
      fileName: mod.original_filename || ""
    }));
  mods = [...imported, ...mods];
  if (!imported.length && !remoteMods.length) return;
  renderMods();
}

function getImageDimensions(file) {
  return new Promise((resolve, reject) => {
   const image = new Image();
   const reader = new FileReader();
   reader.onload = () => {
     image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
     image.onerror = () => reject(new Error(`Could not read ${file.name}.`));
     image.src = reader.result;
   };
   reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
   reader.readAsDataURL(file);
 });
}

function dataUrlToBlob(dataUrl) {
 const [header, encoded] = dataUrl.split(",");
 const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
 const bytes = atob(encoded);
 const buffer = new Uint8Array(bytes.length);
 for (let index = 0; index < bytes.length; index += 1) buffer[index] = bytes.charCodeAt(index);
 return new Blob([buffer], { type: mime });
}

function compressImage(file) {
 return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      image.onload = () => {
        const targetWidth = 1280;
        const targetHeight = 720;
        const targetRatio = targetWidth / targetHeight;
        const sourceRatio = image.naturalWidth / image.naturalHeight;
        let cropWidth = image.naturalWidth;
        let cropHeight = image.naturalHeight;
        let cropX = 0;
        let cropY = 0;
        if (sourceRatio > targetRatio) {
          cropWidth = Math.round(image.naturalHeight * targetRatio);
          cropX = Math.round((image.naturalWidth - cropWidth) / 2);
        } else if (sourceRatio < targetRatio) {
          cropHeight = Math.round(image.naturalWidth / targetRatio);
          cropY = Math.round((image.naturalHeight - cropHeight) / 2);
        }
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        canvas.getContext("2d").drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight);
        resolve(canvas.toDataURL("image/jpeg", .84));
      };
      image.onerror = () => reject(new Error("Could not optimize preview image."));
      image.src = reader.result;
    });
    reader.addEventListener("error", () => reject(new Error("Could not read preview image.")));
    reader.readAsDataURL(file);
  });
}

async function syncServerSession() {
  if (!remoteMode || hasAuthLink) return;
  const user = await apiRequest("/api/me");
  if (!user) {
    currentUser = null;
    localStorage.removeItem("beammods-current-user");
    updateAccountButton();
    return;
  }
  currentUser = {
    username: user.username,
    email: user.email,
    avatar: "",
    createdAt: user.created_at
  };
  localStorage.setItem("beammods-current-user", JSON.stringify(currentUser));
  updateAccountButton();
}

if (hasAuthLink) {
  currentUser = null;
  localStorage.removeItem("beammods-current-user");
}
renderMods();
Promise.resolve()
  .then(() => syncServerSession())
  .then(() => Promise.all([syncCommunityMods(), syncUserMods()]))
  .catch((error) => console.warn("Community sync unavailable:", error.message));
if (!hasAuthLink) currentUser = readStoredUser();
updateAccountButton();
updateAuthForm();
showGoogleAuthResult();
if (hasAuthLink) {
  showLibrary();
  if (authLinkParams.has("activation")) activateAccountFromLink();
  if (authLinkParams.has("reset")) openPasswordResetFromLink();
}
else showLibrary();
