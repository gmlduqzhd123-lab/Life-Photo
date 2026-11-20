import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKGROUND_THEMES, BUILT_IN_BACKGROUNDS, listBackgrounds, searchBackgrounds} from '../dist/background-catalog.mjs';
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

test('background search matches Korean names, aliases and custom names across collections', () => {
  const custom = {id: 'custom-example', name: '우리 반 특별 사진관', builtIn: false};
  const all = [...BUILT_IN_BACKGROUNDS, custom];
  const ids = query => searchBackgrounds(all, query).map(background => background.id);
  assert.deepEqual(ids('  바다 '), ['ocean', 'submarine']);
  assert.deepEqual(ids('체육 대회'), ['track-finish']);
  assert.deepEqual(ids('학교 운동회'), ['track-finish']);
  assert.deepEqual(ids('특별사진관'), [custom.id]);
  assert.deepEqual(ids('없는 장소'), []);
  assert.deepEqual(searchBackgrounds([custom], '우주'), []);
});
