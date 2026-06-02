import { describe, it, expect, beforeEach } from 'vitest';
import { useToastStore } from './toastStore';

const reset = () => useToastStore.setState({ toasts: [] });

describe('toastStore', () => {
  beforeEach(reset);

  it('addToast appends and returns a unique id', () => {
    const id1 = useToastStore.getState().addToast({ kind: 'info', title: 'A' });
    const id2 = useToastStore.getState().addToast({ kind: 'info', title: 'B' });
    expect(id1).not.toEqual(id2);
    expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual(['A', 'B']);
    expect(useToastStore.getState().toasts[0].id).toEqual(id1);
  });

  it('updateToast patches by id', () => {
    const id = useToastStore.getState().addToast({ kind: 'progress', title: 'Removing…' });
    useToastStore.getState().updateToast(id, { kind: 'success', title: 'Removed', duration: 4000 });
    const t = useToastStore.getState().toasts.find((x) => x.id === id)!;
    expect(t.kind).toEqual('success');
    expect(t.title).toEqual('Removed');
    expect(t.duration).toEqual(4000);
  });

  it('dismissToast removes by id', () => {
    const id = useToastStore.getState().addToast({ kind: 'error', title: 'X' });
    useToastStore.getState().dismissToast(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('caps the stack at 4, dropping the oldest', () => {
    const ids = ['A', 'B', 'C', 'D', 'E'].map((title) =>
      useToastStore.getState().addToast({ kind: 'info', title })
    );
    const titles = useToastStore.getState().toasts.map((t) => t.title);
    expect(titles).toEqual(['B', 'C', 'D', 'E']); // 'A' (oldest) dropped
    expect(useToastStore.getState().toasts.find((t) => t.id === ids[0])).toBeUndefined();
  });

  it('progress → succeed flips the same toast to success in place', () => {
    const id = useToastStore.getState().addToast({ kind: 'progress', title: 'Removing…' });
    useToastStore.getState().updateToast(id, { kind: 'success', title: 'Removed', duration: 4000 });
    const ts = useToastStore.getState().toasts;
    expect(ts).toHaveLength(1);
    expect(ts[0].kind).toEqual('success');
  });

  it('does not evict an in-flight progress toast when capping', () => {
    const pid = useToastStore.getState().addToast({ kind: 'progress', title: 'Removing…' });
    ['A', 'B', 'C', 'D'].forEach((title) =>
      useToastStore.getState().addToast({ kind: 'info', title })
    );
    const ts = useToastStore.getState().toasts;
    expect(ts.find((x) => x.id === pid)).toBeDefined();   // progress survives
    expect(ts).toHaveLength(4);
    expect(ts.map((x) => x.title)).toEqual(['Removing…', 'B', 'C', 'D']); // oldest non-progress ('A') dropped
  });
});
