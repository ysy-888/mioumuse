/** App-wide right-click copying; existing openCopyMenu callers copy immediately. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const previous = document.activeElement;
    const box = document.createElement("textarea");
    box.value = text;
    box.readOnly = true;
    box.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(box);
    let copied = false;
    try {
      box.select();
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      box.remove();
      previous?.focus?.({ preventScroll: true });
    }
    if (!copied) {
      showIndicator("Couldn't copy — the browser blocked the clipboard", "error");
      return false;
    }
  }
  showIndicator(`Copied ${text}`, "success");
  return true;
}

function closeCopyMenu() {
  document.getElementById("copyMenu")?.remove();
}

/** Kept as a shared entry point for Magento names, order numbers and emails. */
function openCopyMenu(e, text) {
  if (!text) return;
  e.preventDefault();
  e.stopPropagation();
  closeCopyMenu();
  return copyText(text);
}

/** Whole set, no colour suffix, with the top first: T2488 & P2438. */
function getSetCopyText(styleNo) {
  const names = [...new Set([...(getStyleSetPieces(styleNo) ?? []), baseStyleNo(styleNo)])];
  if (names.some(no => /^T/i.test(no))) {
    const rank = no => /^T/i.test(no) ? 0 : /^[PS]/i.test(no) ? 1 : 2;
    names.sort((a, b) => rank(a) - rank(b));
  }
  return names.join(" & ");
}

function initStyleCopyMenus() {
  // Delegation covers rows added by paging, filtering and pane rendering.
  document.addEventListener("contextmenu", e => {
    const tag = e.target.closest(".set-tag[data-copy-set]");
    if (tag) {
      openCopyMenu(e, tag.dataset.copySet);
      return;
    }
    const cell = e.target.closest('td[data-col="styleNo"], .shoot-style-name, [data-copy-style-no]');
    const styleNo = cell?.dataset.copyStyleNo || cell?.closest("[data-style-no]")?.dataset.styleNo;
    if (styleNo) openCopyMenu(e, styleNo);
  });
}

function initCopyMenu() {
  closeCopyMenu();
  initStyleCopyMenus();
  document.addEventListener("pointerdown", e => {
    if (!e.target.closest("#copyMenu")) closeCopyMenu();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeCopyMenu();
  });
  document.addEventListener("scroll", () => closeCopyMenu(), true);
}
