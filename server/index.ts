import { resolve } from "node:path";
import type { ServerWebSocket } from "bun";
import {
	communityExists,
	createCommunity,
	deleteShape,
	generateSyncMessageForPeer,
	getDocumentData,
	loadCommunity,
	receiveSyncMessage,
	removePeerSyncState,
	updateShape,
} from "./community-store";

const PORT = Number(process.env.PORT) || 3000;
const DIST_DIR = resolve(import.meta.dir, "../dist");

// WebSocket data type
interface WSData {
	communitySlug: string;
	peerId: string;
}

// Track connected clients per community (for broadcasting)
const communityClients = new Map<string, Map<string, ServerWebSocket<WSData>>>();

// Generate unique peer ID
function generatePeerId(): string {
	return `peer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Helper to get client by peer ID
function getClient(slug: string, peerId: string): ServerWebSocket<WSData> | undefined {
	return communityClients.get(slug)?.get(peerId);
}

// Parse subdomain from host header
function getSubdomain(host: string | null): string | null {
	if (!host) return null;

	// Handle localhost for development
	if (host.includes("localhost") || host.includes("127.0.0.1")) {
		return null;
	}

	// Extract subdomain from *.rspace.online
	const parts = host.split(".");
	if (parts.length >= 3 && parts.slice(-2).join(".") === "rspace.online") {
		const subdomain = parts[0];
		if (subdomain !== "www" && subdomain !== "rspace") {
			return subdomain;
		}
	}

	return null;
}

// Serve static files
async function serveStatic(path: string): Promise<Response | null> {
	const filePath = resolve(DIST_DIR, path);
	const file = Bun.file(filePath);

	if (await file.exists()) {
		const contentType = getContentType(path);
		return new Response(file, {
			headers: { "Content-Type": contentType },
		});
	}

	return null;
}

function getContentType(path: string): string {
	if (path.endsWith(".html")) return "text/html";
	if (path.endsWith(".js")) return "application/javascript";
	if (path.endsWith(".css")) return "text/css";
	if (path.endsWith(".json")) return "application/json";
	if (path.endsWith(".svg")) return "image/svg+xml";
	return "text/plain";
}

// Main server
const server = Bun.serve<WSData>({
	port: PORT,

	async fetch(req, server) {
		const url = new URL(req.url);
		const host = req.headers.get("host");
		const subdomain = getSubdomain(host);

		// Handle WebSocket upgrade
		if (url.pathname.startsWith("/ws/")) {
			const communitySlug = url.pathname.split("/")[2];
			if (communitySlug) {
				const peerId = generatePeerId();
				const upgraded = server.upgrade(req, {
					data: { communitySlug, peerId },
				});
				if (upgraded) return undefined;
			}
			return new Response("WebSocket upgrade failed", { status: 400 });
		}

		// API routes
		if (url.pathname.startsWith("/api/")) {
			return handleAPI(req, url);
		}

		// Community canvas route (subdomain detected)
		if (subdomain) {
			const community = await loadCommunity(subdomain);
			if (!community) {
				return new Response("Community not found", { status: 404 });
			}

			// Serve canvas.html for community
			const canvasHtml = await serveStatic("canvas.html");
			if (canvasHtml) return canvasHtml;
		}

		// Static files
		let filePath = url.pathname;
		if (filePath === "/") filePath = "/index.html";
		if (filePath === "/canvas") filePath = "/canvas.html";

		// Remove leading slash
		filePath = filePath.slice(1);

		const staticResponse = await serveStatic(filePath);
		if (staticResponse) return staticResponse;

		// Fallback to index.html for SPA routing
		const indexResponse = await serveStatic("index.html");
		if (indexResponse) return indexResponse;

		return new Response("Not Found", { status: 404 });
	},

	websocket: {
		open(ws: ServerWebSocket<WSData>) {
			const { communitySlug, peerId } = ws.data;

			// Add to clients map
			if (!communityClients.has(communitySlug)) {
				communityClients.set(communitySlug, new Map());
			}
			communityClients.get(communitySlug)!.set(peerId, ws);

			console.log(`[WS] Client ${peerId} connected to ${communitySlug}`);

			// Load community and send initial sync message
			loadCommunity(communitySlug).then((doc) => {
				if (doc) {
					const syncMessage = generateSyncMessageForPeer(communitySlug, peerId);
					if (syncMessage) {
						ws.send(
							JSON.stringify({
								type: "sync",
								data: Array.from(syncMessage),
							})
						);
					}
				}
			});
		},

		message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
			const { communitySlug, peerId } = ws.data;

			try {
				const msg = JSON.parse(message.toString());

				if (msg.type === "sync" && Array.isArray(msg.data)) {
					// Handle Automerge sync message
					const syncMessage = new Uint8Array(msg.data);
					const result = receiveSyncMessage(communitySlug, peerId, syncMessage);

					// Send response to this peer
					if (result.response) {
						ws.send(
							JSON.stringify({
								type: "sync",
								data: Array.from(result.response),
							})
						);
					}

					// Broadcast to other peers
					for (const [targetPeerId, targetMessage] of result.broadcastToPeers) {
						const targetClient = getClient(communitySlug, targetPeerId);
						if (targetClient && targetClient.readyState === WebSocket.OPEN) {
							targetClient.send(
								JSON.stringify({
									type: "sync",
									data: Array.from(targetMessage),
								})
							);
						}
					}
				} else if (msg.type === "ping") {
					// Handle keep-alive ping
					ws.send(JSON.stringify({ type: "pong", timestamp: msg.timestamp }));
				} else if (msg.type === "presence") {
					// Broadcast presence to other clients
					const clients = communityClients.get(communitySlug);
					if (clients) {
						const presenceMsg = JSON.stringify({
							type: "presence",
							peerId,
							...msg,
						});
						for (const [clientPeerId, client] of clients) {
							if (clientPeerId !== peerId && client.readyState === WebSocket.OPEN) {
								client.send(presenceMsg);
							}
						}
					}
				}
				// Legacy message handling for backward compatibility
				else if (msg.type === "update" && msg.id && msg.data) {
					updateShape(communitySlug, msg.id, msg.data);
					// Broadcast to other clients
					const clients = communityClients.get(communitySlug);
					if (clients) {
						const updateMsg = JSON.stringify(msg);
						for (const [clientPeerId, client] of clients) {
							if (clientPeerId !== peerId && client.readyState === WebSocket.OPEN) {
								client.send(updateMsg);
							}
						}
					}
				} else if (msg.type === "delete" && msg.id) {
					deleteShape(communitySlug, msg.id);
					// Broadcast to other clients
					const clients = communityClients.get(communitySlug);
					if (clients) {
						const deleteMsg = JSON.stringify(msg);
						for (const [clientPeerId, client] of clients) {
							if (clientPeerId !== peerId && client.readyState === WebSocket.OPEN) {
								client.send(deleteMsg);
							}
						}
					}
				}
			} catch (e) {
				console.error("[WS] Failed to parse message:", e);
			}
		},

		close(ws: ServerWebSocket<WSData>) {
			const { communitySlug, peerId } = ws.data;

			// Remove from clients map
			const clients = communityClients.get(communitySlug);
			if (clients) {
				clients.delete(peerId);
				if (clients.size === 0) {
					communityClients.delete(communitySlug);
				}
			}

			// Clean up peer sync state
			removePeerSyncState(communitySlug, peerId);

			console.log(`[WS] Client ${peerId} disconnected from ${communitySlug}`);
		},
	},
});

// API handler
async function handleAPI(req: Request, url: URL): Promise<Response> {
	const corsHeaders = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	};

	if (req.method === "OPTIONS") {
		return new Response(null, { headers: corsHeaders });
	}

	// POST /api/communities - Create new community
	if (url.pathname === "/api/communities" && req.method === "POST") {
		try {
			const body = (await req.json()) as { name?: string; slug?: string };
			const { name, slug } = body;

			if (!name || !slug) {
				return Response.json(
					{ error: "Name and slug are required" },
					{ status: 400, headers: corsHeaders }
				);
			}

			// Validate slug format
			if (!/^[a-z0-9-]+$/.test(slug)) {
				return Response.json(
					{ error: "Slug must contain only lowercase letters, numbers, and hyphens" },
					{ status: 400, headers: corsHeaders }
				);
			}

			// Check if exists
			if (await communityExists(slug)) {
				return Response.json(
					{ error: "Community already exists" },
					{ status: 409, headers: corsHeaders }
				);
			}

			// Create community
			await createCommunity(name, slug);

			// Return URL to new community
			return Response.json(
				{ url: `https://${slug}.rspace.online`, slug, name },
				{ headers: corsHeaders }
			);
		} catch (e) {
			console.error("Failed to create community:", e);
			return Response.json(
				{ error: "Failed to create community" },
				{ status: 500, headers: corsHeaders }
			);
		}
	}

	// GET /api/communities/:slug - Get community info
	if (url.pathname.startsWith("/api/communities/") && req.method === "GET") {
		const slug = url.pathname.split("/")[3];
		const data = getDocumentData(slug);

		if (!data) {
			// Try loading from disk
			await loadCommunity(slug);
			const loadedData = getDocumentData(slug);
			if (!loadedData) {
				return Response.json(
					{ error: "Community not found" },
					{ status: 404, headers: corsHeaders }
				);
			}
			return Response.json({ meta: loadedData.meta }, { headers: corsHeaders });
		}

		return Response.json({ meta: data.meta }, { headers: corsHeaders });
	}

	return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
}

console.log(`rSpace server running on http://localhost:${PORT}`);
