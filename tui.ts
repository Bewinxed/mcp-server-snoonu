import {
	createCliRenderer,
	BoxRenderable,
	TextRenderable,
	InputRenderable,
	ScrollBoxRenderable,
	type CliRenderer,
} from "@opentui/core";
import { SnoonuAutomation } from "./src/index.js";

interface ShoppingCommand {
	command: string;
	description: string;
	action: (agent: SnoonuAutomation, args: string) => Promise<void>;
}

class SnoonuTUI {
	private renderer!: CliRenderer;
	private agent: SnoonuAutomation;
	private statusText!: TextRenderable;
	private commandInput!: InputRenderable;
	private resultsBox!: ScrollBoxRenderable;
	private resultsContent!: TextRenderable;
	private isRunning: boolean = true;

	private commands: ShoppingCommand[] = [
		{
			command: "search",
			description: "Search for products (e.g., 'search coffee')",
			action: async (agent, args) => {
				if (!args) {
					this.updateResults(
						"Please specify what to search for\nExample: search coffee"
					);
					return;
				}
				await agent.searchProduct(args);
				this.updateResults(
					`Searching for: ${args}\nCheck browser window for results`
				);
			},
		},
		{
			command: "restaurants",
			description: "Browse restaurants",
			action: async (agent) => {
				const page = agent.getPage();
				if (page) {
					await page.click('text="Restaurants"');
					await page.waitForLoadState("networkidle");
					this.updateResults("Navigated to Restaurants section");
				}
			},
		},
		{
			command: "groceries",
			description: "Browse groceries",
			action: async (agent) => {
				const page = agent.getPage();
				if (page) {
					await page.click('text="Groceries"');
					await page.waitForLoadState("networkidle");
					this.updateResults("Navigated to Groceries section");
				}
			},
		},
		{
			command: "cart",
			description: "View shopping cart",
			action: async (agent) => {
				const page = agent.getPage();
				if (page) {
					await page.goto("https://snoonu.com/cart");
					this.updateResults("Navigated to Shopping Cart");
				}
			},
		},
		{
			command: "profile",
			description: "View profile",
			action: async (agent) => {
				const page = agent.getPage();
				if (page) {
					await page.goto("https://snoonu.com/en/profile");
					this.updateResults("Navigated to Profile page");
				}
			},
		},
		{
			command: "status",
			description: "Check login status",
			action: async (agent) => {
				const isLoggedIn = await agent.isLoggedIn();
				this.updateResults(
					`Status: ${
						isLoggedIn ? "✅ Logged in" : "❌ Not logged in"
					}`
				);
			},
		},
		{
			command: "verify",
			description: "Verify session validity",
			action: async (agent) => {
				const isValid = await agent.verifySession();
				this.updateResults(
					`Session: ${isValid ? "✅ Valid" : "❌ Invalid or expired"}`
				);
			},
		},
		{
			command: "clear",
			description: "Clear saved session",
			action: async (agent) => {
				await agent.clearSession();
				this.updateResults(
					"Session cleared. You will need to log in again."
				);
			},
		},
		{
			command: "help",
			description: "Show available commands",
			action: async () => {
				this.showHelp();
			},
		},
		{
			command: "quit",
			description: "Exit the application",
			action: async () => {
				this.isRunning = false;
			},
		},
	];

	constructor() {
		this.agent = new SnoonuAutomation();
	}

