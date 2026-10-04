import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { PublishersService } from './publishers.service';

@Injectable()
export class SchedulerService {
  constructor(private prisma: PrismaService, private pub: PublishersService) {}

  @Cron('*/1 * * * *')
  async tick() {
    const due = await this.prisma.scheduledPost.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
      take: 10,
    });
    for (const p of due) await this.pub.publish(p.id);
  }
}
