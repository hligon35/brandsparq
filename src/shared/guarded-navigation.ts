export type NavigationGuardState = {
  current: { dirty(): boolean; leave(): Promise<boolean> } | null;
  navigating?: boolean;
};
export async function runGuardedNavigation(guard: NavigationGuardState, action: () => void) {
  if (guard.navigating) return;
  guard.navigating = true;
  try {
    if (!guard.current || (await guard.current.leave())) action();
  } finally {
    guard.navigating = false;
  }
}
export function interceptTabPress(
  event: { preventDefault(): void },
  guard: NavigationGuardState,
  action: () => void,
  alreadyFocused: boolean,
) {
  if (alreadyFocused || !guard.current?.dirty()) return;
  event.preventDefault();
  void runGuardedNavigation(guard, action);
}
