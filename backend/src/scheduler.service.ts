import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { PublishersService } from './publishers.service';

/** Posts that have not been through review, or have been approved. Posts waiting on a decision are never published. */
const CLEARED = [{ approvalStatus: null }, { approvalStatus: 'APPROVED' }];

@Injectable()
export class SchedulerService {
  constructor(private prisma: PrismaService, private pub: PublishersService) {}

  /**
   * Claims each due post (SCHEDULED -> PUBLISHING in one conditional update)
   * before publishing it. A slow publish (video processing can take minutes)
   * can outlast the next tick; that tick finds the post already claimed and
   * leaves it alone, so nothing is published twice.
   */
  @Cron('*/1 * * * *')
  async tick() {
    const due = await this.prisma.scheduledPost.findMany({
      // A suspended client's posts, and posts on a disconnected channel, wait where they are: they go out again once the client
      // is reactivated or the channel is reconnected.
      where: { status: 'SCHEDULED', OR: CLEARED, scheduledAt: { lte: new Date() }, account: { disconnectedAt: null, NOT: { client: { status: 'SUSPENDED' } } } },
      select: { id: true },
      orderBy: { scheduledAt: 'asc' },
      take: 10,
    });
    const claimed: string[] = [];
    for (const p of due) {
      const r = await this.prisma.scheduledPost.updateMany({ where: { id: p.id, status: 'SCHEDULED', OR: CLEARED }, data: { status: 'PUBLISHING', error: null } });
      if (r.count === 1) claimed.push(p.id);
    }
    await Promise.allSettled(claimed.map((id) => this.pub.publish(id)));
  }
}
