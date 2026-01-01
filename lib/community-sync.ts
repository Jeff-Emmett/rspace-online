import * as Automerge from "@automerge/automerge";
import type { FolkShape } from "./folk-shape";

// Shape data stored in Automerge document
export interface ShapeData {
	type: string;
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	content?: string;
	// Arrow-specific
	sourceId?: string;
	targetId?: string;
}

// Automerge document structure
export interface CommunityDoc {
	meta: {
		name: string;
		slug: string;
		createdAt: string;
	};
	shapes: {
		[id: string]: ShapeData;
	};
}

type SyncState = Automerge.SyncState;

/**
 * CommunitySync - Bridges FolkJS shapes with Automerge CRDT sync
 *
 * Handles:
 * - Local shape changes → Automerge document → WebSocket broadcast
 * - Remote Automerge sync messages → Local document → DOM updates
 */
export class CommunitySync extends EventTarget {
	#doc: Automerge.Doc<CommunityDoc>;
	#syncState: SyncState;
	#ws: WebSocket | null = null;
	#communitySlug: string;
	#shapes: Map<string, FolkShape> = new Map();
	#pendingChanges: boolean = false;
	#reconnectAttempts = 0;
	#maxReconnectAttempts = 5;
	#reconnectDelay = 1000;

	constructor(communitySlug: string) {
		super();
		this.#communitySlug = communitySlug;

		// Initialize empty Automerge document
		this.#doc = Automerge.init<CommunityDoc>();
		this.#doc = Automerge.change(this.#doc, "Initialize community", (doc) => {
			doc.meta = {
				name: communitySlug,
				slug: communitySlug,
				createdAt: new Date().toISOString(),
			};
			doc.shapes = {};
		});

		this.#syncState = Automerge.initSyncState();
	}

	get doc(): Automerge.Doc<CommunityDoc> {
		return this.#doc;
	}

	get shapes(): Map<string, FolkShape> {
		return this.#shapes;
	}

	/**
	 * Connect to WebSocket server for real-time sync
	 */
	connect(wsUrl: string): void {
		if (this.#ws?.readyState === WebSocket.OPEN) {
			return;
		}

		this.#ws = new WebSocket(wsUrl);
		this.#ws.binaryType = "arraybuffer";

		this.#ws.onopen = () => {
			console.log(`[CommunitySync] Connected to ${this.#communitySlug}`);
			this.#reconnectAttempts = 0;

			// Request initial sync
			this.#requestSync();

			this.dispatchEvent(new CustomEvent("connected"));
		};

		this.#ws.onmessage = (event) => {
			this.#handleMessage(event.data);
		};

		this.#ws.onclose = () => {
			console.log(`[CommunitySync] Disconnected from ${this.#communitySlug}`);
			this.dispatchEvent(new CustomEvent("disconnected"));

			// Attempt reconnect
			this.#attemptReconnect(wsUrl);
		};

		this.#ws.onerror = (error) => {
			console.error("[CommunitySync] WebSocket error:", error);
			this.dispatchEvent(new CustomEvent("error", { detail: error }));
		};
	}

	#attemptReconnect(wsUrl: string): void {
		if (this.#reconnectAttempts >= this.#maxReconnectAttempts) {
			console.error("[CommunitySync] Max reconnect attempts reached");
			return;
		}

		this.#reconnectAttempts++;
		const delay = this.#reconnectDelay * Math.pow(2, this.#reconnectAttempts - 1);

		console.log(`[CommunitySync] Reconnecting in ${delay}ms (attempt ${this.#reconnectAttempts})`);

		setTimeout(() => {
			this.connect(wsUrl);
		}, delay);
	}

	/**
	 * Request sync from server (sends our sync state)
	 */
	#requestSync(): void {
		const [nextSyncState, syncMessage] = Automerge.generateSyncMessage(
			this.#doc,
			this.#syncState
		);

		this.#syncState = nextSyncState;

		if (syncMessage) {
			this.#send({
				type: "sync",
				data: Array.from(syncMessage),
			});
		}
	}

	/**
	 * Handle incoming WebSocket messages
	 */
	#handleMessage(data: ArrayBuffer | string): void {
		try {
			// Handle binary Automerge sync messages
			if (data instanceof ArrayBuffer) {
				const message = new Uint8Array(data);
				this.#applySyncMessage(message);
				return;
			}

			// Handle JSON messages
			const msg = JSON.parse(data as string);

			switch (msg.type) {
				case "sync":
					// Server sending sync message as JSON array
					if (Array.isArray(msg.data)) {
						const syncMessage = new Uint8Array(msg.data);
						this.#applySyncMessage(syncMessage);
					}
					break;

				case "full-sync":
					// Server sending full document (for initial load)
					if (msg.doc) {
						const binary = new Uint8Array(msg.doc);
						this.#doc = Automerge.load<CommunityDoc>(binary);
						this.#syncState = Automerge.initSyncState();
						this.#applyDocToDOM();
					}
					break;

				case "presence":
					// Handle presence updates (cursors, selections)
					this.dispatchEvent(new CustomEvent("presence", { detail: msg }));
					break;
			}
		} catch (e) {
			console.error("[CommunitySync] Failed to handle message:", e);
		}
	}

	/**
	 * Apply incoming Automerge sync message
	 */
	#applySyncMessage(message: Uint8Array): void {
		const result = Automerge.receiveSyncMessage(
			this.#doc,
			this.#syncState,
			message
		);

		this.#doc = result[0];
		this.#syncState = result[1];

		// Apply changes to DOM if we received new patches
		const patch = result[2] as { patches: Automerge.Patch[] } | null;
		if (patch && patch.patches && patch.patches.length > 0) {
			this.#applyPatchesToDOM(patch.patches);
		}

		// Generate response if needed
		const [nextSyncState, responseMessage] = Automerge.generateSyncMessage(
			this.#doc,
			this.#syncState
		);

		this.#syncState = nextSyncState;

		if (responseMessage) {
			this.#send({
				type: "sync",
				data: Array.from(responseMessage),
			});
		}
	}

	/**
	 * Send message over WebSocket
	 */
	#send(message: object): void {
		if (this.#ws?.readyState === WebSocket.OPEN) {
			this.#ws.send(JSON.stringify(message));
		}
	}

	/**
	 * Register a shape element for syncing
	 */
	registerShape(shape: FolkShape): void {
		this.#shapes.set(shape.id, shape);

		// Listen for transform events
		shape.addEventListener("folk-transform", ((e: CustomEvent) => {
			this.#handleShapeChange(shape);
		}) as EventListener);

		// Listen for content changes (for markdown shapes)
		shape.addEventListener("content-change", ((e: CustomEvent) => {
			this.#handleShapeChange(shape);
		}) as EventListener);

		// Add to document if not exists
		if (!this.#doc.shapes[shape.id]) {
			this.#updateShapeInDoc(shape);
		}
	}

	/**
	 * Unregister a shape
	 */
	unregisterShape(shapeId: string): void {
		this.#shapes.delete(shapeId);
	}

	/**
	 * Handle local shape change - update Automerge doc and sync
	 */
	#handleShapeChange(shape: FolkShape): void {
		this.#updateShapeInDoc(shape);
		this.#syncToServer();
	}

	/**
	 * Update shape data in Automerge document
	 */
	#updateShapeInDoc(shape: FolkShape): void {
		const shapeData = this.#shapeToData(shape);

		this.#doc = Automerge.change(this.#doc, `Update shape ${shape.id}`, (doc) => {
			if (!doc.shapes) doc.shapes = {};
			doc.shapes[shape.id] = shapeData;
		});
	}

	/**
	 * Convert FolkShape to serializable data
	 */
	#shapeToData(shape: FolkShape): ShapeData {
		const data: ShapeData = {
			type: shape.tagName.toLowerCase(),
			id: shape.id,
			x: shape.x,
			y: shape.y,
			width: shape.width,
			height: shape.height,
			rotation: shape.rotation,
		};

		// Add content for markdown shapes
		if ("content" in shape && typeof (shape as any).content === "string") {
			data.content = (shape as any).content;
		}

		// Add arrow connections
		if ("sourceId" in shape) {
			data.sourceId = (shape as any).sourceId;
		}
		if ("targetId" in shape) {
			data.targetId = (shape as any).targetId;
		}

		return data;
	}

	/**
	 * Sync local changes to server
	 */
	#syncToServer(): void {
		const [nextSyncState, syncMessage] = Automerge.generateSyncMessage(
			this.#doc,
			this.#syncState
		);

		this.#syncState = nextSyncState;

		if (syncMessage) {
			this.#send({
				type: "sync",
				data: Array.from(syncMessage),
			});
		}
	}

	/**
	 * Delete a shape from the document
	 */
	deleteShape(shapeId: string): void {
		this.#doc = Automerge.change(this.#doc, `Delete shape ${shapeId}`, (doc) => {
			if (doc.shapes && doc.shapes[shapeId]) {
				delete doc.shapes[shapeId];
			}
		});

		this.#shapes.delete(shapeId);
		this.#syncToServer();
	}

	/**
	 * Apply full document to DOM (for initial load)
	 */
	#applyDocToDOM(): void {
		const shapes = this.#doc.shapes || {};

		for (const [id, shapeData] of Object.entries(shapes)) {
			this.#applyShapeToDOM(shapeData);
		}

		this.dispatchEvent(new CustomEvent("synced", { detail: { shapes } }));
	}

	/**
	 * Apply Automerge patches to DOM
	 */
	#applyPatchesToDOM(patches: Automerge.Patch[]): void {
		for (const patch of patches) {
			const path = patch.path;

			// Handle shape updates: ["shapes", shapeId, ...]
			if (path[0] === "shapes" && typeof path[1] === "string") {
				const shapeId = path[1];
				const shapeData = this.#doc.shapes?.[shapeId];

				if (patch.action === "del" && path.length === 2) {
					// Shape deleted
					this.#removeShapeFromDOM(shapeId);
				} else if (shapeData) {
					// Shape created or updated
					this.#applyShapeToDOM(shapeData);
				}
			}
		}
	}

	/**
	 * Apply shape data to DOM element
	 */
	#applyShapeToDOM(shapeData: ShapeData): void {
		let shape = this.#shapes.get(shapeData.id);

		if (!shape) {
			// Create new shape element
			shape = this.#createShapeElement(shapeData);
			if (shape) {
				this.#shapes.set(shapeData.id, shape);
				this.dispatchEvent(new CustomEvent("shape-created", { detail: { shape, data: shapeData } }));
			}
			return;
		}

		// Update existing shape (avoid triggering our own change events)
		this.#updateShapeElement(shape, shapeData);
	}

	/**
	 * Create a new shape element from data
	 */
	#createShapeElement(data: ShapeData): FolkShape | undefined {
		// This will be handled by the canvas - emit event for canvas to create
		this.dispatchEvent(new CustomEvent("create-shape", { detail: data }));
		return undefined;
	}

	/**
	 * Update shape element without triggering change events
	 */
	#updateShapeElement(shape: FolkShape, data: ShapeData): void {
		// Temporarily remove event listeners to avoid feedback loop
		const isOurChange =
			shape.x === data.x &&
			shape.y === data.y &&
			shape.width === data.width &&
			shape.height === data.height &&
			shape.rotation === data.rotation;

		if (isOurChange && !("content" in data)) {
			return; // No change needed
		}

		// Update position and size
		if (shape.x !== data.x) shape.x = data.x;
		if (shape.y !== data.y) shape.y = data.y;
		if (shape.width !== data.width) shape.width = data.width;
		if (shape.height !== data.height) shape.height = data.height;
		if (shape.rotation !== data.rotation) shape.rotation = data.rotation;

		// Update content for markdown shapes
		if ("content" in data && "content" in shape) {
			const shapeWithContent = shape as any;
			if (shapeWithContent.content !== data.content) {
				shapeWithContent.content = data.content;
			}
		}
	}

	/**
	 * Remove shape from DOM
	 */
	#removeShapeFromDOM(shapeId: string): void {
		const shape = this.#shapes.get(shapeId);
		if (shape) {
			this.#shapes.delete(shapeId);
			this.dispatchEvent(new CustomEvent("shape-deleted", { detail: { shapeId, shape } }));
		}
	}

	/**
	 * Disconnect from server
	 */
	disconnect(): void {
		if (this.#ws) {
			this.#ws.close();
			this.#ws = null;
		}
	}

	/**
	 * Get document as binary for storage
	 */
	getDocumentBinary(): Uint8Array {
		return Automerge.save(this.#doc);
	}

	/**
	 * Load document from binary
	 */
	loadDocumentBinary(binary: Uint8Array): void {
		this.#doc = Automerge.load<CommunityDoc>(binary);
		this.#syncState = Automerge.initSyncState();
		this.#applyDocToDOM();
	}
}
