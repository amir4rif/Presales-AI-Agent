/**
 * Coordinates asynchronous reads whose responses replace one shared cache.
 *
 * Once a newer read starts, an older read is no longer allowed to commit. The
 * older caller follows the newer promise so it cannot report completion before
 * the cache contains the newest requested snapshot.
 */
export class LatestRequestCoordinator {
  private latestRequest = 0;
  private latestCompletion: Promise<void> | null = null;

  run<T>(
    request: (isLatest: () => boolean) => Promise<T>,
    commit: (value: T) => void
  ): Promise<void> {
    const requestId = ++this.latestRequest;
    const isLatest = () => requestId === this.latestRequest;

    // Defer invocation until `latestCompletion` below points at this request.
    // That also lets multiple requests made in one synchronous turn collapse
    // before any unnecessary network work starts.
    const operation = Promise.resolve().then(async () => {
      try {
        if (!isLatest()) return false;
        const value = await request(isLatest);
        if (!isLatest()) return false;
        // Keep commits synchronous: no newer request can interleave between
        // the final freshness check and replacement of the shared cache.
        commit(value);
        return isLatest();
      } catch (error) {
        // A superseded failure is irrelevant; the newer request is the one
        // whose result (or error) must be observed by every waiting caller.
        if (!isLatest()) return false;
        throw error;
      }
    });

    const tracked = operation.then(async (committed) => {
      if (committed) return;
      const newer = this.latestCompletion;
      if (newer && newer !== tracked) await newer;
    });
    this.latestCompletion = tracked;
    return tracked;
  }
}

/**
 * Reserves complete asynchronous transactions in call order. Registration is
 * synchronous, so a later caller cannot slip between an earlier caller's wait,
 * canonical read, and write.
 */
export class SerialTaskCoordinator {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T> | T): Promise<T> {
    const operation = this.tail
      .catch(() => undefined)
      .then(task);
    this.tail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }
}
