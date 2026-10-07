import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { PublishersService } from './publishers.service';

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
      // A suspended client's posts wait where they are; they are picked up again when the client is reactivated.
      where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() }, account: { NOT: { client: { status: 'SUSPENDED' } } } },
      select: { id: true },
      orderBy: { scheduledAt: 'asc' },
      take: 10,
    });
    const claimed: string[] = [];
    for (const p of due) {
      const r = await this.prisma.scheduledPost.updateMany({ where: { id: p.id, status: 'SCHEDULED' }, data: { status: 'PUBLISHING', error: null } });
      if (r.count === 1) claimed.push(p.id);
    }
    await Promise.allSettled(claimed.map((id) => this.pub.publish(id)));
  }
}
