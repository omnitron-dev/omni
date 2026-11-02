import { describe, expect, it } from 'vitest';
import { defaultBoard, exportBoard, importBoard, parseBoard, parseBoards } from '../../webapp/src/utils/dashboard-layout.js';

describe('portable dashboard layouts', () => {
  it('restores v2 definitions and gives an imported board its own identity', () => {
    const { window: _old, ...board }=defaultBoard();
    const restored=parseBoard({ ...board, panels:[{ id:'legacy', type:'uptime-chart', title:'Uptime', size:'small', config:{} }] });
    expect(restored.window).toBe('15m');
    expect(restored.panels[0]).toMatchObject({ type:'stat', config:{metric:'uptime'} });
    const decoded=importBoard(exportBoard(restored));
    expect(decoded.id).not.toBe(restored.id);
    expect(decoded.panels).toEqual(restored.panels);
  });
  it('rejects malformed imports and excessive polling before replacing a dashboard', () => {
    const board=defaultBoard();
    expect(()=>parseBoard({...board,refreshInterval:1})).toThrow(/interval/);
    expect(()=>parseBoards(JSON.stringify([board,board]))).toThrow(/Duplicate/);
    expect(()=>importBoard(' '.repeat(140000))).toThrow(/128 KiB/);
    expect(()=>importBoard(JSON.stringify({version:42}))).toThrow(/version/);
    expect(()=>parseBoard({...board,panels:[{...board.panels[0],type:'__proto__'}]})).toThrow(/Unsupported/);
  });
});
