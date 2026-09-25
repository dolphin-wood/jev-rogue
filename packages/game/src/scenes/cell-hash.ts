/**
 * A cell's hash, for picking which drawing of a floor it gets.
 *
 * It was `(x * 73856093) ^ (y * 19349663)`, read with a small modulus. Both
 * factors are odd, so the low bits of the product are the low bits of x and y
 * and nothing else: `h % 4` repeated every four cells in both directions, and
 * the floors came out as a visible 4 x 4 wallpaper. The input is now mixed
 * through a full avalanche (murmur3's finaliser), so every bit of the result
 * depends on every bit of both coordinates.
 */
export function cellHash(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
