
import { Logger } from '../../../src/utils/logger'

const logger = new Logger('Skill:WebSearch')

const apiKey = Bun.env.BRAVE_SEARCH_API_KEY;

if (!apiKey) {
  logger.error("Error: Environment variable BRAVE_SEARCH_API_KEY is not set.");
  process.exit(1);
}

const query = Bun.argv[2];

if (!query) {
  logger.error("Usage: bun run search.ts <query>");
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
    logger.info("No results found.");
    process.exit(0);
  }

  logger.info(`# Search Results for "${query}"\n`);
  
  results.forEach((result: any, index: number) => {
    logger.info(`### ${index + 1}. [${result.title}](${result.url})`);
    if (result.description) {
      logger.info(`> ${result.description}\n`);
    } else {
      logger.info("\n");
    }
  });

} catch (error) {
  logger.error("An error occurred during the search:", error);
  process.exit(1);
}

export {};
