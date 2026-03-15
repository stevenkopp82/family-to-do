// ============================================================
// FIREBASE CONFIG — Replace this block with your own config
// from the Firebase Console (Project Settings > Your apps)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAA29vEFu7gVTZSAbDwWcfwNw4hSixIPmE",
  authDomain: "family-to-do-list-33ffa.firebaseapp.com",
  projectId: "family-to-do-list-33ffa",
  storageBucket: "family-to-do-list-33ffa.firebasestorage.app",
  messagingSenderId: "1072664901116",
  appId: "1:1072664901116:web:55369f9f89835cfb8c2e79"
};

// ============================================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ---- State ----
let currentUser = null;
let familyId = null;
let members = [];
let tasks = [];
let activeFilter = "all";
let editingTaskId = null;
let tasksUnsubscribe = null;

// ============================================================
// AUTH
// ============================================================

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    console.log("[Auth] Signed in as:", user.uid, user.email);

    let userDoc = null;
    try {
      userDoc = await getDoc(doc(db, "users", user.uid));
      console.log("[Auth] users doc exists:", userDoc.exists());
    } catch (e) {
      console.error("[Auth] Failed to read users doc:", e.code, e.message);
    }

    if (userDoc && userDoc.exists()) {
      // Returning user — load their family
      familyId = userDoc.data().familyId;
      localStorage.setItem("familyId_" + user.uid, familyId);
      console.log("[Auth] familyId from users doc:", familyId);
      try {
        const familyDoc = await getDoc(doc(db, "families", familyId));
        if (familyDoc.exists()) {
          document.getElementById("header-family-name").textContent =
            familyDoc.data().name;
          console.log("[Auth] Family loaded:", familyDoc.data().name);
        } else {
          console.warn("[Auth] Family doc not found for id:", familyId);
        }
      } catch (e) {
        console.error("[Auth] Failed to read family doc:", e.code, e.message);
      }
      showApp();
      subscribeToData();
    } else {
      // No users doc — either new user or partial setup
      console.log("[Auth] No users doc found, entering setup/recovery");
      showFamilySetup();
    }
  } else {
    currentUser = null;
    familyId = null;
    members = [];
    tasks = [];
    if (tasksUnsubscribe) tasksUnsubscribe();
    showAuth();
  }
});

function showApp() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("family-setup-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
}

function showAuth() {
  document.getElementById("app-screen").classList.add("hidden");
  document.getElementById("family-setup-screen").classList.add("hidden");
  document.getElementById("auth-screen").classList.remove("hidden");
}

async function showFamilySetup() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.add("hidden");

  // Recovery: if we have a cached familyId hint in localStorage, try to load
  // that family directly (avoids a collection query which rules don't permit).
  const cachedFamilyId = localStorage.getItem("familyId_" + currentUser.uid);
  console.log("[Setup] cached familyId:", cachedFamilyId);

  if (cachedFamilyId) {
    try {
      console.log("[Setup] Attempting recovery with cached familyId...");
      const famDoc = await getDoc(doc(db, "families", cachedFamilyId));
      console.log("[Setup] family doc exists:", famDoc.exists());
      if (famDoc.exists()) {
        console.log("[Setup] family ownerId:", famDoc.data().ownerId, "current uid:", currentUser.uid);
      }
      if (famDoc.exists() && famDoc.data().ownerId === currentUser.uid) {
        console.log("[Setup] Recovery successful, writing users doc...");
        await setDoc(doc(db, "users", currentUser.uid), {
          name: currentUser.displayName || "Family Member",
          email: currentUser.email || "",
          familyId: cachedFamilyId,
          createdAt: serverTimestamp(),
        });
        familyId = cachedFamilyId;
        document.getElementById("header-family-name").textContent = famDoc.data().name;
        showApp();
        subscribeToData();
        return;
      }
    } catch (e) {
      console.error("[Setup] Recovery failed:", e.code, e.message);
    }
  }

  // Truly new user — show the setup form
  console.log("[Setup] Showing family setup form");
  if (currentUser?.displayName) {
    document.getElementById("setup-member-name").value = currentUser.displayName.split(" ")[0];
  }
  document.getElementById("family-setup-screen").classList.remove("hidden");
}

