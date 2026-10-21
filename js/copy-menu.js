/**
 * Right-click → Copy. One small menu at the pointer, saying exactly what it
 * copies. Used for style numbers in the Styles and Photoshoots tables and
 * the shoot pane, and for product names in the Magento tab (js/magento.js
 * works out what a product copies).
 *
 *   openCopyMenu(event, "ET6157")
 */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // No clipboard permission: the old way, through a hidden text box.
    const box = document.createElement("textarea");
    box.value = text;
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    box.remove();
  }
  showIndicator(`Copied ${text}`, "success");
}

function closeCopyMenu() {
  document.getElementById("copyMenu")?.remove();
}

function openCopyMenu(e, text) {
  closeCopyMenu();
  if (!text) return;
  e.preventDefault();
  const menu = document.createElement("div");
  menu.id = "copyMenu";
  menu.className = "header-menu-dropdown copy-menu";
  menu.setAttribute("role", "menu");
  const item = document.createElement("button");
  item.type = "button";
  item.className = "header-menu-item";
  item.setAttribute("role", "menuitem");
  item.innerHTML = '<svg class="header-menu-item-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const label = document.createElement("span");
  label.textContent = `Copy "${text}"`;
  item.appendChild(label);
  item.addEventListener("click", () => {
    closeCopyMenu();
    copyText(text);
  });
  menu.appendChild(item);
  document.body.appendChild(menu);
  // At the pointer, kept inside the window.
  const left = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8);
  const top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  item.focus();
}

/**
 * Right-clicking a style number copies it: the Style # cell in the Styles
 * and Need to Shoot tables (rows carry data-style-no), and a style in the
 * shoot pane.
 */
function initStyleCopyMenus() {
  ["stylesTableBody", "needTableBody"].forEach(id => {
    document.getElementById(id)?.addEventListener("contextmenu", e => {
      if (!e.target.closest('td[data-col="styleNo"]')) return;
      const styleNo = e.target.closest("tr[data-style-no]")?.dataset.styleNo;
      if (styleNo) openCopyMenu(e, styleNo);
    });
  });
  document.getElementById("shootPaneStyles")?.addEventListener("contextmenu", e => {
    const styleNo = e.target.closest(".shoot-style-text")?.closest("[data-style-no]")?.dataset.styleNo;
    if (styleNo) openCopyMenu(e, styleNo);
  });
}

function initCopyMenu() {
  document.addEventListener("click", e => {
    if (!e.target.closest("#copyMenu")) closeCopyMenu();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeCopyMenu();
  });
  document.addEventListener("scroll", closeCopyMenu, true);
  initStyleCopyMenus();
}
