import type { Point } from "./types";

export const toDOMPrecision = (value: number) => Math.round(value * 1e4) / 1e4;

const PI2 = Math.PI * 2;
const TAU = Math.PI / 2;

export interface MatrixInit {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

export class Matrix implements MatrixInit {
	constructor(
		public a: number = 1,
		public b: number = 0,
		public c: number = 0,
		public d: number = 1,
		public e: number = 0,
		public f: number = 0,
	) {}

	equals(m: MatrixInit) {
		return (
			this.a === m.a &&
			this.b === m.b &&
			this.c === m.c &&
			this.d === m.d &&
			this.e === m.e &&
			this.f === m.f
		);
	}

	identity() {
		this.a = 1.0;
		this.b = 0.0;
		this.c = 0.0;
		this.d = 1.0;
		this.e = 0.0;
		this.f = 0.0;
		return this;
	}

	multiply(m: MatrixInit) {
		const { a, b, c, d, e, f } = this;
		this.a = a * m.a + c * m.b;
		this.c = a * m.c + c * m.d;
		this.e = a * m.e + c * m.f + e;
		this.b = b * m.a + d * m.b;
		this.d = b * m.c + d * m.d;
		this.f = b * m.e + d * m.f + f;
		return this;
	}

	rotate(r: number, cx?: number, cy?: number) {
		if (r === 0) return this;
		if (cx === undefined) return this.multiply(Matrix.Rotate(r));
		return this.translate(cx, cy!).multiply(Matrix.Rotate(r)).translate(-cx, -cy!);
	}

	translate(x: number, y: number): Matrix {
		return this.multiply(Matrix.Translate(x, y!));
	}

	scale(x: number, y: number) {
		return this.multiply(Matrix.Scale(x, y));
	}

	invert() {
		const { a, b, c, d, e, f } = this;
		const denominator = a * d - b * c;
		this.a = d / denominator;
		this.b = b / -denominator;
		this.c = c / -denominator;
		this.d = a / denominator;
		this.e = (d * e - c * f) / -denominator;
		this.f = (b * e - a * f) / denominator;
		return this;
	}

	applyToPoint(point: Point) {
		return Matrix.applyToPoint(this, point);
	}

	clone() {
		return new Matrix(this.a, this.b, this.c, this.d, this.e, this.f);
	}

	toCssString() {
		return Matrix.ToCssString(this);
	}

	static Rotate(r: number, cx?: number, cy?: number) {
		if (r === 0) return Matrix.Identity();
		const cosAngle = Math.cos(r);
		const sinAngle = Math.sin(r);
		const rotationMatrix = new Matrix(cosAngle, sinAngle, -sinAngle, cosAngle, 0.0, 0.0);
		if (cx === undefined) return rotationMatrix;
		return Matrix.Compose(Matrix.Translate(cx, cy!), rotationMatrix, Matrix.Translate(-cx, -cy!));
	}

	static Scale(x: number, y: number, cx?: number, cy?: number) {
		const scaleMatrix = new Matrix(x, 0, 0, y, 0, 0);
		if (cx === undefined) return scaleMatrix;
		return Matrix.Compose(Matrix.Translate(cx, cy!), scaleMatrix, Matrix.Translate(-cx, -cy!));
	}

	static Compose(...matrices: MatrixInit[]) {
		const matrix = Matrix.Identity();
		for (let i = 0, n = matrices.length; i < n; i++) {
			matrix.multiply(matrices[i]);
		}
		return matrix;
	}

	static Identity() {
		return new Matrix(1.0, 0.0, 0.0, 1.0, 0.0, 0.0);
	}

	static Translate(x: number, y: number) {
		return new Matrix(1.0, 0.0, 0.0, 1.0, x, y);
	}

	static applyToPoint(m: MatrixInit, point: Point) {
		return {
			x: m.a * point.x + m.c * point.y + m.e,
			y: m.b * point.x + m.d * point.y + m.f,
		};
	}

	static ToCssString(m: MatrixInit) {
		return `matrix(${toDOMPrecision(m.a)}, ${toDOMPrecision(m.b)}, ${toDOMPrecision(m.c)}, ${toDOMPrecision(m.d)}, ${toDOMPrecision(m.e)}, ${toDOMPrecision(m.f)})`;
	}
}
