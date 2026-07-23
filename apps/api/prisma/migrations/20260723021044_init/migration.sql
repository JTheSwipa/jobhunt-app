-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "dateApplied" TIMESTAMP(3),
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "location" TEXT,
    "source" TEXT,
    "foundVia" TEXT,
    "atsPlatform" TEXT,
    "cvVersion" TEXT,
    "coverLetter" TEXT,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "responseDate" TIMESTAMP(3),
    "responseType" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobListing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'new',
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "country" TEXT,
    "site" TEXT NOT NULL,
    "datePosted" TIMESTAMP(3),
    "jobUrl" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "JobListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterCv" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterCv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CvProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "masterCvId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" JSONB NOT NULL,
    "order" JSONB NOT NULL,
    "style" TEXT NOT NULL DEFAULT 'default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CvProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Application_userId_idx" ON "Application"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobListing_jobUrl_key" ON "JobListing"("jobUrl");

-- CreateIndex
CREATE INDEX "JobListing_userId_idx" ON "JobListing"("userId");

-- CreateIndex
CREATE INDEX "JobListing_site_idx" ON "JobListing"("site");

-- CreateIndex
CREATE UNIQUE INDEX "MasterCv_userId_name_key" ON "MasterCv"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CvProfile_masterCvId_name_key" ON "CvProfile"("masterCvId", "name");

-- AddForeignKey
ALTER TABLE "CvProfile" ADD CONSTRAINT "CvProfile_masterCvId_fkey" FOREIGN KEY ("masterCvId") REFERENCES "MasterCv"("id") ON DELETE CASCADE ON UPDATE CASCADE;
