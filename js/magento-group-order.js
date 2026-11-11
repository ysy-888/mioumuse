/**
 * A Grouped product's Simple items, in order, in the product pane.
 *
 * The storefront shows a group with its items' photos, led by the first
 * item's main photo, and lists the colours in this order too. With 2 or more
 * items, drag one up or down to reorder: it saves to Magento at once (the
 * group's positions), then to the imported groups, so the table follows.
 */

let mgGroupOrderBusy = false;
let mgGroupDragSku = null;

const MG_GRIP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="5" r="1.6"/><circle cx="15" cy="5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="19" r="1.6"/></svg>';

/** Can this group be put in order now? */
function canOrderMgGroup(product) {
  return product.type === "grouped" && (product.childSkus?.length ?? 0) >= 2 && !mgPane?.loading && !mgGroupOrderBusy;
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

function createMgGroupItem(childSku, i, draggable, leadSku) {
  const row = mgPage.items.find(p => p.sku === childSku);
  const li = document.createElement("li");
  li.className = "mg-group-item";
  li.dataset.sku = childSku;
  li.draggable = draggable;
  if (row?.status === 2) li.classList.add("is-disabled");

  const num = Object.assign(document.createElement("span"), { className: "mg-group-num", textContent: String(i + 1) });
  li.appendChild(num);
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
  li.appendChild(Object.assign(document.createElement("span"), { className: "mg-sku", textContent: childSku }));
  if (childSku === leadSku) li.appendChild(Object.assign(document.createElement("span"), { className: "mg-group-tag is-lead", textContent: "Lead photo", title: "The storefront opens on this item's main photo: the first one that's enabled, in stock and has a photo" }));
  if (row?.status === 2) li.appendChild(Object.assign(document.createElement("span"), { className: "mg-group-tag", textContent: "Disabled" }));
  else if (row?.inStock === false) li.appendChild(Object.assign(document.createElement("span"), { className: "mg-group-tag", textContent: "Out of stock" }));
  return li;
}

/** The numbered list; redrawn only when it changes, so a drag isn't cut off. */
function renderMgGroupOrder(list, product) {
  const skus = product.childSkus ?? [];
  const draggable = canOrderMgGroup(product);
  const leadSku = mgGroupLeadSku(skus);
  const key = JSON.stringify([product.sku, skus, draggable, mgGroupOrderBusy, leadSku]);
  list.classList.toggle("is-busy", mgGroupOrderBusy);
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
  if (draggable) list.title = "Drag to change the order. The first item's main photo leads on the storefront.";
  else list.removeAttribute("title");
}

/** The new order, into the pane, the table row and the imported groups. */
async function applyMgGroupOrder(sku, order) {
  if (mgPane?.saved.sku === sku) {
    mgPane.saved.childSkus = [...order];
    mgPane.draft.childSkus = [...order];
  }
  const row = mgPage.items.find(p => p.sku === sku);
  if (row) row.childSkus = [...order];
  if (mgGroups?.has(sku)) {
    mgGroups.set(sku, [...order]);
    try {
      await saveMagentoGroupOrder(sku, order);
    } catch (err) {
      showIndicator(`Saved to Magento, but not to the imported groups: ${err.message}`, "error");
    }
  }
}

async function saveMgGroupOrder(order) {
  const sku = mgPane?.saved.sku;
  if (!sku || mgGroupOrderBusy) return;
  mgGroupOrderBusy = true;
  renderMagentoPane();
  setAppLoading(true, "Saving the order...");
  try {
    const result = await callMagento("groupReorder", { sku, childSkus: order });
    await applyMgGroupOrder(sku, order);
    const skipped = result?.skipped ?? [];
    showIndicator(skipped.length
      ? `Order saved. Magento didn't list ${skipped.join(", ")} (disabled items it hides), so ${skipped.length === 1 ? "it stays" : "they stay"} where ${skipped.length === 1 ? "it was" : "they were"} on Magento.`
      : "Order saved to Magento", skipped.length ? "" : "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't save the order.", "error");
  } finally {
    mgGroupOrderBusy = false;
    setAppLoading(false);
    if (mgPane) renderMagentoPane();
    if (getCurrentAppView() === "magento") renderMgProducts();
  }
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
    const current = mgPane?.saved.childSkus ?? [];
    if (!li || li.dataset.sku === mgGroupDragSku) return;
    const order = current.filter(s => s !== mgGroupDragSku);
    const at = order.indexOf(li.dataset.sku);
    order.splice(mgGroupDropSide(li, e) === "before" ? at : at + 1, 0, mgGroupDragSku);
    if (order.join("\n") !== current.join("\n")) saveMgGroupOrder(order);
  });
}
