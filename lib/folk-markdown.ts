import { FolkShape } from "./folk-shape";
import { css, html } from "./tags";

const styles = css`
	:host {
		background: white;
		border-radius: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		min-width: 200px;
		min-height: 100px;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: #14b8a6;
		color: white;
		border-radius: 8px 8px 0 0;
		font-size: 12px;
		font-weight: 600;
		cursor: move;
	}

	.header-title {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.header-actions {
		display: flex;
		gap: 4px;
	}

	.header-actions button {
		background: transparent;
		border: none;
		color: white;
		cursor: pointer;
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 14px;
	}

	.header-actions button:hover {
		background: rgba(255, 255, 255, 0.2);
	}

	.content {
		padding: 12px;
		height: calc(100% - 36px);
		overflow: auto;
	}

	.editor {
		width: 100%;
		height: 100%;
		border: none;
		outline: none;
		resize: none;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
		font-size: 14px;
		line-height: 1.5;
	}

	.markdown-preview {
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
		font-size: 14px;
		line-height: 1.6;
	}

	.markdown-preview h1 {
		font-size: 1.5em;
		margin: 0 0 0.5em;
		color: #14b8a6;
	}

	.markdown-preview h2 {
		font-size: 1.25em;
		margin: 0.5em 0;
		color: #14b8a6;
	}

	.markdown-preview p {
		margin: 0.5em 0;
	}

	.markdown-preview code {
		background: #f1f5f9;
		padding: 2px 4px;
		border-radius: 3px;
		font-family: monospace;
	}

	.markdown-preview pre {
		background: #f1f5f9;
		padding: 12px;
		border-radius: 6px;
		overflow-x: auto;
	}

	.markdown-preview pre code {
		background: none;
		padding: 0;
	}

	.markdown-preview ul,
	.markdown-preview ol {
		margin: 0.5em 0;
		padding-left: 1.5em;
	}

	.markdown-preview blockquote {
		border-left: 3px solid #14b8a6;
		margin: 0.5em 0;
		padding-left: 1em;
		color: #64748b;
	}
`;

declare global {
	interface HTMLElementTagNameMap {
		"folk-markdown": FolkMarkdown;
	}
}

export class FolkMarkdown extends FolkShape {
	static override tagName = "folk-markdown";

	// Merge parent and child styles
	static {
		const sheet = new CSSStyleSheet();
		const parentRules = Array.from(FolkShape.styles.cssRules).map((r) => r.cssText).join("\n");
		const childRules = Array.from(styles.cssRules).map((r) => r.cssText).join("\n");
		sheet.replaceSync(`${parentRules}\n${childRules}`);
		this.styles = sheet;
	}

	#content = "";
	#isEditing = false;

	get content() {
		return this.#content;
	}

	set content(value: string) {
		this.#content = value;
		this.requestUpdate("content");
		this.dispatchEvent(new CustomEvent("content-change", { detail: { content: value } }));
	}

	override createRenderRoot() {
		const root = super.createRenderRoot();

		// Add markdown-specific UI
		const wrapper = document.createElement("div");
		wrapper.innerHTML = html`
			<div class="header">
				<span class="header-title">
					<span>📝</span>
					<span>Markdown</span>
				</span>
				<div class="header-actions">
					<button class="edit-btn" title="Toggle Edit">✏️</button>
					<button class="close-btn" title="Close">×</button>
				</div>
			</div>
			<div class="content">
				<div class="markdown-preview"></div>
				<textarea class="editor" style="display: none;" placeholder="Write markdown here..."></textarea>
			</div>
		`;

		// Move existing slot content into our wrapper
		const slot = root.querySelector("slot");
		if (slot) {
			slot.parentElement?.replaceChild(wrapper, slot.parentElement.querySelector("div")!);
		}

		// Get references to elements
		const preview = wrapper.querySelector(".markdown-preview") as HTMLElement;
		const editor = wrapper.querySelector(".editor") as HTMLTextAreaElement;
		const editBtn = wrapper.querySelector(".edit-btn") as HTMLButtonElement;
		const closeBtn = wrapper.querySelector(".close-btn") as HTMLButtonElement;

		// Edit toggle
		editBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.#isEditing = !this.#isEditing;
			if (this.#isEditing) {
				editor.style.display = "block";
				preview.style.display = "none";
				editor.value = this.#content;
				editor.focus();
			} else {
				editor.style.display = "none";
				preview.style.display = "block";
				this.content = editor.value;
				preview.innerHTML = this.#renderMarkdown(this.#content);
			}
		});

		// Close button
		closeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.dispatchEvent(new CustomEvent("close"));
		});

		// Editor input
		editor.addEventListener("input", () => {
			this.#content = editor.value;
		});

		editor.addEventListener("blur", () => {
			this.#isEditing = false;
			editor.style.display = "none";
			preview.style.display = "block";
			this.content = editor.value;
			preview.innerHTML = this.#renderMarkdown(this.#content);
		});

		// Initial render
		this.#content = this.getAttribute("content") || "# Hello World\n\nStart typing...";
		preview.innerHTML = this.#renderMarkdown(this.#content);

		return root;
	}

	#renderMarkdown(text: string): string {
		// Simple markdown renderer
		return text
			.replace(/^### (.+)$/gm, "<h3>$1</h3>")
			.replace(/^## (.+)$/gm, "<h2>$1</h2>")
			.replace(/^# (.+)$/gm, "<h1>$1</h1>")
			.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
			.replace(/\*(.+?)\*/g, "<em>$1</em>")
			.replace(/`(.+?)`/g, "<code>$1</code>")
			.replace(/^- (.+)$/gm, "<li>$1</li>")
			.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
			.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
			.replace(/\n\n/g, "</p><p>")
			.replace(/^(.+)$/gm, (match) => {
				if (
					match.startsWith("<h") ||
					match.startsWith("<ul") ||
					match.startsWith("<li") ||
					match.startsWith("<blockquote")
				) {
					return match;
				}
				return `<p>${match}</p>`;
			});
	}

	toJSON() {
		return {
			type: "folk-markdown",
			id: this.id,
			x: this.x,
			y: this.y,
			width: this.width,
			height: this.height,
			rotation: this.rotation,
			content: this.content,
		};
	}
}
