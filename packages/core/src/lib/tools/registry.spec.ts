import { describe, it, expect } from 'vitest';
import { TOOLS, toolDefinitions } from './registry.js';

describe('tool registry', () => {
  it('a runSql és listCategories toolt is regisztrálja', () => {
    expect(Object.keys(TOOLS).sort()).toEqual(['listCategories', 'runSql']);
  });

  it('a definíció neve megegyezik a regiszter kulcsával', () => {
    for (const [name, tool] of Object.entries(TOOLS)) {
      expect(tool.definition.name).toBe(name);
    }
  });

  it('a toolDefinitions minden regisztrált tool definícióját tartalmazza', () => {
    expect(toolDefinitions).toHaveLength(Object.keys(TOOLS).length);
    expect(toolDefinitions.map((d) => d.name).sort()).toEqual([
      'listCategories',
      'runSql',
    ]);
  });
});
