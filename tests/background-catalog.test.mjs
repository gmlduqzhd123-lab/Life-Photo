import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKGROUND_THEMES, BUILT_IN_BACKGROUNDS, listBackgrounds} from '../dist/background-catalog.mjs';
import {validateBundle} from '../dist/preset-bundle.mjs';

test('background filters expose 30 distinct scrapbook scenes and preserve original and favorite scenes', () => {
  const custom = {id: 'custom-example', builtIn: false};
  const backgrounds = [...BUILT_IN_BACKGROUNDS, custom];
  const favorites = new Set(['space', 'hanok-alley', custom.id]);
  assert.equal(new Set(BUILT_IN_BACKGROUNDS.map(b => b.id)).size, 38);
  assert.equal(listBackgrounds(backgrounds, 'recommended', favorites).length, 10);
  assert.equal(listBackgrounds(backgrounds, 'base', favorites).length, 8);
  for (const [category] of BACKGROUND_THEMES) {
    assert.equal(listBackgrounds(backgrounds, category, favorites).length, 5);
  }
  assert.deepEqual(listBackgrounds(backgrounds, 'favorites', favorites).map(b => b.id), [...favorites]);
  assert.deepEqual(listBackgrounds(backgrounds, 'custom', favorites), [custom]);
});

test('teacher settings accept the new built-in backgrounds without bundling image data', () => {
  const backgroundIds = ['track-finish', 'rainy-alley', 'space', 'submarine'];
  const preset = {
    count: 4, layout: 'strip', frame: '#ad3b1e', timer: 3, caption: '', subtitle: '',
    school: '', date: '', backgrounds: backgroundIds, customMissions: []
  };
  const imported = validateBundle({version: 1, preset, backgrounds: [], logo: null});
  assert.deepEqual(imported.preset.backgrounds, backgroundIds);
  assert.deepEqual(imported.backgrounds, []);
});
