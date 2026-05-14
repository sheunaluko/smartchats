import type { ShellDefinition, ShellTarget } from './types';

/**
 * Shell registry — manages available shells and runtime selection.
 *
 * Shells register themselves (typically in their index file),
 * and the app host queries the registry to render the active shell.
 */

const shells: Map<string, ShellDefinition> = new Map();

export function registerShell(shell: ShellDefinition): void {
  shells.set(shell.metadata.id, shell);
}

export function getShell(id: string): ShellDefinition | undefined {
  return shells.get(id);
}

export function listShells(target?: ShellTarget): ShellDefinition[] {
  const all = Array.from(shells.values());
  if (!target) return all;
  return all.filter(s => s.metadata.target === target);
}

export function getShellIds(): string[] {
  return Array.from(shells.keys());
}
