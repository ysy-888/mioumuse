/**
 * Auth — a single-user gate in front of the app.
 *
 * Row Level Security on every table means nothing loads until there's a
 * signed-in session, so this file's job is just: get one, or show a login
 * form until there is one. There's no self-serve signup in the app — create
 * your one account directly in the Supabase dashboard (see supabase-schema.sql).
 *
 * Loaded after js/config.js (needs SUPABASE_URL / SUPABASE_ANON_KEY) and after
 * the Supabase CDN script (needs the global `supabase.createClient`).
 */

const supabaseClient = (typeof supabase !== "undefined" && SUPABASE_URL && SUPABASE_ANON_KEY)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

function isSupabaseConfigured() {
  return supabaseClient !== null;
}

async function getSession() {
  if (!supabaseClient) return null;
  const { data } = await supabaseClient.auth.getSession();
  return data?.session ?? null;
}

async function signIn(email, password) {
  if (!supabaseClient) throw new Error("Supabase isn't configured — set SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js.");
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

async function signOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
}

// ── Login screen ─────────────────────────────────────────────────────────────

function showLoginScreen(message = "") {
  const app = document.getElementById("appMain");
  const toolbar = document.getElementById("companiesToolbar");
  if (app) app.hidden = true;
  if (toolbar) toolbar.hidden = true;

  const screen = document.getElementById("loginScreen");
  if (screen) screen.hidden = false;

  const err = document.getElementById("loginError");
  if (err) {
    err.textContent = message;
    err.hidden = !message;
  }
}

function hideLoginScreen() {
  const screen = document.getElementById("loginScreen");
  if (screen) screen.hidden = true;
}

function initAuthForm() {
  const form = document.getElementById("loginForm");
  if (!form) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const email = document.getElementById("loginEmail")?.value.trim() ?? "";
    const password = document.getElementById("loginPassword")?.value ?? "";
    const btn = document.getElementById("loginSubmitBtn");

    if (btn) { btn.disabled = true; btn.textContent = "Signing in…"; }
    try {
      await signIn(email, password);
      // main.js's onAuthStateChange listener picks up the new session and
      // boots the app from here — nothing else to do on success.
    } catch (err) {
      showLoginScreen(err.message || "Could not sign in.");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Sign in"; }
    }
  });
}
