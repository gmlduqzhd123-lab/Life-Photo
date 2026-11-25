export const EVENT_TEMPLATES = [
  {
    id:'sports',name:'체육대회',background:'track-finish',caption:'우리 함께, 끝까지!',
    missions:['결승선 통과!', '서로 하이파이브!', '우승 세리머니!', '우리 팀 단체 응원!'],
    frame:'#a53d27',frameStyle:'tape',layout:'strip',count:4,timer:3,printCopies:'2'
  },
  {
    id:'graduation',name:'졸업',background:'graduation-wall',caption:'함께한 날들을 기억해',
    missions:['친구와 어깨동무!', '작은 하트!', '미래의 나에게 인사!', '마지막 단체 포즈!'],
    frame:'#72523f',frameStyle:'paper-label',layout:'strip',count:4,timer:5,printCopies:'2'
  },
  {
    id:'class',name:'학급 활동',background:'classroom',caption:'우리 반의 특별한 순간',
    missions:['우리 모둠만의 포즈!', '친구와 손하트!', '활동에서 가장 즐거웠던 장면!'],
    frame:'#416286',frameStyle:'grid-paper',layout:'grid',count:3,timer:3,printCopies:'1'
  }
];

export function builtInEventPreset(id, current) {
  const template = EVENT_TEMPLATES.find(entry => entry.id === id);
  if (!template) return null;
  const {name,background,caption,missions,frame,frameStyle,layout,count,timer,printCopies} = template;
  return {
    ...current, backgrounds:Array(4).fill(background), fits:Array(4).fill('cover'),
    caption, subtitle:'함께 만든 오늘의 추억', customMissions:[...missions], frame, frameStyle,
    layout, count, timer, printPaper:'A4', printCopies, mission:true, allBackgrounds:true,
    eventTemplate:{title:name}
  };
}
