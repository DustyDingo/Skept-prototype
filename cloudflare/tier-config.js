export const TIERS = {
  free:  { quota: 5,   depthSegments: ['head'],                permalink: false, evidenceJson: false, seals: false, viewedHistory: false, priority: false },
  plus:  { quota: 20,  depthSegments: ['head', 'mid'],         permalink: false, evidenceJson: false, seals: false, viewedHistory: true,  priority: false },
  pro:   { quota: 50,  depthSegments: ['head', 'mid'],         permalink: true,  evidenceJson: true,  seals: true,  viewedHistory: true,  priority: false },
  max:   { quota: 100, depthSegments: ['head', 'mid', 'tail'], permalink: true,  evidenceJson: true,  seals: true,  viewedHistory: true,  priority: true  },
};

export function getTier(tierString) {
  return TIERS[tierString] ?? TIERS['free'];
}
