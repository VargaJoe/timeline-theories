interface CoverTimeline { id: string; name: string }

/** One view's bounded, cancellable queue. Results are published as each card is ready. */
export function createTimelineCoverLoader(
  load: (timeline: CoverTimeline, signal: AbortSignal) => Promise<string[]>,
  publish: (timeline: CoverTimeline, covers: string[]) => void,
) {
  const controller = new AbortController();
  const requested = new Set<string>();
  const queue: CoverTimeline[] = [];
  let active = 0;
  const pump = () => {
    while (!controller.signal.aborted && active < 2 && queue.length) {
      const timeline = queue.shift()!;
      active++;
      void Promise.resolve().then(() => load(timeline, controller.signal))
        .catch(() => [] as string[])
        .then(covers => { if (!controller.signal.aborted) publish(timeline, covers); })
        .finally(() => { active--; pump(); });
    }
  };
  return {
    enqueue(timelines: CoverTimeline[]) {
      if (controller.signal.aborted) return;
      for (const timeline of timelines) if (!requested.has(timeline.id)) {
        requested.add(timeline.id); queue.push(timeline);
      }
      pump();
    },
    dispose() { controller.abort(); queue.length = 0; },
  };
}
