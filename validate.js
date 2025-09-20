/* ============================
   Legit City - validate.js
   (Front-end demo auth)
   ============================ */

// ---------- Public validators ----------

function validateRegister(event) {
  event.preventDefault();
  let valid = true;

  const name = el("regName");
  const email = el("regEmail");
  const password = el("regPassword");
  const confirmPassword = el("confirmPassword");
  const accountType = el("accountType");

  clearErrors([name, email, password, confirmPassword, accountType]);

  // Name
  if (name.value.trim().length < 3) {
    setError(name, "Name must be at least 3 characters long.");
    valid = false;
  }

  // Email format
  if (!isValidEmail(email.value)) {
    setError(email, "Please enter a valid email address.");
    valid = false;
  }

  // Password strength
  if (!isStrongPassword(password.value)) {
    setError(
      password,
      "Password must be 8+ chars and include a number and a special character."
    );
    valid = false;
  }

  // Confirm password
  if (password.value !== confirmPassword.value) {
    setError(confirmPassword, "Passwords do not match.");
    valid = false;
  }

  // Account type
  if (!accountType.value) {
    setError(accountType, "Please select an account type.");
    valid = false;
  }

  // Duplicate email check
  const users = getUsers();
  const exists = users.some(u => u.email === normalizeEmail(email.value));
  if (exists) {
    setError(email, "This email is already registered. Try logging in.");
    valid = false;
  }

  if (!valid) return false;

  // Save user (demo only — not secure)
  users.push({
    name: name.value.trim(),
    email: normalizeEmail(email.value),
    password: password.value, // plaintext for demo only
    type: accountType.value
  });
  saveUsers(users);

  alert("✅ Registration successful (demo). You can now log in.");
  // Optionally switch to login form:
  // document.querySelector("#registerForm").style.display = "none";
  // document.querySelector("#loginForm").style.display = "block";
  return true;
}

function validateLogin(event) {
  event.preventDefault();
  let valid = true;

  const email = el("loginEmail");
  const password = el("loginPassword");

  clearErrors([email, password]);

  // Basic email format check (so typos show a clear message)
  if (!isValidEmail(email.value)) {
    setError(email, "Please enter a valid email address.");
    valid = false;
  }

  // Strong password hint (kept to match your policy)
  if (!isStrongPassword(password.value)) {
    setError(
      password,
      "Password must be 8+ chars and include a number and a special character."
    );
    valid = false;
  }

  if (!valid) return false;

  // Compare against registered users (localStorage)
  const users = getUsers();
  const user = users.find(u => u.email === normalizeEmail(email.value));

  if (!user || user.password !== password.value) {
    // Generic auth error (don’t reveal which field failed)
    setError(email, "Email or password is incorrect.");
    setError(password, "Email or password is incorrect.");
    return false;
  }

  alert("✅ Login successful (demo).");
  // Example redirect:
  // window.location.href = "dashboard.html";
  return true;
}

// ---------- Helpers ----------

function isValidEmail(v) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(v).toLowerCase());
}

function isStrongPassword(pw) {
  // ≥8 chars, at least 1 number and 1 special char
  return /^(?=.*[0-9])(?=.*[@$!%*?&])[A-Za-z0-9@$!%*?&]{8,}$/.test(pw);
}

function normalizeEmail(v) {
  return String(v).trim().toLowerCase();
}

function el(id) {
  return document.getElementById(id);
}

// Show error (red border + text) and clear on next input
function setError(input, message) {
  input.classList.add("error-border");
  const msgEl = document.getElementById(input.id + "Error");
  if (msgEl) msgEl.textContent = message;

  const clear = () => {
    input.classList.remove("error-border");
    if (msgEl) msgEl.textContent = "";
    input.removeEventListener("input", clear);
    if (input.tagName.toLowerCase() === "select") {
      input.removeEventListener("change", clear);
    }
  };

  input.addEventListener("input", clear);
  if (input.tagName.toLowerCase() === "select") {
    input.addEventListener("change", clear);
  }
}

function clearErrors(inputs) {
  inputs.forEach(input => {
    input.classList.remove("error-border");
    const msgEl = document.getElementById(input.id + "Error");
    if (msgEl) msgEl.textContent = "";
  });
}

// ---------- localStorage (demo only) ----------

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem("legitcity_users")) || [];
  } catch {
    return [];
  }
}

function saveUsers(arr) {
  localStorage.setItem("legitcity_users", JSON.stringify(arr));
}
