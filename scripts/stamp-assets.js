/**
 * Cache-bust every local asset reference in index.html.
 *
 * GitHub Pages serves js/css with `Cache-Control: max-age=600` and no content
 * hash in the filename, so a browser will keep running an old copy against
 * new HTML — which silently produces a half-updated app. Stamping each
 * reference with a build version makes the URL change whenever we deploy.
 *
 * Run before every commit that touches js/ or crm.css:
 *   node scripts/stamp-assets.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INDEX = path.join(ROOT, "index.html");

/** UTC minute stamp, e.g. 20260818-0612. */
function buildStamp() {
  const now = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
         `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
}

const stamp = process.argv[2] || buildStamp();
let html = fs.readFileSync(INDEX, "utf8");
let count = 0;

// Local .js and .css only — leave any absolute URLs alone.
html = html.replace(
  /(\s(?:src|href)=")((?:js\/[\w.-]+|[\w.-]+)\.(?:js|css))(?:\?v=[^"]*)?(")/g,
  (_match, before, file, after) => {
    count += 1;
    return `${before}${file}?v=${stamp}${after}`;
  }
);

fs.writeFileSync(INDEX, html);
console.log(`Stamped ${count} asset references with v=${stamp}`);
