import { Injectable, effect, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'nostria-theme';
  private readonly darkThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  
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
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
}
