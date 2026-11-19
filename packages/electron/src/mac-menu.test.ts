import { test } from 'node:test';
import assert from 'node:assert/strict';
import { macMenuTemplate } from './mac-menu.js';

test('the app menu says sbtlTV, never the package name; the standard menus stay', () => {
  const t = macMenuTemplate('sbtlTV');
  const app = t[0];
  assert.equal(app.label, 'sbtlTV');
  const items = app.submenu as { role?: string; label?: string }[];
  const byRole = (r: string) => items.find((i) => i.role === r);
  assert.equal(byRole('about')?.label, 'About sbtlTV');
  assert.equal(byRole('hide')?.label, 'Hide sbtlTV');
  assert.equal(byRole('quit')?.label, 'Quit sbtlTV');
  assert.ok(!JSON.stringify(t).includes('@sbtltv'));
  assert.deepEqual(t.slice(1).map((m) => m.role), ['fileMenu', 'editMenu', 'viewMenu', 'windowMenu']);
});
