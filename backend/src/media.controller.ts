import { BadRequestException, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Ctx, RequestContext, requireClient } from './tenancy/ctx';
import { MediaOwnershipService } from './tenancy/media-ownership.service';

export const UPLOAD_DIR = join(process.cwd(), 'uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

/** What the uploader names a file: a timestamp, eight hex characters and the extension (defined in upload-names.ts). */
export { UPLOAD_NAME } from './upload-names';

const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime',
]);

/** User uploads a file -> we host it publicly -> Meta fetches it when publishing. */
@Controller('media')
export class MediaController {
  constructor(private ownership: MediaOwnershipService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
          cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`);
        },
      }),
      // Phone-recorded reels are often 30-80 MB; matches the audience simulation's own limit.
      limits: { fileSize: 100 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED.has(file.mimetype)) {
          return cb(new BadRequestException('Only JPG, PNG, WebP, GIF or MP4 files are allowed.') as any, false);
        }
        cb(null, true);
      },
    }),
  )
  async upload(@Ctx() ctx: RequestContext, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    // The file belongs to the client it was uploaded for, so another client cannot attach it to their own posts.
    await this.ownership.record(file.filename, requireClient(ctx), ctx.user.id);
    const base = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const kind = file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE';
    return { url: `${base}/media/${file.filename}`, filename: file.originalname, size: file.size, kind };
  }
}
