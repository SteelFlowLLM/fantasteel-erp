import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service';

@Injectable()
export class AuthRepository {
  findCredentialByEmployeeNo(tx: Tx, employeeNo: string) {
    return tx.employee.findUnique({ where: { employeeNo }, select: { id: true, passwordHash: true, isActive: true } });
  }
}
