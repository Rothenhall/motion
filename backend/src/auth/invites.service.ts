import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { hashPassword } from './crypto';

export const INVITE_TTL_MS = 72 * 3_600_000;
export const RESET_TTL_MS = 24 * 3_600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The stored password of someone who has not set one yet. It is not a valid hash, so no password can ever match it. */
export const NO_PASSWORD = '!no-password-yet';
export const hasPassword = (stored: string) => stored.startsWith('scrypt$');

type TokenType = 'INVITE' | 'RESET';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Invite and password-reset links. The link carries a random token; only its hash is stored, so a copy of the database
 * does not contain a working link. Each link works once and expires.
 */
@Injectable()
export class InvitesService {
  constructor(private prisma: PrismaService) {}

  linkFor(type: TokenType, token: string) {
    const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    return `${base}/${type === 'INVITE' ? 'accept-invite' : 'reset-password'}?token=${encodeURIComponent(token)}`;
  }

  /** Seats a client has used: active and invited users, not counting staff. */
  seatsUsed(clientId: string) {
    return this.prisma.user.count({ where: { clientId, role: { not: Role.ADMIN }, status: { in: [UserStatus.ACTIVE, UserStatus.INVITED] } } });
  }

  /** A new link for a user. Any earlier unused link of the same kind stops working. */
  async issue(userId: string, type: TokenType, createdById?: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + (type === 'INVITE' ? INVITE_TTL_MS : RESET_TTL_MS));
    await this.prisma.$transaction([
      this.prisma.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.authToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt, createdById } }),
    ]);
    return { token, url: this.linkFor(type, token), expiresAt };
  }

  /** Invites a person to a client. Throws if the email is taken or the client has no free seat. */
  async invite(opts: { clientId: string; email: string; role: Role; invitedById: string }) {
    const email = opts.email?.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) throw new BadRequestException('Enter a valid email address.');
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) throw new ConflictException('That email already has an account.');
    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: opts.clientId }, select: { seatLimit: true } });
    if ((await this.seatsUsed(opts.clientId)) >= client.seatLimit) {
      throw new BadRequestException({ statusCode: 400, code: 'SEAT_LIMIT', message: `This workspace has used all ${client.seatLimit} seats. Remove someone or ask your account manager for more.` });
    }
    const user = await this.prisma.user.create({
      data: { email, passwordHash: NO_PASSWORD, role: opts.role, status: UserStatus.INVITED, clientId: opts.clientId, invitedById: opts.invitedById },
    });
    return { user, ...(await this.issue(user.id, 'INVITE', opts.invitedById)) };
  }

  /** The link's owner, if the link is real, unused and unexpired. Does not use it up. */
  async inspect(token: string | undefined, type: TokenType) {
    if (!token || typeof token !== 'string' || token.length > 200) return null;
    const row = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { client: { select: { name: true, status: true } } } } } });
    if (!row || row.type !== type || row.usedAt || row.expiresAt <= new Date()) return null;
    if (row.user.status === UserStatus.DISABLED) return null;
    return row;
  }

  /** Sets the person's password and uses the link up, in one step: two people holding the same link cannot both win. */
  async redeem(token: string | undefined, type: TokenType, password: string) {
    if (password.length < 8) throw new BadRequestException('Use a password of at least 8 characters.');
    const row = await this.inspect(token, type);
    if (!row) return null;
    const passwordHash = await hashPassword(password);
    return this.prisma.$transaction(async (tx) => {
      const used = await tx.authToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (used.count !== 1) return null;
      return tx.user.update({
        where: { id: row.userId },
        data: { passwordHash, status: UserStatus.ACTIVE, failedAttempts: 0, lockedUntil: null, sessionVersion: { increment: type === 'RESET' ? 1 : 0 } },
      });
    });
  }

  /** Stop every unused link for a user, for example when they are disabled. */
  revokeAll(userId: string) {
    return this.prisma.authToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  }
}
