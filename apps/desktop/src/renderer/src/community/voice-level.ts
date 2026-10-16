/** Phones play voices louder by default: their speakers are small and calls ran quiet. */
export const PHONE_OUTPUT_VOLUME = 1.6;

/** The effective playback level for one person: their own volume, the output volume and ducking. */
export function effectiveGain(personal: number, output: number, duck: number): number {
  const g = Math.max(0, personal) * Math.max(0, output) * Math.max(0, duck);
  return Math.min(4, g);
}