window.signInWithGoogle = async function () {
  clearAuthError();
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      showAuthError("Sign-in failed. Please try again.");
    }
  }
};

window.createFamily = async function () {
  const familyName = document.getElementById("setup-family-name").value.trim();
  const memberName = document.getElementById("setup-member-name").value.trim();
  clearSetupError();

  if (!familyName || !memberName) {
    return showSetupError("Please fill in both fields.");
  }

  try {
    const uid = currentUser.uid;

    // Create family document
    const familyRef = doc(collection(db, "families"));
    await setDoc(familyRef, {
      name: familyName,
      ownerId: uid,
      createdAt: serverTimestamp(),
    });

    // Create user document pointing to family
    await setDoc(doc(db, "users", uid), {
      name: memberName,
      email: currentUser.email,
      familyId: familyRef.id,
      createdAt: serverTimestamp(),
    });

    // Add the registering user as the first family member
    await addDoc(collection(db, "families", familyRef.id, "members"), {
      name: memberName,
      color: randomColor(),
      createdAt: serverTimestamp(),
    });

    familyId = familyRef.id;
    localStorage.setItem("familyId_" + currentUser.uid, familyRef.id);
    document.getElementById("header-family-name").textContent = familyName;
    showApp();
    subscribeToData();
  } catch (e) {
    showSetupError("Failed to create family. Please try again.");
    console.error(e);
  }
};

window.logoutUser = async function () {
  await signOut(auth);
};

function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearAuthError() {
  document.getElementById("auth-error").classList.add("hidden");
}
function showSetupError(msg) {
  const el = document.getElementById("setup-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearSetupError() {
  document.getElementById("setup-error").classList.add("hidden");
}

// ============================================================
// REALTIME DATA SUBSCRIPTIONS
// ============================================================

function subscribeToData() {
  console.log("[Sub] Subscribing with familyId:", familyId);

  // Members
  onSnapshot(
    collection(db, "families", familyId, "members"),
    (snap) => {
      console.log("[Sub] Members snapshot received, count:", snap.docs.length);
      members = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderMemberChips();
      renderMemberCheckboxes();
      renderMembersList();
    },
    (err) => console.error("[Sub] Members permission error:", err.code, err.message)
  );

  // Tasks
  if (tasksUnsubscribe) tasksUnsubscribe();
  tasksUnsubscribe = onSnapshot(
    collection(db, "families", familyId, "tasks"),
    (snap) => {
      console.log("[Sub] Tasks snapshot received, count:", snap.docs.length);
      tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      processDueRecurringTasks().then(() => renderTasks());
    },
    (err) => console.error("[Sub] Tasks permission error:", err.code, err.message)
  );
}

// ============================================================
// RECURRING TASK LOGIC
// ============================================================

async function processDueRecurringTasks() {
  const today = todayStr();
  for (const task of tasks) {
    if (task.recurrence === "none" || !task.recurrence) continue;
    if (!task.completed) continue;

    // Reopen if nextDue has arrived
    if (task.nextDue && task.nextDue <= today) {
      await updateDoc(doc(db, "families", familyId, "tasks", task.id), {
        completed: false,
        completedAt: null,
        dueDate: task.nextDue,
        nextDue: null,
      });
      continue;
    }

    // Safety net: recurring task is completed but has no nextDue set
    // (can happen for tasks completed before this fix was deployed)
    if (!task.nextDue) {
      const nextDue = computeNextDue(task.dueDate || null, task.recurrence);
      // If nextDue is today or already past, reopen immediately
      if (nextDue && nextDue <= today) {
        await updateDoc(doc(db, "families", familyId, "tasks", task.id), {
          completed: false,
          completedAt: null,
          dueDate: nextDue,
          nextDue: null,
        });
      } else if (nextDue) {
        // Store the computed nextDue so it reopens on the right day
        await updateDoc(doc(db, "families", familyId, "tasks", task.id), { nextDue });
      }
    }
  }
}

// Quick test helper: open browser console and run testRecurring('task title')
// to backdate a recurring task's due date to yesterday so it re-opens immediately.
window.testRecurring = async function(titleSubstring) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const task = tasks.find(t => t.title.toLowerCase().includes(titleSubstring.toLowerCase()) && t.completed);
  if (!task) { console.log("No completed task found matching:", titleSubstring); return; }
  await updateDoc(doc(db, "families", familyId, "tasks", task.id), { nextDue: yesterdayStr });
  console.log("Set nextDue to yesterday for:", task.title, "— refresh the page to trigger re-open.");
};

