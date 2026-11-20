import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {newProject,addItem,History,presetOf,isComplete} from '../dist/core.mjs';
globalThis.crypto??=webcrypto;
test('repeated groups reset photo state and retain only teacher settings',()=>{
 let settings={timer:3,sound:false,mission:true,customMissions:[]},project=newProject(),history=new History();
 for(let group=0;group<12;group++){
  for(const cut of project.cuts){history.record(project);addItem(cut,`photo-${group}`,200,200);}
  assert.equal(isComplete(project),true);const preset=presetOf(project,settings);history.clear();project=newProject(preset);
  assert.equal(isComplete(project),false);assert.equal(history.past.length,0);assert.equal(project.cuts.flatMap(c=>c.items).length,0);assert.equal(JSON.stringify(preset).includes('photo-'),false);
 }
});
