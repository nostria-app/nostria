import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

@Injectable({
    providedIn: 'root'
})
export class MetaService {
    private meta = inject(Meta);
    private title = inject(Title);

    /**
     * Sets the page title
     * @param title The title to set
     */
    setTitle(title: string): void {
        this.title.setTitle(title);
    }

    /**
     * Sets the page description
     * @param description The description to set
     */
    setDescription(description: string): void {
        this.updateMetaTag('description', description);
    }

    /**
     * Sets the canonical URL for the page
     * @param url The canonical URL
     */
    setCanonicalUrl(url: string): void {
        let link: HTMLLinkElement | null = this.getLinkElement('canonical');

        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', 'canonical');
            document.head.appendChild(link);
        }

        link.setAttribute('href', url);
    }

    /**
     * Updates all social media tags at once with consistent information
     * @param config Object containing metadata properties
     */
    updateSocialMetadata(config: {
        title?: string;
        description?: string;
        image?: string;
        url?: string;
        type?: string;
        author?: string;
        twitterCard?: 'summary' | 'summary_large_image' | 'app' | 'player' | any;
    }): void {
        if (config.title) this.setTitle(config.title);
        if (config.description) this.setDescription(config.description);

        // Open Graph
        if (config.title) this.updateMetaTag('og:title', config.title);
        if (config.description) this.updateMetaTag('og:description', config.description);
        if (config.image) this.updateMetaTag('og:image', config.image);
        if (config.url) this.updateMetaTag('og:url', config.url);
        if (config.type) this.updateMetaTag('og:type', config.type);

        // Twitter Card
        if (config.twitterCard) this.updateMetaTag('twitter:card', config.twitterCard);
        if (config.title) this.updateMetaTag('twitter:title', config.title);
        if (config.description) this.updateMetaTag('twitter:description', config.description);
        if (config.image) this.updateMetaTag('twitter:image', config.image);
        if (config.author) this.updateMetaTag('twitter:creator', config.author);
    }

    /**
     * Updates or creates a meta tag
     * @param name Name or property of the meta tag
     * @param content Content value for the meta tag
     * @param isProperty Whether this is a property attribute (true) or name attribute (false)
     */
    private updateMetaTag(name: string, content: string) {
        // Determine if this tag uses property or name attribute
        // Only OpenGraph (og:) tags use property attribute, Twitter cards use name
        const attrType = name.startsWith('og:') ? 'property' : 'name';

        try {
            // Try to update the tag if it exists, otherwise add it
            this.meta.updateTag({ [attrType]: name, content });
        } catch (error) {
            // If updateTag fails (which happens if the tag doesn't exist), add it
            this.meta.addTag({ [attrType]: name, content });
        }
    }

    /**
     * Gets a link element if it exists
     * @param rel The rel attribute to look for
     * @returns The link element or null if not found
     */
    private getLinkElement(rel: string): HTMLLinkElement | null {
        return document.querySelector(`link[rel='${rel}']`);
    }
}