	private async setupUI() {
		this.renderer = await createCliRenderer({
			exitOnCtrlC: false,
			useMouse: true,
			useAlternateScreen: true,
		});

		// Main container box
		const mainBox = new BoxRenderable(this.renderer, {
			id: "main",
			width: process.stdout.columns || 80,
			height: process.stdout.rows || 24,
			border: true,
			borderStyle: "single",
			title: "🛒 Snoonu Shopping Agent TUI",
			titleAlignment: "center",
			backgroundColor: "#1a1a1a",
		});

		// Position main box at root
		mainBox.x = 0;
		mainBox.y = 0;

		// Status text
		this.statusText = new TextRenderable(this.renderer, {
			id: "status",
			content: "Status: Initializing...",
			fg: "yellow",
		});
		this.statusText.x = 2;
		this.statusText.y = 2;

		// Command prompt label
		const commandLabel = new TextRenderable(this.renderer, {
			id: "command-label",
			content: "Command:",
			fg: "white",
		});
		commandLabel.x = 2;
		commandLabel.y = 4;

		// Command input field
		this.commandInput = new InputRenderable(this.renderer, {
			id: "command-input",
			width: 60,
			height: 1,
			placeholder: "Type a command (e.g., 'search coffee' or 'help')",
			backgroundColor: "#2a2a2a",
			textColor: "white",
			focusedBackgroundColor: "#3a3a3a",
			focusedTextColor: "cyan",
			placeholderColor: "#666666",
		});
		this.commandInput.x = 11;
		this.commandInput.y = 4;

		// Results area container
		this.resultsBox = new ScrollBoxRenderable(this.renderer, {
			id: "results",
			width: (process.stdout.columns || 80) - 4,
			height: (process.stdout.rows || 24) - 11,
			border: true,
			borderStyle: "single",
			title: "Results",
			titleAlignment: "left",
			scrollY: true,
			scrollX: false,
			viewportOptions: {
				backgroundColor: "#1a1a1a",
			},
		});
		this.resultsBox.x = 2;
		this.resultsBox.y = 7;

		// Results content text
		this.resultsContent = new TextRenderable(this.renderer, {
			id: "results-content",
			content:
				"Welcome to Snoonu Shopping Agent!\nType 'help' to see available commands.",
			wrap: true,
			wrapMode: "word",
			fg: "white",
		});
		this.resultsContent.x = 0;
		this.resultsContent.y = 0;

		// Help text at bottom
		const helpText = new TextRenderable(this.renderer, {
			id: "help",
			content: "Ctrl+C to quit | Enter to submit command",
			fg: "#666666",
		});
		helpText.x = 2;
		helpText.y = (process.stdout.rows || 24) - 2;

		// Add all elements to renderer
		this.renderer.root.add(mainBox);
		mainBox.add(this.statusText);
		mainBox.add(commandLabel);
		mainBox.add(this.commandInput);
		mainBox.add(this.resultsBox);
		this.resultsBox.add(this.resultsContent);
		mainBox.add(helpText);

		// Setup input handling
		this.setupInputHandling();

		// Focus on input
		this.commandInput.focus();
	}

	private setupInputHandling() {
		// Handle command input submission
		this.commandInput.on("enter", async () => {
			const value = this.commandInput.value;
			if (value.trim()) {
				await this.processCommand(value);
				this.commandInput.value = "";
			}
		});

		// Handle global keyboard shortcuts
		this.renderer.on("keypress", (key: any) => {
			// Check for Ctrl+C
			if (key && key.ctrl && key.name === "c") {
				this.isRunning = false;
			}
			// Check for quit commands
			if (
				key &&
				(key.name === "q" || key.name === "Q") &&
				!this.commandInput.focused
			) {
				this.isRunning = false;
			}
		});

		// Keep input focused
		this.renderer.on("blur", () => {
			setTimeout(() => {
				if (this.commandInput && !this.commandInput.isDestroyed) {
					this.commandInput.focus();
				}
			}, 100);
		});
	}

	private showHelp() {
		let helpContent = "📋 Available Commands:\n\n";
		this.commands.forEach((cmd) => {
			helpContent += `  ${cmd.command.padEnd(15)} - ${cmd.description}\n`;
		});
		helpContent += "\n💡 Tips:\n";
		helpContent += "  • Commands are case-insensitive\n";
		helpContent += "  • The browser window will open separately\n";
		helpContent += "  • Login will be handled automatically when needed\n";
		helpContent += "  • Your session is saved between runs\n";

		this.updateResults(helpContent);
	}

