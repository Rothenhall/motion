import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/**
 * A channel can be connected to one client at a time, so comments, automations and publishing are never handled twice.
 * Throws a message that names where it is already connected. A disconnected channel is free to connect elsewhere.
 */
export async function assertChannelFree(prisma: Pick<PrismaService, 'socialAccount'>, provider: string, externalId: string, clientId: string) {
  const clash = await prisma.socialAccount.findFirst({
    where: { provider, externalId, disconnectedAt: null, OR: [{ clientId: null }, { clientId: { not: clientId } }] },
    select: { client: { select: { name: true } } },
  });
  if (clash) {
    throw new ConflictException({ statusCode: 409, code: 'CHANNEL_ALREADY_CONNECTED', message: `This channel is already connected to ${clash.client?.name ?? 'another client'}. Disconnect it there first.` });
  }
}

/** True when a database error is the one-connected-channel rule being hit by two requests at once. */
export const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';
