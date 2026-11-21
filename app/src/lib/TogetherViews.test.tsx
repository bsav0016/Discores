import { create, type ReactTestInstance } from 'react-test-renderer';
import type { CourseBoard, FriendRecord } from '@/domain/together';
import { CourseBoardView, GroupSection, TogetherCard } from './TogetherViews';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const texts = (node: ReactTestInstance): string[] =>
  node.findAll((n) => (n.type as unknown) === 'Text' || (n.type as any)?.displayName === 'Text')
    .map((n) => [n.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .filter(Boolean);
const render = (ui: React.ReactElement) => {
  let r: ReturnType<typeof create>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-test-renderer').act(() => {
    r = create(ui);
  });
  return r!;
};

const record = (over: Partial<FriendRecord> = {}): FriendRecord => ({
  userId: 'f1', name: 'Fay', roundsTogether: 3, compared: 2, wins: 1, ties: 0, losses: 1, averageDiff: -1.5,
  bestRound: { roundId: 'a', courseName: 'Maple Hill', startedAt: '2026-11-01T10:00:00Z', diff: -4, myTotal: 40, theirTotal: 44 },
  rounds: [
    { roundId: 'b', courseName: 'Oak Park', startedAt: '2026-11-08T10:00:00Z', diff: 1, myTotal: 45, theirTotal: 44 },
    { roundId: 'a', courseName: 'Maple Hill', startedAt: '2026-11-01T10:00:00Z', diff: -4, myTotal: 40, theirTotal: 44 },
  ],
  lastPlayed: '2026-11-08T10:00:00Z', ...over,
});

describe('TogetherCard', () => {
  it('shows an empty state with no shared finished rounds', () => {
    const all = texts(render(<TogetherCard name="Fay" record={undefined} />).root).join(' | ');
    expect(all).toContain('No finished rounds with Fay yet.');
  });

  it('shows the record, the average, the best round and the last rounds', () => {
    const all = texts(render(<TogetherCard name="Fay" record={record()} />).root).join(' | ');
    expect(all).toContain('3 rounds together');
    expect(all).toContain('Record 1-0-1');
    expect(all).toContain('On average 1.5 ahead');
    expect(all).toContain('Best 4 ahead at Maple Hill');
    expect(all).toContain('Oak Park');
    expect(all).toContain('45–44');
    expect(all).toContain("Strokes, yours then Fay's.");
  });

  it('explains when nothing is comparable yet', () => {
    const all = texts(render(<TogetherCard name="Fay" record={record({ compared: 0, rounds: [], averageDiff: null, bestRound: null })} />).root).join(' | ');
    expect(all).toContain('no record to show');
    expect(all).not.toContain('Record ');
  });
});

describe('GroupSection', () => {
  it('renders nothing without friends', () => {
    expect(render(<GroupSection records={[]} />).toJSON()).toBeNull();
  });

  it('lists each friend and opens their page with the friend kind', () => {
    const r = render(<GroupSection records={[record(), record({ userId: 'f2', name: 'Bo', compared: 0, rounds: [] })]} />);
    const all = texts(r.root).join(' | ');
    expect(all).toContain('Your group');
    expect(all).toContain('Fay');
    expect(all).toContain('No full rounds to compare yet.');
    const card = r.root.findAll((n) => typeof n.props.onPress === 'function')[0];
    card.props.onPress();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/person/[id]', params: { id: 'f1', name: 'Fay', kind: 'friend' } });
  });
});

describe('CourseBoardView', () => {
  it('ranks the group on the course, you included', () => {
    const board: CourseBoard = {
      layoutId: 'L1', courseName: 'Maple Hill', holeCount: 18,
      entries: [
        { userId: 'f1', name: 'Fay', isMe: false, total: 52, relative: -2, roundId: 'a', startedAt: '2026-11-01T10:00:00Z' },
        { userId: 'me', name: 'You', isMe: true, total: 56, relative: 2, roundId: 'b', startedAt: '2026-11-02T10:00:00Z' },
      ],
    };
    const all = texts(render(<CourseBoardView board={board} />).root);
    expect(all).toEqual(expect.arrayContaining(["YOUR GROUP'S BEST ROUNDS", 'Fay', '52', 'You', '56']));
    expect(all.indexOf('Fay')).toBeLessThan(all.indexOf('You'));
  });
});
