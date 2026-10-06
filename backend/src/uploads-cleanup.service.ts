import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from './prisma.service';
import { UPLOAD_DIR, UPLOAD_NAME } from './media.controller';

const DAY = 86_400_000;

/** The upload file names a stored mediaUrls value (a JSON array of URLs) points at, whatever host the URLs carry. */
function filesIn(json: string): string[] {
  try {
    const urls: unknown = JSON.parse(json);
    if (!Array.isArray(urls)) return [];
    return urls.flatMap((u) => {
      try { return [new URL(String(u)).pathname.replace(/^\/media\//, '')]; } catch { return []; }
    });
  } catch { return []; }
}

/**
 * Uploads pile up: removed posts, abandoned composers and deleted accounts leave files behind. This finds the files that
 * no post, draft or pre-flight check points at and that are older than the grace period. It only deletes them when
 * UPLOAD_CLEANUP=on; until then it logs what it would remove, so you can look before you let it delete anything.
 */
@Injectable()
export class UploadsCleanupService {
  private log = new Logger(UploadsCleanupService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('30 3 * * *')
  async nightly() {
    try { await this.sweep(); } catch (e) { this.log.warn(`Upload cleanup failed: ${e instanceof Error ? e.message : e}`); }
  }

  async sweep({ dir = UPLOAD_DIR, now = Date.now() } = {}) {
    const days = Number(process.env.UPLOAD_CLEANUP_DAYS) > 0 ? Number(process.env.UPLOAD_CLEANUP_DAYS) : 14;
    const enabled = process.env.UPLOAD_CLEANUP === 'on';

    // References first, then the folder: a file uploaded in between is newer than the grace period, so it is never a candidate.
    const kept = new Set<string>();
    const tables = await Promise.all([
      this.prisma.scheduledPost.findMany({ select: { mediaUrls: true } }),
      this.prisma.postDraft.findMany({ select: { mediaUrls: true } }),
      this.prisma.contentCheck.findMany({ select: { mediaUrls: true } }),
    ]);
    for (const rows of tables) for (const row of rows) for (const file of filesIn(row.mediaUrls)) kept.add(file);

    const orphans: { name: string; size: number }[] = [];
    for (const name of await fs.readdir(dir)) {
      if (!UPLOAD_NAME.test(name) || kept.has(name)) continue; // only files Motion's own uploader named
      const stat = await fs.stat(join(dir, name)).catch(() => null);
      if (!stat?.isFile() || now - stat.mtimeMs < days * DAY) continue;
      orphans.push({ name, size: stat.size });
    }

    let removed = 0;
    if (enabled) {
      for (const { name } of orphans) {
        try { await fs.unlink(join(dir, name)); removed++; } catch (e) { this.log.warn(`Could not remove ${name}: ${e instanceof Error ? e.message : e}`); }
      }
    }
    const mb = (orphans.reduce((sum, o) => sum + o.size, 0) / 1_048_576).toFixed(1);
    if (orphans.length) this.log.log(`${enabled ? `Removed ${removed} of ${orphans.length}` : `Would remove ${orphans.length}`} unused uploads older than ${days} days (${mb} MB).${enabled ? '' : ' Set UPLOAD_CLEANUP=on to delete them.'}`);
    return { orphans: orphans.map((o) => o.name), removed };
  }
}
