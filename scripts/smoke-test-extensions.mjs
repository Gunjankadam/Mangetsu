const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function report(label, url, init = {}) {
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA, ...init.headers },
      ...init,
    });
    const ct = r.headers.get("content-type") || "";
    let extra = "";
    if (ct.includes("text/html") || ct.includes("json")) {
      const t = await r.text();
      extra = t.slice(0, 100).replace(/\s+/g, " ");
    }
    console.log(`${label}: ${r.status} ${ct.split(";")[0]}`);
    if (extra) console.log(`  preview: ${extra}${extra.length >= 100 ? "..." : ""}`);
  } catch (e) {
    console.log(`${label}: ERROR ${e.cause?.message || e.message}`);
  }
}

console.log("--- EpicManga (Madara: https://epicmanga.co) ---");
await report("Home", "https://epicmanga.co/");
await report("Madara ajax", "https://epicmanga.co/wp-admin/admin-ajax.php", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "action=madara_load_more&page=1&template=madara-core/content/content-archive",
});

console.log("\n--- Flame Comics (Next.js) ---");
await report("Home HTML", "https://flamecomics.xyz/");
let buildId = "";
try {
  const r = await fetch("https://flamecomics.xyz/", { headers: { "User-Agent": UA } });
  const html = await r.text();
  const m = html.match(/"buildId":"([^"]+)"/);
  if (m) buildId = m[1];
  console.log("Extracted buildId:", buildId || "(not found)");
  if (buildId) {
    const dataUrl = `https://flamecomics.xyz/_next/data/${buildId}/index.json`;
    await report("Next data index.json", dataUrl);
  }
} catch (e) {
  console.log("Flame parse error:", e.message);
}

console.log("\n--- Komga ---");
console.log("Extension uses user-configured base URL + auth (not a single public site).");
console.log("Typical API: GET {base}/api/v2/libraries");
await report("Komga.org", "https://komga.org/");
