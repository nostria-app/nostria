declare global {
	const $localize: {
		(messageParts: TemplateStringsArray, ...expressions: readonly unknown[]): string;
		locale?: string;
	};
}

export {};
