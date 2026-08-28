/**
 * pwa.test.js — the PWA layer and the mobile-shell rules.
 *
 * The thing most worth protecting here is that the app STILL WORKS as a plain
 * file opened off disk. The PWA layer is additive; if registering a service
 * worker ever throws on file://, the offline build this project is built
 * around is dead on arrival and nothing else in the suite would catch it.
 */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

const html = read("rise-sports.html");
const src = read("app.source.js");
const sw = read("sw.js");
const manifest = JSON.parse(read("manifest.webmanifest"));

let pass = 0, fail = 0;
const check = (name, cond, extra) => cond ? (pass++, console.log("  PASS  " + name))
                                          : (fail++, console.log("  FAIL  " + name + "  " + (extra === undefined ? "" : extra)));

console.log("build integrity");
// the app must be the LAST script block, or build.js splices into the wrong one
const lastOpen = html.lastIndexOf("<script>");
check("app source sits in the last script block", html.indexOf("DEFAULT_SPORT", lastOpen) > lastOpen);
check("shell survived the splice (title)", html.includes("<title>RISE Sports"));
check("shell survived the splice (loading screen)", html.includes('id="loading-screen"'));
check("no literal closing script tag in app source", !/<\/script>/i.test(src));

console.log("\nservice worker registration");
const reg = html.indexOf("navigator.serviceWorker.register");
check("registration is present", reg > -1);
check("registration runs BEFORE the app block", reg > -1 && reg < lastOpen);
// the guard that keeps file:// working
check("registration is guarded by protocol", /https\?:\$?\/.test\(location\.protocol\)|location\.protocol/.test(html.slice(Math.max(0, reg - 400), reg)));
check("guard excludes file://", /\^https\?:\$/.test(html), "expected an ^https?:$ protocol test");
check("registration failure is swallowed", /register\('sw\.js'\)\.catch/.test(html));

console.log("\nmanifest");
check("has a name and short_name", !!manifest.name && !!manifest.short_name);
check("short_name fits a home screen (<=12 chars)", manifest.short_name.length <= 12, manifest.short_name);
check("display is standalone", manifest.display === "standalone");
check("theme_color matches the palette lime", manifest.theme_color === "#65a30d");
check("declares a 192 and a 512 icon", ["192x192", "512x512"].every(s2 => manifest.icons.some(i => i.sizes === s2)));
check("declares a maskable icon", manifest.icons.some(i => i.purpose === "maskable"));
check("every manifest icon file exists", manifest.icons.every(i => fs.existsSync(path.join(root, i.src))),
  manifest.icons.map(i => i.src).join(","));

console.log("\nicons");
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const iconFiles = ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png", "icons/apple-touch-icon.png"];
check("all four icons exist", iconFiles.every(f => fs.existsSync(path.join(root, f))));
const dims = f => {
  const b = fs.readFileSync(path.join(root, f));
  return { sig: b.subarray(0, 8).equals(PNG_SIG), w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
check("all are real PNGs", iconFiles.every(f => dims(f).sig));
check("icon-192 is 192x192", dims("icons/icon-192.png").w === 192 && dims("icons/icon-192.png").h === 192);
check("icon-512 is 512x512", dims("icons/icon-512.png").w === 512);
check("apple-touch-icon is 180x180", dims("icons/apple-touch-icon.png").w === 180);
check("apple-touch-icon is linked (iOS ignores the manifest)", /rel="apple-touch-icon"/.test(html));

console.log("\nservice worker");
check("cache name is build-hashed", /const CACHE = "rise-sports-[0-9a-f]{12}"/.test(sw));
check("skipWaiting so a new build supersedes the old", sw.includes("skipWaiting"));
check("deletes stale caches on activate", sw.includes("caches.delete"));
check("navigations are network-first", /req\.mode === "navigate"/.test(sw) && /\.catch\(\(\) => caches\.match/.test(sw));
// match the CALL, not the word — the source comment explains why addAll is avoided
check("caches entries individually, not addAll", sw.includes("c.add(u).catch") && !/\.addAll\s*\(/.test(sw));
check("ignores non-GET", /req\.method !== "GET"/.test(sw));

console.log("\nmobile shell");
check("bottom nav meets the 44px touch target", /minHeight: 44/.test(src));
check("content clears the nav past the home indicator", /calc\(90px \+ env\(safe-area-inset-bottom/.test(src));
check("nav padding uses the bottom inset", /env\(safe-area-inset-bottom,5px\)/.test(src));
check("shell respects landscape notch insets", /safe-area-inset-left/.test(src) && /safe-area-inset-right/.test(src));
check("viewport meta present", /name="viewport"/.test(html));
// every wide bracket surface must scroll inside its own container
const wide = [...src.matchAll(/minWidth: (?:\w+(?:\.\w+)*(?:\[\w+\])?\.length \* \d+|1[7-9]0|2\d\d)/g)];
check("wide surfaces exist to check", wide.length > 0, wide.length + " found");
check("each wide surface has an overflowX ancestor within 400 chars",
  wide.every(m => src.slice(Math.max(0, m.index - 400), m.index).includes("overflowX")),
  wide.filter(m => !src.slice(Math.max(0, m.index - 400), m.index).includes("overflowX"))
      .map(m => src.slice(m.index, m.index + 40)).join(" | "));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
