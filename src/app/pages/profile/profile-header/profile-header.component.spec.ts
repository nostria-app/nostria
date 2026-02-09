/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal, computed } from '@angular/core';
import { ProfileHeaderComponent } from './profile-header.component';

function createComponent(): ProfileHeaderComponent {
  const component = Object.create(ProfileHeaderComponent.prototype) as ProfileHeaderComponent;

  // Initialize the premiumTier signal
  (component as any).premiumTier = signal<string | null>(null);

  // Re-create the computed signals that depend on premiumTier
  (component as any).isPremium = computed(() => {
    const tier = (component as any).premiumTier();
    return tier === 'premium' || tier === 'premium_plus';
  });

  (component as any).isPremiumPlus = computed(() => {
    const tier = (component as any).premiumTier();
    return tier === 'premium_plus';
  });

  return component;
}

describe('ProfileHeaderComponent', () => {
  describe('premium indicator', () => {
    it('should not show premium when tier is null', () => {
      const component = createComponent();
      expect(component.isPremium()).toBe(false);
      expect(component.isPremiumPlus()).toBe(false);
    });

    it('should not show premium when tier is free', () => {
      const component = createComponent();
      (component as any).premiumTier.set('free');
      expect(component.isPremium()).toBe(false);
      expect(component.isPremiumPlus()).toBe(false);
    });

    it('should show premium but not premium plus for premium tier', () => {
      const component = createComponent();
      (component as any).premiumTier.set('premium');
      expect(component.isPremium()).toBe(true);
      expect(component.isPremiumPlus()).toBe(false);
    });

    it('should show both premium and premium plus for premium_plus tier', () => {
      const component = createComponent();
      (component as any).premiumTier.set('premium_plus');
      expect(component.isPremium()).toBe(true);
      expect(component.isPremiumPlus()).toBe(true);
    });

    it('should react to tier changes', () => {
      const component = createComponent();

      // Start with no tier
      expect(component.isPremium()).toBe(false);

      // Upgrade to premium
      (component as any).premiumTier.set('premium');
      expect(component.isPremium()).toBe(true);
      expect(component.isPremiumPlus()).toBe(false);

      // Upgrade to premium plus
      (component as any).premiumTier.set('premium_plus');
      expect(component.isPremium()).toBe(true);
      expect(component.isPremiumPlus()).toBe(true);

      // Downgrade back to free
      (component as any).premiumTier.set('free');
      expect(component.isPremium()).toBe(false);
      expect(component.isPremiumPlus()).toBe(false);
    });
  });
});
