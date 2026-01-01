import { mkdir, readdir } from "node:fs/promises";
import * as Automerge from "@automerge/automerge";

const STORAGE_DIR = process.env.STORAGE_DIR || "./data/communities";

export interface CommunityMeta {
	name: string;
	slug: string;
	createdAt: string;
}

export interface ShapeData {
	type: string;
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	content?: string;
	sourceId?: string;
	targetId?: string;
}

export interface CommunityDoc {
	meta: CommunityMeta;
	shapes: {
		[id: string]: ShapeData;
	};
}

// Per-peer sync state for Automerge
interface PeerState {
	syncState: Automerge.SyncState;
	lastActivity: number;
}

// In-memory cache of Automerge documents
const communities = new Map<string, Automerge.Doc<CommunityDoc>>();

// Track sync state per peer (WebSocket connection)
const peerSyncStates = new Map<string, Map<string, PeerState>>();

// Debounce save timers
const saveTimers = new Map<string, Timer>();

// Ensure storage directory exists
await mkdir(STORAGE_DIR, { recursive: true });

/**
 * Load community document from disk
 */
export async function loadCommunity(slug: string): Promise<Automerge.Doc<CommunityDoc> | null> {
	// Check cache first
	if (communities.has(slug)) {
		return communities.get(slug)!;
	}

	// Try to load Automerge binary first
	const binaryPath = `${STORAGE_DIR}/${slug}.automerge`;
	const binaryFile = Bun.file(binaryPath);

	if (await binaryFile.exists()) {
		try {
			const buffer = await binaryFile.arrayBuffer();
			const doc = Automerge.load<CommunityDoc>(new Uint8Array(buffer));
			communities.set(slug, doc);
			return doc;
		} catch (e) {
			console.error(`Failed to load Automerge doc for ${slug}:`, e);
		}
	}

	// Fallback: try JSON format and migrate
	const jsonPath = `${STORAGE_DIR}/${slug}.json`;
	const jsonFile = Bun.file(jsonPath);

	if (await jsonFile.exists()) {
		try {
			const data = (await jsonFile.json()) as CommunityDoc;
			// Migrate JSON to Automerge
			const doc = jsonToAutomerge(data);
			communities.set(slug, doc);
			// Save as Automerge binary
			await saveCommunity(slug);
			return doc;
		} catch (e) {
			console.error(`Failed to migrate JSON for ${slug}:`, e);
			return null;
		}
	}

	return null;
}

/**
 * Convert JSON document to Automerge document
 */
function jsonToAutomerge(data: CommunityDoc): Automerge.Doc<CommunityDoc> {
	let doc = Automerge.init<CommunityDoc>();
	doc = Automerge.change(doc, "Import from JSON", (d) => {
		d.meta = { ...data.meta };
		d.shapes = {};
		for (const [id, shape] of Object.entries(data.shapes || {})) {
			d.shapes[id] = { ...shape };
		}
	});
	return doc;
}

/**
 * Save community document to disk (debounced)
 */
export async function saveCommunity(slug: string): Promise<void> {
	const doc = communities.get(slug);
	if (!doc) return;

	// Clear existing timer
	const existingTimer = saveTimers.get(slug);
	if (existingTimer) {
		clearTimeout(existingTimer);
	}

	// Debounce saves to avoid excessive disk writes
	const timer = setTimeout(async () => {
		const currentDoc = communities.get(slug);
		if (!currentDoc) return;

		const binary = Automerge.save(currentDoc);
		const path = `${STORAGE_DIR}/${slug}.automerge`;
		await Bun.write(path, binary);
		console.log(`[Store] Saved ${slug} (${binary.length} bytes)`);
	}, 2000);

	saveTimers.set(slug, timer);
}

/**
 * Create a new community
 */
export async function createCommunity(name: string, slug: string): Promise<Automerge.Doc<CommunityDoc>> {
	let doc = Automerge.init<CommunityDoc>();
	doc = Automerge.change(doc, "Create community", (d) => {
		d.meta = {
			name,
			slug,
			createdAt: new Date().toISOString(),
		};
		d.shapes = {};
	});

	communities.set(slug, doc);
	await saveCommunity(slug);
	return doc;
}

/**
 * Check if community exists
 */
export async function communityExists(slug: string): Promise<boolean> {
	if (communities.has(slug)) return true;

	const binaryPath = `${STORAGE_DIR}/${slug}.automerge`;
	const jsonPath = `${STORAGE_DIR}/${slug}.json`;

	const binaryFile = Bun.file(binaryPath);
	const jsonFile = Bun.file(jsonPath);

	return (await binaryFile.exists()) || (await jsonFile.exists());
}

/**
 * List all communities
 */
