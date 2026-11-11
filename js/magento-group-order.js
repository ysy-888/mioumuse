/**
 * A group's order, in the product pane — part of the pane's edits, saved with
 * Save to Magento (or undone with Revert) like any field.
 *
 *   Grouped product   its Simple items as a numbered list; drag one up or
 *                     down, or click an SKU to open that item's pane.
 *   Simple item       "2 of 3" beside its group: pick another place to move
 *                     it; click the group to open the Grouped product.
 *
 * The storefront shows a group with its items' photos, led by the first
 * shown item's main photo, and lists the colours in this order too. Saving
 * sets the group's positions on Magento, then the imported groups, so the
 * products table follows.
 */

let mgGroupDragSku = null;

const MG_GRIP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="5" r="1.6"/><circle cx="15" cy="5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="19" r="1.6"/></svg>';

/**
 * The pane's group and its order, on both what Magento has and the draft: a
 * Grouped product's own items, or — for a Simple item — the imported group
 * it's in (none when groups haven't been imported).
 */
function seedMgGroupOrder(state) {
  const p = state.saved;
  const groupSku = p.type === "grouped" ? p.sku : p.groupSku ?? null;
  const order = p.type === "grouped" ? p.childSkus ?? [] : (groupSku && mgGroups?.get(groupSku)) || [];
  [state.saved, state.draft].forEach(o => {
    o.groupOrderSku = groupSku;
    o.groupOrder = [...order];
  });
}

/** The order can change: 2 or more items, the product loaded, not saving. */
function canReorderMgGroup() {
  return (mgPane?.draft.groupOrder?.length ?? 0) >= 2 && !mgPane.loading && !mgPane.saving && Boolean(mgPane.saved.groupOrderSku);
}

/** A change to the draft order: redraw, and count it as unsaved. */
function setMgGroupDraftOrder(order) {
  if (!mgPane) return;
  mgPane.draft.groupOrder = order;
  renderMagentoPane();
}

/**
 * The item the storefront leads with: the first one that's enabled, in stock
 * and has a photo — it passes over the rest (disabled ones aren't shown, and
 * sold-out ones go last). Only items on this page of the table are known.
 */
function mgGroupLeadSku(skus) {
  const shown = skus
    .map(sku => mgPage.items.find(p => p.sku === sku))
    .filter(row => row && row.status !== 2 && getMgImageUrl(row));
  // All sold out: the first one still leads.
  return (shown.find(row => row.inStock !== false) ?? shown[0])?.sku ?? null;
}

/** A button that opens another product's pane. */
function createMgPaneLink(sku, title) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mg-pane-link mg-sku";
  btn.dataset.openSku = sku;
  btn.textContent = sku;
  btn.title = title;
  btn.draggable = false;
  return btn;
}

function createMgGroupItem(childSku, i, draggable, leadSku) {
  const row = mgPage.items.find(p => p.sku === childSku);
  const li = document.createElement("li");
  li.className = "mg-group-item";
  li.dataset.sku = childSku;
  li.draggable = draggable;
  if (row?.status === 2) li.classList.add("is-disabled");

  li.appendChild(Object.assign(document.createElement("span"), { className: "mg-group-num", textContent: String(i + 1) }));
  if (draggable) {
    const grip = document.createElement("span");
    grip.className = "mg-group-grip";
    grip.innerHTML = MG_GRIP_ICON;
    li.appendChild(grip);
  }
  const thumb = document.createElement("span");
  thumb.className = "mg-group-thumb";
  const url = row ? getMgImageUrl(row) : "";
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    img.draggable = false;
    thumb.appendChild(img);
  }
  li.appendChild(thumb);
  li.appendChild(createMgPaneLink(childSku, `Open ${childSku}`));
  if (childSku === leadSku) li.appendChild(Object.assign(document.createElement("span"), { className: "mg-group-tag is-lead", textContent: "Lead photo", title: "The storefront opens on this item's main photo: the first one that's enabled, in stock and has a photo" }));
  if (row?.status === 2) li.appendChild(Object.assign(document.createElement("span"), { className: "mg-group-tag", textContent: "Disabled" }));
  else if (row?.inStock === false) li.appendChild(Object.assign(document.createElement("span"), { className: "mg-group-tag", textContent: "Out of stock" }));
  return li;
}

/** A Grouped product's items, in the draft's order; redrawn only on a change, so a drag isn't cut off. */
function renderMgGroupOrder(list) {
  const skus = mgPane?.draft.groupOrder ?? [];
  const draggable = canReorderMgGroup();
  const leadSku = mgGroupLeadSku(skus);
  const key = JSON.stringify([mgPane?.saved.sku, skus, draggable, leadSku]);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  if (!skus.length) {
    list.replaceChildren(Object.assign(document.createElement("span"), { className: "mg-group-empty", textContent: "No simple items" }));
    return;
  }
  const ol = document.createElement("ol");
  ol.className = "mg-group-order";
  ol.classList.toggle("is-sortable", draggable);
  ol.replaceChildren(...skus.map((sku, i) => createMgGroupItem(sku, i, draggable, leadSku)));
  list.replaceChildren(ol);
  if (draggable) list.title = "Drag to change the order, then Save to Magento. The first item's main photo leads on the storefront.";
  else list.removeAttribute("title");
}

