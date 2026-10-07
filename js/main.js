/**
 * Boot sequence.
 *
 * Everything below the auth gate assumes a signed-in session — Row Level
 * Security would just return empty tables without one, which would read as
 * "no companies yet" rather than the actual problem. So: check for a
 * session first, and only load data once there is one.
 */

async function loadAndShowApp() {
  setAppLoading(true, "Loading...");
  hideLoginScreen();
  const app = document.getElementById("appMain");
  if (app) app.hidden = false;

  try {
    await loadAppData();
    applyCompanyFilters();
    switchAppView("home");
  } catch (err) {
    showIndicator(err.message || "Failed to load data.", "error");
  } finally {
    setAppLoading(false);
  }
}

async function bootApp() {
  setAppLoading(true, "Loading...");

  initAuthForm();
  initAppNav();
  initHeaderMenu();
  initCompaniesView();
  initCompanyDetail();
  initCompanyForm();
  initCalendar();
  initCompanyMiniCal();
  initBookkeepingView();

  if (!isSupabaseConfigured()) {
    setAppLoading(false);
    showLoginScreen("Supabase isn't configured yet — set SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js, then reload.");
    return;
  }

  const initialSession = await getSession();
  if (initialSession) {
    await loadAndShowApp();
  } else {
    setAppLoading(false);
    showLoginScreen();
  }

  // supabase-js replays the current session once immediately on subscribe,
  // so the first callback here just echoes what getSession() already told
  // us above — `wasSignedIn` starts matching that same state and only a
  // real sign-in/sign-out transition after that should do anything.
  let wasSignedIn = Boolean(initialSession);
  supabaseClient?.auth.onAuthStateChange((_event, session) => {
    const isSignedIn = Boolean(session);
    if (isSignedIn === wasSignedIn) return;
    wasSignedIn = isSignedIn;
    // A full reload is the simplest way back to a known-clean state rather
    // than unwinding whatever view was open when the session changed.
    location.reload();
  });
}

bootApp();
