// SPDX-License-Identifier: AGPL-3.0-only
import type { SkillDetail } from '../api/skills';

export const mockSkills: SkillDetail[] = [
  { id: 'server-health', name: 'server-health', description: 'Review server health and summarize resource usage, failed services, and recent events.', body: '# Server health\n\nReview the current state of the server before suggesting changes.\n\n## What to check\n\n- CPU and memory usage\n- Storage availability\n- Failed services and recent logs\n\n## Report\n\nSummarize findings with evidence and suggest a next step for each issue.' },
  { id: 'release-notes', name: 'release-notes', description: 'Turn a list of completed changes into concise, readable release notes.', body: '# Release notes\n\nGroup completed changes by their effect on users.\n\n## Writing guide\n\n1. Lead with the most useful improvement.\n2. Describe the resulting behavior.\n3. Mention any action the user needs to take.\n\nKeep each note short and specific.' },
  { id: 'project-guide', name: 'project-guide', description: 'Explain a project’s structure and help a new contributor find the right starting point.', body: '# Project guide\n\nRead the project documentation and identify the main entry points.\n\n## Overview\n\nExplain how the main components work together, then provide a small example.' },
].map((skill) => ({ ...skill, path: `/home/user/.agents/skills/${skill.id}/SKILL.md`, raw: `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n${skill.body}` }));
