export function sweepInterval(value: string | undefined) {
  const interval = Number(value ?? '30000');
  if (!Number.isInteger(interval) || interval < 1 || interval > 3600000)
    throw new Error('HOLD_SWEEP_INTERVAL_MS inválido.');
  return interval;
}
// Uma execução por processo; múltiplos processos são seguros pela atualização condicional no DB.
export function startHoldExpiry(
  run: () => Promise<unknown>,
  interval: number,
  onError: () => void,
) {
  let pending: Promise<void> | undefined;
  const tick = () => {
    if (pending) return;
    pending = Promise.resolve()
      .then(run)
      .then(() => {}, onError)
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(tick, interval);
  tick();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
