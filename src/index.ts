import { chromium, Browser, BrowserContext, Page, Cookie } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';

interface SessionData {
  cookies: Cookie[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
}

class SnoonuAutomation {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isHandlingLogin: boolean = false;
  private sessionFile: string = path.join(__dirname, 'snoonu-session.json');
  private loginCheckInterval: NodeJS.Timeout | null = null;

  constructor(private config = {
    headless: false,
    slowMo: 300,
    phoneNumber: process.env.SNOONU_PHONE || '',
    autoHandleLogin: true,
    checkLoginInterval: 2000 // Check every 2 seconds
  }) {}

  async initialize() {
    console.log('🚀 Initializing Snoonu automation...');
    
    // Launch browser
    this.browser = await chromium.connectOverCDP({
  endpointURL: 'http://localhost:9111',
  
});


    // Create context with saved session if exists
    await this.createContextWithSession();
    
    // Create page
    this.page = await this.context!.newPage();
    
    // Set up login monitoring
    if (this.config.autoHandleLogin) {
      this.setupLoginMonitoring();
    }
    
    // Save session on any navigation
    this.page.on('load', async () => {
      await this.saveSession();
    });

    console.log('✅ Automation initialized');
  }

  private async createContextWithSession() {
    const sessionExists = await this.loadSession();
    
    if (sessionExists) {
      console.log('📂 Loading saved session...');
      const session: SessionData = JSON.parse(await fs.readFile(this.sessionFile, 'utf-8'));
      
      this.context = await this.browser!.newContext({
        // Apply saved cookies
        storageState: {
          cookies: session.cookies,
          origins: [] // We'll restore localStorage manually
        }
      });
      
      console.log('✅ Session restored');
    } else {
      console.log('🆕 Creating new session...');
      this.context = await this.browser!.newContext();
    }
  }

  private async loadSession(): Promise<boolean> {
    try {
      await fs.access(this.sessionFile);
      return true;
    } catch {
      return false;
    }
  }

