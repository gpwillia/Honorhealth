export const homeSites = [
  "JCL",
  "Deer Valley",
  "Thunderbird",
  "Osborn",
  "Shea",
  "TMC",
  "Unknown"
] as const;

export type HomeSite = (typeof homeSites)[number];

export function assignHomeSite(officerId: string): HomeSite {
  const hash = Array.from(officerId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return homeSites[hash % homeSites.length];
}