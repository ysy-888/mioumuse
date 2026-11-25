const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const shell = fs.readFileSync("index.html", "utf8").split('<table id="stylesTable"')[1].split("</thead>")[0];
const allHeaders = [...shell.matchAll(/<th\b[^>]*data-col="([^"]+)"[^>]*>([\s\S]*?)<\/th>/g)].map(m => ({
  dataset: { col: m[1] }, textContent: m[2].replace(/<[^>]+>/g, "").replace(/&#10;/g, " ").trim(), querySelector: () => null,
}));
let headers = allHeaders, hidden = [], captured = "", messages = [];
const figures = ["oh", "wip", "oo", "ats", "receivedQty", "invQty"].map((col, i) => ({ col, label: ["OH", "WIP", "OO", "ATS", "Received", "Invoiced"][i] }));
const rows = Array.from({length:20}, (_,i) => ({ styleNo:`T${1000+i}`,color:i%2?'BLACK/IVORY':'DUSTY ROSE',description:'Cotton blend embroidered long sleeve blouse',notes:'Review sample and confirm availability before the next shoot.',category:'TOPS',season:'SPRING 27',show:'1',status:'ACTIVE',availableDate:'2027-02',ihd:'2027-02-17',magentoQty:99,magentoAts:87 }));
const dataColumns = Object.fromEntries(['styleNo','color','description','notes','category','season','show','status','magentoQty','magentoAts'].map(col=>[col,{value:s=>s[col],numeric:col.startsWith('magento')} ]));
const image = 'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="64"><rect width="50" height="64" fill="#f2eded"/><path d="M15 9L4 22l8 8 4-5v30h19V25l4 5 8-8L35 9l-10 5z" fill="#a7b9ae"/></svg>').toString('base64');
const ctx = {
  filteredStyles: rows, STYLE_QTY_FIGURES: figures, STYLE_COLUMNS: dataColumns, APP_NAME:'MIOU MUSE', EMPTY_DISPLAY:'—',
  document: { querySelectorAll:()=>headers, querySelector:()=>headers.some(h=>h.dataset.col==='image')?{}:null, getElementById:()=>({value:'cotton'}) },
  getTableView:()=>({hidden}), reportHasPhotos:()=>true, completeStyleSetBlocks:rs=>rs.map(r=>[r]),
  styleImageState:'ready', samplePhotoState:'ready', describeShootStatus:()=>({label:'Need to Shoot'}),
  styleQtyFigures:()=>figures.map(f=>({...f,text:'12'})),
  createStyleMgStatusCell:()=>({outerHTML:'<span class="mg-avail-pill is-yes">Available</span>'}),
  formatAvailableMonth:()=> 'FEB',ihdSortValue:s=>s.ihd,shootStatusText:()=> 'Need to Shoot',todayYmd:()=> '2026-11-24',
  styleShowDeleted:false,styleNoPhotosOnly:false,styleAtsAvailableOnly:false,styleAtsUnavailableOnly:false,styleMagentoNoPhotoOnly:false,
  columnFilters:new Map(),showIndicator:msg=>messages.push(msg),
  escapeReportHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
};
vm.createContext(ctx); vm.runInContext(fs.readFileSync('js/exports.js','utf8'),ctx);
ctx.loadReportThumbs=async rs=>rs.map(()=>image);
ctx.printHtml=async html=>{captured=html;};
(async()=>{
  await ctx.exportStylesPdf();
  assert.match(captured, /size: letter portrait/); assert.doesNotMatch(captured,/size: letter landscape/);
  assert.match(captured,/20 styles/); assert.match(captured,/T1019/);assert.match(captured,/QTY \(M\)/);
  assert.match(captured,/<th class="numeric">OH<\/th>/);assert.match(captured,/<th class="numeric">QTY \(M\)<\/th>/);
  assert.match(captured,/th\.numeric, td\.numeric \{ text-align: center/);assert.match(captured,/data:image\/svg/);
  fs.mkdirSync('.local-tools/style-pdf-preview',{recursive:true});
  fs.writeFileSync('.local-tools/style-pdf-preview/full.html',captured);
  headers=['notes','styleNo','qtys','magentoAts'].map(col=>allHeaders.find(h=>h.dataset.col===col));
  hidden=['qtys.oh','qtys.wip','qtys.oo','qtys.receivedQty','qtys.invQty'];
  ctx.filteredStyles=[rows[1]];
  await ctx.exportStylesPdf();
  const printedHeaders=[...captured.matchAll(/<th class="[^"]*">([^<]*)<\/th>/g)].map(m=>m[1]);
  assert.deepEqual(printedHeaders,['Notes','Style #','ATS','ATS (M)']);
  assert.match(captured,/T1001/);assert.doesNotMatch(captured,/T1000/);assert.doesNotMatch(captured,/<img/);
  fs.writeFileSync('.local-tools/style-pdf-preview/filtered.html',captured);
  captured='';ctx.filteredStyles=[];await ctx.exportStylesPdf();assert.equal(captured,'');assert.match(messages.at(-1),/No styles match/);
  console.log('Passed portrait, all filtered rows, visible column order, N41 subcolumns, photos and empty-result export checks.');
})().catch(e=>{console.error(messages);console.error(e);process.exitCode=1;});
