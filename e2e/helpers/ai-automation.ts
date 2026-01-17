/**
 * AI/LLM Automation Helpers
 *
 * This module provides utilities specifically designed for AI-driven test automation.
 * It focuses on:
 * - Structured output for AI analysis
 * - Detailed state capture
 * - Semantic page understanding
 * - Action recommendations
 */
import { Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Page state capture for AI analysis
 */
export interface PageState {
  url: string;
  title: string;
  timestamp: string;
  viewport: { width: number; height: number };
  scrollPosition: { x: number; y: number };
  interactiveElements: InteractiveElement[];
  visibleText: string[];
  errors: string[];
  networkRequests: NetworkRequest[];
  consoleMessages: ConsoleMessage[];
}

export interface InteractiveElement {
  type: string;
  selector: string;
  text: string;
  ariaLabel: string | null;
  isVisible: boolean;
  isEnabled: boolean;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
}

export interface NetworkRequest {
  url: string;
  method: string;
  status: number | null;
  resourceType: string;
}

export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: string;
}

/**
 * AI-optimized page analyzer
 */
export class AIPageAnalyzer {
  private consoleMessages: ConsoleMessage[] = [];
  private networkRequests: NetworkRequest[] = [];

  constructor(private page: Page) {
    this.setupListeners();
  }

