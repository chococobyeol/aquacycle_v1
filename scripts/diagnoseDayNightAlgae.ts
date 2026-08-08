import { SCENARIOS } from '../src/simulation/config';
import { dayNightStateAt } from '../src/simulation/dayNight';
import {
  attachedAlgaeEffectiveLight,
  netGrowthPotential,
} from '../src/simulation/growth';

const cycle = SCENARIOS['mission-6'].dayNightCycle!;
for (const maximumLight of [20, 40, 60, 80, 100]) {
  for (const oedogonium of [0, 0.1, 0.2]) {
    let nitzschia = 0;
    let greenAlgae = 0;
    for (let second = 0; second < 360; second += 1) {
      const incident = maximumLight * dayNightStateAt(second, cycle).lightMultiplier;
      nitzschia += netGrowthPotential(
        'nitzschia',
        attachedAlgaeEffectiveLight('nitzschia', incident, oedogonium),
        24,
      );
      greenAlgae += netGrowthPotential('oedogonium', incident, 24);
    }
    console.log(JSON.stringify({
      maximumLight,
      oedogonium,
      nitzschia: nitzschia / 360,
      oedogoniumRate: greenAlgae / 360,
    }));
  }
}
