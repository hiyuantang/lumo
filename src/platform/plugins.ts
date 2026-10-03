// SPDX-License-Identifier: AGPL-3.0-only
import calendar from '../../apps/calendar/lumo.plugin.json';
import skills from '../../apps/skills/lumo.plugin.json';
import git from '../../apps/git/lumo.plugin.json';
import docker from '../../apps/docker/lumo.plugin.json';
import nginx from '../../apps/nginx/lumo.plugin.json';
import monitor from '../../apps/monitor/lumo.plugin.json';

export const pluginPackages = { calendar: 'calendar', skills: 'skills', git: 'git', containers: 'docker', websites: 'nginx', home: 'monitor' } as const;
export const pluginManifests = [calendar, skills, git, docker, nginx, monitor];
