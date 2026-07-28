-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "cvRenderId" TEXT;

-- AlterTable
ALTER TABLE "CvProfile" ADD COLUMN     "headline" TEXT,
ADD COLUMN     "summary" TEXT;

-- CreateTable
CREATE TABLE "CvRender" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "cvProfileId" TEXT,
    "profileName" TEXT NOT NULL,
    "masterCvId" TEXT,
    "resolvedData" JSONB NOT NULL,
    "order" JSONB NOT NULL,
    "style" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "pdfPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CvRender_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CvRender_userId_idx" ON "CvRender"("userId");

-- CreateIndex
CREATE INDEX "CvRender_contentHash_idx" ON "CvRender"("contentHash");

-- CreateIndex
CREATE INDEX "Application_cvRenderId_idx" ON "Application"("cvRenderId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_cvRenderId_fkey" FOREIGN KEY ("cvRenderId") REFERENCES "CvRender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvRender" ADD CONSTRAINT "CvRender_cvProfileId_fkey" FOREIGN KEY ("cvProfileId") REFERENCES "CvProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvRender" ADD CONSTRAINT "CvRender_masterCvId_fkey" FOREIGN KEY ("masterCvId") REFERENCES "MasterCv"("id") ON DELETE SET NULL ON UPDATE CASCADE;
