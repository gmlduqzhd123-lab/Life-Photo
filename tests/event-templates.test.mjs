import test from 'node:test';
import assert from 'node:assert/strict';
import {EVENT_TEMPLATES,builtInEventPreset} from '../dist/event-templates.mjs';
import {BUILT_IN_BACKGROUNDS} from '../dist/background-catalog.mjs';

test('each event template uses a built-in background and independent pose and print settings', () => {
  const current = {school:'우리 학교',date:'오늘',printPaper:'letter',backgrounds:['space']};
  for (const {id,name} of EVENT_TEMPLATES) {
    const preset = builtInEventPreset(id,current);
    assert.equal(preset.eventTemplate.title,name);
    assert.equal(preset.school,'우리 학교');
    assert.equal(preset.date,'오늘');
    assert.equal(preset.printPaper,'A4');
    assert.equal(preset.count,preset.customMissions.length);
    assert.ok(BUILT_IN_BACKGROUNDS.some(background => background.id === preset.backgrounds[0]));
    assert.notEqual(preset.customMissions,builtInEventPreset(id,current).customMissions);
  }
  assert.deepEqual(current.backgrounds,['space']);
  assert.equal(builtInEventPreset('missing',current),null);
});