  private async saveSession() {
    if (!this.context || !this.page) return;
    
    try {
      const cookies = await this.context.cookies();
      
      // Get localStorage and sessionStorage
      const localStorage = await this.page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) items[key] = window.localStorage.getItem(key) || '';
        }
        return items;
      });
      
      const sessionStorage = await this.page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          if (key) items[key] = window.sessionStorage.getItem(key) || '';
        }
        return items;
      });
      
      const sessionData: SessionData = {
        cookies,
        localStorage,
        sessionStorage
      };
      
      await fs.writeFile(this.sessionFile, JSON.stringify(sessionData, null, 2));
      console.log('💾 Session saved');
    } catch (error) {
      console.error('Error saving session:', error);
    }
  }

  private setupLoginMonitoring() {
    console.log('👀 Setting up login prompt monitoring...');
    
    // Monitor for login modal appearance
    this.loginCheckInterval = setInterval(async () => {
      if (this.isHandlingLogin || !this.page) return;
      
      try {
        // Check if login modal is visible
        const loginModal = await this.page.locator('text="Log in to see discounts"').isVisible().catch(() => false);
        
        if (loginModal) {
          console.log('🔐 Login prompt detected!');
          await this.handleLoginFlow();
        }
      } catch (error) {
        // Silent fail - page might be navigating
      }
    }, this.config.checkLoginInterval);
  }

  private async handleLoginFlow() {
    if (this.isHandlingLogin || !this.page) return;
    
    this.isHandlingLogin = true;
    console.log('🔄 Handling login flow...');
    
    try {
      // Step 1: Enter phone number
      console.log('📱 Entering phone number...');
      const phoneInput = this.page.locator('input[placeholder="Mobile Number"]');
      await phoneInput.waitFor({ state: 'visible', timeout: 5000 });
      
      // Get phone number if not configured
      let phoneNumber = this.config.phoneNumber;
      if (!phoneNumber) {
        phoneNumber = await this.promptUser('Enter phone number (without country code): ');
      }
      
      await phoneInput.click();
      await phoneInput.fill(phoneNumber);
      
      // Click continue
      console.log('➡️ Clicking continue...');
      await this.page.click('button:has-text("Continue")');
      
      // Step 2: Handle OTP
      console.log('⏳ Waiting for OTP screen...');
      
      // Wait for OTP inputs to appear
      await this.page.waitForSelector('input[maxlength="1"]', { timeout: 10000 });
      
      // Get OTP from user
      const otp = await this.promptUser('Enter OTP code: ');
      
      // Fill OTP inputs
      console.log('🔢 Entering OTP...');
      const otpInputs = await this.page.locator('input[maxlength="1"]').all();
      
      for (let i = 0; i < otp.length && i < otpInputs.length; i++) {
        await otpInputs[i].fill(otp[i]);
        await this.page.waitForTimeout(100); // Small delay between inputs
      }
      
      // Wait for login to complete
      console.log('⏳ Waiting for login to complete...');
      
      // Wait for modal to disappear
      await this.page.waitForSelector('text="Log in to see discounts"', { 
        state: 'hidden', 
        timeout: 15000 
      });
      
      console.log('✅ Login successful!');
      
      // Save session after successful login
      await this.saveSession();
      
    } catch (error) {
      console.error('❌ Login flow error:', error);
      await this.page.screenshot({ path: 'login-error.png' });
    } finally {
      this.isHandlingLogin = false;
    }
  }

  private promptUser(question: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  async navigateTo(url: string) {
    if (!this.page) throw new Error('Page not initialized');
    
    console.log(`🌐 Navigating to ${url}`);
    await this.page.goto(url, { waitUntil: 'networkidle' });
  }

  async performAction(action: () => Promise<void>) {
    // This method wraps any action and ensures login is handled if needed
    if (!this.page) throw new Error('Page not initialized');
    
    try {
      await action();
    } catch (error) {
      console.error('Action failed:', error);
      // Check if login is needed
      const needsLogin = await this.page.locator('text="Log in to see discounts"').isVisible().catch(() => false);
      if (needsLogin) {
        console.log('Login required for this action');
        await this.handleLoginFlow();
        // Retry the action
        console.log('Retrying action after login...');
        await action();
      } else {
        throw error;
      }
    }
  }

  async searchProduct(query: string) {
    await this.performAction(async () => {
      if (!this.page) return;
      
      console.log(`🔍 Searching for: ${query}`);
      const searchBox = this.page.locator('input[placeholder*="Search"]');
      await searchBox.click();
      await searchBox.fill(query);
      await searchBox.press('Enter');
      await this.page.waitForLoadState('networkidle');
    });
  }

  async addToCart(productSelector: string) {
    await this.performAction(async () => {
      if (!this.page) return;
      
      console.log('🛒 Adding to cart...');
      await this.page.click(productSelector);
      // Add more specific cart logic here
    });
  }

  async clearSession() {
    console.log('🗑️ Clearing saved session...');
    try {
      await fs.unlink(this.sessionFile);
      console.log('✅ Session cleared');
    } catch (error) {
      console.log('No session to clear');
    }
  }

  async cleanup() {
    console.log('🧹 Cleaning up...');
    
    if (this.loginCheckInterval) {
      clearInterval(this.loginCheckInterval);
    }
    
    await this.saveSession();
    
    if (this.browser) {
      await this.browser.close();
    }
    
    console.log('✅ Cleanup complete');
  }

  // Getter for direct page access if needed
  getPage(): Page | null {
    return this.page;
  }
}

// Example usage
async function main() {
  const automation = new SnoonuAutomation({
    headless: false,
    slowMo: 300,
    phoneNumber: process.env.SNOONU_PHONE || '',
    autoHandleLogin: true,
    checkLoginInterval: 2000
  });

  try {
    await automation.initialize();
    
    // Navigate to Snoonu
    await automation.navigateTo('https://snoonu.com');
    
    // Example: Search for a product
    // await automation.searchProduct('coffee');
    
    // Example: Click on restaurants
    // await automation.performAction(async () => {
    //   const page = automation.getPage();
    //   if (page) {
    //     await page.click('text="Restaurants"');
    //   }
    // });
    
    // Keep running (you can perform any actions)
    console.log('🎮 Automation running. Press Ctrl+C to exit.');
    console.log('The login flow will be handled automatically when needed.');
    
    // Keep the script running
    await new Promise(() => {}); // This will run indefinitely
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

// Run if this is the main module
if (require.main === module) {
  main().catch(console.error);
}

// Export for use as a module
export { SnoonuAutomation };
export default SnoonuAutomation;