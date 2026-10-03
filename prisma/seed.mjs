import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Database is intentionally empty. Create the first real organization and owner through the Admin registration page.');
}

main()
  .catch((error) => {
    console.error('Seed verification failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
