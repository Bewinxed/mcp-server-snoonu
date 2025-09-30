// dev.ts
import type { Page } from "playwright";
import { SnoonuAutomation } from "./src/index.ts";

import * as repl from "repl";

// src/dev/locator-explorer.ts
export class LocatorExplorer {
	page!: Page;
	constructor(page: Page) {
		this.page = page;
	}

	async explore(selector: string) {
		const locator = this.page.locator(selector);
		const count = await locator.count();

		console.log(`\n🔍 Exploring: ${selector}`);
		console.log(`   Count: ${count}`);

		for (let i = 0; i < Math.min(count, 5); i++) {
			const element = locator.nth(i);
			const text = await element.textContent().catch(() => null);
			const visible = await element.isVisible().catch(() => false);
			const attrs = await element.evaluate((el) => ({
				id: el.id,
				className: el.className,
				tagName: el.tagName,
			}));

			console.log(`\n   [${i}]:`);
			console.log(`      Text: ${text?.slice(0, 50)}`);
			console.log(`      Visible: ${visible}`);
			console.log(`      Attributes:`, attrs);
		}

		// Highlight in browser
		await this.page.evaluate((sel) => {
			document.querySelectorAll(sel).forEach((el) => {
				(el as HTMLElement).style.outline = "3px solid red";
			});
		}, selector);
	}

	async clearHighlights() {
		await this.page.evaluate(() => {
			document.querySelectorAll("*").forEach((el) => {
				(el as HTMLElement).style.outline = "";
			});
		});
	}
}

// Usage in REPL:
// const explorer = new LocatorExplorer(page);
// await explorer.explore('.modal button');

async function main() {
	console.log("🚀 Starting Snoonu Dev Environment...\n");

	const automation = new SnoonuAutomation();
	await automation.initialize();
	const page = automation.getPage()!;
	await automation.navigateTo("https://snoonu.com");

	const explorer = new LocatorExplorer(page);

	const replServer = repl.start({
		prompt: "🔧 snoonu> ",
		useColors: true,
	});

	// Expose everything
	const helpers = {
		automation,
		page,
		explorer,

		// Selector helpers
		$: (selector: string) => page.locator(selector),
		$$: async (selector: string) => page.locator(selector).all(),

		// Action helpers
		click: async (selector: string) => page.locator(selector).click(),

		fill: async (selector: string, value: string) =>
			page.locator(selector).fill(value),

		getText: async (selector: string) =>
			page.locator(selector).textContent(),

		// Debug helpers
		screenshot: async (name: string = "test.png") => {
			await page.screenshot({ path: name });
			console.log(`📸 Screenshot saved: ${name}`);
		},

		goto: async (url: string) => page.goto(url),

		waitFor: async (selector: string, timeout: number = 5000) =>
			page.locator(selector).waitFor({ timeout }),

		// Highlight helper
		highlight: async (selector: string) => {
			await page.evaluate((sel) => {
				document.querySelectorAll(sel).forEach((el) => {
					(el as HTMLElement).style.outline = "3px solid red";
				});
			}, selector);
			console.log(`✨ Highlighted: ${selector}`);
		},

		unhighlight: async () => {
			await page.evaluate(() => {
				document.querySelectorAll("*").forEach((el) => {
					(el as HTMLElement).style.outline = "";
				});
			});
			console.log("✨ Highlights cleared");
		},
	};

	Object.assign(replServer.context, helpers);

	console.log(`
📚 Available Commands:
   
   Core:
   - automation          Main automation instance
   - page               Playwright page object
   - explorer           Locator explorer
   
   Selectors:
   - $(selector)        Get a locator
   - $$(selector)       Get all locators (returns promise)
   
   Actions:
   - click(selector)
   - fill(selector, value)
   - getText(selector)
   - goto(url)
   - waitFor(selector, timeout?)
   
   Debug:
   - screenshot(name?)
   - highlight(selector)
   - unhighlight()
   - explorer.explore(selector)
   
💡 Examples:
   await $('button').count()
   await click('.search-button')
   await getText('h1')
   await screenshot('debug.png')
   await explorer.explore('[class*="SearchResults"]')
   await highlight('.modal')
  `);
}

main();
