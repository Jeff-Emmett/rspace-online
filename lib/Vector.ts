import type { Point } from "./types";

const { hypot, cos, sin, atan2 } = Math;

export class Vector {
	static zero(): Point {
		return { x: 0, y: 0 };
	}

	static sub(a: Point, b: Point): Point {
		return { x: a.x - b.x, y: a.y - b.y };
	}

	static add(a: Point, b: Point): Point {
		return { x: a.x + b.x, y: a.y + b.y };
	}

	static scale(v: Point, scaleFactor: number): Point {
		return { x: v.x * scaleFactor, y: v.y * scaleFactor };
	}

	static mag(v: Point): number {
		return Math.sqrt(v.x * v.x + v.y * v.y);
	}

	static normalized(v: Point): Point {
		const { x, y } = v;
		const magnitude = hypot(x, y);
		if (magnitude === 0) return { x: 0, y: 0 };
		const invMag = 1 / magnitude;
		return { x: x * invMag, y: y * invMag };
	}

	static distance(a: Point, b: Point): number {
		const dx = a.x - b.x;
		const dy = a.y - b.y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	static distanceSquared(a: Point, b: Point): number {
		const dx = a.x - b.x;
		const dy = a.y - b.y;
		return dx * dx + dy * dy;
	}

	static lerp(a: Point, b: Point, t: number): Point {
		return {
			x: a.x + (b.x - a.x) * t,
			y: a.y + (b.y - a.y) * t,
		};
	}

	static rotate(v: Point, angle: number): Point {
		const _cos = cos(angle);
		const _sin = sin(angle);
		return {
			x: v.x * _cos - v.y * _sin,
			y: v.x * _sin + v.y * _cos,
		};
	}

	static rotateAround(point: Point, pivot: Point, angle: number): Point {
		const dx = point.x - pivot.x;
		const dy = point.y - pivot.y;
		const c = cos(angle);
		const s = sin(angle);
		return {
			x: pivot.x + dx * c - dy * s,
			y: pivot.y + dx * s + dy * c,
		};
	}

	static angle(v: Point): number {
		return atan2(v.y, v.x);
	}

	static angleTo(a: Point, b: Point = { x: 1, y: 0 }): number {
		const angleA = Vector.angle(a);
		const angleB = Vector.angle(b);
		return angleA - angleB;
	}

	static angleFromOrigin(point: Point, origin: Point): number {
		return Vector.angleTo({
			x: point.x - origin.x,
			y: point.y - origin.y,
		});
	}
}
