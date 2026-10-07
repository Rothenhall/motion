import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { uploadNamesIn } from '../upload-names';
import { workspaceName } from './clients.service';

/** Lets two backend instances starting together take turns instead of both migrating the same rows. */
const LOCK_KEY = 7_236_001;

export type BackfillResult = { clientsCreated: number; rowsAssigned: number; mediaRecorded: number; promoted: number };

/**
 * Moves data that predates client workspaces into them. Runs at every start and does nothing once everything has a
 * client, so it is safe to leave in place:
 *   1. every user without a workspace gets one (named after them, with the AI switch on, as their account has always had it);
 *   2. everything a user owns (channels, drafts, ideas, hooks, brand profile, checks) joins that workspace;
 *   3. channels from before accounts existed (no owner) go to the first user's workspace;
 *   4. on the first pass, uploads referenced by posts, drafts and checks are recorded against their client.
 * Staff are named, not guessed: anyone listed in ADMIN_EMAILS (comma separated) is made an admin. Nobody is ever demoted
 * from here, so removing an address from the list does not lock anyone out; change a role deliberately instead.
 * It fails the start rather than half-finishing: rows with no client would simply vanish from the app.
 */
@Injectable()
export class TenancyBackfillService implements OnModuleInit {
  private log = new Logger(TenancyBackfillService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    const r = await this.run();
    if (r.promoted) this.log.log(`Made ${r.promoted} user(s) from ADMIN_EMAILS an admin.`);
    if (r.clientsCreated || r.rowsAssigned) this.log.log(`Moved existing data into client workspaces: ${r.clientsCreated} workspace(s), ${r.rowsAssigned} row(s), ${r.mediaRecorded} upload(s) recorded.`);
  }

  async run(): Promise<BackfillResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
      const result: BackfillResult = { clientsCreated: 0, rowsAssigned: 0, mediaRecorded: 0, promoted: 0 };

      // 0. staff named in ADMIN_EMAILS are admins
      const staff = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
      if (staff.length) result.promoted = (await tx.user.updateMany({ where: { email: { in: staff }, role: { not: 'ADMIN' } }, data: { role: 'ADMIN' } })).count;

      // 1. a workspace for everyone who lacks one (oldest first, so "the first user" is stable)
      for (const user of await tx.user.findMany({ where: { clientId: null }, orderBy: { createdAt: 'asc' } })) {
        const client = await tx.client.create({ data: { name: workspaceName(user.email), createdById: user.id } });
        await tx.clientFeatureFlag.create({ data: { clientId: client.id, featureKey: 'ai', enabled: true, updatedById: user.id } });
        await tx.user.update({ where: { id: user.id }, data: { clientId: client.id } });
        result.clientsCreated++;
      }

      // 2. what each user owns joins their workspace
      const unassigned = await Promise.all([
        tx.socialAccount.count({ where: { clientId: null } }),
        tx.postDraft.count({ where: { clientId: null } }),
        tx.contentIdea.count({ where: { clientId: null } }),
        tx.hook.count({ where: { clientId: null } }),
        tx.contentCheck.count({ where: { clientId: null } }),
        tx.brandProfile.count({ where: { clientId: null } }),
      ]);
      if (unassigned.some((n) => n > 0)) {
        for (const user of await tx.user.findMany({ where: { clientId: { not: null } }, select: { id: true, clientId: true }, orderBy: { createdAt: 'asc' } })) {
          const where = { userId: user.id, clientId: null };
          const data = { clientId: user.clientId };
          const moved = await Promise.all([
            tx.socialAccount.updateMany({ where, data }),
            tx.postDraft.updateMany({ where, data }),
            tx.contentIdea.updateMany({ where, data }),
            tx.hook.updateMany({ where, data }),
            tx.contentCheck.updateMany({ where, data }),
            tx.brandProfile.updateMany({ where, data }),
          ]);
          result.rowsAssigned += moved.reduce((sum, m) => sum + m.count, 0);
        }

        // 3. channels connected before user accounts existed belong to whoever set the workspace up first
        const first = await tx.user.findFirst({ where: { clientId: { not: null } }, orderBy: { createdAt: 'asc' }, select: { id: true, clientId: true } });
        if (first) {
          const orphans = await tx.socialAccount.updateMany({ where: { userId: null, clientId: null }, data: { userId: first.id, clientId: first.clientId } });
          result.rowsAssigned += orphans.count;
        }
      }

      // 4. record who uploaded what, once, right after the move
      if (result.clientsCreated || result.rowsAssigned) {
        const owned = new Map<string, string>(); // upload name -> client
        const note = (json: string, clientId: string | null) => { if (clientId) for (const name of uploadNamesIn(json)) if (!owned.has(name)) owned.set(name, clientId); };
        for (const p of await tx.scheduledPost.findMany({ select: { mediaUrls: true, account: { select: { clientId: true } } } })) note(p.mediaUrls, p.account.clientId);
        for (const d of await tx.postDraft.findMany({ select: { mediaUrls: true, clientId: true } })) note(d.mediaUrls, d.clientId);
        for (const c of await tx.contentCheck.findMany({ select: { mediaUrls: true, clientId: true } })) note(c.mediaUrls, c.clientId);
        if (owned.size) {
          const created = await tx.mediaFile.createMany({ data: [...owned].map(([name, clientId]) => ({ name, clientId })), skipDuplicates: true });
          result.mediaRecorded = created.count;
        }
      }
      return result;
    }, { timeout: 120_000 });
  }
}
