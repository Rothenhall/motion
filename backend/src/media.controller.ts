import { BadRequestException, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync, openSync, readSync, closeSync, promises as fs } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { Ctx, RequestContext, requireClient } from './tenancy/ctx';
import { MediaOwnershipService } from './tenancy/media-ownership.service';

export const UPLOAD_DIR = join(process.cwd(), 'uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

/** What the uploader names a file: a timestamp, a random part and the extension (defined in upload-names.ts). */
export { UPLOAD_NAME } from './upload-names';

/** The only types accepted, and the extension each is stored with. The extension never comes from the visitor's file name. */
const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
};

/** Does the start of the file look like the type the browser claimed? Stops an HTML or script file labelled as a picture. */
export function looksLike(mime: string, head: Buffer): boolean {
  const ascii = (from: number, to: number) => head.subarray(from, to).toString('latin1');
  switch (mime) {
    case 'image/jpeg': return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/png': return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/gif': return ascii(0, 4) === 'GIF8';
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'video/mp4': return ascii(4, 8) === 'ftyp';
    case 'video/quicktime': return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(4, 8));
    default: return false;
  }
}

function readHead(path: string): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    const n = readSync(fd, buf, 0, 16, 0);
    return buf.subarray(0, n);
  } finally { closeSync(fd); }
}

/** User uploads a file -> we host it publicly -> Meta fetches it when publishing. */
@Controller('media')
export class MediaController {
  constructor(private ownership: MediaOwnershipService) {}

  // A generous ceiling for a composer adding a carousel, low enough that one login cannot fill the disk in minutes.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomBytes(16).toString('hex')}.${TYPES[file.mimetype] ?? 'bin'}`),
      }),
      // Phone-recorded reels are often 30-80 MB; matches the audience simulation's own limit.
      limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 5, parts: 8 },
      fileFilter: (_req, file, cb) => {
        if (!TYPES[file.mimetype]) {
          return cb(new BadRequestException('Only JPG, PNG, WebP, GIF or MP4 files are allowed.') as any, false);
        }
        cb(null, true);
      },
    }),
  )
  async upload(@Ctx() ctx: RequestContext, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose a file to upload.');
    try {
      // The type the browser reports is only a claim: check the file itself.
      if (!looksLike(file.mimetype, readHead(file.path))) throw new BadRequestException('That file does not look like a real JPG, PNG, WebP, GIF or MP4.');
      // The file belongs to the client it was uploaded for, so another client cannot attach it to their own posts.
      await this.ownership.record(file.filename, requireClient(ctx), ctx.user.id);
    } catch (e) {
      await fs.unlink(file.path).catch(() => undefined); // never leave a file on disk that has no owner
      throw e;
    }
    const base = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const kind = file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE';
    return { url: `${base}/media/${file.filename}`, filename: file.originalname, size: file.size, kind };
  }
}
