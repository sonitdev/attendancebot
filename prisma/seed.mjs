import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial workforce organization and records...');

  // 1. Organization
  const org = await prisma.organization.upsert({
    where: { slug: 'acme' },
    update: {},
    create: {
      slug: 'acme',
      name: 'Acme Site Construction Ltd.',
    },
  });
  console.log(`Organization ready: ${org.name} (${org.id})`);

  // 2. Roles & Permissions
  const ownerRole = await prisma.role.upsert({
    where: {
      organizationId_code: {
        organizationId: org.id,
        code: 'OWNER',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      code: 'OWNER',
      name: 'Organization Owner',
    },
  });

  const hrRole = await prisma.role.upsert({
    where: {
      organizationId_code: {
        organizationId: org.id,
        code: 'HR',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      code: 'HR',
      name: 'Human Resources',
    },
  });

  const siteManagerRole = await prisma.role.upsert({
    where: {
      organizationId_code: {
        organizationId: org.id,
        code: 'SITE_MANAGER',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      code: 'SITE_MANAGER',
      name: 'Site Manager',
    },
  });

  // 3. Admin, HR, and Engineering Manager Users
  const adminUser = await prisma.user.upsert({
    where: {
      organizationId_email: {
        organizationId: org.id,
        email: 'admin@acme.com',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      email: 'admin@acme.com',
      status: 'ACTIVE',
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: ownerRole.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: ownerRole.id,
    },
  });

  const hrUser = await prisma.user.upsert({
    where: {
      organizationId_email: {
        organizationId: org.id,
        email: 'hr@acme.com',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      email: 'hr@acme.com',
      status: 'ACTIVE',
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: hrUser.id,
        roleId: hrRole.id,
      },
    },
    update: {},
    create: {
      userId: hrUser.id,
      roleId: hrRole.id,
    },
  });

  const engUser = await prisma.user.upsert({
    where: {
      organizationId_email: {
        organizationId: org.id,
        email: 'eng@acme.com',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      email: 'eng@acme.com',
      status: 'ACTIVE',
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: engUser.id,
        roleId: siteManagerRole.id,
      },
    },
    update: {},
    create: {
      userId: engUser.id,
      roleId: siteManagerRole.id,
    },
  });

  // 4. Project
  const project = await prisma.project.upsert({
    where: {
      organizationId_code: {
        organizationId: org.id,
        code: 'PRJ-ALPHA',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      code: 'PRJ-ALPHA',
      name: 'Riverside Tower Phase 1',
      status: 'ACTIVE',
    },
  });

  // 5. Site with Geofence & IANA Timezone
  let site = await prisma.site.findFirst({
    where: {
      organizationId: org.id,
      projectId: project.id,
      name: 'Main Construction Site A',
    },
  });

  if (!site) {
    site = await prisma.site.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        name: 'Main Construction Site A',
        latitude: 11.5564, // Phnom Penh Center
        longitude: 104.9282,
        allowedRadiusMeters: 100,
        timezone: 'Asia/Phnom_Penh',
        status: 'ACTIVE',
      },
    });
  }

  // 6. Work Schedule
  let schedule = await prisma.workSchedule.findFirst({
    where: {
      organizationId: org.id,
      name: 'Standard Day Shift',
    },
  });

  if (!schedule) {
    schedule = await prisma.workSchedule.create({
      data: {
        organizationId: org.id,
        name: 'Standard Day Shift',
        timezone: 'Asia/Phnom_Penh',
        startTime: '08:00',
        endTime: '17:00',
        graceMinutes: 15,
      },
    });
  }

  // 7. Employee
  const employee = await prisma.employee.upsert({
    where: {
      organizationId_employeeCode: {
        organizationId: org.id,
        employeeCode: 'EMP-001',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      employeeCode: 'EMP-001',
      fullName: 'Sokha Chan',
      jobTitle: 'Site Technician',
      phone: '+85512345678',
      status: 'ACTIVE',
    },
  });

  // 8. Assignment (from 2026-01-01 to 2026-12-31)
  let assignment = await prisma.assignment.findFirst({
    where: {
      organizationId: org.id,
      employeeId: employee.id,
      siteId: site.id,
      scheduleId: schedule.id,
      status: 'ACTIVE',
    },
  });

  if (!assignment) {
    assignment = await prisma.assignment.create({
      data: {
        organizationId: org.id,
        employeeId: employee.id,
        siteId: site.id,
        scheduleId: schedule.id,
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-12-31T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });
  }

  console.log('Database seeding completed successfully:');
  console.log({
    organization: org.name,
    project: project.name,
    site: site.name,
    schedule: schedule.name,
    employee: employee.fullName,
    assignmentId: assignment.id,
  });
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
