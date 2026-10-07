import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

/** What staff did to a client's workspace. Writing an entry must never stop the action it describes. */
@Injectable()
export class AuditService {
  private log = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async record(actorId: string, action: string, opts: { clientId?: string | null; targetType?: string; targetId?: string; meta?: Prisma.InputJsonValue } = {}) {
    try {
      await this.prisma.adminAuditLog.create({ data: { actorId, action, clientId: opts.clientId ?? null, targetType: opts.targetType, targetId: opts.targetId, meta: opts.meta } });
    } catch (e) {
      this.log.warn(`Could not record ${action}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Newest first, with who did it. */
  async forClient(clientId: string, take = 100) {
    const rows = await this.prisma.adminAuditLog.findMany({ where: { clientId }, orderBy: { at: 'desc' }, take });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } }, select: { id: true, email: true } });
    const email = new Map(users.map((u) => [u.id, u.email]));
    return rows.map((r) => ({ id: r.id, at: r.at, action: r.action, targetType: r.targetType, targetId: r.targetId, meta: r.meta, actor: { id: r.actorId, email: email.get(r.actorId) ?? null } }));
  }
}
