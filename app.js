// ============================================================
// FIREBASE CONFIG — Replace this block with your own config
// from the Firebase Console (Project Settings > Your apps)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
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

// Handle the result when Google redirects back to the app
getRedirectResult(auth).catch((e) => {
  if (e.code && e.code !== "auth/cancelled-popup-request") {
    console.error("Redirect sign-in error:", e);
  }
});

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
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      // Returning user — load their family
      familyId = userDoc.data().familyId;
      const familyDoc = await getDoc(doc(db, "families", familyId));
      if (familyDoc.exists()) {
        document.getElementById("header-family-name").textContent =
          familyDoc.data().name;
      }
      showApp();
      subscribeToData();
    } else {
      // New Google user — need to set up their family
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

  // Recovery: check if this user already owns a family (in case the users doc
  // failed to write last time but the family doc was created successfully).
  try {
    const q = query(collection(db, "families"), where("ownerId", "==", currentUser.uid));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const existingFamily = snap.docs[0];
      await setDoc(doc(db, "users", currentUser.uid), {
        name: currentUser.displayName || "Family Member",
        email: currentUser.email || "",
        familyId: existingFamily.id,
        createdAt: serverTimestamp(),
      });
      familyId = existingFamily.id;
      document.getElementById("header-family-name").textContent = existingFamily.data().name;
      showApp();
      subscribeToData();
      return;
    }
  } catch (e) {
    console.warn("Family recovery check failed:", e);
  }

  // Truly new user — show the setup form
  if (currentUser?.displayName) {
    document.getElementById("setup-member-name").value = currentUser.displayName.split(" ")[0];
  }
  document.getElementById("family-setup-screen").classList.remove("hidden");
}

window.signInWithGoogle = async function () {
  clearAuthError();
  try {
    await signInWithRedirect(auth, googleProvider);
    // Page will redirect to Google, then back here.
    // onAuthStateChanged + getRedirectResult handle the rest.
  } catch (e) {
    showAuthError("Sign-in failed. Please try again.");
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
  // Members
  onSnapshot(
    collection(db, "families", familyId, "members"),
    (snap) => {
      members = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderMemberChips();
      renderMemberCheckboxes();
      renderMembersList();
    }
  );

  // Tasks
  if (tasksUnsubscribe) tasksUnsubscribe();
  tasksUnsubscribe = onSnapshot(
    collection(db, "families", familyId, "tasks"),
    (snap) => {
      tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      processDueRecurringTasks().then(() => renderTasks());
    }
  );
}

// ============================================================
// RECURRING TASK LOGIC
// ============================================================

async function processDueRecurringTasks() {
  const today = todayStr();
  for (const task of tasks) {
    if (task.recurrence === "none" || !task.recurrence) continue;
    if (task.completed && task.nextDue && task.nextDue <= today) {
      // Re-open task with next due date
      await updateDoc(doc(db, "families", familyId, "tasks", task.id), {
        completed: false,
        completedAt: null,
        dueDate: task.nextDue,
        nextDue: null,
      });
    }
  }
}

function computeNextDue(dueDate, recurrence) {
  if (!dueDate || recurrence === "none") return null;
  const d = new Date(dueDate + "T12:00:00");
  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  else if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "biweekly") d.setDate(d.getDate() + 14);
  else if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================
// RENDER TASKS
// ============================================================

function renderTasks() {
  const container = document.getElementById("task-list");
  const today = todayStr();

  let filtered = tasks.filter((t) => !t.completed);
  if (activeFilter !== "all") {
    filtered = filtered.filter(
      (t) => t.members && t.members.includes(activeFilter)
    );
  }

  const overdue = filtered
    .filter((t) => t.dueDate && t.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const upcoming = filtered
    .filter((t) => t.dueDate && t.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const noDue = filtered.filter((t) => !t.dueDate);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">✅</div>
      <p>${activeFilter === "all" ? "No tasks yet! Add one above." : "No tasks for this member."}</p>
    </div>`;
    return;
  }

  let html = "";

  if (overdue.length) {
    html += `<div class="section-label">⚠️ Overdue</div>`;
    overdue.forEach((t) => (html += taskCard(t, true)));
  }

  if (upcoming.length) {
    html += `<div class="section-label">📅 Upcoming</div>`;
    upcoming.forEach((t) => (html += taskCard(t, false)));
  }

  if (noDue.length) {
    html += `<div class="section-label">🗂 No Due Date</div>`;
    noDue.forEach((t) => (html += taskCard(t, false)));
  }

  container.innerHTML = html;
}

function taskCard(task, isOverdue) {
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

  const dateStr = task.dueDate
    ? formatDate(task.dueDate)
    : "";
  const dateClass = isOverdue ? "task-date overdue-text" : "task-date";

  const recurLabel = task.recurrence && task.recurrence !== "none"
    ? `<span class="task-recur">↻ ${recurringLabel(task.recurrence)}</span>`
    : "";

  const deleteTitle = task.recurrence && task.recurrence !== "none"
    ? "Delete (stop recurring)"
    : "Delete task";

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
  row.innerHTML = html;
}

window.setFilter = function (memberId) {
  activeFilter = memberId;
  renderMemberChips();
  renderTasks();
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
  renderMemberCheckboxes();
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

  if (isRecurring && task.dueDate) {
    const nextDue = computeNextDue(task.dueDate, task.recurrence);
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

function renderMembersList() {
  const container = document.getElementById("members-list");
  if (!members.length) {
    container.innerHTML = `<p style="font-size:13px;color:var(--text3);margin-bottom:8px">No members yet.</p>`;
    return;
  }
  container.innerHTML = members
    .map((m) => {
      const initials = m.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
      return `<div class="member-row">
        <div class="avatar" style="background:${m.color || "#888"}">${initials}</div>
        <span class="member-name">${escHtml(m.name)}</span>
        <button class="member-delete" onclick="deleteMember('${m.id}')" title="Remove member">✕</button>
      </div>`;
    })
    .join("");
}

window.addMember = async function () {
  const nameEl = document.getElementById("new-member-name");
  const colorEl = document.getElementById("new-member-color");
  const name = nameEl.value.trim();
  if (!name) return;

  try {
    await addDoc(collection(db, "families", familyId, "members"), {
      name,
      color: colorEl.value || randomColor(),
      createdAt: serverTimestamp(),
    });
    nameEl.value = "";
  } catch (e) {
    const el = document.getElementById("members-modal-error");
    el.textContent = "Failed to add member.";
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
