(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BlockerModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function dependencies(snapshot, task) {
    return (snapshot.tasks || []).filter(other => other.id !== task.id && other.status === 'blocked' &&
      ((task.dependencies || []).includes(other.id) || (task.waitingOn || '').split(/[^a-zA-Z0-9_.-]+/).includes(other.id)));
  }

  function kind(snapshot, task) {
    if (dependencies(snapshot, task).length) return ['Dependency', 'neutral', 'View dependency'];
    if (/automated.*review|review.*resolution/i.test(task.waitingOn + ' ' + task.blocker)) return ['Review blocked', 'warn', 'Message owner'];
    if (/host|capacity|CPU|GPU/i.test(task.waitingOn + ' ' + task.needs)) return ['Capacity needed', 'warn', 'Provide capacity'];
    return ['Needs follow-up', 'warn', 'Message owner'];
  }

  function order(snapshot, tasks) {
    return [...tasks].sort((a, b) => Number(kind(snapshot, a)[0] === 'Review blocked') -
      Number(kind(snapshot, b)[0] === 'Review blocked') || a.line - b.line);
  }

  function primaryRoots(snapshot, tasks) {
    const roots = tasks.filter(task => !dependencies(snapshot, task).length);
    // Preserve the dashboard fallback for an all-cycle selection.
    return order(snapshot, roots.length ? roots : tasks);
  }

  function blockerSummary(snapshot) {
    const blocked = order(snapshot, (snapshot.tasks || []).filter(task => task.status === 'blocked'));
    const roots = primaryRoots(snapshot, blocked);
    return { blocked, roots, dependentCount: blocked.length - roots.length,
      approvals: (snapshot.approvals?.items || []).filter(item => !item.sent) };
  }

  return { blockerSummary, dependencies, kind, order, primaryRoots };
});
