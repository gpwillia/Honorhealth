import { assignHomeSite, type HomeSite } from "./homeSites.js";

export interface OfficerProfile {
  id: string;
  roles: string[];
  armedQualified: boolean;
  homeSite: HomeSite;
}

const generatedProfiles: Record<string, OfficerProfile> = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => {
    const officerNumber = i + 1;
    const id = `officer${officerNumber}`;
    return [
      id,
      {
        id,
        roles: ["Security Officer"],
        armedQualified: true,
        homeSite: assignHomeSite(id)
      }
    ];
  })
);

const directory: Record<string, OfficerProfile> = {
  ...generatedProfiles,
  officerA: {
    id: "officerA",
    roles: ["Security Officer"],
    armedQualified: false,
    homeSite: assignHomeSite("officerA")
  },
  officerB: {
    id: "officerB",
    roles: ["Security Officer"],
    armedQualified: true,
    homeSite: assignHomeSite("officerB")
  }
};

export function getOfficerProfile(officerId: string): OfficerProfile | null {
  return directory[officerId] ?? null;
}
