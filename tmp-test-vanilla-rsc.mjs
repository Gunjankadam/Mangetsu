const SITE = "https://vanillatranslation.com";
const API = "https://api.vanillatranslation.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: `${SITE}/` },
  });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

function parseRscChunkWithApiResponse(text) {
  // RSC lines are typically: "<id>:<json>".
  // We need the line where payload includes props.API_Response.chapter.images.
  const lines = text.split("\n");
  let debugHits = 0;
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const payload = line.slice(i + 1).trim();
    if (!payload.startsWith("[") && !payload.startsWith("{")) continue;
    if (!payload.includes("API_Response")) continue;
    if (debugHits < 3) {
      console.log("debug line", line.slice(0, 220));
      debugHits++;
    }
    try {
      const node = JSON.parse(payload);
      const stack = [node];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== "object") continue;
        if (cur.props?.API_Response?.chapter?.images) {
          return cur.props.API_Response;
        }
        if (Array.isArray(cur)) {
          for (const v of cur) stack.push(v);
        } else {
          for (const v of Object.values(cur)) stack.push(v);
        }
      }
    } catch {
      // ignore malformed/non-json lines
    }
  }
  return null;
}

async function main() {
  const knownUrl =
    "https://vanillatranslation.com/series/after-becoming-a-dumpling-the-villain-family-wants-to-kill-me/chapter-39?_rsc=1x5f7";
  const knownRes = await fetch(knownUrl, {
    headers: { "User-Agent": UA, Referer: `${SITE}/`, RSC: "1", Accept: "text/x-component" },
  });
  const knownText = await knownRes.text();
  console.log("known status", knownRes.status, "len", knownText.length);
  console.log("known has images literal", knownText.includes("\"images\":[{"));
  console.log("known has media.ezmanga", knownText.includes("media.ezmanga.org"));
  const kIdx = knownText.indexOf("media.ezmanga.org");
  if (kIdx !== -1) {
    console.log("known snippet", knownText.slice(Math.max(0, kIdx - 100), kIdx + 180));
  }

  const query = await fetchJson(`${API}/api/query?page=1&perPage=1&searchTerm=`);
  const post = query.posts?.[0];
  if (!post) throw new Error("No posts");
  const chData = await fetchJson(
    `${API}/api/chapters?postId=${post.id}&skip=0&take=200&order=desc&userid=`,
  );
  const chapters = chData.post?.chapters ?? [];
  const chapter = chapters.find((c) => c?.isAccessible) ?? chapters[chapters.length - 1];
  if (!chapter) throw new Error("No chapter");

  const chapterUrl = `${SITE}/series/${post.slug}/${chapter.slug}`;
  const r = await fetch(`${chapterUrl}?_rsc=1`, {
    headers: {
      "User-Agent": UA,
      Referer: `${SITE}/`,
      RSC: "1",
      Accept: "text/x-component",
    },
  });
  const text = await r.text();
  console.log("has chapter.images literal", text.includes("\"images\":[{"));
  console.log("has media.ezmanga", text.includes("media.ezmanga.org"));
  const mediaIdx = text.indexOf("media.ezmanga.org");
  if (mediaIdx !== -1) {
    console.log("media snippet", text.slice(Math.max(0, mediaIdx - 120), mediaIdx + 180));
  }
  const apiResp = parseRscChunkWithApiResponse(text);
  const images = apiResp?.chapter?.images ?? [];

  console.log("chapterUrl", chapterUrl);
  console.log("rsc status", r.status, "content-type", r.headers.get("content-type"));
  console.log("images extracted", images.length);
  console.log("first image", images[0]?.url ?? null);
}

await main();