export async function listCommunities(): Promise<string[]> {
	try {
		const files = await readdir(STORAGE_DIR);
		const slugs = new Set<string>();

		for (const f of files) {
			if (f.endsWith(".automerge")) {
				slugs.add(f.replace(".automerge", ""));
			} else if (f.endsWith(".json")) {
				slugs.add(f.replace(".json", ""));
			}
		}

		return Array.from(slugs);
	} catch {
		return [];
	}
}

/**
 * Get or create sync state for a peer
 */
export function getPeerSyncState(slug: string, peerId: string): PeerState {
	if (!peerSyncStates.has(slug)) {
		peerSyncStates.set(slug, new Map());
	}

	const communityPeers = peerSyncStates.get(slug)!;

	if (!communityPeers.has(peerId)) {
		communityPeers.set(peerId, {
			syncState: Automerge.initSyncState(),
			lastActivity: Date.now(),
		});
	}

	const peerState = communityPeers.get(peerId)!;
	peerState.lastActivity = Date.now();
	return peerState;
}

/**
 * Remove peer sync state (on disconnect)
 */
export function removePeerSyncState(slug: string, peerId: string): void {
	const communityPeers = peerSyncStates.get(slug);
	if (communityPeers) {
		communityPeers.delete(peerId);
		if (communityPeers.size === 0) {
			peerSyncStates.delete(slug);
		}
	}
}

/**
 * Get all peer IDs for a community
 */
export function getCommunityPeers(slug: string): string[] {
	const communityPeers = peerSyncStates.get(slug);
	return communityPeers ? Array.from(communityPeers.keys()) : [];
}

/**
 * Process incoming sync message from a peer
 * Returns response message and messages for other peers
 */
export function receiveSyncMessage(
	slug: string,
	peerId: string,
	message: Uint8Array,
): {
	response: Uint8Array | null;
	broadcastToPeers: Map<string, Uint8Array>;
} {
	const doc = communities.get(slug);
	if (!doc) {
		return { response: null, broadcastToPeers: new Map() };
	}

	const peerState = getPeerSyncState(slug, peerId);

	// Apply incoming sync message
	const result = Automerge.receiveSyncMessage(
		doc,
		peerState.syncState,
		message
	);

	const newDoc = result[0];
	const newSyncState = result[1];
	const patch = result[2] as { patches: Automerge.Patch[] } | null;

	communities.set(slug, newDoc);
	peerState.syncState = newSyncState;

	// Schedule save if changes were made
	const hasPatches = patch && patch.patches && patch.patches.length > 0;
	if (hasPatches) {
		saveCommunity(slug);
	}

	// Generate response for this peer
	const [nextSyncState, responseMessage] = Automerge.generateSyncMessage(
		newDoc,
		peerState.syncState
	);
	peerState.syncState = nextSyncState;

	// Generate messages for other peers
	const broadcastToPeers = new Map<string, Uint8Array>();
	const communityPeers = peerSyncStates.get(slug);

	if (communityPeers && hasPatches) {
		for (const [otherPeerId, otherPeerState] of communityPeers) {
			if (otherPeerId !== peerId) {
				const [newOtherSyncState, otherMessage] = Automerge.generateSyncMessage(
					newDoc,
					otherPeerState.syncState
				);
				otherPeerState.syncState = newOtherSyncState;

				if (otherMessage) {
					broadcastToPeers.set(otherPeerId, otherMessage);
				}
			}
		}
	}

	return {
		response: responseMessage || null,
		broadcastToPeers,
	};
}

/**
 * Generate initial sync message for a new peer
 */
export function generateSyncMessageForPeer(
	slug: string,
	peerId: string,
): Uint8Array | null {
	const doc = communities.get(slug);
	if (!doc) return null;

	const peerState = getPeerSyncState(slug, peerId);
	const [newSyncState, message] = Automerge.generateSyncMessage(
		doc,
		peerState.syncState
	);
	peerState.syncState = newSyncState;

	return message || null;
}

/**
 * Get document as plain object (for API responses)
 */
export function getDocumentData(slug: string): CommunityDoc | null {
	const doc = communities.get(slug);
	if (!doc) return null;

	// Convert Automerge doc to plain object
	return JSON.parse(JSON.stringify(doc));
}

// Legacy functions for backward compatibility

export function updateShape(
	slug: string,
	shapeId: string,
	data: ShapeData,
): void {
	const doc = communities.get(slug);
	if (doc) {
		const newDoc = Automerge.change(doc, `Update shape ${shapeId}`, (d) => {
			if (!d.shapes) d.shapes = {};
			d.shapes[shapeId] = data;
		});
		communities.set(slug, newDoc);
		saveCommunity(slug);
	}
}

export function deleteShape(slug: string, shapeId: string): void {
	const doc = communities.get(slug);
	if (doc) {
		const newDoc = Automerge.change(doc, `Delete shape ${shapeId}`, (d) => {
			if (d.shapes && d.shapes[shapeId]) {
				delete d.shapes[shapeId];
			}
		});
		communities.set(slug, newDoc);
		saveCommunity(slug);
	}
}
