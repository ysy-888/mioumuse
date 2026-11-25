const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync("js/n41-orders.js", "utf8").split("// ── Loading and saving")[0];
const ctx = { mgOrderKey: v => String(v ?? "").replace(/\D/g, "").replace(/^0+/, ""), isMgN41Closed: h => String(h?.status ?? "").toLowerCase() === "closed" };
vm.createContext(ctx); vm.runInContext(source, ctx);
const parse = text => ctx.parseN41SoRows(ctx.n41SoCsvRows(text));
const fixture = "Orderno,Status,CustomerPo,Customer,so_qty,OrderDate\n1,Closed,Web:00000716,C,6,11/24/2026\n2,Open,Web:00000716,C,12,11/24/2026\n3,Closed,Web:00000717,C,6,11/24/2026";
let parsed = parse(fixture);
assert.equal(parsed.kind, "summary"); assert.equal(parsed.headers.size, 3);
assert.equal(parsed.webOrders.get("716").status, "Open");
assert.equal(parsed.webOrders.get("717").status, "Closed");
assert.equal(parsed.headers.get("1").order_date, "2026-11-24");
assert.equal(parsed.headers.get("1").total_units, 6);
assert.throws(() => parse("Orderno,Status,CustomerPo\n1,Closed,Web:1\n1,Open,Web:1"), /conflicting/);
parsed = parse("orderno,sod_id,status,customer,style,color,customerPo\n1,5,Closed,C,T1,BLUE,Web:00000716");
assert.equal(parsed.kind, "detail"); assert.equal(parsed.lines.length, 1);
assert.equal(parsed.webOrders.get("716").status, "Unknown", "detail lines cannot establish a header status");
assert.equal(ctx.n41HeaderWebOrders([]).size, 0, "no headers must not fall back to detail-derived status");
const fullSource = fs.readFileSync("js/n41-orders.js", "utf8");
vm.runInContext(fullSource.match(/function buildSoOrders\([\s\S]*?\n\}/)[0], ctx);
vm.runInContext(`
  so.headers = new Map([
    ['1', {order_no:'1', status:'Open', customer:'C'}],
    ['2', {order_no:'2', status:'Closed', customer:'C'}],
    ['3', {order_no:'3', status:'Open', customer:'C',total_units:12}]
  ]);
  so.lines = [
    {order_no:'1',status:'Closed',style_no:'T1',customer:'C'},
    {order_no:'2',status:'Open',style_no:'T2',customer:'C'},
    {order_no:'4',status:'Closed',style_no:'T4',customer:'C'}
  ];
  buildSoOrders();
`, ctx);
assert.equal(vm.runInContext("so.orders.get('1').status", ctx), "Open");
assert.equal(vm.runInContext("so.orders.get('2').status", ctx), "Closed");
assert.equal(vm.runInContext("so.orders.get('3').units", ctx), 12);
assert.equal(vm.runInContext("so.orders.get('4').status", ctx), "Unknown");
console.log("Passed SO Summary detection, header aggregation, conflicting status and SO Detail compatibility checks.");

if (process.argv[2]) {
  parsed = parse(fs.readFileSync(process.argv[2], "utf8"));
  console.log(JSON.stringify({ headers: parsed.headers.size, webOrders: parsed.webOrders.size, web716: parsed.webOrders.get("716")?.status ?? "Unknown (not in summary)" }));
  if (process.argv[3]) {
    const dir = process.argv[3]; fs.mkdirSync(dir, { recursive: true });
    const rows = [...parsed.headers.values()];
    const columns = Object.keys(rows[0]);
    for (let i = 0; i < rows.length; i += 1000) {
      const json = JSON.stringify(rows.slice(i, i + 1000));
      assert.ok(!json.includes("$n41_headers$"));
      const sql = `insert into public.n41_so_headers (user_id,${columns.join(",")}) select (select workspace_id from public.team_members limit 1),${columns.map(c => "x." + c).join(",")} from jsonb_populate_recordset(null::public.n41_so_headers,$n41_headers$${json}$n41_headers$::jsonb) x on conflict (user_id,order_no) do update set ${columns.filter(c => c !== "order_no").map(c => c + "=excluded." + c).join(",")},imported_at=now();`;
      fs.writeFileSync(`${dir}/batch-${String(i / 1000).padStart(3, "0")}.sql`, sql);
    }
  }
}
