import { chromium } from "playwright";

// Start browser server
const browserServer = await chromium.launchServer({
  port: 3000,
  headless: true
});
console.log(browserServer.wsEndpoint());
// Outputs: ws://localhost:3000/abc123