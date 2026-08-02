# Simulation verification presets

`mission8-established-prey.json` is a frozen, fish-free Mission 8 aquarium
captured after the Daphnia, shrimp, Vallisneria, producer, and microbe
communities had established. The Mission 8 long-run verifier loads this state
by default and releases a fresh ricefish pair immediately, avoiding repeated
prey-community setup on every calibration run.

Regenerate the preset only when the pre-predator fixture or save schema changes.
The preset intentionally resets ricefish inventory and historical population
events before it is committed.

The verifier also accepts a saved in-progress checkpoint, so a long run can be
continued without repeating either establishment or the already verified
predator interval:

```sh
npm run verify:mission-8-food-web -- \
  --resume=tmp/mission8-checkpoint.json \
  --duration=2400 \
  --save-output=tmp/mission8-next-checkpoint.json \
  --report-output=tmp/mission8-next-report.json
```