  private setupListeners(): void {
    // Capture console messages
    this.page.on('console', (msg) => {
      this.consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString(),
      });
    });

    // Capture network requests
    this.page.on('response', async (response) => {
      this.networkRequests.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        resourceType: response.request().resourceType(),
      });
    });
  }

  /**
   * Capture complete page state for AI analysis
   */
  async capturePageState(): Promise<PageState> {
    const viewport = this.page.viewportSize() || { width: 0, height: 0 };

    const pageData = await this.page.evaluate(() => {
      // Get scroll position
      const scrollPosition = {
        x: window.scrollX,
        y: window.scrollY,
      };

      // Get all interactive elements
      const interactiveSelectors = [
        'button',
        'a[href]',
        'input',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[tabindex]:not([tabindex="-1"])',
      ];

      const elements: Omit<InteractiveElement, 'boundingBox'>[] = [];
      interactiveSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
          const htmlEl = el as HTMLElement;
          const rect = htmlEl.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0 &&
            window.getComputedStyle(htmlEl).visibility !== 'hidden';

          if (isVisible) {
            elements.push({
              type: el.tagName.toLowerCase(),
              selector: generateSelector(el),
              text: el.textContent?.trim().slice(0, 100) || '',
              ariaLabel: el.getAttribute('aria-label'),
              isVisible,
              isEnabled: !(el as HTMLButtonElement).disabled,
            });
          }
        });
      });

      // Get visible text content
      const textNodes: string[] = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        if (text && text.length > 2) {
          textNodes.push(text.slice(0, 200));
        }
      }

      // Get any visible errors
      const errors: string[] = [];
      document.querySelectorAll('.error, [role="alert"], .mat-mdc-snack-bar-container').forEach((el) => {
        const text = el.textContent?.trim();
        if (text) {
          errors.push(text);
        }
      });

      return {
        scrollPosition,
        elements: elements.slice(0, 100), // Limit for performance
        visibleText: [...new Set(textNodes)].slice(0, 50),
        errors,
      };

      function generateSelector(el: Element): string {
        if (el.id) return `#${el.id}`;
        if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;

        const classes = Array.from(el.classList).slice(0, 2).join('.');
        if (classes) return `${el.tagName.toLowerCase()}.${classes}`;

        return el.tagName.toLowerCase();
      }
    });

    return {
      url: this.page.url(),
      title: await this.page.title(),
      timestamp: new Date().toISOString(),
      viewport,
      scrollPosition: pageData.scrollPosition,
      interactiveElements: pageData.elements.map((el) => ({ ...el, boundingBox: null })),
      visibleText: pageData.visibleText,
      errors: pageData.errors,
      networkRequests: this.networkRequests.slice(-50),
      consoleMessages: this.consoleMessages.slice(-50),
    };
  }

  /**
   * Get action recommendations based on current page state
   */
  async getActionRecommendations(): Promise<string[]> {
    const state = await this.capturePageState();
    const recommendations: string[] = [];

    // Analyze interactive elements
    const buttons = state.interactiveElements.filter((el) => el.type === 'button');
    const links = state.interactiveElements.filter((el) => el.type === 'a');
    const inputs = state.interactiveElements.filter((el) => ['input', 'textarea'].includes(el.type));

    if (buttons.length > 0) {
      recommendations.push(`Found ${buttons.length} clickable buttons. Key buttons: ${buttons.slice(0, 5).map((b) => b.text || b.ariaLabel || 'unnamed').join(', ')}`);
    }

    if (links.length > 0) {
      recommendations.push(`Found ${links.length} navigation links.`);
    }

    if (inputs.length > 0) {
      recommendations.push(`Found ${inputs.length} input fields for text entry.`);
    }

    if (state.errors.length > 0) {
      recommendations.push(`⚠️ Errors detected: ${state.errors.join('; ')}`);
    }

    return recommendations;
  }

  /**
   * Save page state to file for AI analysis
   */
  async saveStateToFile(testName: string): Promise<string> {
    const state = await this.capturePageState();
    const outputDir = path.join(process.cwd(), 'test-results', 'ai-states');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${testName}-${timestamp}.json`;
    const filepath = path.join(outputDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(state, null, 2));

    return filepath;
  }

  /**
   * Clear collected data
   */
  clearCollectedData(): void {
    this.consoleMessages = [];
    this.networkRequests = [];
  }
}

/**
 * Semantic action helper - uses natural language-like commands
 */
export class SemanticActions {
  constructor(private page: Page) { }

  /**
   * Click a button by its visible text
   */
  async clickButton(text: string): Promise<void> {
    const button = this.page.getByRole('button', { name: text });
    await button.click();
  }

  /**
   * Click a link by its visible text
   */
  async clickLink(text: string): Promise<void> {
    const link = this.page.getByRole('link', { name: text });
    await link.click();
  }

  /**
   * Fill an input field by its label
   */
  async fillInput(label: string, value: string): Promise<void> {
    const input = this.page.getByLabel(label);
    await input.fill(value);
  }

  /**
   * Type text in an input (with keyboard simulation)
   */
  async typeText(label: string, value: string): Promise<void> {
    const input = this.page.getByLabel(label);
    await input.click();
    await this.page.keyboard.type(value);
  }

  /**
   * Wait for text to appear on page
   */
  async waitForText(text: string, timeout = 10000): Promise<void> {
    await this.page.getByText(text).waitFor({ state: 'visible', timeout });
  }

  /**
   * Check if text is visible
   */
  async isTextVisible(text: string): Promise<boolean> {
    return await this.page.getByText(text).isVisible();
  }

  /**
   * Scroll to element with text
   */
  async scrollToText(text: string): Promise<void> {
    const element = this.page.getByText(text);
    await element.scrollIntoViewIfNeeded();
  }

  /**
   * Get all visible button texts
   */
  async getVisibleButtons(): Promise<string[]> {
    const buttons = this.page.getByRole('button');
    return await buttons.allTextContents();
  }

  /**
   * Navigate to a specific section using command palette
   */
  async navigateViaCommandPalette(command: string): Promise<void> {
    await this.page.keyboard.press('Control+k');
    await this.page.waitForTimeout(300);
    await this.page.keyboard.type(command);
    await this.page.keyboard.press('Enter');
    await this.page.waitForLoadState('networkidle');
  }
}

/**
 * Test result formatter for AI consumption
 */
export function formatTestResultForAI(testName: string, passed: boolean, details: Record<string, unknown>): string {
  return JSON.stringify({
    test: testName,
    status: passed ? 'PASSED' : 'FAILED',
    timestamp: new Date().toISOString(),
    details,
  }, null, 2);
}
