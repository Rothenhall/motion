import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FeaturesService } from './features.service';

/** "alex@example.com" becomes "Alex's workspace". Used for the first workspace someone gets. */
export function workspaceName(email: string): string {
  const local = email.split('@')[0] || 'My';
  return `${local.charAt(0).toUpperCase()}${local.slice(1)}'s workspace`;
}

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService, private features: FeaturesService) {}

  /** A new client workspace. `aiEnabled` turns the AI switch on straight away (it starts off for clients an agency creates). */
  async create(opts: { name: string; createdById?: string; aiEnabled?: boolean }) {
    const client = await this.prisma.client.create({ data: { name: opts.name, createdById: opts.createdById } });
    if (opts.aiEnabled) await this.features.set(client.id, 'ai', true, opts.createdById);
    return client;
  }
}
