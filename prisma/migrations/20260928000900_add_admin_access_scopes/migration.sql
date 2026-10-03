CREATE TABLE "UserProjectScope" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserProjectScope_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserProjectScope_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UserProjectScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserProjectScope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "UserSiteScope" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserSiteScope_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserSiteScope_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UserSiteScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserSiteScope_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserProjectScope_userId_projectId_key" ON "UserProjectScope"("userId", "projectId");
CREATE INDEX "UserProjectScope_organizationId_userId_idx" ON "UserProjectScope"("organizationId", "userId");
CREATE INDEX "UserProjectScope_organizationId_projectId_idx" ON "UserProjectScope"("organizationId", "projectId");
CREATE UNIQUE INDEX "UserSiteScope_userId_siteId_key" ON "UserSiteScope"("userId", "siteId");
CREATE INDEX "UserSiteScope_organizationId_userId_idx" ON "UserSiteScope"("organizationId", "userId");
CREATE INDEX "UserSiteScope_organizationId_siteId_idx" ON "UserSiteScope"("organizationId", "siteId");
