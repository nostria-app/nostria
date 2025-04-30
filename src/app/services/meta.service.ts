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
        twitterCard?: 'summary' | 'summary_large_image' | 'app' | 'player';
    }): void {
        const { title, description, image, url, type = 'website', author, twitterCard = 'summary_large_image' } = config;

        // Update basic meta if provided
        if (title) this.setTitle(title);
        if (description) this.setDescription(description);

        // Open Graph
        if (title) this.updateMetaTag('og:title', title);
        if (description) this.updateMetaTag('og:description', description);
        if (image) this.updateMetaTag('og:image', image);
        if (url) this.updateMetaTag('og:url', url);
        if (type) this.updateMetaTag('og:type', type);

        // Twitter Card
        if (twitterCard) this.updateMetaTag('twitter:card', twitterCard);
        if (title) this.updateMetaTag('twitter:title', title);
        if (description) this.updateMetaTag('twitter:description', description);
        if (image) this.updateMetaTag('twitter:image', image);
        if (author) this.updateMetaTag('twitter:creator', author);
    }

    /**
     * Updates or creates a meta tag
     * @param name Name or property of the meta tag
     * @param content Content value for the meta tag
     * @param isProperty Whether this is a property attribute (true) or name attribute (false)
     */
    private updateMetaTag(name: string, content: string) {
        // console.log('Updating meta tag:', name, content);

        let attrType = 'name';

        if (name.startsWith('og:')) {
            attrType = 'property';
        }

        // const attrType = name.startsWith('og:') || (name.startsWith('twitter:') || name !== '') ? 'property' : 'name';
        const selector = `${attrType}='${name}'`;

        // console.log('Selector:', selector);
        const tag = this.meta.getTag(selector);
        // console.log('Meta tag:', tag, selector);

        if (tag) {
            this.meta.updateTag({ [attrType]: name, content });
        } else {
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
