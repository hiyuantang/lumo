// SPDX-License-Identifier: AGPL-3.0-only
export interface Skill {
  id: string;
  name: string;
  description: string;
  path: string;
  issue?: string;
}

export interface SkillCatalog {
  path: string;
  skills: Skill[];
  limited: boolean;
}

export interface SkillDetail extends Skill {
  body: string;
  raw: string;
}
