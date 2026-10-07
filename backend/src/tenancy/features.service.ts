import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FEATURE_DEFAULTS, FeatureKey, FeatureMap, isFeatureKey } from './features.constants';

@Injectable()
export class FeaturesService {
  constructor(private prisma: PrismaService) {}

  /** Every switch for a client: the default, unless an admin made a deliberate change. */
  async forClient(clientId: string): Promise<FeatureMap> {
    const rows = await this.prisma.clientFeatureFlag.findMany({ where: { clientId } });
    const map = { ...FEATURE_DEFAULTS };
    for (const row of rows) if (isFeatureKey(row.featureKey)) map[row.featureKey] = row.enabled;
    return map;
  }

  async set(clientId: string, key: string, enabled: boolean, updatedById?: string) {
    if (!isFeatureKey(key)) throw new BadRequestException(`Unknown feature: ${key}.`);
    await this.prisma.clientFeatureFlag.upsert({
      where: { clientId_featureKey: { clientId, featureKey: key } },
      update: { enabled, updatedById },
      create: { clientId, featureKey: key, enabled, updatedById },
    });
  }

  async isEnabled(clientId: string, key: FeatureKey): Promise<boolean> {
    return (await this.forClient(clientId))[key];
  }
}
