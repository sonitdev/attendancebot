CREATE INDEX "Site_organizationId_projectId_status_idx"
ON "Site"("organizationId", "projectId", "status");

CREATE INDEX "Assignment_organizationId_siteId_startsOn_status_idx"
ON "Assignment"("organizationId", "siteId", "startsOn", "status");
