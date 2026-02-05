export interface Point {
	x: number;
	y: number;
}

/**
 * Compare whether two floating-point numbers are close enough
 * @param a First number
 * @param b Second number
 * @param eps Error threshold, default 0.001
 */
export function isClose(a: number, b: number, eps: number = 0.001): boolean {
	return Math.abs(a - b) < eps;
}

export function dist(p1: Point, p2: Point): number {
	return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

export function lerp(p1: Point, p2: Point, t: number): Point {
	return {
		x: p1.x + (p2.x - p1.x) * t,
		y: p1.y + (p2.y - p1.y) * t,
	};
}

/**
 * Calculate angle (0-360)
 */
export function getAngle(p1: Point, p2: Point): number {
	return (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
}

/**
 * Calculate signed angle between two vectors
 */
export function getAngleBetween(v1: Point, v2: Point): number {
	let angle = getAngle({ x: 0, y: 0 }, v2) - getAngle({ x: 0, y: 0 }, v1);
	while (angle <= -180) angle += 360;
	while (angle > 180) angle -= 360;
	return angle;
}

/**
 * Cubic Bezier curve
 */
export function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
	const mt = 1 - t;
	return {
		x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
		y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
	};
}

/**
 * Calculate intersection point of two lines
 */
export function getLineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
	if (!p1 || !p2 || !p3 || !p4)
		return null;
	const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
	if (Math.abs(d) < 1e-6)
		return null; // Parallel

	const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / d;
	return {
		x: p1.x + t * (p2.x - p1.x),
		y: p1.y + t * (p2.y - p1.y),
	};
}

/**
 * Quintic Bezier easing function (smootherStep)
 * t: parameter from 0-1
 * Returns: smooth value from 0-1
 */
export function smootherStep(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10);
}
