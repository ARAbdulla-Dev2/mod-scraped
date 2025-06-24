const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const SEARCH_FILE_URL = "https://raw.githubusercontent.com/ARAbdulla-Dev2/hard.db/refs/heads/main/search.txt";
const CACHE_FILE_PATH = path.join(__dirname, "cache.json");
let cache = {};

// Initialize cache
if (fs.existsSync(CACHE_FILE_PATH)) {
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, "utf8"));
  } catch (e) {
    console.error("❌ Failed to parse cache.json:", e.message);
  }
}

function saveCache() {
  fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cache, null, 2));
}

async function loadSearchEntries() {
  try {
    const response = await axios.get(SEARCH_FILE_URL);
    return response.data
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((entry) => {
        const [title, category] = entry.split("-").map((s) => s.trim());
        return { title, category };
      });
  } catch (e) {
    console.error("❌ Could not load search.txt from GitHub:", e.message);
    return [];
  }
}

async function fetchProject(category, query, force = false) {
  const url = `https://modrinth.com/${category}?q=${encodeURIComponent(query)}`;
  try {
    const { data } = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(data);
    const results = [];

    $("article.project-card").each((i, el) => {
      const element = $(el);
      const title = element.find(".title .name").text().trim();
      const link = "https://modrinth.com" + element.find("a[href]").attr("href");
      const icon = element.find("img[alt][src]").first().attr("src");
      const description = element.find(".description").text().trim();
      const author = element.find(".author a").text().trim();
      const downloads = element.find(".stat strong").first().text().trim();
      const followers = element.find(".stat").eq(1).find("strong").text().trim();
      const updated = element.find(".stat.date").text().replace("Updated", "").trim();

      results.push({
        title,
        link,
        icon,
        description,
        author,
        category,
        downloads,
        followers,
        updated,
      });
    });

    return results;
  } catch (err) {
    console.error(`❌ Error scraping ${url}:`, err.message);
    return [];
  }
}

app.get("/api", async (req, res) => {
  const query = req.query.search?.trim();
  const category = req.query.category?.trim();
  const force = req.query.force === "true";

  if (!query || !category) {
    return res.status(400).json({ error: "Missing ?search= and/or ?category=" });
  }

  const fullKey = `${query.toLowerCase()}-${category.toLowerCase()}`;

  // Serve from cache if available and not forcing refresh
  if (cache[fullKey] && !force) {
    return res.json(cache[fullKey]);
  }

  // Scrape the site
  const results = await fetchProject(category, query, force);

  // Load allowed list from search.txt
  const allowedEntries = new Set(
    (await loadSearchEntries()).map((e) => `${e.title.toLowerCase()}-${e.category.toLowerCase()}`)
  );

  // Filter only if title-category combo exists in txt
  const matched = results.filter((item) =>
    allowedEntries.has(`${item.title.toLowerCase()}-${item.category.toLowerCase()}`)
  );

  // Save to cache
  if (matched.length) {
    cache[fullKey] = matched;
    saveCache();
  }

  res.json(matched);
});

app.get("/api/all", async (req, res) => {
  const force = req.query.force === "true";
  const entries = await loadSearchEntries();
  const allResults = [];

  for (const { title, category } of entries) {
    const cacheKey = `${title.toLowerCase()}-${category}`;

    if (cache[cacheKey] && !force) {
      allResults.push(...cache[cacheKey]);
      continue;
    }

    const results = await fetchProject(category, title, force);
    const matched = results.filter((r) => r.title.toLowerCase() === title.toLowerCase());

    if (matched.length) {
      cache[cacheKey] = matched;
      saveCache();
      allResults.push(...matched);
    }

    await new Promise((r) => setTimeout(r, 1000)); // throttle
  }

  res.json(allResults);
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);