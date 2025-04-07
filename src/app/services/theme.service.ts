import { Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'nostria-theme';
  private readonly logger = inject(LoggerService);
  
  private isDarkMode = signal<boolean>(this.getInitialThemeMode());
  
  darkMode: Signal<boolean> = computed(() => {
    const mode = this.isDarkMode();
    this.logger.debug('darkMode computed value accessed', { isDarkMode: mode });
    return mode;
  });
  
  constructor() {
    this.logger.info('Initializing ThemeService');
    
    // Apply theme whenever it changes
    effect(() => {
      const isDark = this.isDarkMode();
      this.logger.debug('Theme effect triggered', { isDarkMode: isDark });
      
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      
      // Save to localStorage
      localStorage.setItem(this.THEME_KEY, isDark ? 'dark' : 'light');
    });
    
    this.logger.debug('ThemeService initialization completed');
  }
  
  private getInitialThemeMode(): boolean {
    this.logger.debug('Getting initial theme mode');
    
    // Check localStorage first
    const savedTheme = localStorage.getItem(this.THEME_KEY);
    
    if (savedTheme) {
      this.logger.debug('Found theme in localStorage', { theme: savedTheme });
      return savedTheme === 'dark';
    }
    
    // If not found in localStorage, check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      this.logger.debug('Using system dark mode preference');
      return true;
    }
    
    this.logger.debug('No theme preference found, defaulting to light mode');
    return false;
  }
  
  toggleDarkMode(): void {
    this.logger.debug('Toggling dark mode');
    this.isDarkMode.update(current => !current);
  }
  
  setDarkMode(isDark: boolean): void {
    this.logger.debug('Setting dark mode', { isDarkMode: isDark });
    this.isDarkMode.set(isDark);
  }
}
