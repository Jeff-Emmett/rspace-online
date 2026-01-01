import { Matrix } from "./Matrix";
import type { Point } from "./types";

interface DOMRectTransformInit {
	height?: number;
	width?: number;
	x?: number;
	y?: number;
	rotation?: number;
	transformOrigin?: Point;
	rotateOrigin?: Point;
}

/**
 * Represents a rectangle with position, size, and rotation,
 * capable of transforming points between local and parent coordinate spaces.
 */
export class DOMRectTransform implements DOMRect {
	#x: number;
	#y: number;
	#width: number;
	#height: number;
	#rotation: number;
	#transformOrigin: Point;
	#rotateOrigin: Point;
	#transformMatrix: Matrix;
	#inverseMatrix: Matrix;

	constructor(init: DOMRectTransformInit = {}) {
		this.#x = init.x ?? 0;
		this.#y = init.y ?? 0;
		this.#width = init.width ?? 0;
		this.#height = init.height ?? 0;
		this.#rotation = init.rotation ?? 0;
		this.#transformOrigin = init.transformOrigin ?? { x: 0.5, y: 0.5 };
		this.#rotateOrigin = init.rotateOrigin ?? { x: 0.5, y: 0.5 };
		this.#transformMatrix = Matrix.Identity();
		this.#inverseMatrix = Matrix.Identity();
		this.#updateMatrices();
	}

	get x(): number {
		return this.#x;
	}
	set x(value: number) {
		this.#x = value;
		this.#updateMatrices();
	}

	get y(): number {
		return this.#y;
	}
	set y(value: number) {
		this.#y = value;
		this.#updateMatrices();
	}

	get width(): number {
		return this.#width;
	}
	set width(value: number) {
		this.#width = value;
		this.#updateMatrices();
	}

	get height(): number {
		return this.#height;
	}
	set height(value: number) {
		this.#height = value;
		this.#updateMatrices();
	}

	get rotation(): number {
		return this.#rotation;
	}
	set rotation(value: number) {
		this.#rotation = value;
		this.#updateMatrices();
	}

	get transformOrigin(): Point {
		return this.#transformOrigin;
	}
	set transformOrigin(value: Point) {
		this.#transformOrigin = value;
		this.#updateMatrices();
	}

	get rotateOrigin(): Point {
		return this.#rotateOrigin;
	}
	set rotateOrigin(value: Point) {
		this.#rotateOrigin = value;
		this.#updateMatrices();
	}

	get left(): number {
		return this.x;
	}
	get top(): number {
		return this.y;
	}
	get right(): number {
		return this.x + this.width;
	}
	get bottom(): number {
		return this.y + this.height;
	}

	#updateMatrices() {
		this.#transformMatrix.identity();
		const transformOrigin = this.#getAbsoluteTransformOrigin();
		const rotateOrigin = this.#getAbsoluteRotateOrigin();

		this.#transformMatrix
			.translate(this.#x, this.#y)
			.translate(transformOrigin.x, transformOrigin.y)
			.translate(rotateOrigin.x - transformOrigin.x, rotateOrigin.y - transformOrigin.y)
			.rotate(this.#rotation)
			.translate(-(rotateOrigin.x - transformOrigin.x), -(rotateOrigin.y - transformOrigin.y))
			.translate(-transformOrigin.x, -transformOrigin.y);

		this.#inverseMatrix = this.#transformMatrix.clone().invert();
	}

	#getAbsoluteTransformOrigin(): Point {
		return {
			x: this.#width * this.#transformOrigin.x,
			y: this.#height * this.#transformOrigin.y,
		};
	}

	#getAbsoluteRotateOrigin(): Point {
		return {
			x: this.#width * this.#rotateOrigin.x,
			y: this.#height * this.#rotateOrigin.y,
		};
	}

	get transformMatrix(): Matrix {
		return this.#transformMatrix;
	}

	get inverseMatrix(): Matrix {
		return this.#inverseMatrix;
	}

	toLocalSpace(point: Point): Point {
		return this.#inverseMatrix.applyToPoint(point);
	}

	toParentSpace(point: Point): Point {
		return this.#transformMatrix.applyToPoint(point);
	}

	get topLeft(): Point {
		return { x: 0, y: 0 };
	}
	get topRight(): Point {
		return { x: this.width, y: 0 };
	}
	get bottomRight(): Point {
		return { x: this.width, y: this.height };
	}
	get bottomLeft(): Point {
		return { x: 0, y: this.height };
	}
	get center(): Point {
		return { x: this.x + this.width / 2, y: this.y + this.height / 2 };
	}

	set topLeft(point: Point) {
		const bottomRightBefore = this.toParentSpace(this.bottomRight);
		const deltaWidth = this.#width - point.x;
		const deltaHeight = this.#height - point.y;
		this.#x += point.x;
		this.#y += point.y;
		this.#width = deltaWidth;
		this.#height = deltaHeight;
		this.#updateMatrices();
		const bottomRightAfter = this.toParentSpace(this.bottomRight);
		this.#x -= bottomRightAfter.x - bottomRightBefore.x;
		this.#y -= bottomRightAfter.y - bottomRightBefore.y;
		this.#updateMatrices();
	}

	set topRight(point: Point) {
		const bottomLeftBefore = this.toParentSpace(this.bottomLeft);
		const deltaWidth = point.x;
		const deltaHeight = this.#height - point.y;
		this.#y += point.y;
		this.#width = deltaWidth;
		this.#height = deltaHeight;
		this.#updateMatrices();
		const bottomLeftAfter = this.toParentSpace(this.bottomLeft);
		this.#x -= bottomLeftAfter.x - bottomLeftBefore.x;
		this.#y -= bottomLeftAfter.y - bottomLeftBefore.y;
		this.#updateMatrices();
	}

	set bottomRight(point: Point) {
		const topLeftBefore = this.toParentSpace(this.topLeft);
		this.#width = point.x;
		this.#height = point.y;
		this.#updateMatrices();
		const topLeftAfter = this.toParentSpace(this.topLeft);
		this.#x -= topLeftAfter.x - topLeftBefore.x;
		this.#y -= topLeftAfter.y - topLeftBefore.y;
		this.#updateMatrices();
	}

	set bottomLeft(point: Point) {
		const topRightBefore = this.toParentSpace(this.topRight);
		const deltaWidth = this.#width - point.x;
		const deltaHeight = point.y;
		this.#x += point.x;
		this.#width = deltaWidth;
		this.#height = deltaHeight;
		this.#updateMatrices();
		const topRightAfter = this.toParentSpace(this.topRight);
		this.#x -= topRightAfter.x - topRightBefore.x;
		this.#y -= topRightAfter.y - topRightBefore.y;
		this.#updateMatrices();
	}

	vertices(): Point[] {
		return [this.topLeft, this.topRight, this.bottomRight, this.bottomLeft];
	}

	toCssString(): string {
		return this.transformMatrix.toCssString();
	}

	toJSON() {
		return {
			x: this.x,
			y: this.y,
			width: this.width,
			height: this.height,
			rotation: this.rotation,
		};
	}
}

export class DOMRectTransformReadonly extends DOMRectTransform {
	constructor(init: DOMRectTransformInit = {}) {
		super(init);
	}

	override set x(_: number) {}
	override set y(_: number) {}
	override set width(_: number) {}
	override set height(_: number) {}
	override set rotation(_: number) {}
}
