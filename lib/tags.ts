/** A raw tagged template literal that just provides HTML syntax highlighting/LSP support. */
export const html = String.raw;

export function css(strings: TemplateStringsArray, ...values: unknown[]) {
	const styles = new CSSStyleSheet();
	styles.replaceSync(String.raw(strings, ...values));
	return styles;
}
