import { ReactiveElement } from "@lit/reactive-element";

/**
 * Base class for all custom elements. Extends Lit's `ReactiveElement` and adds utilities for defining the element.
 */
export class FolkElement extends ReactiveElement {
	/** Defines the name of the custom element, must include a hyphen. */
	static tagName = "";

	/** Defines the custom element with the global CustomElementRegistry. */
	static define() {
		if (customElements.get(this.tagName)) return;
		customElements.define(this.tagName, this);
	}
}
