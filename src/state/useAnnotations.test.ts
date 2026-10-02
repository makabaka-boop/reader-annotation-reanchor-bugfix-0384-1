// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Book } from '../types';
import { useAnnotations } from './useAnnotations';
import { sampleBookV1, sampleBookV2 } from '../samples';

beforeEach(() => {
  localStorage.clear();
});

/**
 * 构造同一本书的两个版本：v2 中原句所在段落文字不变（旧坐标处读到的仍是
 * 「他点了点头。」），但下一段被改写并插入了两处相同短句——上下文已改变、
 * 全章共三处匹配。坐标权威路径会因此误保留旧高亮并跳过待裁决。
 */
function dupV1(): Book {
  return {
    id: 'dup-book',
    title: '重复句',
    version: '1',
    chapters: [
      {
        id: 'c1',
        title: '第一章',
        paragraphs: [
          { id: 'p1', text: '清晨，他点了点头。' },
          { id: 'p2', text: '街坊们都知道，这门手艺传了三代。' },
        ],
      },
    ],
  };
}

function dupV2(): Book {
  return {
    id: 'dup-book',
    title: '重复句',
    version: '2',
    chapters: [
      {
        id: 'c1',
        title: '第一章',
        paragraphs: [
          { id: 'p1', text: '清晨，他点了点头。' },
          {
            id: 'p2',
            text: '他点了点头。又一日，他点了点头。街坊们都知道，这门手艺在镇上传了三代。',
          },
        ],
      },
    ],
  };
}