	private updateStatus(message: string, color: string = "yellow") {
		if (this.statusText && !this.statusText.isDestroyed) {
			this.statusText.content = `Status: ${message}`;
			this.statusText.fg = color;
		}
	}

	private updateResults(content: string) {
		if (this.resultsContent && !this.resultsContent.isDestroyed) {
			this.resultsContent.content = content;

			// Auto-scroll to bottom if content is longer than viewport
			if (this.resultsBox && !this.resultsBox.isDestroyed) {
				// Scroll to bottom to show latest content
				const contentHeight = this.resultsContent.height || 0;
				const viewportHeight = this.resultsBox.height || 0;
				if (contentHeight > viewportHeight) {
					this.resultsBox.scrollTop = contentHeight - viewportHeight;
				}
			}
		}
	}

	private async processCommand(input: string) {
		const parts = input.trim().split(" ");
		const commandName = parts[0].toLowerCase();
		const args = parts.slice(1).join(" ");

		const command = this.commands.find(
			(cmd) => cmd.command === commandName
		);

		if (command) {
			try {
				this.updateStatus(`Executing: ${commandName}...`, "yellow");
				await command.action(this.agent, args);
				this.updateStatus(`Completed: ${commandName}`, "green");
			} catch (error: any) {
				this.updateStatus(`Error: ${error.message}`, "red");
				this.updateResults(
					`❌ Error executing command:\n${error.message}\n\nPlease try again or type 'help' for available commands.`
				);
			}
		} else {
			this.updateStatus(`Unknown command: ${commandName}`, "red");
			this.updateResults(
				`❌ Unknown command: ${commandName}\n\nType 'help' for available commands.`
			);
		}
	}

	async start() {
		console.log("🚀 Starting Snoonu TUI...");

		// Setup UI
		await this.setupUI();

		// Initialize the browser automation
		this.updateStatus("Initializing browser automation...", "yellow");

		try {
			await this.agent.initialize();
			await this.agent.navigateTo("https://snoonu.com");

			const isLoggedIn = await this.agent.isLoggedIn();
			this.updateStatus(
				isLoggedIn
					? "Ready - Logged in ✅"
					: "Ready - Not logged in ⚠️",
				isLoggedIn ? "green" : "yellow"
			);

			// Show initial help
			this.showHelp();
		} catch (error: any) {
			this.updateStatus(`Initialization error: ${error.message}`, "red");
			this.updateResults(
				`❌ Failed to initialize browser automation:\n${error.message}\n\n⚠️ Make sure Chrome is running with remote debugging on port 9111\n\nTo start Chrome with debugging:\nchrome --remote-debugging-port=9111`
			);
		}

		// Main render loop
		const renderLoop = () => {
			if (
				!this.isRunning ||
				!this.renderer ||
				this.renderer.isDestroyed
			) {
				return;
			}

			// Request render
			this.renderer.requestRender();

			// Continue loop
			setImmediate(renderLoop);
		};

		// Start render loop
		renderLoop();

		// Wait for exit
		while (this.isRunning) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		// Cleanup
		await this.cleanup();
	}

	private async cleanup() {
		this.updateStatus("Shutting down...", "yellow");

		// Save session before exiting
		try {
			await this.agent.cleanup();
		} catch (error) {
			console.error("Error during agent cleanup:", error);
		}

		// Destroy renderer
		if (this.renderer && !this.renderer.isDestroyed) {
			this.renderer.destroy();
		}

		process.exit(0);
	}
}

// Main entry point
async function main() {
	const tui = new SnoonuTUI();

	// Handle graceful shutdown
	process.on("SIGINT", async () => {
		console.log("\n👋 Shutting down gracefully...");
		await tui["cleanup"]();
	});

	process.on("uncaughtException", (error) => {
		console.error("Uncaught exception:", error);
		process.exit(1);
	});

	process.on("unhandledRejection", (error) => {
		console.error("Unhandled rejection:", error);
		process.exit(1);
	});

	await tui.start();
}

// Run the TUI
main().catch(console.error);
