// Exercises the production helper without calling Magento or Supabase.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { stripTypeScriptTypes } = require("node:module");
const source = fs.readFileSync("supabase/functions/magento/index.ts", "utf8");
const quantities = source.slice(source.indexOf("function closedOrderQuantities("), source.indexOf("const actions:"));
const action = source.slice(source.indexOf("  async reconcileClosedOrders("), source.indexOf("  /** How many orders have each status"));
const item = changes => ({ item_id: 11, sku: "SKU", product_type: "simple", qty_ordered: 10, qty_invoiced: 6, qty_canceled: 0, qty_shipped: 0, qty_refunded: 0, ...changes });

async function run({ items = [item()], n41Status = "Closed", cancelError = false, shipError = false, status = "processing", sourceRows = null } = {}) {
  const order = { increment_id: "00000716", status, items: structuredClone(items) };
  const writes = [];
  let shipmentCount = 0;
  const ctx = {
    UserError: class extends Error {},
    listParam: ids => ids,
    criteria: () => "test=1",
    skuBatches: skus => [skus],
    eachLimited: async (ids, limit, fn) => Promise.all(ids.map(fn)),
    mg: async (path, init) => {
      if (path.startsWith("/inventory/source-items?")) return { items: sourceRows ?? order.items.map(i => ({ sku: i.sku, source_code: "warehouse", quantity: 100, status: 1 })) };
      if (!init) return structuredClone(order);
      writes.push({ path, body: init.body && JSON.parse(init.body) });
      if (path.endsWith("/cancel")) {
        if (cancelError) throw new Error("Cancel failed");
        for (const i of order.items) i.qty_canceled += Math.max(0, i.qty_ordered - i.qty_invoiced - i.qty_canceled);
      } else if (path.endsWith("/ship")) {
        if (shipError) throw new Error("Ship permission denied");
        const body = JSON.parse(init.body);
        assert.equal(body.notify, false);
        assert.equal(body.arguments.extension_attributes.source_code, "warehouse");
        for (const shipped of body.items) {
          const i = order.items.find(i => i.item_id === shipped.order_item_id);
          assert.ok(shipped.qty > 0 && shipped.qty <= i.qty_invoiced - i.qty_shipped - i.qty_refunded);
          i.qty_shipped += shipped.qty;
        }
        shipmentCount++;
      } else throw new Error(`Unexpected path ${path}`);
      if (order.items.every(i => i.qty_invoiced + i.qty_canceled >= i.qty_ordered && (i.is_virtual || i.qty_shipped + i.qty_refunded >= i.qty_invoiced))) order.status = order.items.some(i => i.qty_invoiced) ? "complete" : "canceled";
      return path.endsWith("/ship") ? shipmentCount : true;
    },
  };
  vm.createContext(ctx);
  vm.runInContext(stripTypeScriptTypes(`${quantities}\nconst actions = {${action}};`), ctx);
  const client = { from: table => {
    assert.equal(table, "n41_so_headers");
    return { select: () => ({ eq: (field, key) => {
      assert.equal(field, "web_order_key"); assert.equal(key, "716");
      return Promise.resolve({ data: (Array.isArray(n41Status) ? n41Status : [n41Status]).map(status => ({ status })) });
    } }) };
  } };
  const reconcile = () => vm.runInContext("actions", ctx).reconcileClosedOrders({ ids: [7], _n41Client: client });
  const result = (await reconcile()).results[0];
  return { result, writes, order, reconcile };
}

(async () => {
  let r = await run();
  assert.equal(r.result.ok, true); assert.equal(r.result.canceled, 4); assert.equal(r.result.shipmentId, 1); assert.equal(r.result.status, "complete");
  assert.equal(r.writes[0].path, "/orders/7/cancel"); assert.equal(r.writes[1].path, "/order/7/ship");
  await r.reconcile(); assert.equal(r.writes.length, 2, "retry must not duplicate writes");
  r = await run({ items: [item({ qty_ordered: 6, qty_shipped: 2 })] });
  assert.equal(r.writes[0].body.items[0].qty, 4, "ship only remaining invoiced units");
  r = await run({ items: [item({ qty_ordered: 6, qty_refunded: 2 })] });
  assert.equal(r.writes[0].body.items[0].qty, 4, "exclude refunded units");
  r = await run({ items: [item({ qty_ordered: 6, qty_shipped: 6 })] }); assert.equal(r.writes.length, 0);
  r = await run({ items: [item({ qty_invoiced: 0 })] }); assert.equal(r.result.status, "canceled"); assert.equal(r.writes.length, 1);
  r = await run({ items: [item({ is_virtual: 1 })] }); assert.equal(r.writes.length, 1, "virtual items are canceled but never shipped");
  r = await run({ items: [item({ product_type: "configurable", qty_ordered: 6 }), item({ item_id: 12, parent_item_id: 11, qty_ordered: 6 })] });
  assert.equal(r.writes[0].body.items.length, 1, "do not double-count configurable children");
  r = await run({ n41Status: "Open" }); assert.equal(r.result.ok, false); assert.equal(r.writes.length, 0);
  r = await run({ n41Status: [] }); assert.equal(r.result.ok, false); assert.equal(r.writes.length, 0);
  r = await run({ n41Status: ["Closed", "Open"] }); assert.equal(r.result.ok, false); assert.equal(r.writes.length, 0);
  r = await run({ items: [item({ product_type: "bundle" })] }); assert.equal(r.result.ok, false); assert.equal(r.writes.length, 0);
  r = await run({ cancelError: true }); assert.equal(r.result.ok, false); assert.equal(r.writes.length, 1);
  r = await run({ shipError: true }); assert.equal(r.result.ok, false); assert.equal(r.result.canceled, 4); assert.match(r.result.error, /permission/);
  assert.equal(r.result.shipmentId, null);
  r = await run({ sourceRows: [] }); assert.equal(r.result.ok, false); assert.match(r.result.error, /No single inventory source/);
  r = await run({ sourceRows: [{sku:'SKU',source_code:'a'},{sku:'SKU',source_code:'b'}] }); assert.match(r.result.error, /multiple inventory sources/);
  r = await run({ shipError: true, sourceRows: [{sku:'SKU',source_code:'warehouse',quantity:0,status:0}] });
  assert.match(r.result.error, /source qty 0, Out of Stock/); assert.match(r.result.error, /Source: warehouse/);
  console.log("Passed 17 mocked reconciliation and source-selection scenarios; no live orders changed.");
})().catch(err => { console.error(err); process.exitCode = 1; });
