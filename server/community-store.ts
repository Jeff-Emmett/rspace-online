import { mkdir, readdir } from "node:fs/promises";

const STORAGE_DIR = process.env.STORAGE_DIR || "./data/communities";

export interface CommunityMeta {
	name: string;
	slug: string;
	createdAt: string;
}

export interface CommunityDoc {
	meta: CommunityMeta;
	shapes: Record<
		string,
		{
			type: string;
			id: string;
			x: number;
			y: number;
			width: number;
			height: number;
			rotation?: number;
			content?: string;
		}
	>;
}

// In-memory cache of community docs
const communities = new Map<string, CommunityDoc>();

// Ensure storage directory exists
await mkdir(STORAGE_DIR, { recursive: true });

export async function loadCommunity(slug: string): Promise<CommunityDoc | null> {
	// Check cache first
	if (communities.has(slug)) {
		return communities.get(slug)!;
	}

	// Try to load from disk
	const path = `${STORAGE_DIR}/${slug}.json`;
	const file = Bun.file(path);

	if (await file.exists()) {
		try {
			const data = (await file.json()) as CommunityDoc;
			communities.set(slug, data);
			return data;
		} catch (e) {
			console.error(`Failed to load community ${slug}:`, e);
			return null;
		}
	}

	return null;
}

export async function saveCommunity(slug: string, doc: CommunityDoc): Promise<void> {
	communities.set(slug, doc);
	const path = `${STORAGE_DIR}/${slug}.json`;
	await Bun.write(path, JSON.stringify(doc, null, 2));
}

export async function createCommunity(name: string, slug: string): Promise<CommunityDoc> {
	const doc: CommunityDoc = {
		meta: {
			name,
			slug,
			createdAt: new Date().toISOString(),
		},
		shapes: {},
	};

	await saveCommunity(slug, doc);
	return doc;
}

export async function communityExists(slug: string): Promise<boolean> {
	if (communities.has(slug)) return true;

	const path = `${STORAGE_DIR}/${slug}.json`;
	const file = Bun.file(path);
	return file.exists();
}

export async function listCommunities(): Promise<string[]> {
	try {
		const files = await readdir(STORAGE_DIR);
		return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
	} catch {
		return [];
	}
}

export function updateShape(
	slug: string,
	shapeId: string,
	data: CommunityDoc["shapes"][string],
): void {
	const doc = communities.get(slug);
	if (doc) {
		doc.shapes[shapeId] = data;
		// Save async without blocking
		saveCommunity(slug, doc);
	}
}

export function deleteShape(slug: string, shapeId: string): void {
	const doc = communities.get(slug);
	if (doc) {
		delete doc.shapes[shapeId];
		saveCommunity(slug, doc);
	}
}
