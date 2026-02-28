const url = Bun.argv[2];
const optionsStr = Bun.argv[3]; // optional JSON string for fetch options

if (!url) {
  console.error("Usage: bun run fetch.ts <url> [optionsJSON]");
  process.exit(1);
}

let options = {};
if (optionsStr) {
  try {
    options = JSON.parse(optionsStr);
  } catch (err) {
    console.error("Error parsing options JSON:", err);
    process.exit(1);
  }
}

try {
  const response = await fetch(url, options);
  
  const text = await response.text();
  
  if (!response.ok) {
    console.error(`HTTP Request failed with status ${response.status}: ${response.statusText}`);
    console.error(text);
    process.exit(1);
  }

  // Check if it's JSON to pretty-print or just print raw text
  try {
    const json = JSON.parse(text);
    console.log(JSON.stringify(json, null, 2));
  } catch {
    console.log(text);
  }

} catch (err) {
  console.error("Network or fetch error:", err);
  process.exit(1);
}

export {};
