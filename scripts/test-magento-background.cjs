const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const source = fs.readFileSync("js/magento-n41.js", "utf8");
async function check(fail) {
  let release;
  const notifications = [], requests = [];
  const pending = new Promise(resolve => { release = resolve; });
  const ctx = {
    confirm: () => true,
    notify: n => notifications.push(n),
    syncMgN41FlaggedButton: () => {},
    setAppLoading: () => { throw new Error("Background processing must never show the blocking overlay"); },
    callMagento: async (action, params) => { requests.push({action, params}); await pending; if(fail) throw new Error('Network failed'); return {results: params.ids.map(id => ({id,ok:true}))}; },
    describeMgReconcileResults: r => `Processed ${r.length}`,
    loadMgOpenOrders: async () => {},
    getCurrentAppView: () => 'styles',
    loadMgSales: () => { throw new Error("Must not redraw another page"); },
  };
  vm.createContext(ctx);
  vm.runInContext("let mgReconcileProgress=''; const mgOrderSelected=new Map();", ctx);
  vm.runInContext(source.match(/async function reconcileMgClosedOrders\([\s\S]*?\n\}/)[0], ctx);
  const work = ctx.reconcileMgClosedOrders(Array.from({length:7},(_,i)=>({id:i})));
  assert.equal(notifications.length,1); assert.match(notifications[0].msg,/background/);
  assert.equal(vm.runInContext('mgReconcileProgress',ctx),'Processing 0 / 7');
  release(); await work;
  assert.equal(requests.length,fail?1:2);
  assert.equal(notifications.at(-1).category,'orders');
  assert.equal(notifications.at(-1).type,fail?'error':'success');
  assert.equal(vm.runInContext('mgReconcileProgress',ctx),'');
}
(async()=>{await check(false);await check(true);console.log('Passed nonblocking progress, cross-page completion and failure notification checks.');})().catch(e=>{console.error(e);process.exitCode=1;});
