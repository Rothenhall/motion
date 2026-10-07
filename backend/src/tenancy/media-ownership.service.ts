import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { uploadNamesIn } from '../upload-names';

/**
 * Uploads are public by URL (Meta has to fetch them), but each one belongs to the client that uploaded it. Without
 * this check a client who learned another client's file name could attach that file to their own post or check.
 */
@Injectable()
export class MediaOwnershipService {
  constructor(private prisma: PrismaService) {}

  async record(name: string, clientId: string, uploadedById?: string) {
    await this.prisma.mediaFile.upsert({ where: { name }, update: {}, create: { name, clientId, uploadedById } });
  }

  /**
   * Refuses uploads that belong to another client. Pasted external links are not Motion's to judge, and files
   * uploaded before ownership was recorded have no owner, so both pass.
   */
  async assertUsable(clientId: string, urls: string[]) {
    const names = urls.flatMap((u) => uploadNamesIn(JSON.stringify([u])));
    if (!names.length) return;
    const owned = await this.prisma.mediaFile.findMany({ where: { name: { in: names } }, select: { clientId: true } });
    if (owned.some((f) => f.clientId !== clientId)) throw new BadRequestException('That file is not available. Upload it again.');
  }
}