describe('useAnnotations 端到端', () => {
  it('新增批注 → 持久化 → 重载入同一版本仍定位', () => {
    const { result, rerender } = renderHook(() => useAnnotations());

    act(() => result.current.importBook(structuredClone(sampleBookV1)));
    const ch = result.current.flat!.chapters[0];
    const s = ch.text.indexOf('王木匠推开店门');
    act(() => result.current.addAnnotation(ch.id, s, s + '王木匠推开店门'.length, '第一条'));
    const id = result.current.annotations[0].id;
    expect(result.current.annotations[0].status).toBe('anchored');
    expect(JSON.parse(localStorage.getItem('reader:annotations:sample-book')!)[0].anchor.text).toContain('王木匠');

    // 模拟刷新：重新载入同一版本
    const { result: r2 } = renderHook(() => useAnnotations());
    act(() => r2.current.importBook(structuredClone(sampleBookV1)));
    expect(r2.current.annotations).toHaveLength(1);
    expect(r2.current.annotations[0].id).toBe(id);
    expect(r2.current.annotations[0].status).toBe('anchored');
    expect(r2.current.annotations[0].note).toBe('第一条');
    rerender();
  });

  it('导入新版本：唯一迁移 / 多处待裁决 / 找不到失联；裁决与删除分别作用于重叠批注', () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.importBook(structuredClone(sampleBookV1)));
    const ch = result.current.flat!.chapters[0];
    const add = (needle: string) => {
      const s = ch.text.indexOf(needle);
      act(() => result.current.addAnnotation(ch.id, s, s + needle.length, needle));
    };
    add('王木匠推开店门');
    add('他点了点头。');
    add('只剩一盏灯还亮着');

    // 导入 v2 触发重锚
    act(() => result.current.importBook(structuredClone(sampleBookV2)));
    const [a, b, c] = result.current.annotations;
    expect(a.status).toBe('anchored');
    expect(b.status).toBe('ambiguous');
    expect(b.candidates).toHaveLength(2);
    expect(c.status).toBe('lost');
    // 失联批注保留原文证据
    expect(c.anchor.text).toBe('只剩一盏灯还亮着');

    // 裁决选第二个候选
    act(() => result.current.resolve(b.id, b.candidates![1]));
    const resolved = result.current.annotations.find((x) => x.id === b.id)!;
    expect(resolved.status).toBe('anchored');
    expect(resolved.anchor.start).toBe(b.candidates![1].start);

    // 删除只影响被删的一条，其余保留（重叠批注可分别删除）
    act(() => result.current.deleteAnnotation(a.id));
    expect(result.current.annotations.map((x) => x.id)).toEqual([b.id, c.id]);
  });

  it('失联批注修改备注后仍持久化，且不会被系统猜测放置', () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.importBook(structuredClone(sampleBookV1)));
    const ch = result.current.flat!.chapters[0];
    const s = ch.text.indexOf('只剩一盏灯还亮着');
    act(() => result.current.addAnnotation(ch.id, s, s + 8, '证据'));
    act(() => result.current.importBook(structuredClone(sampleBookV2)));
    const lost = result.current.annotations[0];
    expect(lost.status).toBe('lost');
    act(() => result.current.updateNote(lost.id, '补充说明'));
    const stored = JSON.parse(localStorage.getItem('reader:annotations:sample-book')!);
    expect(stored[0].note).toBe('补充说明');
    expect(stored[0].status).toBe('lost');
  });

  it('刷新后直接导入新版本：旧坐标文字仍吻合也强制重锚，多处匹配进入待裁决', () => {
    // 第一次会话：在 v1 上保存批注（短句在 v1 仅一处）
    const first = renderHook(() => useAnnotations());
    act(() => first.result.current.importBook(structuredClone(dupV1())));
    const ch1 = first.result.current.flat!.chapters[0];
    const s = ch1.text.indexOf('他点了点头。');
    act(() => first.result.current.addAnnotation(ch1.id, s, s + 6, '原批注'));
    const id = first.result.current.annotations[0].id;

    // 模拟刷新：全新的内存状态，直接导入 v2（不经过同会话的 v1→v2）
    const after = renderHook(() => useAnnotations());
    act(() => after.result.current.importBook(structuredClone(dupV2())));
    const ann = after.result.current.annotations[0];
    expect(ann.id).toBe(id);
    // 旧坐标处文字虽仍一致，但新版本中该句出现三次、上下文已改变 → 必须待裁决
    expect(ann.status).toBe('ambiguous');
    expect(ann.candidates).toHaveLength(3);
    // 上下文评分：原句整体平移到 p2（其后仍接保存的后缀「街坊们都知道…」），
    // 得分最高排第一；旧坐标处仅前缀「清晨，」吻合，分数较低但作为候选保留。
    const byFlat = new Map(ann.candidates!.map((c) => [c.start, c]));
    expect(ann.candidates![0].start).toBe(20);
    expect(ann.candidates![0].score).toBeGreaterThan(byFlat.get(s)!.score);
    expect(byFlat.has(s)).toBe(true);
  });

  it('刷新后直接导入新版本：坐标漂移与失联按证据判定，跨段落选区自动迁移', () => {
    const first = renderHook(() => useAnnotations());
    act(() => first.result.current.importBook(structuredClone(sampleBookV1)));
    const ch = first.result.current.flat!.chapters[0];
    // 跨段落选区（p1 尾 → p2 头），锚点文字含段界定符
    const p1End = ch.paragraphs[0].textEnd;
    const crossStart = p1End - 3;
    const crossEnd = ch.paragraphs[1].start + 3;
    const crossText = ch.text.slice(crossStart, crossEnd);
    act(() => first.result.current.addAnnotation(ch.id, crossStart, crossEnd, '跨段'));
    const insertAt = ch.text.indexOf('只剩一盏灯还亮着');
    act(() =>
      first.result.current.addAnnotation(ch.id, insertAt, insertAt + '只剩一盏灯还亮着'.length, '末段'),
    );

    // 刷新后直接导入 v2
    const after = renderHook(() => useAnnotations());
    act(() => after.result.current.importBook(structuredClone(sampleBookV2)));
    const [cross, gone] = after.result.current.annotations;
    expect(cross.status).toBe('anchored');
    expect(cross.anchor.text.replace(/\n/g, '')).toBe(crossText.replace(/\n/g, ''));
    expect(gone.status).toBe('lost');
    expect(gone.anchor.text).toBe('只剩一盏灯还亮着');
  });

  it('再次刷新后重载新版本：已重锚/已裁决的批注与导出版本保持一致', () => {
    const first = renderHook(() => useAnnotations());
    act(() => first.result.current.importBook(structuredClone(dupV1())));
    const ch1 = first.result.current.flat!.chapters[0];
    const s = ch1.text.indexOf('他点了点头。');
    act(() => first.result.current.addAnnotation(ch1.id, s, s + 6, '原批注'));
    const id = first.result.current.annotations[0].id;

    // 刷新后导入 v2 → 待裁决；裁决采用旧坐标之外、评分最高的候选（原句平移处）
    const after = renderHook(() => useAnnotations());
    act(() => after.result.current.importBook(structuredClone(dupV2())));
    const chosen = after.result.current.annotations[0].candidates![0];
    expect(chosen.start).not.toBe(s);
    act(() => after.result.current.resolve(id, chosen));
    expect(after.result.current.annotations[0].anchor.start).toBe(chosen.start);

    // 再次刷新：重载同一版本 v2，裁决结果必须原样保留，不回退为待裁决
    const reloaded = renderHook(() => useAnnotations());
    act(() => reloaded.result.current.importBook(structuredClone(dupV2())));
    const ann = reloaded.result.current.annotations[0];
    expect(ann.status).toBe('anchored');
    expect(ann.anchor.start).toBe(chosen.start);
    expect(ann.anchor.end).toBe(chosen.end);
  });
});
