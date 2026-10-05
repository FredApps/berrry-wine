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

  // Who can unblock a task, from recorded fields only: [actor, basis].
  // 'user' = needs the user's input or resources; 'agent' = an agent or the
  // coordinator can resolve it. A task that records nothing is the owner's to
  // clarify, which is agent work, and the basis says so.
  function actor(snapshot, task) {
    const waiting = String(task.waitingOn || '').trim();
    if (dependencies(snapshot, task).length) return ['agent', 'Waits on another blocked task'];
    const category = kind(snapshot, task)[0];
    if (/\bno (?:user|human) (?:decision|input|action)\b/i.test(waiting)) return ['agent', 'Waiting on: ' + waiting];
    if (/\b(?:user|human|you|maintainer|dashboard-user|approval)\b/i.test(waiting)) return ['user', 'Waiting on: ' + waiting];
    if (category === 'Review blocked') return ['user', 'Automated review stopped validation; agents must not retry it, so a person decides'];
    if (category === 'Capacity needed') return ['user', 'Capacity needed (host, CPU or GPU): ' + (task.needs || waiting || 'not described')];
    if (waiting) return ['agent', 'Waiting on: ' + waiting];
    return ['agent', 'No waitingOn recorded; the owner must state what is needed'];
  }

  function split(snapshot, tasks) {
    const user = [], agent = [];
    for (const task of tasks) (actor(snapshot, task)[0] === 'user' ? user : agent).push(task);
    return { user, agent };
  }

  function blockerSummary(snapshot) {
    const blocked = order(snapshot, (snapshot.tasks || []).filter(task => task.status === 'blocked'));
    const roots = primaryRoots(snapshot, blocked);
    const approvals = (snapshot.approvals?.items || []).filter(item => !item.sent);
    const { user, agent } = split(snapshot, roots);
    return { blocked, roots, dependentCount: blocked.length - roots.length, approvals, needsUser: user, agentResolvable: agent };
  }

  return { actor, blockerSummary, dependencies, kind, order, primaryRoots, split };
});
