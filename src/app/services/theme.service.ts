import { Injectable, effect, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'nostria-theme';
  private readonly darkThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  
  // Theme colors for PWA
  private readonly LIGHT_THEME_COLOR = '#FEF7FA'; // Light background color
  private readonly DARK_THEME_COLOR = '#303030'; // Dark background color
  
  darkMode = signal<boolean>(this.getInitialThemePreference());
  
  constructor() {
    // Set up effect to apply theme changes
    effect(() => {
      this.applyTheme(this.darkMode());
    });
    
    // Listen for system preference changes
    this.darkThemeMediaQuery.addEventListener('change', e => {
      // Only update if user hasn't explicitly set a preference
      if (!localStorage.getItem(this.THEME_KEY)) {
        this.darkMode.set(e.matches);
      }
    });
  }
  
  toggleDarkMode(): void {
    const newValue = !this.darkMode();
    this.darkMode.set(newValue);
    localStorage.setItem(this.THEME_KEY, newValue ? 'dark' : 'light');
  }
  
  private getInitialThemePreference(): boolean {
    // Check for saved preference
    const savedPreference = localStorage.getItem(this.THEME_KEY);
    if (savedPreference) {
      return savedPreference === 'dark';
    }
    
    // Fall back to system preference
    return this.darkThemeMediaQuery.matches;
  }
  
  private applyTheme(isDark: boolean): void {
    const themeColor = isDark ? this.DARK_THEME_COLOR : this.LIGHT_THEME_COLOR;
    
    if (isDark) {
      document.documentElement.classList.add('dark');
      // document.body.style.backgroundColor = this.DARK_THEME_COLOR;
    } else {
      document.documentElement.classList.remove('dark');
      // document.body.style.backgroundColor = this.LIGHT_THEME_COLOR;
    }
    
    this.updateThemeMetaTag(themeColor);
  }
  
  private updateThemeMetaTag(color: string): void {
    // Find the theme-color meta tag
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    
    // If it doesn't exist, create it
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(metaThemeColor);
    }
    
    // Set the color
    metaThemeColor.setAttribute('content', color);
  }
}
