
const apiKey = Bun.env.BRAVE_SEARCH_API_KEY;

if (!apiKey) {
  console.error("Error: Environment variable BRAVE_SEARCH_API_KEY is not set.");
  process.exit(1);
}

const query = Bun.argv[2];

if (!query) {
  console.error("Usage: bun run search.ts <query>");
  process.exit(1);
}

const SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

try {
  const response = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(query)}&count=5`, {
    headers: {
      "Accept": "application/json",
      "X-Subscription-Token": apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Brave Search API request failed with status ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const results = data.web?.results;

  if (!results || results.length === 0) {
    console.log("No results found.");
    process.exit(0);
  }

  console.log(`# Search Results for "${query}"\n`);
  
  results.forEach((result: any, index: number) => {
    console.log(`### ${index + 1}. [${result.title}](${result.url})`);
    if (result.description) {
      console.log(`> ${result.description}\n`);
    } else {
      console.log("\n");
    }
  });

} catch (error) {
  console.error("An error occurred during the search:", error);
  process.exit(1);
}

export {};
