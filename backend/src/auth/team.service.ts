import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { hasPassword, InvitesService } from './invites.service';

/** What a person looks like to whoever manages them. Never includes the password hash. */
export const userView = (u: Pick<User, 'id' | 'email' | 'role' | 'status' | 'lastLoginAt' | 'createdAt' | 'passwordHash'>) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  status: u.status,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
  hasPassword: hasPassword(u.passwordHash),
});

/** The people in a client workspace and the actions on them. Staff and a client's own main contact both use this; who may call it is decided by the controllers. */
@Injectable()
export class TeamService {
  constructor(private prisma: PrismaService, private invites: InvitesService) {}

  async members(clientId: string) {
    const [users, client, used] = await Promise.all([
      this.prisma.user.findMany({ where: { clientId, role: { not: Role.ADMIN } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { seatLimit: true } }),
      this.invites.seatsUsed(clientId),
    ]);
    return { members: users.map(userView), seats: { used, limit: client.seatLimit } };
  }

  /** A person who is not staff, in this client. 404 for anyone else, so ids from other workspaces reveal nothing. */
  async find(clientId: string | null, id: string, roles: Role[] = [Role.CLIENT_POC, Role.CLIENT_MEMBER]) {
    const user = await this.prisma.user.findFirst({ where: { id, ...(clientId ? { clientId } : {}), role: { in: roles } } });
    if (!user) throw new NotFoundException('Person not found.');
    return user;
  }

  invite(clientId: string, email: string, role: Role, invitedById: string) {
    return this.invites.invite({ clientId, email, role, invitedById });
  }

  resend(user: User, actorId: string) {
    if (user.status !== UserStatus.INVITED) throw new BadRequestException('Only people who have not joined yet can be sent a new invitation.');
    return this.invites.issue(user.id, 'INVITE', actorId);
  }

  resetLink(user: User, actorId: string) {
    if (user.status !== UserStatus.ACTIVE) throw new BadRequestException('A reset link is for people who have already joined. Send an invitation instead.');
    return this.invites.issue(user.id, 'RESET', actorId);
  }

  /** Shuts the person out at once: their sessions end and any link they hold stops working. */
  async disable(user: User) {
    await this.invites.revokeAll(user.id);
    return this.prisma.user.update({ where: { id: user.id }, data: { status: UserStatus.DISABLED, sessionVersion: { increment: 1 } } });
  }

  /** Brings someone back. They use a seat again, so there must be one free. They need a new invitation if they never set a password. */
  async enable(user: User) {
    if (user.status !== UserStatus.DISABLED) return user;
    if (user.clientId) {
      const client = await this.prisma.client.findUniqueOrThrow({ where: { id: user.clientId }, select: { seatLimit: true } });
      if ((await this.invites.seatsUsed(user.clientId)) >= client.seatLimit) {
        throw new BadRequestException({ statusCode: 400, code: 'SEAT_LIMIT', message: 'There is no free seat. Raise the seat limit or remove someone first.' });
      }
    }
    return this.prisma.user.update({ where: { id: user.id }, data: { status: hasPassword(user.passwordHash) ? UserStatus.ACTIVE : UserStatus.INVITED, failedAttempts: 0, lockedUntil: null } });
  }
}
