import { chromium } from "playwright";
import * as readline from "readline";

async function main() {
  console.log("🔌 Connecting to running browser...");
  const browser = await chromium.connectOverCDP({
    endpointURL: "http://127.0.0.1:9111",
  });

  const contexts = browser.contexts();
  let context = contexts[0];
  if (!context) {
    context = await browser.newContext();
  }

  const pages = context.pages();
  let page = pages[0];
  if (!page) {
    page = await context.newPage();
  }

  console.log("✅ Connected to page:", page.url());
  console.log("👉 Type CSS/XPath/text selectors to inspect locators");
  console.log("👉 Prefix with `:` to run JS inside page (e.g. `:document.title`)");
  console.log("👉 Type `exit` to quit");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "REPL> ",
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const cmd = line.trim();
    if (cmd === "exit") {
      rl.close();
      return;
    }
    if (!cmd) {
      rl.prompt();
      return;
    }

    try {
      if (cmd.startsWith(":")) {
        // Run arbitrary JS in the page
        const expr = cmd.slice(1);
        const result = await page.evaluate((code) => {
          // eslint-disable-next-line no-eval
          return eval(code);
        }, expr);
        console.log("🟢 JS result:", result);
      } else {
        // Treat as locator
        const locator = page.locator(cmd);
        const count = await locator.count();
        if (count === 0) {
          console.log("❌ No matches");
        } else {
          for (let i = 0; i < count; i++) {
            const text = await locator.nth(i).innerText().catch(() => null);
            console.log(`[${i}] ${text}`);
          }
        }
      }
    } catch (err) {
      console.error("Error:", err);
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    console.log("👋 Exiting REPL...");
    await browser.close();
    process.exit(0);
  });
}

main().catch(console.error);
