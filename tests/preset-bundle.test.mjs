import test from 'node:test';import assert from 'node:assert/strict';import {validateBundle} from '../dist/preset-bundle.mjs';
import {newProject,presetOf} from '../dist/core.mjs';
const preset={count:4,layout:'strip',frame:'#7862da',timer:3,caption:'우리 반',subtitle:'오늘',school:'',date:'',backgrounds:['space','space','space','space'],customMissions:[]};
test('validates imported settings and rejects malformed and unreferenced payloads',()=>{const ok=validateBundle({version:1,preset,backgrounds:[],logo:null});assert.equal(ok.preset.count,4);assert.throws(()=>validateBundle({version:1,preset:{...preset,count:100},backgrounds:[]}));assert.throws(()=>validateBundle({version:1,preset:{...preset,backgrounds:['custom-missing','space','space','space']},backgrounds:[]}));assert.throws(()=>validateBundle({version:1,preset,backgrounds:[{id:'custom-x',name:'x',data:'data:image/svg+xml;base64,AAAA'}]}));});

test('older settings retain the classic frame and new frames survive the preset round trip', () => {
  const bundle = {version: 1, preset, backgrounds: [], logo: null};
  assert.equal(newProject(validateBundle(bundle).preset).frameStyle, 'classic');
  for (const frameStyle of ['grid-paper', 'tape', 'paper-label']) {
    const imported = validateBundle({...bundle, preset: {...preset, frameStyle}});
    assert.equal(presetOf(newProject(imported.preset), preset).frameStyle, frameStyle);
  }
});