/**
 * A Simple item's group: the Grouped product (opens its pane), and where this
 * item sits in it — a pick list to move it.
 */
function renderMgGroupPlace(list, product) {
  const groupSku = mgPane?.saved.groupOrderSku;
  const order = mgPane?.draft.groupOrder ?? [];
  const at = order.indexOf(product.sku);
  const key = JSON.stringify([product.sku, groupSku, order, canReorderMgGroup()]);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  const parts = [createMgPaneLink(groupSku, `Open the Grouped product ${groupSku}`)];
  if (at >= 0 && order.length >= 2) {
    const select = document.createElement("select");
    select.className = "mg-group-place";
    select.title = "This item's place in the group — the first shown item's photo leads on the storefront";
    select.disabled = !canReorderMgGroup();
    order.forEach((_, i) => select.add(new Option(`${i + 1} of ${order.length}`, String(i), false, i === at)));
    select.addEventListener("change", () => {
      const next = order.filter(sku => sku !== product.sku);
      next.splice(Number(select.value), 0, product.sku);
      setMgGroupDraftOrder(next);
    });
    parts.push(select);
  } else if (at >= 0) {
    parts.push(Object.assign(document.createElement("span"), { className: "mg-group-place-text", textContent: "1 of 1" }));
  }
  list.replaceChildren(...parts);
}

/** After a save: the order into the table row and the imported groups. */
async function applyMgGroupOrder(groupSku, order) {
  const row = mgPage.items.find(p => p.sku === groupSku);
  if (row) row.childSkus = [...order];
  if (mgGroups?.has(groupSku)) {
    mgGroups.set(groupSku, [...order]);
    try {
      await saveMagentoGroupOrder(groupSku, order);
    } catch (err) {
      showIndicator(`Saved to Magento, but not to the imported groups: ${err.message}`, "error");
    }
  }
}

/** Items Magento didn't list (disabled ones it hides) keep their place there. */
function describeMgGroupSkipped(skipped) {
  if (!skipped.length) return "";
  const one = skipped.length === 1;
  return `. Magento didn't list ${skipped.join(", ")} (disabled items it hides), so ${one ? "it stays" : "they stay"} where ${one ? "it was" : "they were"} on Magento.`;
}

function clearMgGroupDropMarks(list) {
  list.querySelectorAll(".is-drop-before, .is-drop-after").forEach(el => el.classList.remove("is-drop-before", "is-drop-after"));
}

const mgGroupDropSide = (li, e) => {
  const box = li.getBoundingClientRect();
  return e.clientY < box.top + box.height / 2 ? "before" : "after";
};

function initMgGroupOrder() {
  const list = document.getElementById("mgPaneGroupList");
  if (!list) return;

  // An SKU or the group: open that product's pane.
  list.addEventListener("click", e => {
    const link = e.target.closest("[data-open-sku]");
    if (link) openMagentoPane(link.dataset.openSku);
  });

  list.addEventListener("dragstart", e => {
    const li = e.target.closest?.(".mg-group-item");
    if (!li?.draggable) return;
    mgGroupDragSku = li.dataset.sku;
    li.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", mgGroupDragSku);
  });
  list.addEventListener("dragend", () => {
    mgGroupDragSku = null;
    list.querySelector(".is-dragging")?.classList.remove("is-dragging");
    clearMgGroupDropMarks(list);
  });
  list.addEventListener("dragover", e => {
    if (!mgGroupDragSku) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    clearMgGroupDropMarks(list);
    const li = e.target.closest?.(".mg-group-item");
    if (li && li.dataset.sku !== mgGroupDragSku) li.classList.add(`is-drop-${mgGroupDropSide(li, e)}`);
  });
  list.addEventListener("drop", e => {
    if (!mgGroupDragSku) return;
    e.preventDefault();
    clearMgGroupDropMarks(list);
    const li = e.target.closest?.(".mg-group-item");
    const current = mgPane?.draft.groupOrder ?? [];
    if (!li || li.dataset.sku === mgGroupDragSku) return;
    const order = current.filter(s => s !== mgGroupDragSku);
    const at = order.indexOf(li.dataset.sku);
    order.splice(mgGroupDropSide(li, e) === "before" ? at : at + 1, 0, mgGroupDragSku);
    if (order.join("\n") !== current.join("\n")) setMgGroupDraftOrder(order);
  });
}