function computeNextDue(dueDate, recurrence) {
  if (recurrence === "none" || !recurrence) return null;
  // If no due date, base recurrence off today
  const base = dueDate || todayStr();
  const d = new Date(base + "T12:00:00");
  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  else if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "biweekly") d.setDate(d.getDate() + 14);
  else if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);
  // Use local date string to avoid UTC timezone shifting
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayStr() {
  const d = new Date();
  // Use local date, not UTC — avoids off-by-one errors in non-UTC timezones
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function timestampToLocalDate(ts) {
  // Converts a Firestore Timestamp or ISO string to a local YYYY-MM-DD string
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ============================================================
// RENDER TASKS
// ============================================================

function renderTasks() {
  const container = document.getElementById("task-list");
  const today = todayStr();

  let incomplete = tasks.filter((t) => !t.completed);

  // Apply member filter
  if (activeFilter === "unassigned") {
    incomplete = incomplete.filter((t) => !t.members || t.members.length === 0);
  } else if (activeFilter !== "all") {
    incomplete = incomplete.filter(
      (t) => t.members && t.members.includes(activeFilter)
    );
  }

  const overdue = incomplete
    .filter((t) => t.dueDate && t.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const upcoming = incomplete
    .filter((t) => t.dueDate && t.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const noDue = incomplete.filter((t) => !t.dueDate);

  // Completed today only — apply same member filter
  let completedToday = tasks.filter((t) => {
    if (!t.completed) return false;
    if (!t.completedAt) return false;
    return timestampToLocalDate(t.completedAt) === today;
  });
  if (activeFilter === "unassigned") {
    completedToday = completedToday.filter((t) => !t.members || t.members.length === 0);
  } else if (activeFilter !== "all") {
    completedToday = completedToday.filter((t) => t.members && t.members.includes(activeFilter));
  }

  if (incomplete.length === 0 && completedToday.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">✅</div>
      <p>${activeFilter === "all" ? "No tasks yet! Add one above." : "No tasks for this filter."}</p>
    </div>`;
    return;
  }

  let html = "";

  if (overdue.length) {
    html += `<div class="section-label">⚠️ Overdue</div>`;
    overdue.forEach((t) => (html += taskCard(t, true, false)));
  }

  if (upcoming.length) {
    html += `<div class="section-label">📅 Upcoming</div>`;
    upcoming.forEach((t) => (html += taskCard(t, false, false)));
  }

  if (noDue.length) {
    html += `<div class="section-label">🗂 No Due Date</div>`;
    noDue.forEach((t) => (html += taskCard(t, false, false)));
  }

  if (completedToday.length) {
    html += `<div class="section-label">✅ Completed Today</div>`;
    completedToday.forEach((t) => (html += taskCard(t, false, true)));
  }

  container.innerHTML = html;
}

function taskCard(task, isOverdue, isCompleted) {
  const memberAvatars = (task.members || [])
    .map((mid) => {
      const m = members.find((x) => x.id === mid);
      if (!m) return "";
      const initials = m.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
      return `<div class="avatar" style="background:${m.color || "#888"}" title="${m.name}">${initials}</div>`;
    })
    .join("");

  const dateStr = task.dueDate ? formatDate(task.dueDate) : "";
  const dateClass = isOverdue ? "task-date overdue-text" : "task-date";

  const recurLabel = task.recurrence && task.recurrence !== "none"
    ? `<span class="task-recur">↻ ${recurringLabel(task.recurrence)}</span>`
    : "";

  const deleteTitle = task.recurrence && task.recurrence !== "none"
    ? "Delete (stop recurring)"
    : "Delete task";

  if (isCompleted) {
    return `<div class="task-card task-card-completed">
      <div class="task-check checked" title="Completed"></div>
      <div class="task-main">
        <div class="task-title task-title-completed">${escHtml(task.title)}</div>
        <div class="task-meta">
          ${recurLabel}
          <div class="member-avatars">${memberAvatars}</div>
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn delete" onclick="deleteTask('${task.id}')" title="${deleteTitle}">🗑</button>
      </div>
    </div>`;
  }

  return `<div class="task-card${isOverdue ? " overdue" : ""}">
    <div class="task-check" onclick="toggleComplete('${task.id}')" title="Mark complete"></div>
    <div class="task-main">
      <div class="task-title">${escHtml(task.title)}</div>
      <div class="task-meta">
        ${dateStr ? `<span class="${dateClass}">📅 ${dateStr}</span>` : ""}
        ${recurLabel}
        <div class="member-avatars">${memberAvatars}</div>
      </div>
    </div>
    <div class="task-actions">
      <button class="task-action-btn" onclick="openEditTask('${task.id}')" title="Edit">✏️</button>
      <button class="task-action-btn delete" onclick="deleteTask('${task.id}')" title="${deleteTitle}">🗑</button>
    </div>
  </div>`;
}

function recurringLabel(r) {
  return { daily: "Daily", weekly: "Weekly", biweekly: "Every 2 wks", monthly: "Monthly" }[r] || r;
}

function formatDate(str) {
  const d = new Date(str + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ============================================================
// MEMBER CHIPS (filter)
// ============================================================

function renderMemberChips() {
  const row = document.getElementById("member-filter-chips");
  let html = `<button class="chip${activeFilter === "all" ? " chip-active" : ""}" onclick="setFilter('all')">All</button>`;
  members.forEach((m) => {
    const active = activeFilter === m.id ? " chip-active" : "";
    html += `<button class="chip${active}" onclick="setFilter('${m.id}')" style="${active ? `background:${m.color};border-color:${m.color}` : ""}">${escHtml(m.name)}</button>`;
  });
  const unassignedActive = activeFilter === "unassigned" ? " chip-active" : "";
  html += `<button class="chip${unassignedActive}" onclick="setFilter('unassigned')" style="${unassignedActive ? "background:#9e9892;border-color:#9e9892" : ""}">Unassigned</button>`;
  row.innerHTML = html;
}

window.setFilter = function (memberId) {
  activeFilter = memberId;
  renderMemberChips();
  renderTasks();
};

// Exposed for color swatch selection
window.selectMemberColor = function (color) {
  document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("selected"));
  const swatch = document.querySelector(`.color-swatch[data-color="${color}"]`);
  if (swatch) swatch.classList.add("selected");
  document.getElementById("selected-member-color").value = color;
};

// ============================================================
// TASK MODAL
// ============================================================

window.openTaskModal = function () {
  editingTaskId = null;
  document.getElementById("task-modal-title").textContent = "Add Task";
  document.getElementById("task-title").value = "";
  document.getElementById("task-due").value = "";
  document.getElementById("task-recurrence").value = "none";
  clearTaskError();
  // Pre-select the currently filtered member (if any)
  const preselect = (activeFilter !== "all" && activeFilter !== "unassigned") ? [activeFilter] : [];
  renderMemberCheckboxes(preselect);
  document.getElementById("task-modal").classList.remove("hidden");
};

window.openEditTask = function (taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  editingTaskId = taskId;
  document.getElementById("task-modal-title").textContent = "Edit Task";
  document.getElementById("task-title").value = task.title;
  document.getElementById("task-due").value = task.dueDate || "";
  document.getElementById("task-recurrence").value = task.recurrence || "none";
  clearTaskError();
  renderMemberCheckboxes(task.members || []);
  document.getElementById("task-modal").classList.remove("hidden");
};

window.closeTaskModal = function (e) {
  if (e && e.target !== document.getElementById("task-modal")) return;
  document.getElementById("task-modal").classList.add("hidden");
};

window.saveTask = async function () {
  const title = document.getElementById("task-title").value.trim();
  if (!title) return showTaskError("Please enter a task title.");

  const dueDate = document.getElementById("task-due").value || null;
  const recurrence = document.getElementById("task-recurrence").value;

  if (recurrence !== "none" && !dueDate) {
    return showTaskError("A due date is required for recurring tasks.");
  }
  const selectedMembers = Array.from(
    document.querySelectorAll(".member-checkbox-item.selected")
  ).map((el) => el.dataset.memberId);

  const data = {
    title,
    dueDate,
    recurrence,
    members: selectedMembers,
    completed: false,
    updatedAt: serverTimestamp(),
  };

  try {
    if (editingTaskId) {
      await updateDoc(
        doc(db, "families", familyId, "tasks", editingTaskId),
        data
      );
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "families", familyId, "tasks"), data);
    }
    document.getElementById("task-modal").classList.add("hidden");
  } catch (e) {
    showTaskError("Failed to save task. Please try again.");
    console.error(e);
  }
};

function renderMemberCheckboxes(selected = []) {
  const container = document.getElementById("member-checkboxes");
  if (!members.length) {
    container.innerHTML = `<p style="font-size:13px;color:var(--text3)">No members yet — add some in the Members panel.</p>`;
    return;
  }
  container.innerHTML = members
    .map((m) => {
      const isSelected = selected.includes(m.id);
      const initials = m.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
      return `<div class="member-checkbox-item${isSelected ? " selected" : ""}" 
        data-member-id="${m.id}" 
        onclick="toggleMemberCheckbox(this)">
        <div class="avatar" style="background:${m.color || "#888"}">${initials}</div>
        <span>${escHtml(m.name)}</span>
        <input type="checkbox" ${isSelected ? "checked" : ""} style="margin-left:auto" tabindex="-1" />
      </div>`;
    })
    .join("");
}

window.toggleMemberCheckbox = function (el) {
  el.classList.toggle("selected");
  el.querySelector("input[type=checkbox]").checked = el.classList.contains("selected");
};

function showTaskError(msg) {
  const el = document.getElementById("task-modal-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearTaskError() {
  document.getElementById("task-modal-error").classList.add("hidden");
}

// ============================================================
// COMPLETE / DELETE TASKS
// ============================================================

window.toggleComplete = async function (taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  const isRecurring = task.recurrence && task.recurrence !== "none";

  if (isRecurring) {
    // computeNextDue handles null dueDate by using today as the base
    const nextDue = computeNextDue(task.dueDate || null, task.recurrence);
    await updateDoc(doc(db, "families", familyId, "tasks", taskId), {
      completed: true,
      completedAt: serverTimestamp(),
      nextDue,
    });
  } else {
    await updateDoc(doc(db, "families", familyId, "tasks", taskId), {
      completed: true,
      completedAt: serverTimestamp(),
    });
  }
};

window.deleteTask = async function (taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const msg =
    task.recurrence && task.recurrence !== "none"
      ? "Delete this recurring task permanently (it will stop repeating)?"
      : "Delete this task?";
  if (!confirm(msg)) return;
  await deleteDoc(doc(db, "families", familyId, "tasks", taskId));
};

// ============================================================
// MEMBERS MODAL
// ============================================================

window.openMembersModal = function () {
  renderMembersList();
  document.getElementById("members-modal").classList.remove("hidden");
};

window.closeMembersModal = function (e) {
  if (e && e.target !== document.getElementById("members-modal")) return;
  document.getElementById("members-modal").classList.add("hidden");
};

window.renderMembersList = function(editingId = null) {
  const container = document.getElementById("members-list");
  if (!members.length) {
    container.innerHTML = `<p style="font-size:13px;color:var(--text3);margin-bottom:8px">No members yet.</p>`;
    return;
  }
  container.innerHTML = members.map((m) => {
    const initials = m.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
    if (m.id === editingId) {
      // Inline edit row
      const swatches = MEMBER_COLORS.map(({color, label}) => {
        const sel = color === (m.color || "#4f86f7") ? " selected" : "";
        return `<div class="color-swatch${sel}" data-color="${color}" style="background:${color}"
          onclick="document.getElementById('edit-member-color').value='${color}';document.querySelectorAll('#member-edit-swatches .color-swatch').forEach(s=>s.classList.remove('selected'));this.classList.add('selected')"
          title="${label}"></div>`;
      }).join("");
      return `<div class="member-row member-row-editing">
        <div class="member-edit-fields">
          <input type="text" id="edit-member-name" class="input" value="${escHtml(m.name)}" placeholder="Name" style="margin-bottom:8px" />
          <div class="color-swatches" style="margin-top:0">
            <span class="swatch-label">Color:</span>
            <div id="member-edit-swatches" class="swatch-row">${swatches}</div>
            <input type="hidden" id="edit-member-color" value="${m.color || '#4f86f7'}" />
          </div>
        </div>
        <div class="member-edit-actions">
          <button class="btn btn-primary btn-sm" onclick="saveMemberEdit('${m.id}')">Save</button>
          <button class="btn btn-ghost btn-sm" onclick="renderMembersList()">Cancel</button>
        </div>
      </div>`;
    }
    // Normal row
    return `<div class="member-row">
      <div class="avatar" style="background:${m.color || "#888"}">${initials}</div>
      <span class="member-name">${escHtml(m.name)}</span>
      <div style="display:flex;gap:4px;margin-left:auto">
        <button class="member-action-btn" onclick="renderMembersList('${m.id}')" title="Edit member">✏️</button>
        <button class="member-action-btn" onclick="deleteMember('${m.id}')" title="Remove member">✕</button>
      </div>
    </div>`;
  }).join("");
};

const MEMBER_COLORS = [
  {color:"#4f86f7",label:"Blue"},{color:"#2d6a4f",label:"Green"},
  {color:"#f4845f",label:"Coral"},{color:"#9b59b6",label:"Purple"},
  {color:"#e67e22",label:"Orange"},{color:"#e91e8c",label:"Pink"},
  {color:"#1abc9c",label:"Teal"},{color:"#c0392b",label:"Red"},
];

window.saveMemberEdit = async function(memberId) {
  const name = document.getElementById("edit-member-name").value.trim();
  const color = document.getElementById("edit-member-color").value;
  if (!name) return;
  try {
    await updateDoc(doc(db, "families", familyId, "members", memberId), { name, color });
    // renderMembersList will be called automatically via onSnapshot
  } catch (e) {
    console.error("Failed to update member:", e);
    const el = document.getElementById("members-modal-error");
    el.textContent = "Failed to save changes.";
    el.classList.remove("hidden");
  }
};

window.addMember = async function () {
  const nameEl = document.getElementById("new-member-name");
  const colorEl = document.getElementById("selected-member-color");
  const name = nameEl.value.trim();
  if (!name) return;

  try {
    await addDoc(collection(db, "families", familyId, "members"), {
      name,
      color: colorEl.value || randomColor(),
      createdAt: serverTimestamp(),
    });
    nameEl.value = "";
    // Reset swatch selection to first color
    window.selectMemberColor("#4f86f7");
  } catch (e) {
    console.error("[Member] Failed to add member:", e.code, e.message);
    const el = document.getElementById("members-modal-error");
    el.textContent = `Failed to add member: ${e.message}`;
    el.classList.remove("hidden");
  }
};

window.deleteMember = async function (memberId) {
  if (!confirm("Remove this family member? They will be removed from any tasks they're assigned to.")) return;
  await deleteDoc(doc(db, "families", familyId, "members", memberId));

  // Remove from tasks
  const tasksWithMember = tasks.filter(
    (t) => t.members && t.members.includes(memberId)
  );
  for (const task of tasksWithMember) {
    const newMembers = task.members.filter((m) => m !== memberId);
    await updateDoc(doc(db, "families", familyId, "tasks", task.id), {
      members: newMembers,
    });
  }
};

// ============================================================
// UTILS
// ============================================================

function randomColor() {
  const colors = [
    "#2d6a4f", "#f4845f", "#4f86f7", "#9b59b6",
    "#e67e22", "#1abc9c", "#e91e8c", "#34495e",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
