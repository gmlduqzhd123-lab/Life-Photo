import {THEMES} from './core.mjs?v=scrapbook-flow';

export const BACKGROUND_THEMES = [
  ['school', '학교와 행사', [
    ['track-finish', '체육대회 결승선'],
    ['graduation-wall', '졸업 포토월'],
    ['library-maze', '도서관 책장 미로'],
    ['science-lab', '과학실 실험대'],
    ['school-crosswalk', '등굣길 횡단보도']
  ]],
  ['season', '사계절', [
    ['cherry-lane', '벚꽃 등굣길'],
    ['summer-picnic', '여름 피크닉'],
    ['autumn-station', '단풍 기차역'],
    ['snowman-village', '눈사람 마을'],
    ['rainy-alley', '비 오는 골목']
  ]],
  ['nature', '자연 탐험', [
    ['aurora-field', '오로라 설원'],
    ['volcano-field', '화산 탐사 구역'],
    ['desert-dunes', '사막 모래언덕'],
    ['waterfall-bridge', '폭포 앞 출렁다리'],
    ['firefly-cave', '반딧불 동굴']
  ]],
  ['travel', '여행과 문화', [
    ['hanok-alley', '한옥 골목'],
    ['airport-gate', '세계 여행 출국장'],
    ['pyramids', '사막의 피라미드'],
    ['canal-bridge', '운하의 작은 다리'],
    ['night-market', '야시장 먹거리 골목']
  ]],
  ['storybook', '동화와 놀이', [
    ['giant-desk', '거인의 책상'],
    ['toy-train', '장난감 기차 마을'],
    ['cookie-bakery', '과자 집 베이커리'],
    ['treasure-map', '보물섬 지도'],
    ['popup-castle', '그림책 속 성']
  ]],
  ['future', '미래와 탐사', [
    ['lunar-base', '달 기지 관측실'],
    ['robot-workshop', '로봇 제작소'],
    ['sky-station', '공중 도시 정류장'],
    ['time-portal', '타임머신 승강장'],
    ['submarine', '심해 잠수정 조종실']
  ]]
];

export const BACKGROUND_FILTERS = [
  ['recommended', '추천 배경'],
  ...BACKGROUND_THEMES.map(([id, title]) => [id, title]),
  ['base', '기존 기본 배경'],
  ['custom', '내가 추가한 배경']
];

const recommended = new Set([
  'track-finish', 'graduation-wall', 'cherry-lane', 'summer-picnic', 'aurora-field',
  'hanok-alley', 'giant-desk', 'toy-train', 'lunar-base', 'robot-workshop'
]);

export const BUILT_IN_BACKGROUNDS = [
  ...THEMES.map(([id, name, desc]) => ({
    id, name, desc, builtIn: true, category: 'base', url: `./assets/backgrounds/${id}.svg`
  })),
  ...BACKGROUND_THEMES.flatMap(([category, , entries]) => entries.map(([id, name]) => ({
    id, name, category, builtIn: true, recommended: recommended.has(id),
    url: `./assets/backgrounds/scrapbook/${id}.webp`
  })))
];

export function listBackgrounds(backgrounds, filter, favorites) {
  if (filter === 'favorites') return backgrounds.filter(b => favorites.has(b.id));
  if (filter === 'recommended') return backgrounds.filter(b => b.recommended);
  if (filter === 'custom') return backgrounds.filter(b => !b.builtIn);
  return backgrounds.filter(b => b.category === filter);
}
