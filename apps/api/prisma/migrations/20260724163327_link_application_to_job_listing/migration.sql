-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "jobListingId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Application_jobListingId_key" ON "Application"("jobListingId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobListingId_fkey" FOREIGN KEY ("jobListingId") REFERENCES "JobListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

