export interface OfficerProfile {
  id: string;
  roles: string[];
  armedQualified: boolean;
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
        armedQualified: true
      }
    ];
  })
);

const directory: Record<string, OfficerProfile> = {
  ...generatedProfiles,
  officerA: {
    id: "officerA",
    roles: ["Security Officer"],
    armedQualified: false
  },
  officerB: {
    id: "officerB",
    roles: ["Security Officer"],
    armedQualified: true
  }
};

export function getOfficerProfile(officerId: string): OfficerProfile | null {
  return directory[officerId] ?? null;
}
